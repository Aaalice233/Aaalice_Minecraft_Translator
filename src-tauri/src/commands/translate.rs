use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;

use crate::core::{
    logging,
    models::{EntryProgress, LlmConfig, PipelineConfig, PipelineProgress, TranslateLogEntry},
    jobs, paths, pipeline, settings,
};

fn spawn_batched_reader<T: Serialize + Clone + Send + 'static>(
    rx: mpsc::Receiver<T>,
    app: tauri::AppHandle,
    event_name: &'static str,
) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut batch: Vec<T> = Vec::with_capacity(512);
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(item) => {
                    batch.push(item);
                    if batch.len() >= 512 {
                        if let Err(err) = app.emit(event_name, &batch) {
                            tracing::error!("{event_name} emit error: {err}");
                        }
                        batch.clear();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() {
                        if let Err(err) = app.emit(event_name, &batch) {
                            tracing::error!("{event_name} emit error: {err}");
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

    logging::append_main(format!("翻译任务创建成功，任务 ID: {job_id}"))
        .map_err(|err| err.to_string())?;

    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (log_tx, log_rx) = mpsc::channel::<TranslateLogEntry>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    // Progress reader (debounced: emit latest value every ~100ms to avoid flooding the frontend)
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut last_progress: Option<PipelineProgress> = None;
        loop {
            match progress_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(progress) => {
                    last_progress = Some(progress);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ref p) = last_progress {
                        if let Err(err) = app_emit.emit("translate-progress", &p) {
                            tracing::error!("translate-progress emit error: {err}");
                        }
                        last_progress = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(ref p) = last_progress {
                        let _ = app_emit.emit("translate-progress", &p);
                    }
                    break;
                }
            }
        }
    });

    spawn_batched_reader(log_rx, app.clone(), "translate-log-entries");
    spawn_batched_reader(entry_progress_rx, app.clone(), "translate-entry-progresses");

    let s = settings::load_settings(&root).ok();
    let resource_pack_names = s
        .as_ref()
        .map(|s| s.resource_pack_names.clone())
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
        resource_pack_names,
        llm,
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        pipeline::run_pipeline(config, &job_id, &*pipeline::GLOBAL_CANCEL, progress_tx, log_tx, entry_progress_tx)
    })
    .await
    .map_err(|err| err.to_string())??;

    logging::append_main(
        format!("翻译任务完成: {} 条目", result.completed),
    )
    .ok();

    Ok(result.completed)
}

#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    pipeline::cancel_current_translation();
    let _ = logging::append_main(
        "翻译任务被用户取消",
    );
    Ok(())
}

#[tauri::command]
pub async fn retry_failed_entries(
    app: tauri::AppHandle,
    job_id: String,
    source_language: String,
    target_language: String,
) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(|err| err.to_string())?;

    logging::append_main(format!("重试失败条目开始，任务 ID: {job_id}"))
        .map_err(|err| err.to_string())?;

    let manager = jobs::JobManager::new(root.clone());
    let all_results = manager.load_results(&job_id)?;
    let failed_count = all_results.iter().filter(|r| r.source_type == "failed").count();

    if failed_count == 0 {
        logging::append_main("重试失败条目: 没有需要重试的条目").ok();
        return Ok(0);
    }

    pipeline::register_translation_task(&job_id);

    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    let app_progress = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut last_progress: Option<PipelineProgress> = None;
        loop {
            match progress_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(p) => {
                    last_progress = Some(p);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ref p) = last_progress {
                        let _ = app_progress.emit("translate-progress", &p);
                        last_progress = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(ref p) = last_progress {
                        let _ = app_progress.emit("translate-progress", &p);
                    }
                    break;
                }
            }
        }
    });

    spawn_batched_reader(entry_progress_rx, app.clone(), "translate-entry-progresses");

    let llm = settings::load_settings(&root).ok().map(|s| LlmConfig {
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
    }).ok_or("请先配置 LLM 设置")?;

    let retried = pipeline::retry_failed_entries(
        &root, &job_id, &source_language, &target_language, &llm,
        &*pipeline::GLOBAL_CANCEL, &progress_tx, &entry_progress_tx,
    )?;

    let retried_success = retried.iter().filter(|r| r.source_type == "llm").count();
    let retried_failed = retried.iter().filter(|r| r.source_type == "failed").count();

    let merged: Vec<jobs::TranslationResult> = all_results.into_iter()
        .map(|r| {
            if r.source_type == "failed" {
                retried.iter()
                    .find(|nr| nr.key == r.key && nr.mod_name == r.mod_name)
                    .cloned()
                    .unwrap_or(r)
            } else {
                r
            }
        })
        .collect();

    // Rewrite the entire JSONL (atomic: write to tmp then rename)
    let out_path = paths::translate_job_results_path(&root, &job_id);
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let mut content = String::with_capacity(merged.len() * 150);
    for r in &merged {
        content.push_str(&serde_json::to_string(r)
            .map_err(|e| format!("序列化失败: {e}"))?);
        content.push('\n');
    }
    let tmp_path = out_path.with_extension("jsonl.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("写入翻译结果失败: {e}"))?;
    std::fs::rename(&tmp_path, &out_path)
        .map_err(|e| format!("重命名翻译结果文件失败: {e}"))?;

    if let Ok(Some(mut job)) = manager.load(&job_id) {
        let new_completed = merged.iter().filter(|r| r.source_type != "failed").count();
        let new_failed = merged.len() - new_completed;
        job.completed_entries = new_completed;
        job.failed_entries = new_failed;
        manager.save(&job)
            .map_err(|e| format!("保存翻译任务状态失败: {e}"))?;
    }

    // Send completion progress
    let _ = progress_tx.send(PipelineProgress {
        current: 1, total: 1,
        phase: crate::core::models::PipelinePhase::Completed,
        mod_name: String::new(),
        sub_step: None,
        stage_status: crate::core::models::StageStatus::Completed,
    });
    drop(progress_tx);
    drop(entry_progress_tx);

    logging::append_main(
        format!("重试失败条目完成: 成功 {retried_success}, 仍然失败 {retried_failed}"),
    ).ok();

    Ok(retried_success)
}
