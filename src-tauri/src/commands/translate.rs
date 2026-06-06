use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;

use crate::core::{
    logging,
    models::{EntryProgress, LlmConfig, PipelineConfig, PipelineProgress, TranslateLogEntry},
    paths, pipeline, settings,
};

fn spawn_batched_reader<T: Serialize + Clone + Send + 'static>(
    rx: mpsc::Receiver<T>,
    app: tauri::AppHandle,
    job_id: String,
    event_name: &'static str,
) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut batch: Vec<T> = Vec::with_capacity(512);
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(item) => {
                    if pipeline::is_translation_cancelled(&job_id) {
                        if !batch.is_empty() {
                            let _ = app.emit(event_name, &batch);
                        }
                        break;
                    }
                    batch.push(item);
                    if batch.len() >= 512 {
                        if let Err(err) = app.emit(event_name, &batch) {
                            eprintln!("{event_name} emit error: {err}");
                        }
                        batch.clear();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if pipeline::is_translation_cancelled(&job_id) {
                        if !batch.is_empty() {
                            let _ = app.emit(event_name, &batch);
                        }
                        break;
                    }
                    if !batch.is_empty() {
                        if let Err(err) = app.emit(event_name, &batch) {
                            eprintln!("{event_name} emit error: {err}");
                        }
                        batch.clear();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() {
                        let _ = app.emit(event_name, &batch);
                    }
                    break;
                }
            }
        }
    });
}

#[tauri::command]
pub async fn start_translation(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
    scan_job_id: Option<String>,
) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(|err| err.to_string())?;
    let job_id = logging::new_job_id("translate");

    pipeline::register_translation_task(&job_id);

    logging::append_main(&root, format!("翻译任务创建成功，任务 ID: {job_id}"))
        .map_err(|err| err.to_string())?;

    // Channels: progress events + log entries + entry-level progress
    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    let progress_tx_work = progress_tx.clone();
    let log_tx_work = log_tx.clone();
    let entry_progress_tx_work = entry_progress_tx.clone();
    let job_id_progress = job_id.clone();

    // Progress reader (low frequency, not batched)
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

    // Batched readers for high-frequency events
    spawn_batched_reader(log_rx, app.clone(), job_id.clone(), "translate-log-entries");
    spawn_batched_reader(entry_progress_rx, app.clone(), job_id.clone(), "translate-entry-progresses");

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
    .map_err(|err| err.to_string())??;

    drop(progress_tx);
    drop(log_tx);
    drop(entry_progress_tx);

    logging::append_main(
        &root,
        format!("翻译任务完成: {} 条目", result.completed),
    )
    .ok();

    Ok(result.completed)
}

#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    pipeline::cancel_current_translation();
    let _ = logging::append_main(
        &paths::runtime_root().map_err(|err| err.to_string())?,
        "翻译任务被用户取消",
    );
    Ok(())
}
