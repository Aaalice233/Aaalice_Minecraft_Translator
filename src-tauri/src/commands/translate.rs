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
    let handle = tauri::async_runtime::spawn_blocking(move || {
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
    tauri::async_runtime::spawn(async move {
        if let Err(e) = handle.await {
            tracing::error!("批量读取器({event_name}) panic: {:?}", e);
        }
    });
}

fn spawn_progress_reader(
    progress_rx: mpsc::Receiver<PipelineProgress>,
    app: tauri::AppHandle,
) {
    let handle = tauri::async_runtime::spawn_blocking(move || {
        let mut last_progress: Option<PipelineProgress> = None;
        loop {
            match progress_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(p) => {
                    last_progress = Some(p);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ref p) = last_progress {
                        if let Err(err) = app.emit("translate-progress", &p) {
                            tracing::error!("translate-progress emit error: {err}");
                        }
                        last_progress = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if let Some(ref p) = last_progress {
                        let _ = app.emit("translate-progress", &p);
                    }
                    break;
                }
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        if let Err(e) = handle.await {
            tracing::error!("进度读取器 panic: {:?}", e);
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

    spawn_progress_reader(progress_rx, app.clone());
    spawn_batched_reader(log_rx, app.clone(), "translate-log-entries");
    spawn_batched_reader(entry_progress_rx, app.clone(), "translate-entry-progresses");

    let result = tauri::async_runtime::spawn_blocking(move || {
        // 清理旧的翻译任务文件，仅保留词典
        let mgr = jobs::JobManager::new(root.clone());
        let _ = mgr.cleanup_old_translation_jobs(&job_id);

        if let Some(ref scan_id) = scan_job_id {
            let mgr = jobs::JobManager::new(root.clone());
            match mgr.create_from_scan_with_job_id(scan_id, &job_id) {
                Ok(job) => {
                    logging::append_main(format!(
                        "翻译 Job 状态文件已创建: scan_job_id={scan_id}, 条目={}",
                        job.entries.len()
                    )).ok();
                }
                Err(err) => {
                    logging::append_main(format!("创建翻译 Job 状态文件失败: {err}")).ok();
                }
            }
        }

        let settings_load_result = settings::load_settings(&root);
        let resource_pack_names = match &settings_load_result {
            Ok(s) => {
                let has_placeholder = s.resource_pack_names.iter()
                    .any(|n| n.contains("{{mc_version}}"));
                match settings::detect_mc_version(&s.instance_path) {
                    Ok(ver) => {
                        let replaced = settings::apply_placeholders(s, &ver);
                        replaced.resource_pack_names
                    }
                    Err(e) if has_placeholder => {
                        return Err(format!(
                            "MC 版本检测失败，且 resourcePackNames 中包含 {{mc_version}} 占位符: {e}"
                        ));
                    }
                    Err(_) => {
                        // 不含占位符，向后兼容
                        s.resource_pack_names.clone()
                    }
                }
            }
            Err(e) => return Err(e.to_string()),
        };

        let llm = settings_load_result.ok().map(|s| LlmConfig {
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

        pipeline::run_pipeline(config, &job_id, &*pipeline::GLOBAL_CANCEL, progress_tx, log_tx, entry_progress_tx)
    })
    .await
    .map_err(|err| err.to_string())??;

    logging::append_main(
        format!("翻译任务完成: {} 条目", result.completed),
    ).ok();

    Ok(result.completed)
}

#[tauri::command]
pub fn cancel_translation() -> Result<(), String> {
    pipeline::cancel_current_translation();
    logging::append_main("翻译任务被用户取消").ok();
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

    pipeline::register_translation_task(&job_id);

    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    spawn_progress_reader(progress_rx, app.clone());
    spawn_batched_reader(entry_progress_rx, app.clone(), "translate-entry-progresses");

    let retried_success = tauri::async_runtime::spawn_blocking(move || {
        let manager = jobs::JobManager::new(root.clone());
        let all_results = manager.load_results(&job_id)?;
        let failed_count = all_results.iter().filter(|r| r.source_type == "failed").count();

        if failed_count == 0 {
            logging::append_main("重试失败条目: 没有需要重试的条目").ok();
            return Ok::<usize, String>(0);
        }

        let settings = settings::load_settings(&root)
            .map_err(|e| format!("加载 LLM 设置失败: {e}"))?;

        let llm = LlmConfig {
            base_url: settings.base_url,
            api_key: settings.api_key,
            model: settings.model,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            concurrency: settings.concurrency as usize,
            batch_size: settings.batch_size as usize,
            timeout_secs: settings.timeout_secs as u64,
            retry_count: settings.retry_count as u32,
            rate_limit_rpm: settings.rate_limit_rpm,
            prefer_user_dict: settings.prefer_user_dictionary,
            system_prompt: if settings.system_prompt.is_empty() {
                crate::core::models::DEFAULT_SYSTEM_PROMPT.to_string()
            } else {
                settings.system_prompt
            },
        };

        let retried = pipeline::retry_failed_entries(
            &root, &job_id, &source_language, &target_language, &llm,
            &*pipeline::GLOBAL_CANCEL, &progress_tx, &entry_progress_tx,
        )?;

        let succ = retried.iter().filter(|r| r.source_type == "llm").count();
        let failed = retried.iter().filter(|r| r.source_type == "failed").count();

        // Merge retried results back into JSONL so validation picks up the changes
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

        let out_path = paths::translate_job_results_path(&root, &job_id);
        if let Some(parent) = out_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut content = String::with_capacity(merged.len() * 150);
        for r in &merged {
            if let Ok(line) = serde_json::to_string(r) {
                content.push_str(&line);
                content.push('\n');
            }
        }
        let tmp_path = out_path.with_extension("jsonl.tmp");
        if std::fs::write(&tmp_path, &content).is_ok() {
            let _ = std::fs::rename(&tmp_path, &out_path);
        }

        if let Ok(Some(mut job)) = manager.load(&job_id) {
            let new_completed = merged.iter().filter(|r| r.source_type != "failed").count();
            let new_failed = merged.len() - new_completed;
            job.completed_entries = new_completed;
            job.failed_entries = new_failed;
            let _ = manager.save(&job);
        }

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
            format!("重试失败条目完成: 成功 {succ}, 仍然失败 {failed}"),
        ).ok();

        Ok::<usize, String>(succ)
    })
    .await
    .map_err(|err| format!("重试任务线程崩溃: {err}"))??;

    Ok(retried_success)
}

#[tauri::command]
pub async fn translate_single_entry(
    _app: tauri::AppHandle,
    job_id: Option<String>,
    key: String,
    source_text: String,
    mod_name: String,
    mod_id: String,
    source_language: String,
    target_language: String,
) -> Result<String, String> {
    let root = paths::runtime_root().map_err(|err| err.to_string())?;
    let log_key = key.clone();

    logging::append_main(format!("单条目翻译开始: key={log_key}, mod={mod_name}"))
        .map_err(|err| err.to_string())?;

    let settings = settings::load_settings(&root)
        .map_err(|e| format!("加载 LLM 设置失败: {e}"))?;

    let llm = LlmConfig {
        base_url: settings.base_url,
        api_key: settings.api_key,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        concurrency: settings.concurrency as usize,
        batch_size: settings.batch_size as usize,
        timeout_secs: settings.timeout_secs as u64,
        retry_count: settings.retry_count as u32,
        rate_limit_rpm: settings.rate_limit_rpm,
        prefer_user_dict: settings.prefer_user_dictionary,
        system_prompt: if settings.system_prompt.is_empty() {
            crate::core::models::DEFAULT_SYSTEM_PROMPT.to_string()
        } else {
            settings.system_prompt
        },
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        pipeline::translate_single_entry(
            &root,
            job_id.as_deref(),
            &key,
            &source_text,
            &mod_name,
            &mod_id,
            &source_language,
            &target_language,
            &llm,
            Some(&*pipeline::GLOBAL_CANCEL),
        )
    })
    .await
    .map_err(|err| format!("翻译线程崩溃: {err}"))??;

    logging::append_main(format!("单条目翻译完成: key={log_key}, 长度={}", result.len())).ok();

    Ok(result)
}
