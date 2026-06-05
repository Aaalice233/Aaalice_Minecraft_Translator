// Translation pipeline orchestration
// Coordinates Scan → Extract → Dictionary → LLM → Finalize.
// This is the single orchestrator for all translation work.
// Cancel/state coordination uses module-level statics.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use crate::core::models::*;
use crate::core::{dictionary, jobs, logging, paths, scanner, shield};
use crate::core::llm::{LlmClient, TranslationEntry};

// ── Cancel mechanism ──────────────────────────────────────────

static TRANSLATE_CANCEL: AtomicBool = AtomicBool::new(false);
static ACTIVE_TRANSLATE_TASK: Mutex<Option<String>> = Mutex::new(None);

/// Check whether the current translation job should stop.
pub fn is_translation_cancelled(job_id: &str) -> bool {
    if TRANSLATE_CANCEL.load(Ordering::SeqCst) {
        return true;
    }
    let task = ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner());
    task.as_ref().map_or(true, |id| id != job_id)
}

/// Signal the current translation to stop.
pub fn cancel_current_translation() {
    *ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner()) = None;
    TRANSLATE_CANCEL.store(true, Ordering::SeqCst);
}

/// Register a new translation job. Clears the cancel flag first,
/// then stores the new job ID. Returns the previous job ID if any.
pub fn register_translation_task(job_id: &str) -> Option<String> {
    TRANSLATE_CANCEL.store(false, Ordering::SeqCst);
    let mut task = ACTIVE_TRANSLATE_TASK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = task.take();
    *task = Some(job_id.to_string());
    prev
}

// ── Pending entry extraction ──────────────────────────────────

/// Extract all source entries that don't have a corresponding target-language entry.
/// Returns `(entry, file_name)` pairs.
pub fn extract_pending_entries(summary: &ScanSummary) -> Vec<(&LanguageEntry, &str)> {
    let mut pending = Vec::new();
    for mod_result in &summary.mods {
        let source = &mod_result.resolved_source_language;
        let target = &mod_result.target_language;
        let target_keys: HashSet<&str> = mod_result
            .entries
            .iter()
            .filter(|e| e.language == *target)
            .map(|e| e.key.as_str())
            .collect();
        for entry in &mod_result.entries {
            if entry.language == *source && !target_keys.contains(entry.key.as_str()) {
                pending.push((entry, mod_result.file_name.as_str()));
            }
        }
    }
    pending
}

// ── Main pipeline ─────────────────────────────────────────────

/// Run the full translation pipeline. Emits progress and log events through channels.
pub fn run_pipeline(
    config: PipelineConfig,
    job_id: &str,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
) -> Result<PipelineResult, String> {
    // ── Phase 1: Acquire scan result ──────────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: 1, phase: PipelinePhase::Scanning,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let scan_summary = resolve_scan(&config, job_id, &progress_tx)?;

    if scan_summary.cancelled || is_translation_cancelled(job_id) {
        let _ = logging::append_job(&config.root, job_id, "扫描被取消或翻译被取消");
        return Ok(PipelineResult {
            completed: 0, dict_count: 0, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: config.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 2: Extract pending entries ──────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: 1, phase: PipelinePhase::Extracting,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let pending = extract_pending_entries(&scan_summary);
    let total = pending.len().max(1);

    let _ = progress_tx.send(PipelineProgress {
        current: 1, total: 1, phase: PipelinePhase::Extracting,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    if is_translation_cancelled(job_id) {
        return Ok(PipelineResult {
            completed: 0, dict_count: 0, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 3: Dictionary matching ──────────────────────────
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total, phase: PipelinePhase::Dictionary,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Running,
    });

    let prefer_user_dict = config.llm.as_ref().map(|c| c.prefer_user_dict).unwrap_or(false);
    let dict_db_path = paths::dictionary_db_path(&config.root);
    let dict_conn = dictionary::open(&dict_db_path).map_err(|e| format!("打开词典失败: {e}"))?;

    let mut processed = 0usize;
    let mut batch_results: Vec<jobs::TranslationResult> = Vec::new();
    let mut llm_only_entries: Vec<(&LanguageEntry, &str)> = Vec::new();

    for (entry, file_name) in &pending {
        if processed % 64 == 0 && is_translation_cancelled(job_id) {
            break;
        }
        if shield::is_placeholder_only(&entry.text) {
            batch_results.push(jobs::TranslationResult {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: entry.text.clone(),
                mod_id: entry.mod_id.clone(),
                mod_name: file_name.to_string(),
                source_type: "skipped".into(),
            });
            let _ = log_tx.send(TranslateLogEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: entry.text.clone(),
                mod_name: entry.mod_id.clone(),
                source_type: "skipped".into(),
            });
        } else {
            let source_hash = dictionary::hash_text(&entry.text);
            match dictionary::search_by_hash(&dict_conn, &source_hash, &config.target_language) {
                Ok(results) => {
                    let dict_match = if prefer_user_dict {
                        // prefer manual-type entries
                        results.iter().find(|d| d.source_type == "manual")
                            .or_else(|| results.iter().find(|d| d.source_type != "manual"))
                    } else {
                        results.iter().find(|d| d.source_text == entry.text)
                    };
                    if let Some(de) = dict_match {
                        batch_results.push(jobs::TranslationResult {
                            key: entry.key.clone(),
                            source_text: entry.text.clone(),
                            target_text: de.target_text.clone(),
                            mod_id: entry.mod_id.clone(),
                            mod_name: file_name.to_string(),
                            source_type: "dictionary".into(),
                        });
                        let _ = log_tx.send(TranslateLogEntry {
                            key: entry.key.clone(),
                            source_text: entry.text.clone(),
                            target_text: de.target_text.clone(),
                            mod_name: entry.mod_id.clone(),
                            source_type: "dictionary".into(),
                        });
                    } else {
                        llm_only_entries.push((entry, file_name));
                    }
                }
                Err(_) => {
                    llm_only_entries.push((entry, file_name));
                }
            }
        }
        processed += 1;
        if processed % 64 == 0 {
            let _ = progress_tx.send(PipelineProgress {
                current: processed, total,
                phase: PipelinePhase::Dictionary,
                mod_name: String::new(), sub_step: None,
                stage_status: StageStatus::Running,
            });
        }
    }

    let dict_count = processed - llm_only_entries.len();

    let _ = progress_tx.send(PipelineProgress {
        current: processed, total,
        phase: PipelinePhase::Dictionary,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    if !batch_results.is_empty() {
        let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
    }

    if is_translation_cancelled(job_id) {
        return Ok(PipelineResult {
            completed: processed, dict_count, llm_count: 0,
            token_usage: TokenUsage::default(),
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    // ── Phase 4: LLM Translation ──────────────────────────────
    let mut accumulated_token_usage = TokenUsage::default();
    let mut llm_count = 0usize;

    if !llm_only_entries.is_empty() {
        let llm_cfg = config.llm.as_ref().ok_or_else(|| "LLM 未配置，但有待翻译条目需要 LLM 翻译".to_string())?;
        let effective_batch_size = llm_cfg.batch_size.min(llm_only_entries.len());
        let total_llm_batches = llm_only_entries.len().div_ceil(effective_batch_size);
        let wave_size = llm_cfg.concurrency.min(total_llm_batches);
        let inter_batch_delay_ms = if llm_cfg.rate_limit_rpm > 0 && wave_size > 0 {
            (60000.0 / (llm_cfg.rate_limit_rpm as f64 / wave_size as f64)).max(0.0) as u64
        } else {
            0
        };

        let client = LlmClient {
            base_url: llm_cfg.base_url.clone(),
            api_key: llm_cfg.api_key.clone(),
            model: llm_cfg.model.clone(),
            temperature: llm_cfg.temperature,
            max_tokens: llm_cfg.max_tokens,
            concurrency: llm_cfg.concurrency,
            batch_size: llm_cfg.batch_size,
            retry_count: llm_cfg.retry_count,
            timeout_secs: llm_cfg.timeout_secs,
            system_prompt: llm_cfg.system_prompt.clone(),
            effective_concurrency: std::sync::atomic::AtomicUsize::new(llm_cfg.concurrency),
            consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
        };

        client.validate()?;

        // Build key → (mod_id, file_name) mapping before the LLM loop,
        // so LLM results retain metadata even though TranslateResult doesn't carry it.
        let key_to_meta: std::collections::HashMap<&str, (&str, &str)> = llm_only_entries
            .iter()
            .map(|(entry, file_name)| (entry.key.as_str(), (entry.mod_id.as_str(), *file_name)))
            .collect();

        let _ = progress_tx.send(PipelineProgress {
            current: 0, total: total_llm_batches,
            phase: PipelinePhase::Translating,
            mod_name: String::new(),
            sub_step: Some(format!("0/{total_llm_batches} 批次")),
            stage_status: StageStatus::Running,
        });

        for wave_start in (0..total_llm_batches).step_by(wave_size) {
            if is_translation_cancelled(job_id) {
                break;
            }
            let wave_end = (wave_start + wave_size).min(total_llm_batches);

            // Build wave of batches
            let wave_batches: Vec<Vec<TranslationEntry>> = (wave_start..wave_end)
                .map(|bi| {
                    let start = bi * effective_batch_size;
                    let end = (start + effective_batch_size).min(llm_only_entries.len());
                    llm_only_entries[start..end]
                        .iter()
                        .map(|(entry, _)| TranslationEntry {
                            key: entry.key.clone(),
                            text: entry.text.clone(),
                            mod_id: entry.mod_id.clone(),
                            source_lang: entry.language.clone(),
                            target_lang: config.target_language.clone(),
                        })
                        .collect()
                })
                .collect();

            // Dispatch batches concurrently in this wave
            let wave_results: Vec<(Vec<jobs::TranslationResult>, TokenUsage)> = std::thread::scope(|s| {
                wave_batches
                    .iter()
                    .map(|batch| {
                        s.spawn(|| {
                            let (results, token_usage) = client.translate_batch(batch, None);
                            let token = token_usage.unwrap_or_default();
                            // Convert TranslateResult to TranslationResult
                            let converted: Vec<jobs::TranslationResult> = results
                                .into_iter()
                                .map(|r| jobs::TranslationResult {
                                    key: r.key,
                                    source_text: r.original_text,
                                    target_text: r.translated_text,
                                    mod_id: String::new(),
                                    mod_name: String::new(),
                                    source_type: if r.success { "llm".to_string() } else { "failed".to_string() },
                                })
                                .collect();
                            (converted, token)
                        })
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .filter_map(|h| h.join().ok())
                    .collect()
            });

            // Restore mod_id/mod_name from the pre-built lookup table
            let set_mod_meta = |entry: &mut jobs::TranslationResult| {
                if let Some(&(mid, fname)) = key_to_meta.get(entry.key.as_str()) {
                    if entry.mod_id.is_empty() { entry.mod_id = mid.to_string(); }
                    if entry.mod_name.is_empty() { entry.mod_name = fname.to_string(); }
                }
            };

            for (results, token) in &wave_results {
                // Token usage: add ONCE per batch, not per-entry
                accumulated_token_usage.prompt_tokens += token.prompt_tokens;
                accumulated_token_usage.completion_tokens += token.completion_tokens;
                accumulated_token_usage.total_tokens += token.total_tokens;

                let mut wave_llm_count = 0usize;
                for mut entry in results.iter().cloned() {
                    if entry.source_type == "llm" {
                        wave_llm_count += 1;
                    }
                    set_mod_meta(&mut entry);
                    let _ = log_tx.send(TranslateLogEntry {
                        key: entry.key.clone(),
                        source_text: entry.source_text.clone(),
                        target_text: entry.target_text.clone(),
                        mod_name: entry.mod_name.clone(),
                        source_type: entry.source_type.clone(),
                    });
                    batch_results.push(entry);
                }
                llm_count += wave_llm_count;
                processed += wave_llm_count;
            }

            let _ = progress_tx.send(PipelineProgress {
                current: wave_end.min(total_llm_batches),
                total: total_llm_batches,
                phase: PipelinePhase::Translating,
                mod_name: String::new(),
                sub_step: Some(format!("{}/{} 批次", wave_end.min(total_llm_batches), total_llm_batches)),
                stage_status: StageStatus::Running,
            });

            let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
            batch_results.clear();

            let next_wave_start = wave_start + wave_size;
            if next_wave_start < total_llm_batches && inter_batch_delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(inter_batch_delay_ms));
            }
        }
    }

    // ── Phase 5: Finalize ──────────────────────────────────────
    if is_translation_cancelled(job_id) {
        if !batch_results.is_empty() {
            let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
        }
        let _ = logging::append_job(&config.root, job_id, "翻译任务在完成前被取消");
        return Ok(PipelineResult {
            completed: processed, dict_count, llm_count,
            token_usage: accumulated_token_usage,
            actual_source_language: scan_summary.source_language.clone(),
            job_id: job_id.to_string(),
        });
    }

    if accumulated_token_usage.total_tokens > 0 {
        let _ = logging::append_job(&config.root, job_id, format!(
            "LLM Token 使用: prompt={}, completion={}, total={}",
            accumulated_token_usage.prompt_tokens,
            accumulated_token_usage.completion_tokens,
            accumulated_token_usage.total_tokens,
        ));
    }

    let _ = progress_tx.send(PipelineProgress {
        current: processed, total,
        phase: PipelinePhase::Completed,
        mod_name: String::new(), sub_step: None,
        stage_status: StageStatus::Completed,
    });

    let _ = logging::append_job(&config.root, job_id, format!(
        "翻译完成: {processed}/{total} 条目 (词典: {dict_count}, LLM: {llm_count})"
    ));

    Ok(PipelineResult {
        completed: processed,
        dict_count,
        llm_count,
        token_usage: accumulated_token_usage,
        actual_source_language: scan_summary.source_language.clone(),
        job_id: job_id.to_string(),
    })
}

/// Resolve a ScanSummary: try to load from cached file, or run a new scan.
/// When running a scan, progress events are relayed through progress_tx.
fn resolve_scan(
    config: &PipelineConfig,
    _job_id: &str,
    progress_tx: &mpsc::Sender<PipelineProgress>,
) -> Result<ScanSummary, String> {
    // Try loading from cached scan file
    if let Some(ref sid) = config.scan_job_id {
        if !sid.is_empty() {
            let scan_path = paths::job_state_path(&config.root, sid);
            if let Ok(content) = std::fs::read_to_string(&scan_path) {
                if let Ok(summary) = serde_json::from_str::<ScanSummary>(&content) {
                    if summary.source_language == config.source_language
                        && summary.target_language == config.target_language
                    {
                        let _ = logging::append_main(&config.root, format!("从缓存加载扫描结果 (任务 {sid})"));
                        return Ok(summary);
                    }
                    let _ = logging::append_main(&config.root, format!(
                        "缓存扫描语言不匹配 (缓存: {}→{}, 当前: {}→{}), 重新扫描",
                        summary.source_language, summary.target_language,
                        config.source_language, config.target_language,
                    ));
                }
            }
        }
    }

    // Run a new scan, relaying progress to the pipeline channel
    let relay = |scan_progress: ScanProgress| {
        let _ = progress_tx.send(PipelineProgress {
            current: scan_progress.current,
            total: scan_progress.total,
            phase: PipelinePhase::Scanning,
            mod_name: scan_progress.mod_name,
            sub_step: None,
            stage_status: StageStatus::Running,
        });
    };

    let summary = scanner::scan_instance(
        &config.root,
        config.instance_path.clone(),
        config.source_language.clone(),
        config.target_language.clone(),
        config.i18n_pack_name.clone().unwrap_or_default(),
        config.vm_pack_name.clone().unwrap_or_default(),
        &TRANSLATE_CANCEL,
        &relay,
    ).map_err(|e| format!("扫描失败: {e}"))?;

    // Persist scan result
    if !summary.cancelled {
        if let Ok(json) = serde_json::to_string_pretty(&summary) {
            let job_path = paths::job_state_path(&config.root, &summary.job_id);
            if let Some(parent) = job_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(err) = std::fs::write(&job_path, &json) {
                let _ = logging::append_main(&config.root, format!("扫描结果写入失败 ({}): {err}", job_path.display()));
            }
        }
    }

    Ok(summary)
}

// ── Tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pending_entries_returns_source_without_target() {
        let summary = ScanSummary {
            job_id: "test".into(),
            instance_path: "/test".into(),
            validation: crate::core::models::InstanceValidation {
                instance_path: "/test".into(),
                is_valid: true,
                mods_path: "/test/mods".into(),
                resourcepacks_path: "/test/resourcepacks".into(),
                warnings: vec![],
            },
            mods: vec![crate::core::models::ModScanResult {
                mod_id: "test_mod".into(),
                file_name: "test.jar".into(),
                jar_path: "/test/mods/test.jar".into(),
                language_file_count: 2,
                recovered_language_files: 0,
                failed_language_files: 0,
                source_language: "en_us".into(),
                resolved_source_language: "en_us".into(),
                target_language: "zh_cn".into(),
                source_entries: 2,
                target_entries: 1,
                has_target_language: true,
                formats: vec!["json".into()],
                entries: vec![
                    crate::core::models::LanguageEntry {
                        mod_id: "test_mod".into(),
                        key: "item.test.one".into(),
                        text: "Item One".into(),
                        text_hash: "hash1".into(),
                        language: "en_us".into(),
                        format: "json".into(),
                        source_file: "en_us.json".into(),
                    },
                    crate::core::models::LanguageEntry {
                        mod_id: "test_mod".into(),
                        key: "item.test.two".into(),
                        text: "Item Two".into(),
                        text_hash: "hash2".into(),
                        language: "en_us".into(),
                        format: "json".into(),
                        source_file: "en_us.json".into(),
                    },
                    crate::core::models::LanguageEntry {
                        mod_id: "test_mod".into(),
                        key: "item.test.one".into(),
                        text: "物品一".into(),
                        text_hash: "hash3".into(),
                        language: "zh_cn".into(),
                        format: "json".into(),
                        source_file: "zh_cn.json".into(),
                    },
                ],
                warnings: vec![],
            }],
            resource_packs: vec![],
            source_language: "en_us".into(),
            target_language: "zh_cn".into(),
            total_language_files: 2,
            total_source_entries: 2,
            total_target_entries: 1,
            total_pending_entries: 0,
            resource_pack_covered_entries: 0,
            actual_pending_entries: 0,
            warnings: vec![],
            cancelled: false,
        };

        let pending = extract_pending_entries(&summary);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0.key, "item.test.two");
    }
}
