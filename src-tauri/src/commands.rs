use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};

use tauri::Emitter;

use crate::core::{
    dictionary,
    logging,
    models::{
        InstanceValidation, LlmModel, LlmModelsResponse, ScanProgress, ScanSummary, Settings,
        StageStatus, TranslateLogEntry, TranslateProgress,
    },
    packer,
    paths, scanner, settings,
};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);
static TRANSLATE_CANCEL: AtomicBool = AtomicBool::new(false);

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

    result.map_err(to_message)
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
) -> Result<usize, String> {
    TRANSLATE_CANCEL.store(false, Ordering::SeqCst);

    let root = paths::runtime_root().map_err(to_message)?;
    let job_id = logging::new_job_id("translate");
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

    let result: Result<usize, String> = tauri::async_runtime::spawn_blocking(move || {
        // Phase: matching — validate and re-scan to get entries
        if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
            return Ok(0usize);
        }

        let _ = progress_tx_work.send(TranslateProgress {
            current: 0,
            total: 1,
            phase: "matching".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Running,
        });

        let scan_summary = scanner::scan_instance(
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

        let _ = progress_tx_work.send(TranslateProgress {
            current: 1,
            total: 1,
            phase: "matching".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Completed,
        });

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

        if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
            return Ok(0usize);
        }

        let total = total_entries.unwrap_or(pending_entries.len());
        if pending_entries.is_empty() {
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

        // Phase: translating — divide into batches and simulate
        let batch_size = 50usize;
        let total_batches = (total + batch_size - 1) / batch_size;
        let mut completed = 0usize;

        let _ = progress_tx_work.send(TranslateProgress {
            current: 0,
            total,
            phase: "translating".to_string(),
            mod_name: String::new(),
            sub_step: Some(format!("0/{total_batches} 批次")),
            stage_status: StageStatus::Running,
        });

        for batch_index in 0..total_batches {
            if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
                logging::append_job(&root, &job_id, "翻译任务被用户取消").map_err(to_message)?;
                return Ok(completed);
            }

            let start = batch_index * batch_size;
            let end = total.min(start + batch_size);
            let batch_entries = &pending_entries[start..end];

            // Simulate translation: emit per-entry log event (stub for real LLM)
            for (entry, mod_name) in batch_entries {
                let _ = log_tx_work.send(TranslateLogEntry {
                    key: entry.key.clone(),
                    source_text: entry.text.clone(),
                    target_text: entry.text.clone(), // stub: target = source (LLM later)
                    mod_name: mod_name.to_string(),
                    source_type: "mod".to_string(),
                });
                completed += 1;
            }

            // Emit progress update for this batch
            let _ = progress_tx_work.send(TranslateProgress {
                current: completed,
                total,
                phase: "translating".to_string(),
                mod_name: batch_entries
                    .first()
                    .map(|(_, name)| name.to_string())
                    .unwrap_or_default(),
                sub_step: Some(format!(
                    "{}/{} 批次",
                    batch_index + 1,
                    total_batches
                )),
                stage_status: StageStatus::Running,
            });

            // Simulate work: small delay per batch
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let _ = progress_tx_work.send(TranslateProgress {
            current: completed,
            total,
            phase: "translating".to_string(),
            mod_name: String::new(),
            sub_step: None,
            stage_status: StageStatus::Completed,
        });

        logging::append_job(&root, &job_id, format!("翻译完成: {completed}/{total} 条目"))
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
#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    TRANSLATE_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}
