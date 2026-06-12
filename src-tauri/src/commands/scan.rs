use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Instant;

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

use tracing::info;

use crate::core::{
    logging,
    models::{
        InstanceValidation, ScanDiffResult, ScanPhase, ScanProgress, ScanSummary, StageStatus,
    },
    paths, scanner, settings,
};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

/// Resolve a user-provided path to a canonical form to prevent path traversal.
/// Uses `canonicalize` if the path exists, otherwise manually resolves
/// `..` and `.` components.
fn sanitize_instance_path(input: &str) -> Result<String, String> {
    let path = Path::new(input);

    // Prefer canonicalize when path exists (resolves symlinks and ..)
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical.to_string_lossy().to_string());
    }

    // Fallback: manually resolve components
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                if components.is_empty() {
                    return Err("路径越权：试图跳出根目录".to_string());
                }
                components.pop();
            }
            Component::Normal(c) => {
                components.push(c.to_string_lossy().to_string());
            }
            Component::RootDir => {
                components.clear();
            }
            _ => {}
        }
    }

    if components.is_empty() {
        return Err("无效的实例路径".to_string());
    }

    let mut result = PathBuf::new();
    for c in components {
        result.push(c);
    }
    Ok(result.to_string_lossy().to_string())
}

#[tauri::command]
pub fn validate_instance(path: String) -> Result<InstanceValidation, String> {
    let safe_path = sanitize_instance_path(&path)?;
    scanner::validate_instance(safe_path).map_err(|err| err.to_string())
}

#[derive(Debug, Clone, Copy)]
struct ScanSummaryMetrics {
    mod_entries: usize,
    resource_pack_entries: usize,
    text_bytes: usize,
}

#[derive(Debug)]
struct PersistStats {
    path: PathBuf,
    file_size_bytes: Option<u64>,
}

impl ScanSummaryMetrics {
    fn total_entries(self) -> usize {
        self.mod_entries + self.resource_pack_entries
    }
}

fn scan_summary_metrics(summary: &ScanSummary) -> ScanSummaryMetrics {
    let mut metrics = ScanSummaryMetrics {
        mod_entries: 0,
        resource_pack_entries: 0,
        text_bytes: 0,
    };

    for mod_result in &summary.mods {
        metrics.mod_entries += mod_result.entries.len();
        metrics.text_bytes += mod_result
            .entries
            .iter()
            .map(|entry| entry.text.len() + entry.key.len())
            .sum::<usize>();
    }
    for resource_pack in &summary.resource_packs {
        metrics.resource_pack_entries += resource_pack.entries.len();
        metrics.text_bytes += resource_pack
            .entries
            .iter()
            .map(|entry| entry.text.len() + entry.key.len())
            .sum::<usize>();
    }

    metrics
}

fn persist_scan_summary(root: &Path, summary: &ScanSummary) -> Result<PersistStats, String> {
    let job_path = paths::job_state_path(root, &summary.job_id);
    if let Some(parent) = job_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("创建扫描结果目录失败 ({}): {err}", parent.display()))?;
    }
    let file = File::create(&job_path)
        .map_err(|err| format!("创建扫描结果失败 ({}): {err}", job_path.display()))?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, summary)
        .map_err(|err| format!("序列化扫描结果失败: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("写入扫描结果失败 ({}): {err}", job_path.display()))?;

    let file_size_bytes = match std::fs::metadata(&job_path) {
        Ok(metadata) => Some(metadata.len()),
        Err(err) => {
            tracing::warn!("读取扫描结果文件大小失败 ({}): {err}", job_path.display());
            None
        }
    };

    Ok(PersistStats {
        path: job_path,
        file_size_bytes,
    })
}

fn strip_scan_summary_entries(summary: &mut ScanSummary) {
    for mod_result in &mut summary.mods {
        mod_result.entries.clear();
    }
    for resource_pack in &mut summary.resource_packs {
        resource_pack.entries.clear();
    }
}

#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    let command_started = Instant::now();
    let safe_path = sanitize_instance_path(&path)?;
    SCAN_CANCEL.store(false, Ordering::SeqCst);
    logging::append_main(format!(
        "扫描性能: 开始 path={safe_path}, source={source_language}, target={target_language}"
    ))
    .ok();

    let root = paths::runtime_root().map_err(|err| err.to_string())?;
    // Bounded channel prevents unbounded memory growth if receiver is temporarily blocked.
    let (progress_tx, progress_rx) = mpsc::sync_channel::<ScanProgress>(64);
    let progress_tx_scan = progress_tx.clone();

    let app_emit = app.clone();
    let scan_progress_handle = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("scan-progress", &progress) {
                tracing::error!("scan-progress emit error: {err}");
            }
        }
    });

    let root_for_save = root.clone();

    let scan_started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let settings = settings::load_settings(&root).map_err(|e| e.to_string())?;
        let pack_names = {
            let has_placeholder = settings
                .resource_pack_names
                .iter()
                .any(|n| n.contains("{{mc_version}}"));
            match settings::detect_mc_version(&settings.instance_path) {
                Ok(ver) => {
                    let replaced = settings::apply_placeholders(&settings, &ver);
                    replaced.resource_pack_names
                }
                Err(e) if has_placeholder => {
                    return Err(format!(
                        "MC 版本检测失败，且 resourcePackNames 中包含 {{mc_version}} 占位符: {e}"
                    ));
                }
                Err(_) => settings.resource_pack_names.clone(),
            }
        };
        scanner::scan_instance(
            safe_path,
            source_language,
            target_language,
            pack_names,
            &|| SCAN_CANCEL.load(Ordering::SeqCst),
            &|progress: ScanProgress| {
                let _ = progress_tx_scan.send(progress);
            },
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    let scan_elapsed_ms = scan_started.elapsed().as_millis();

    drop(progress_tx);
    let progress_join_started = Instant::now();
    if let Err(e) = scan_progress_handle.await {
        tracing::error!("扫描进度读取器 panic: {:?}", e);
    }
    let progress_join_elapsed_ms = progress_join_started.elapsed().as_millis();
    let mut summary = result.map_err(|err| err.to_string())?;
    let full_metrics = scan_summary_metrics(&summary);
    logging::append_main(format!(
        "扫描性能: 扫描阶段完成 job_id={}, 耗时={}ms, mods={}, resource_packs={}, entries={}, text_bytes≈{}, progress_drain={}ms",
        summary.job_id,
        scan_elapsed_ms,
        summary.mods.len(),
        summary.resource_packs.len(),
        full_metrics.total_entries(),
        full_metrics.text_bytes,
        progress_join_elapsed_ms
    ))
    .ok();

    // Persist before returning so the translation pipeline can reuse this scan
    // by scan_job_id without racing a background writer.
    if !summary.cancelled {
        let _ = app.emit(
            "scan-progress",
            &ScanProgress {
                current: 0,
                total: 1,
                mod_name: String::new(),
                phase: ScanPhase::Persist,
                sub_step: Some("保存扫描结果".to_string()),
                stage_status: StageStatus::Running,
            },
        );
        let persist_started = Instant::now();
        let (saved_summary, persist_stats) = tauri::async_runtime::spawn_blocking(move || {
            let persist_stats = persist_scan_summary(&root_for_save, &summary)?;
            Ok::<(ScanSummary, PersistStats), String>((summary, persist_stats))
        })
        .await
        .map_err(|err| format!("扫描结果保存线程失败: {err}"))??;
        summary = saved_summary;
        let persist_elapsed_ms = persist_started.elapsed().as_millis();
        logging::append_main(format!(
            "扫描性能: 保存扫描结果完成 job_id={}, 耗时={}ms, file_size={}bytes, path={}",
            summary.job_id,
            persist_elapsed_ms,
            persist_stats
                .file_size_bytes
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            persist_stats.path.display()
        ))
        .ok();

        let strip_started = Instant::now();
        let before_strip_metrics = scan_summary_metrics(&summary);
        strip_scan_summary_entries(&mut summary);
        let after_strip_metrics = scan_summary_metrics(&summary);
        let strip_elapsed_ms = strip_started.elapsed().as_millis();
        logging::append_main(format!(
            "扫描性能: UI 返回体瘦身完成 job_id={}, 耗时={}ms, stripped_entries={}, stripped_text_bytes≈{}, return_entries={}, return_text_bytes≈{}",
            summary.job_id,
            strip_elapsed_ms,
            before_strip_metrics.total_entries().saturating_sub(after_strip_metrics.total_entries()),
            before_strip_metrics.text_bytes.saturating_sub(after_strip_metrics.text_bytes),
            after_strip_metrics.total_entries(),
            after_strip_metrics.text_bytes
        ))
        .ok();
        let _ = app.emit(
            "scan-progress",
            &ScanProgress {
                current: 1,
                total: 1,
                mod_name: String::new(),
                phase: ScanPhase::Persist,
                sub_step: Some("扫描结果已保存".to_string()),
                stage_status: StageStatus::Completed,
            },
        );
    }

    logging::append_main(format!(
        "扫描性能: 命令返回前完成 job_id={}, total_elapsed={}ms",
        summary.job_id,
        command_started.elapsed().as_millis()
    ))
    .ok();
    Ok(summary)
}

#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn pick_instance_folder(
    app: tauri::AppHandle,
    locale: Option<String>,
) -> Result<Option<String>, String> {
    info!("pick_instance_folder");
    let _ = locale;
    match app
        .dialog()
        .file()
        .set_title("选择实例")
        .blocking_pick_folder()
    {
        Some(path) => {
            let path_str = path
                .into_path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

/// Compare a fresh scan against the previous scan to detect new mods.
/// Returns diff information so the frontend can prompt the user for incremental translation.
#[tauri::command]
pub async fn scan_and_diff(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanDiffResult, String> {
    info!(
        "scan_and_diff: path={}, source={}, target={}",
        path, source_language, target_language
    );

    // 1. Load the most recent previous scan
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let old_summary = {
        let mgr = crate::core::jobs::JobManager::new(root.clone());
        match mgr.load_latest() {
            Ok(Some(job)) => {
                // Load the scan that this job was based on
                let scan_path = paths::job_state_path(&root, &job.scan_job_id);
                if scan_path.is_file() {
                    let content = std::fs::read_to_string(&scan_path)
                        .map_err(|e| format!("读取旧扫描结果失败: {e}"))?;
                    serde_json::from_str::<ScanSummary>(&content).ok()
                } else {
                    None
                }
            }
            _ => None,
        }
    };

    // 2. Run a fresh scan
    let new_summary = scan_instance(app.clone(), path, source_language, target_language).await?;

    // 3. Detect new mods
    let old_mod_ids: HashSet<&str> = old_summary
        .as_ref()
        .map(|s| s.mods.iter().map(|m| m.mod_id.as_str()).collect())
        .unwrap_or_default();
    let new_mods: Vec<String> = new_summary
        .mods
        .iter()
        .filter(|m| !old_mod_ids.contains(m.mod_id.as_str()))
        .map(|m| m.mod_id.clone())
        .collect();

    let old_mod_count = old_summary.map(|s| s.mods.len()).unwrap_or(0);

    let new_mod_count = new_mods.len();
    Ok(ScanDiffResult {
        new_summary,
        new_mods,
        new_mod_count,
        old_mod_count,
    })
}
