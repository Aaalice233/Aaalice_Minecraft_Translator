use std::collections::HashSet;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;

use super::i18n_dict;
use crate::core::{
    dictionary, jobs, logging,
    models::{EntryProgress, LlmConfig, PipelineConfig, PipelineProgress, TranslateLogEntry},
    paths, pipeline, settings,
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

fn spawn_progress_reader(progress_rx: mpsc::Receiver<PipelineProgress>, app: tauri::AppHandle) {
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

fn should_use_i18n_reference(target_language: &str) -> bool {
    target_language.trim().eq_ignore_ascii_case("zh_cn")
}

fn i18n_reference_db_path_for(
    app: &tauri::AppHandle,
    target_language: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    if should_use_i18n_reference(target_language) {
        Ok(Some(i18n_dict::active_i18n_dict_path(app)?))
    } else {
        Ok(None)
    }
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
        let mut effective_path = path;
        let mut effective_source_language = source_language;
        let mut effective_target_language = target_language;

        if let Some(ref scan_id) = scan_job_id {
            let mgr = jobs::JobManager::new(root.clone());
            match mgr.create_from_scan_with_job_id(scan_id, &job_id) {
                Ok(job) => {
                    logging::append_main(format!(
                        "翻译 Job 状态文件已创建: scan_job_id={scan_id}, 条目={}",
                        job.entries.len()
                    )).ok();
                    let scan_summary = mgr.load_scan_summary(scan_id)?;
                    effective_path = scan_summary.instance_path;
                    effective_source_language = scan_summary.source_language;
                    effective_target_language = scan_summary.target_language;
                }
                Err(err) => {
                    logging::append_main(format!("创建翻译 Job 状态文件失败: {err}")).ok();
                    return Err(format!("创建翻译 Job 状态文件失败，请重新扫描实例: {err}"));
                }
            }
        }

        let settings_load_result = settings::load_settings(&root);
        let resource_pack_names = match &settings_load_result {
            Ok(s) => {
                let has_placeholder = s.resource_pack_names.iter()
                    .any(|n| n.contains("{{mc_version}}"));
                match settings::detect_mc_version(&effective_path) {
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
            instance_path: effective_path,
            source_language: effective_source_language,
            target_language: effective_target_language.clone(),
            scan_job_id,
            resource_pack_names,
            i18n_reference_db_path: i18n_reference_db_path_for(&app, &effective_target_language)?,
            llm,
        };

        pipeline::run_pipeline(
            config,
            &job_id,
            &*pipeline::GLOBAL_CANCEL,
            progress_tx,
            log_tx,
            entry_progress_tx,
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    logging::append_main(format!("翻译任务完成: {} 条目", result.completed)).ok();

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

    logging::append_main(format!("重试失败或缺失条目开始，任务 ID: {job_id}"))
        .map_err(|err| err.to_string())?;

    pipeline::register_translation_task(&job_id);

    let (progress_tx, progress_rx) = mpsc::channel::<PipelineProgress>();
    let (entry_progress_tx, entry_progress_rx) = mpsc::channel::<EntryProgress>();

    spawn_progress_reader(progress_rx, app.clone());
    spawn_batched_reader(entry_progress_rx, app.clone(), "translate-entry-progresses");

    let retried_success = tauri::async_runtime::spawn_blocking(move || {
        let manager = jobs::JobManager::new(root.clone());
        let job = manager.refresh_counts_from_results(&job_id)?;
        let all_results = manager.load_results(&job_id)?;
        let retryable_count = job.failed_entries;

        if retryable_count == 0 {
            logging::append_main("重试失败或缺失条目: 没有需要重试的条目").ok();
            return Ok::<usize, String>(0);
        }

        let settings =
            settings::load_settings(&root).map_err(|e| format!("加载 LLM 设置失败: {e}"))?;

        let i18n_reference_db_path = i18n_reference_db_path_for(&app, &target_language)?;

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
            &root,
            &job_id,
            &source_language,
            &target_language,
            &llm,
            &*pipeline::GLOBAL_CANCEL,
            &progress_tx,
            &entry_progress_tx,
            i18n_reference_db_path.as_deref(),
        )?;

        let succ = retried.iter().filter(|r| r.source_type == "llm").count();
        let failed = retried.iter().filter(|r| r.source_type == "failed").count();

        // Merge retried results back into JSONL so validation picks up both
        // replaced failed lines and newly recovered missing lines.
        let mut replaced: HashSet<(String, String, String)> = HashSet::new();
        let mut merged: Vec<jobs::TranslationResult> =
            Vec::with_capacity(all_results.len() + retried.len());
        for r in all_results {
            if r.source_type == "failed" {
                if let Some(nr) = retried.iter().find(|nr| {
                    nr.key == r.key && nr.mod_id == r.mod_id && nr.mod_name == r.mod_name
                }) {
                    replaced.insert((nr.key.clone(), nr.mod_id.clone(), nr.mod_name.clone()));
                    merged.push(nr.clone());
                    continue;
                }
            }
            merged.push(r);
        }
        for r in &retried {
            let id = (r.key.clone(), r.mod_id.clone(), r.mod_name.clone());
            if !replaced.contains(&id) {
                merged.push(r.clone());
            }
        }

        let out_path = paths::translate_job_results_path(&root, &job_id);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建结果目录失败: {e}"))?;
        }
        let mut content = String::with_capacity(merged.len() * 150);
        for r in &merged {
            let line = serde_json::to_string(r).map_err(|e| format!("序列化重试结果失败: {e}"))?;
            content.push_str(&line);
            content.push('\n');
        }
        let tmp_path = out_path.with_extension("jsonl.tmp");
        std::fs::write(&tmp_path, &content).map_err(|e| format!("写入重试结果失败: {e}"))?;
        std::fs::rename(&tmp_path, &out_path).map_err(|e| format!("替换重试结果失败: {e}"))?;

        let successful_retried: Vec<jobs::TranslationResult> = retried
            .iter()
            .filter(|r| r.source_type == "llm" || r.source_type == "reviewed")
            .cloned()
            .collect();
        if !successful_retried.is_empty() {
            let dict_conn = dictionary::open(&paths::dictionary_db_path(&root))
                .map_err(|e| format!("重试结果已写入任务文件，但打开词典失败: {e}"))?;
            let mut dict = dictionary::MemoryDictionary::load_local_entries(&dict_conn)
                .map_err(|e| format!("重试结果已写入任务文件，但加载词典失败: {e}"))?;
            dict.save_llm_results(
                &dict_conn,
                &successful_retried,
                &source_language,
                &target_language,
            )
            .map_err(|e| format!("重试结果已写入任务文件，但同步到词典失败: {e}"))?;
        }

        manager.refresh_counts_from_results(&job_id)?;

        let _ = progress_tx.send(PipelineProgress {
            current: 1,
            total: 1,
            phase: crate::core::models::PipelinePhase::Completed,
            mod_name: String::new(),
            sub_step: None,
            stage_status: crate::core::models::StageStatus::Completed,
        });
        drop(progress_tx);
        drop(entry_progress_tx);

        logging::append_main(format!(
            "重试失败或缺失条目完成: 成功 {succ}, 仍然失败 {failed}"
        ))
        .ok();

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

    let settings = settings::load_settings(&root).map_err(|e| format!("加载 LLM 设置失败: {e}"))?;

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
        let i18n_reference_db_path = i18n_reference_db_path_for(&_app, &target_language)?;
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
            i18n_reference_db_path.as_deref(),
        )
    })
    .await
    .map_err(|err| format!("翻译线程崩溃: {err}"))??;

    logging::append_main(format!(
        "单条目翻译完成: key={log_key}, 长度={}",
        result.len()
    ))
    .ok();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::should_use_i18n_reference;

    #[test]
    fn i18n_reference_only_enabled_for_zh_cn_target() {
        assert!(should_use_i18n_reference("zh_cn"));
        assert!(should_use_i18n_reference("ZH_CN"));
        assert!(!should_use_i18n_reference("en_us"));
        assert!(!should_use_i18n_reference("ja_jp"));
        assert!(!should_use_i18n_reference("auto"));
        assert!(!should_use_i18n_reference(""));
    }
}
