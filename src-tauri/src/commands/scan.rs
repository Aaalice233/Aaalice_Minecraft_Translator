use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

use tracing::info;

use crate::core::{
    models::{InstanceValidation, ScanDiffResult, ScanProgress, ScanSummary},
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

#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    let safe_path = sanitize_instance_path(&path)?;
    SCAN_CANCEL.store(false, Ordering::SeqCst);

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
    tauri::async_runtime::spawn(async move {
        if let Err(e) = scan_progress_handle.await {
            tracing::error!("扫描进度读取器 panic: {:?}", e);
        }
    });

    let root_for_save = root.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let pack_names = settings::load_settings(&root)
            .ok()
            .map(|s| s.resource_pack_names)
            .unwrap_or_default();
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
    })
    .await
    .map_err(|e| e.to_string())?;

    drop(progress_tx);
    let summary = result.map_err(|err| err.to_string())?;

    // Write scan result to disk asynchronously
    if !summary.cancelled {
        let root_for_log = root_for_save;
        let summary_clone = summary.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Ok(json) = serde_json::to_string_pretty(&summary_clone) {
                let job_path = paths::job_state_path(&root_for_log, &summary_clone.job_id);
                if let Some(parent) = job_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(err) = std::fs::write(&job_path, json) {
                    let _ = crate::core::logging::append_main(format!("扫描结果写入失败 ({}): {err}", job_path.display()));
                }
            }
        });
    }

    Ok(summary)
}

#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn pick_instance_folder(app: tauri::AppHandle, locale: Option<String>) -> Result<Option<String>, String> {
    info!("pick_instance_folder");
    let _ = locale;
    match app.dialog().file().set_title("选择实例").blocking_pick_folder() {
        Some(path) => {
            let path_str = path.into_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
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
    info!("scan_and_diff: path={}, source={}, target={}", path, source_language, target_language);

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
