use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

use crate::core::{
    dictionary, llm,
    logging,
    models::{
        InstanceValidation, LanguageEntry, LlmModel, LlmModelsResponse, ScanProgress,
        ScanSummary, Settings, StageStatus, TokenUsage, TranslateLogEntry, TranslateProgress,
    },
    jobs,
    packer,
    paths, scanner, settings, shield,
};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);
/// AtomicBool used by the scanner during translation's fallback re-scan.
/// Set to true on cancel so the scanner stops promptly.
static TRANSLATE_CANCEL: AtomicBool = AtomicBool::new(false);
/// Active translation task ID. Stores the current job_id when translating.
/// Set to None when idle or cancelled. Translation loops check this to detect cancellation.
static ACTIVE_TRANSLATE_TASK: Mutex<Option<String>> = Mutex::new(None);

/// Returns true if the translation task with the given job_id has been cancelled.
/// Checks both the explicit cancel flag AND the task ID — whichever fires first wins.
fn is_translation_cancelled(job_id: &str) -> bool {
    if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
        return true;
    }
    ACTIVE_TRANSLATE_TASK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(true, |active| active != job_id)
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    settings::load_settings(&paths::runtime_root().map_err(to_message)?).map_err(to_message)
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    settings::save_settings(&paths::runtime_root().map_err(to_message)?, &settings)
        .map_err(to_message)
}

#[tauri::command]
pub fn validate_instance(path: String) -> Result<InstanceValidation, String> {
    scanner::validate_instance(path).map_err(to_message)
}

#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    // Reset cancel flag for this scan
    SCAN_CANCEL.store(false, Ordering::SeqCst);

    let root = paths::runtime_root().map_err(to_message)?;

    // Channel: relay progress from blocking/rayon threads → async runtime context.
    // This avoids calling app.emit() from inside rayon's thread pool (which may
    // not reliably deliver events to the webview on Windows).
    let (progress_tx, progress_rx) = mpsc::channel::<ScanProgress>();
    let progress_tx_scan = progress_tx.clone();

    // Spawn a reader that receives progress from the channel and emits events
    // from a tokio blocking thread (not from rayon's thread pool), ensuring
    // events reliably reach the webview on Windows.
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("scan-progress", &progress) {
                eprintln!("scan-progress emit error: {err}");
            }
        }
    });

    // Read pack names from persisted settings for resource pack filtering
    let settings = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = settings
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    // Clone root before moving into the blocking closure
    let root_for_save = root.clone();

    // Run the actual scan on a blocking thread; the scanner sends progress
    // updates through the channel instead of calling emit directly.
    let result = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_instance(
            &root,
            path,
            source_language,
            target_language,
            i18n_pack_name,
            vm_pack_name,
            &SCAN_CANCEL,
            &|progress: ScanProgress| {
                let _ = progress_tx_scan.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    // Drop our sender so the channel closes, letting the reader task exit.
    drop(progress_tx);

    let summary = result.map_err(to_message)?;

    // Persist scan result to data/jobs/scan_{jobId}.json (skip if cancelled)
    if !summary.cancelled {
        match serde_json::to_string_pretty(&summary) {
            Ok(json) => {
                let job_path = paths::job_state_path(&root_for_save, &summary.job_id);
                if let Some(parent) = job_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(err) = std::fs::write(&job_path, json) {
                    eprintln!("扫描结果写入失败 ({}): {err}", job_path.display());
                }
            }
            Err(err) => {
                eprintln!("扫描结果序列化失败: {err}");
            }
        }
    }

    Ok(summary)
}

/// Request cancellation of the current scan.
/// The current stage completes before the scan stops (stage-boundary cancel).
#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(path).map_err(to_message)
}

#[tauri::command]
pub fn fetch_llm_models(base_url: String, api_key: String) -> Result<LlmModelsResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(to_message)?;
    let urls = model_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let response = client
            .get(&url)
            .bearer_auth(&api_key)
            .send()
            .map_err(to_message);

        let Ok(response) = response else {
            last_error = "模型列表请求失败".to_string();
            continue;
        };

        if !response.status().is_success() {
            last_error = format!("模型列表请求失败：HTTP {}", response.status());
            continue;
        }

        let body: serde_json::Value = response.json().map_err(to_message)?;
        let models = body
            .get("data")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?.to_string();
                        let owned_by = item
                            .get("owned_by")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string();
                        Some(LlmModel { id, owned_by })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        return Ok(LlmModelsResponse {
            models,
            source_url: url,
        });
    }

    Err(if last_error.is_empty() {
        "未能拉取模型列表".to_string()
    } else {
        last_error
    })
}


#[tauri::command]
pub fn pick_instance_folder(app: tauri::AppHandle, locale: Option<String>) -> Result<Option<String>, String> {
    // locale is accepted for future use; native dialog locale is OS-controlled
    let _ = locale;
    match app.dialog().file().set_title("选择实例").blocking_pick_folder() {
        Some(path) => {
            let path_str = path.into_path().map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn model_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        vec![format!("{trimmed}/models")]
    } else {
        vec![format!("{trimmed}/models"), format!("{trimmed}/v1/models")]
    }
}

// ── P2: Dictionary commands ─────────────────────────────────────────

#[tauri::command]
pub fn search_dictionary(
    search: Option<String>,
    source_type: Option<String>,
    mod_id: Option<String>,
    source_lang: Option<String>,
    target_lang: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<dictionary::DictionaryEntry>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let query = dictionary::DictionaryQuery {
        search,
        source_type,
        mod_id,
        source_lang,
        target_lang,
        limit,
        offset,
    };
    dictionary::search(&conn, &query).map_err(to_message)
}

#[tauri::command]
pub fn update_dictionary_entry(id: i64, target_text: String) -> Result<bool, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    dictionary::update_translation(&conn, id, &target_text).map_err(to_message)
}

#[tauri::command]
pub fn delete_dictionary_entry(id: i64) -> Result<bool, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    dictionary::delete(&conn, id).map_err(to_message)
}

#[tauri::command]
pub fn export_dictionary(file_path: String) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let lines = dictionary::export_jsonl(&conn).map_err(to_message)?;
    let content = lines.join("\n");
    std::fs::write(&file_path, content).map_err(to_message)?;
    Ok(lines.len())
}

#[tauri::command]
pub fn import_dictionary(file_path: String) -> Result<dictionary::ImportResult, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let content = std::fs::read_to_string(&file_path).map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let lines: Vec<&str> = content.lines().collect();
    dictionary::import_jsonl(&conn, &lines).map_err(to_message)
}

#[tauri::command]
pub fn get_dictionary_stats() -> Result<dictionary::DictionaryStats, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let total = dictionary::count(&conn).map_err(to_message)?;
    let mod_ids = dictionary::distinct_mod_ids(&conn).map_err(to_message)?;
    Ok(dictionary::DictionaryStats { total, mod_ids })
}

// ── P4: Pack command ────────────────────────────────────────────────

#[tauri::command]
pub fn generate_translation_pack(
    entries: Vec<packer::PackEntry>,
    target_language: String,
    dry_run: bool,
) -> Result<packer::PackResult, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(to_message)?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: "Aaalice-MC-Translator".to_string(),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
    };

    packer::generate_pack(&options).map_err(to_message)
}

#[tauri::command]
pub fn copy_pack_to_instance(
    pack_zip_path: String,
    instance_path: String,
    overwrite: bool,
) -> Result<packer::CopyResult, String> {
    packer::copy_to_resourcepacks(&pack_zip_path, &instance_path, overwrite).map_err(to_message)
}

// ── Translation commands ────────────────────────────────────────────

#[tauri::command]
pub async fn start_translation(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
    total_entries: Option<usize>,
    scan_job_id: Option<String>,
) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let job_id = logging::new_job_id("translate");

    // Clear the cancel flag BEFORE registering the task ID.
    // This ordering prevents a race where cancel_translation() fires between
    // the two stores and the CANCEL=true is overwritten. Now is_translation_cancelled()
    // checks CANCEL first, so whichever variable captures the cancel wins.
    TRANSLATE_CANCEL.store(false, Ordering::SeqCst);
    *ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner()) = Some(job_id.clone());

    logging::append_main(&root, format!("翻译任务创建成功，任务 ID: {job_id}"))
        .map_err(to_message)?;

    // Channel: relay progress from blocking threads → async runtime context
    let (progress_tx, progress_rx) = mpsc::channel::<TranslateProgress>();
    let progress_tx_work = progress_tx.clone();

    // Channel: relay per-entry log entries for the real-time log panel
    let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();
    let log_tx_work = log_tx.clone();

    // Spawn reader that receives progress from channel and emits events
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("translate-progress", &progress) {
                eprintln!("translate-progress emit error: {err}");
            }
        }
    });

    // Spawn reader that receives log entries from channel and emits events
    let app_emit_log = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(log_entry) = log_rx.recv() {
            if let Err(err) = app_emit_log.emit("translate-log-entry", &log_entry) {
                eprintln!("translate-log-entry emit error: {err}");
            }
        }
    });

    // Read pack names from persisted settings for resource pack filtering during re-scan
    let settings = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = settings
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();
    // Extract LLM/translation config from settings
    let cfg_base_url = settings.as_ref().map(|s| s.base_url.clone()).unwrap_or_default();
    let cfg_api_key = settings.as_ref().map(|s| s.api_key.clone()).unwrap_or_default();
    let cfg_model = settings.as_ref().map(|s| s.model.clone()).unwrap_or_default();
    let cfg_temperature = settings.as_ref().map(|s| s.temperature).unwrap_or(1.0);
    let cfg_max_tokens = settings.as_ref().map(|s| s.max_tokens).unwrap_or(4096);
    let cfg_concurrency = settings.as_ref().map(|s| s.concurrency as usize).unwrap_or(6);
    let cfg_batch_size = settings.as_ref().map(|s| s.batch_size as usize).unwrap_or(50).max(1);
    let cfg_timeout_secs = settings.as_ref().map(|s| s.timeout_secs as u64).unwrap_or(120);
    let cfg_retry_count = settings.as_ref().map(|s| s.retry_count as u32).unwrap_or(3);
    let cfg_retry_delay_secs = settings.as_ref().map(|s| s.retry_delay_secs).unwrap_or(2.0);
    let cfg_rate_limit_rpm = settings.as_ref().map(|s| s.rate_limit_rpm).unwrap_or(3000);
    let cfg_prefer_user_dict = settings.as_ref().map(|s| s.prefer_user_dictionary).unwrap_or(true);
    let _cfg_batch_max_chars = settings.as_ref().map(|s| s.batch_max_chars).unwrap_or(120_000);

    let result: Result<usize, String> = tauri::async_runtime::spawn_blocking(move || {
        // ── Phase 1: Acquire scan result ──────────────────────────────
        if is_translation_cancelled(&job_id) {
            return Ok(0usize);
        }

        // Try to load from existing scan file when scan_job_id is provided
        let loaded_from_file = scan_job_id
            .as_ref()
            .filter(|s| !s.is_empty())
            .and_then(|sid| {
                let scan_path = paths::job_state_path(&root, sid);
                let content = std::fs::read_to_string(&scan_path).ok()?;
                let summary: ScanSummary = serde_json::from_str(&content).ok()?;
                // Validate that the cached scan matches current language parameters
                if summary.source_language != source_language
                    || summary.target_language != target_language
                {
                    logging::append_main(&root, format!(
                        "缓存扫描语言不匹配 (缓存: {}→{}, 当前: {}→{}), 重新扫描",
                        summary.source_language, summary.target_language,
                        source_language, target_language,
                    )).ok();
                    return None;
                }
                logging::append_main(&root, format!("从缓存加载扫描结果 (任务 {sid})")).ok();
                Some(summary)
            });

        let scan_summary = if let Some(cached) = loaded_from_file {
            cached
        } else {
            // Re-scan
            let _ = progress_tx_work.send(TranslateProgress {
                current: 0,
                total: 1,
                phase: "matching".to_string(),
                mod_name: String::new(),
                sub_step: None,
                stage_status: StageStatus::Running,
            });

            let summary = scanner::scan_instance(
                &root,
                path,
                source_language.clone(),
                target_language.clone(),
                i18n_pack_name,
                vm_pack_name,
                &TRANSLATE_CANCEL,
                &|_: ScanProgress| {},
            )
            .map_err(to_message)?;

            // Persist the fresh scan result
            if !summary.cancelled {
                if let Ok(json) = serde_json::to_string_pretty(&summary) {
                    let job_path = paths::job_state_path(&root, &summary.job_id);
                    if let Some(parent) = job_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Err(err) = std::fs::write(&job_path, &json) {
                        eprintln!("扫描结果写入失败 ({}): {err}", job_path.display());
                    }
                }
            }

            let _ = progress_tx_work.send(TranslateProgress {
                current: 1,
                total: 1,
                phase: "matching".to_string(),
                mod_name: String::new(),
                sub_step: None,
                stage_status: StageStatus::Completed,
            });

            summary
        };

        // Collect all pending entries (source entries without target equivalents)
        let mut pending_entries: Vec<(&crate::core::models::LanguageEntry, &str)> = Vec::new();
        for mod_result in &scan_summary.mods {
            let resolved_source = &mod_result.resolved_source_language;
            let target = &mod_result.target_language;
            // Build a set of keys already present in target language
            let target_keys: std::collections::HashSet<&str> = mod_result
                .entries
                .iter()
                .filter(|e| e.language == *target)
                .map(|e| e.key.as_str())
                .collect();

            for entry in &mod_result.entries {
                if entry.language == *resolved_source && !target_keys.contains(entry.key.as_str()) {
                    pending_entries.push((entry, mod_result.file_name.as_str()));
                }
            }
        }

        if is_translation_cancelled(&job_id) {
            return Ok(0usize);
        }

        let total = total_entries.unwrap_or(pending_entries.len());
        if pending_entries.is_empty() || total == 0 {
            let _ = progress_tx_work.send(TranslateProgress {
                current: 0,
                total: 0,
                phase: "translating".to_string(),
                mod_name: String::new(),
                sub_step: None,
                stage_status: StageStatus::Completed,
            });
            logging::append_job(&root, &job_id, "无需翻译，所有条目已有目标语言版本")
                .map_err(to_message)?;
            return Ok(0usize);
        }

        // ── Phase 2: Dictionary matching ────────────────────────────
        // Reuse existing translations from dictionary before hitting the LLM.

        let mut completed = 0usize;
        let mut dict_matched_count = 0usize;
        let mut batch_results: Vec<jobs::TranslationResult> = Vec::new();
        let mut llm_only_entries: Vec<(&LanguageEntry, &str)> = Vec::new();

        // Try to open dictionary DB (failure is non-fatal but warn user)
        let db_path = paths::dictionary_db_path(&root);
        let dict_conn = match dictionary::open(&db_path) {
            Ok(conn) => Some(conn),
            Err(e) => {
                let _ = logging::append_main(&root, format!("词典数据库打开失败，跳过词典匹配: {e}"));
                None
            }
        };

        let _ = progress_tx_work.send(TranslateProgress {
            current: 0,
            total,
            phase: "dictionary".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Running,
        });

        for i in 0..pending_entries.len() {
            // Check cancellation periodically during dictionary matching
            if i % 64 == 0 && is_translation_cancelled(&job_id) {
                logging::append_job(&root, &job_id, "翻译任务在词典匹配阶段被取消").map_err(to_message)?;
                if !batch_results.is_empty() {
                    let _ = jobs::batch_append_results(&root, &job_id, &batch_results);
                    batch_results.clear();
                }
                return Ok(completed);
            }

            let (entry, mod_name) = pending_entries[i];

            // Skip pure-placeholder text (e.g. "%s %s")
            if shield::is_placeholder_only(&entry.text) {
                batch_results.push(jobs::TranslationResult {
                    key: entry.key.clone(),
                    source_text: entry.text.clone(),
                    target_text: entry.text.clone(),
                    mod_id: entry.mod_id.clone(),
                    mod_name: mod_name.to_string(),
                    source_type: "skipped".to_string(),
                });
                let _ = log_tx_work.send(TranslateLogEntry {
                    key: entry.key.clone(),
                    source_text: entry.text.clone(),
                    target_text: entry.text.clone(),
                    mod_name: mod_name.to_string(),
                    source_type: "skipped".to_string(),
                });
                completed += 1;
                continue;
            }

            // Check dictionary for existing translation
            if let Some(ref conn) = dict_conn {
                let hash = dictionary::hash_text(&entry.text);
                if let Ok(results) = dictionary::search_by_hash(conn, &hash, &target_language) {
                    if let Some(dict_entry) = results.iter()
                        .find(|d| (d.source_type != "manual" || cfg_prefer_user_dict)
                            && d.source_text == entry.text)
                    {
                        batch_results.push(jobs::TranslationResult {
                            key: entry.key.clone(),
                            source_text: entry.text.clone(),
                            target_text: dict_entry.target_text.clone(),
                            mod_id: entry.mod_id.clone(),
                            mod_name: mod_name.to_string(),
                            source_type: "dictionary".to_string(),
                        });
                        let _ = log_tx_work.send(TranslateLogEntry {
                            key: entry.key.clone(),
                            source_text: entry.text.clone(),
                            target_text: dict_entry.target_text.clone(),
                            mod_name: mod_name.to_string(),
                            source_type: "dictionary".to_string(),
                        });
                        completed += 1;
                        dict_matched_count += 1;
                        continue;
                    }
                }
            }

            // Needs LLM translation
            llm_only_entries.push((entry, mod_name));
        }

        // Flush dictionary results to disk
        if !batch_results.is_empty() {
            if let Err(e) = jobs::batch_append_results(&root, &job_id, &batch_results) {
                eprintln!("词典结果写入失败: {e}");
            }
            batch_results.clear();
        }
        let dict_count = dict_matched_count;

        let _ = progress_tx_work.send(TranslateProgress {
            current: completed,
            total,
            phase: "dictionary".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Completed,
        });

        // ── Phase 3: LLM translation (concurrent waves) ─────────────

        let llm_total = llm_only_entries.len();

        if llm_total == 0 {
            let _ = progress_tx_work.send(TranslateProgress {
                current: completed,
                total,
                phase: "translating".to_string(),
                mod_name: String::new(),
                sub_step: None,
                stage_status: StageStatus::Completed,
            });
            logging::append_job(&root, &job_id,
                format!("词典匹配完成，无需 LLM 翻译。已处理 {completed}/{total} 条目"))
                .map_err(to_message)?;
            return Ok(completed);
        }

        let effective_batch_size = cfg_batch_size.min(llm_total);
        let total_llm_batches = llm_total.div_ceil(effective_batch_size);
        // Wave = concurrent batch group; compute delay that respects rate limit
        let wave_size = cfg_concurrency.min(total_llm_batches);

        // Compute delay between waves, accounting for concurrent requests per wave
        let inter_batch_delay_ms: u64 = if cfg_rate_limit_rpm > 0 && total_llm_batches > 1 {
            (60_000f64 * wave_size as f64 / cfg_rate_limit_rpm as f64).ceil() as u64
        } else {
            // Clamp to [0, 60000] so NaN/negative settings don't produce zero delay
            let secs = cfg_retry_delay_secs.max(0.0).min(60.0);
            (secs * 1000.0) as u64
        };

        let _ = progress_tx_work.send(TranslateProgress {
            current: completed,
            total,
            phase: "translating".to_string(),
            mod_name: String::new(),
            sub_step: Some(format!("0/{total_llm_batches} 批次")),
            stage_status: StageStatus::Running,
        });

        // Build LLM client from settings
        let llm_client = Arc::new(llm::LlmClient {
            base_url: cfg_base_url,
            api_key: cfg_api_key,
            model: cfg_model,
            temperature: cfg_temperature,
            max_tokens: cfg_max_tokens,
            concurrency: cfg_concurrency,
            batch_size: effective_batch_size,
            retry_count: cfg_retry_count,
            timeout_secs: cfg_timeout_secs,
        });
        llm_client.validate().map_err(to_message)?;

        // Wave-based concurrent batch processing
        let mut accumulated_token_usage = TokenUsage::default();

        for wave_start in (0..total_llm_batches).step_by(wave_size) {
            if is_translation_cancelled(&job_id) {
                logging::append_job(&root, &job_id, "翻译任务被用户取消").map_err(to_message)?;
                if !batch_results.is_empty() {
                    let _ = jobs::batch_append_results(&root, &job_id, &batch_results);
                    batch_results.clear();
                }
                return Ok(completed);
            }

            let wave_end = total_llm_batches.min(wave_start + wave_size);
            let wave_count = wave_end - wave_start;

            // Build batch references for this wave
            let wave_batches: Vec<&[(&LanguageEntry, &str)]> = (wave_start..wave_end)
                .map(|bi| {
                    let s = bi * effective_batch_size;
                    let e = llm_total.min(s + effective_batch_size);
                    &llm_only_entries[s..e]
                })
                .collect();

            // Translate this wave's batches concurrently
            let wave_results: Vec<(Vec<llm::TranslateResult>, Option<TokenUsage>)> = {
                std::thread::scope(|scope| {
                    let mut handles = Vec::with_capacity(wave_count);
                    for batch in &wave_batches {
                        let llm_entries: Vec<llm::TranslationEntry> = batch
                            .iter()
                            .map(|(entry, _)| llm::TranslationEntry {
                                key: entry.key.clone(),
                                text: entry.text.clone(),
                                mod_id: entry.mod_id.clone(),
                                source_lang: entry.language.clone(),
                                target_lang: target_language.clone(),
                            })
                            .collect();
                        let client = Arc::clone(&llm_client);
                        handles.push(scope.spawn(move || client.translate_batch(&llm_entries)));
                    }
                    handles.into_iter().map(|h| h.join().unwrap()).collect()
                })
            };

            // Process results from this wave
            for (batch_idx_in_wave, (translate_results, token_usage)) in wave_results.iter().enumerate() {
                let batch_idx = wave_start + batch_idx_in_wave;
                let s = batch_idx * effective_batch_size;
                let e = llm_total.min(s + effective_batch_size);

                // Accumulate token usage
                if let Some(usage) = token_usage {
                    accumulated_token_usage.prompt_tokens += usage.prompt_tokens;
                    accumulated_token_usage.completion_tokens += usage.completion_tokens;
                    accumulated_token_usage.total_tokens += usage.total_tokens;
                }

                for i in s..e {
                    let (entry, mod_name) = llm_only_entries[i];
                    let target_text = if translate_results[i - s].success {
                        translate_results[i - s].translated_text.clone()
                    } else {
                        entry.text.clone()
                    };
                    batch_results.push(jobs::TranslationResult {
                        key: entry.key.clone(),
                        source_text: entry.text.clone(),
                        target_text: target_text.clone(),
                        mod_id: entry.mod_id.clone(),
                        mod_name: mod_name.to_string(),
                        source_type: if translate_results[i - s].success {
                            "llm".to_string()
                        } else {
                            "failed".to_string()
                        },
                    });
                    let _ = log_tx_work.send(TranslateLogEntry {
                        key: entry.key.clone(),
                        source_text: entry.text.clone(),
                        target_text,
                        mod_name: mod_name.to_string(),
                        source_type: if translate_results[i - s].success {
                            "llm".to_string()
                        } else {
                            "failed".to_string()
                        },
                    });
                    completed += 1;
                }
            }

            // Flush results to disk after each wave
            if !batch_results.is_empty() {
                if let Err(e) = jobs::batch_append_results(&root, &job_id, &batch_results) {
                    eprintln!("批次结果写入失败: {e}");
                }
                batch_results.clear();
            }

            // Emit progress for this wave
            let _ = progress_tx_work.send(TranslateProgress {
                current: completed,
                total,
                phase: "translating".to_string(),
                mod_name: String::new(),
                sub_step: Some(format!(
                    "{}/{} 批次",
                    wave_end.min(total_llm_batches),
                    total_llm_batches
                )),
                stage_status: StageStatus::Running,
            });

            // Rate limit between waves
            let next_wave_start = wave_start + wave_size;
            if next_wave_start < total_llm_batches && inter_batch_delay_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(inter_batch_delay_ms));
            }
        }

        // ── Phase 4: Completion ─────────────────────────────────────

        // Final cancel check before reporting completion
        if is_translation_cancelled(&job_id) {
            logging::append_job(&root, &job_id, "翻译任务在完成前被取消").map_err(to_message)?;
            if !batch_results.is_empty() {
                let _ = jobs::batch_append_results(&root, &job_id, &batch_results);
                batch_results.clear();
            }
            return Ok(completed);
        }

        // Log token usage
        if accumulated_token_usage.total_tokens > 0 {
            let _ = logging::append_job(&root, &job_id, format!(
                "LLM Token 使用: prompt={}, completion={}, total={}",
                accumulated_token_usage.prompt_tokens,
                accumulated_token_usage.completion_tokens,
                accumulated_token_usage.total_tokens,
            ));
        }

        let _ = progress_tx_work.send(TranslateProgress {
            current: completed,
            total,
            phase: "translating".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Completed,
        });

        logging::append_job(&root, &job_id, format!(
            "翻译完成: {completed}/{total} 条目 (词典: {dict_count}, LLM: {llm_total})"))
            .map_err(to_message)?;

        Ok(completed)
    })
    .await
    .map_err(|e| e.to_string())?;

    // Drop senders to close channels
    drop(progress_tx);
    drop(log_tx);

    result.map_err(to_message)
}

/// Request cancellation of the current translation.
/// Clears the active task ID and signals the scanner (if running) to stop.
#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    *ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner()) = None;
    TRANSLATE_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Clear all cached scan and translation job files from the jobs directory.
#[tauri::command]
pub fn clear_jobs_cache() -> Result<(), String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let jobs_dir = paths::jobs_dir(&root);
    if !jobs_dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&jobs_dir).map_err(to_message)? {
        let entry = entry.map_err(to_message)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("scan_") || name.starts_with("translate_") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Load a specific translation job by its job_id.
#[tauri::command]
pub fn get_translation_job(job_id: String) -> Result<Option<jobs::TranslationJobState>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root);
    manager.load(&job_id)
}

/// Find the most recent translation job on disk (by mtime).
#[tauri::command]
pub fn load_latest_translation_job() -> Result<Option<jobs::TranslationJobState>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root);
    manager.load_latest()
}

/// Validate a completed translation job: check for missing translations,
/// format code corruption, and placeholder drops.
#[tauri::command]
pub fn validate_translation(job_id: String) -> Result<crate::core::models::ValidationReport, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root.clone());

    let job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    // Convert PendingEntry to the format shield::validate expects
    let pending: Vec<jobs::PendingEntry> = job.entries.clone();
    let report = crate::core::shield::validate_translation_results(&pending, &results);
    Ok(report)
}

/// Generate a resource pack from a completed translation job's results.
#[tauri::command]
pub fn generate_pack_from_job(
    job_id: String,
    target_language: String,
    dry_run: bool,
) -> Result<crate::core::packer::PackResult, String> {
    use crate::core::packer;

    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root.clone());

    let _job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    let entries: Vec<packer::PackEntry> = results
        .into_iter()
        .map(|r| packer::PackEntry {
            mod_id: r.mod_id,
            key: r.key,
            text: r.target_text,
            source_text: r.source_text,
        })
        .collect();

    if entries.is_empty() {
        return Err("翻译结果为空，无法生成资源包".to_string());
    }

    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(to_message)?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: format!("Aaalice-MC-Translator-{job_id}"),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
    };

    packer::generate_pack(&options).map_err(to_message)
}
