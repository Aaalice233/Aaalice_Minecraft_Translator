use std::sync::mpsc;

use tauri::Emitter;

use crate::core::{
    logging,
    models::{EntryProgress, LlmConfig, PipelineConfig, PipelineProgress, TranslateLogEntry},
    paths, pipeline, settings,
};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

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

    // Register task (clear cancel flag first, then store job ID)
    pipeline::register_translation_task(&job_id);

    logging::append_main(&root, format!("翻译任务创建成功，任务 ID: {job_id}"))
        .map_err(to_message)?;

    // Channels: progress events + log entries + entry-level progress
    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    let progress_tx_work = progress_tx.clone();
    let log_tx_work = log_tx.clone();
    let entry_progress_tx_work = entry_progress_tx.clone();
    let job_id_progress = job_id.clone();
    let job_id_log = job_id.clone();
    let job_id_entry = job_id.clone();

    // Reader: progress events → Tauri events (checks cancel to stop early)
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if pipeline::is_translation_cancelled(&job_id_progress) {
                break;
            }
            if let Err(err) = app_emit.emit("translate-progress", &progress) {
                eprintln!("translate-progress emit error: {err}");
            }
        }
    });

    // Reader: log entries → Tauri events (checks cancel to stop early)
    let app_emit_log = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(entry) = log_rx.recv() {
            if pipeline::is_translation_cancelled(&job_id_log) {
                break;
            }
            if let Err(err) = app_emit_log.emit("translate-log-entry", &entry) {
                eprintln!("translate-log-entry emit error: {err}");
            }
        }
    });

    // Reader: entry-level progress → Tauri events
    let app_emit_entry = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = entry_progress_rx.recv() {
            if pipeline::is_translation_cancelled(&job_id_entry) {
                break;
            }
            if let Err(err) = app_emit_entry.emit("translate-entry-progress", &progress) {
                eprintln!("translate-entry-progress emit error: {err}");
            }
        }
    });

    // Read settings for pack names and LLM config
    let s = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = s
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    let llm = s.map(|s| LlmConfig {
        base_url: s.base_url,
        api_key: s.api_key,
        model: s.model,
        temperature: s.temperature,
        max_tokens: s.max_tokens,
        concurrency: s.concurrency as usize,
        batch_size: s.batch_size as usize,
        timeout_secs: s.timeout_secs as u64,
        retry_count: s.retry_count as u32,
        rate_limit_rpm: s.rate_limit_rpm,
        prefer_user_dict: s.prefer_user_dictionary,
        system_prompt: if s.system_prompt.is_empty() {
            crate::core::models::DEFAULT_SYSTEM_PROMPT.to_string()
        } else {
            s.system_prompt
        },
    });

    let config = PipelineConfig {
        root: root.clone(),
        instance_path: path,
        source_language,
        target_language,
        scan_job_id,
        i18n_pack_name: Some(i18n_pack_name),
        vm_pack_name: Some(vm_pack_name),
        llm,
    };

    // Run pipeline on blocking thread
    let result = tauri::async_runtime::spawn_blocking(move || {
        pipeline::run_pipeline(config, &job_id, progress_tx_work, log_tx_work, entry_progress_tx_work)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Close channels → reader threads exit
    drop(progress_tx);
    drop(log_tx);

    logging::append_main(
        &root,
        format!("翻译任务完成: {}/{} 条目", result.completed, total_entries.unwrap_or(0)),
    )
    .ok();

    Ok(result.completed)
}

#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    pipeline::cancel_current_translation();
    let _ = logging::append_main(
        &paths::runtime_root().map_err(to_message)?,
        "翻译任务被用户取消",
    );
    Ok(())
}
