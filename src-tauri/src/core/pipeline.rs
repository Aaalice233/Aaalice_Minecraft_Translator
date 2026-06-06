// Translation pipeline orchestration
// Coordinates Scan → Extract → Dictionary → LLM → Finalize.
// This is the single orchestrator for all translation work.
// Cancel/state coordination uses module-level statics.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use crate::core::models::*;
use crate::core::{cfpa, dictionary, jobs, logging, paths, scanner, shield};
use crate::core::llm::{LlmClient, TranslateResult, TranslationEntry};

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

/// Extract ALL source entries.  Each entry carries the existing translation text
/// if available (from mod-internal target lang file, or from resource packs).
/// Entries without an existing translation go through dictionary → LLM.
pub fn extract_pending_entries<'a>(
    summary: &'a ScanSummary,
) -> Vec<(&'a LanguageEntry, &'a str, Option<String>)> {
    // Build resource-pack lookup: (mod_id, key) → target text
    let rp_lookup: HashMap<(&str, &str), &str> = summary
        .resource_packs
        .iter()
        .flat_map(|rp| rp.entries.iter())
        .filter(|e| e.language == summary.target_language)
        .map(|e| ((e.mod_id.as_str(), e.key.as_str()), e.text.as_str()))
        .collect();

    let mut pending = Vec::new();
    for mod_result in &summary.mods {
        let source = &mod_result.resolved_source_language;
        let target = &mod_result.target_language;
        // Map: key → existing target text (mod-internal)
        let target_map: HashMap<&str, &str> = mod_result
            .entries
            .iter()
            .filter(|e| e.language == *target)
            .map(|e| (e.key.as_str(), e.text.as_str()))
            .collect();

        for entry in &mod_result.entries {
            if entry.language != *source {
                continue;
            }
            // Priority: mod-internal zh_cn > resource pack > None (→ LLM)
            let existing = target_map
                .get(entry.key.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    rp_lookup
                        .get(&(entry.mod_id.as_str(), entry.key.as_str()))
                        .map(|s| s.to_string())
                });
            pending.push((entry, mod_result.file_name.as_str(), existing));
        }
    }
    pending
}

/// 按 mod_id 分组，每组内按 batch_size 切割（设置值是最大值）
fn group_batches<'a>(
    entries: &[(&'a LanguageEntry, &'a str)],
    batch_size: usize,
) -> Vec<Vec<(&'a LanguageEntry, &'a str)>> {
    let mut by_mod: HashMap<&str, Vec<(&LanguageEntry, &str)>> = HashMap::new();
    for item in entries {
        by_mod.entry(item.0.mod_id.as_str()).or_default().push(*item);
    }

    let mut mod_ids: Vec<&str> = by_mod.keys().copied().collect();
    mod_ids.sort();

    let mut batches = Vec::new();
    for mod_id in &mod_ids {
        let group = by_mod.get(mod_id).unwrap();
        for chunk in group.chunks(batch_size.max(1)) {
            batches.push(chunk.to_vec());
        }
    }
    batches
}

// ── Main pipeline ─────────────────────────────────────────────

/// Run the full translation pipeline. Emits progress and log events through channels.
pub fn run_pipeline(
    config: PipelineConfig,
    job_id: &str,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
    entry_progress_tx: mpsc::Sender<EntryProgress>,
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

    for (entry, file_name, existing_target) in &pending {
        if processed % 64 == 0 && is_translation_cancelled(job_id) {
            break;
        }

        // Priority 1: existing translation from mod-internal zh_cn or resource packs
        if let Some(target_text) = existing_target {
            batch_results.push(jobs::TranslationResult {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: target_text.clone(),
                mod_id: entry.mod_id.clone(),
                mod_name: file_name.to_string(),
                source_type: "existing".into(),
            });
            let _ = log_tx.send(TranslateLogEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: target_text.clone(),
                mod_name: entry.mod_id.clone(),
                source_type: "existing".into(),
            });
            let _ = entry_progress_tx.send(EntryProgress {
                key: entry.key.clone(),
                mod_name: file_name.to_string(),
                source_text: entry.text.clone(),
                target_text: Some(target_text.clone()),
                status: EntryStatus::Completed,
            });
        } else if shield::is_placeholder_only(&entry.text) {
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
            let _ = entry_progress_tx.send(EntryProgress {
                key: entry.key.clone(),
                mod_name: file_name.to_string(),
                source_text: entry.text.clone(),
                target_text: Some(entry.text.clone()),
                status: EntryStatus::Skip,
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
                        let _ = entry_progress_tx.send(EntryProgress {
                            key: entry.key.clone(),
                            mod_name: file_name.to_string(),
                            source_text: entry.text.clone(),
                            target_text: Some(de.target_text.clone()),
                            status: EntryStatus::DictionaryHit,
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

    // 发射待翻译条目的初始状态
    for (entry, file_name) in &llm_only_entries {
        let _ = entry_progress_tx.send(EntryProgress {
            key: entry.key.clone(),
            mod_name: file_name.to_string(),
            source_text: entry.text.clone(),
            target_text: None,
            status: EntryStatus::Pending,
        });
    }

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
        let effective_batch_size = llm_cfg.batch_size.max(1);

        // 智能分批：按 mod_id 分组
        let smart_batches = group_batches(&llm_only_entries, effective_batch_size);
        let total_llm_batches = smart_batches.len();
        let initial_concurrency = llm_cfg.concurrency.min(total_llm_batches).max(1);

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
            effective_concurrency: std::sync::atomic::AtomicUsize::new(initial_concurrency),
            consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
        };

        client.validate()?;

        // Build key → (mod_id, file_name) mapping
        let key_to_meta: HashMap<&str, (&str, &str)> = llm_only_entries
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

        let _completed_batches = std::sync::atomic::AtomicUsize::new(0);
        // 自适应并发波浪循环
        let mut batch_index = 0usize;
        loop {
            if batch_index >= total_llm_batches {
                break;
            }
            if is_translation_cancelled(job_id) {
                break;
            }

            let current_conc = client.effective_concurrency.load(Ordering::SeqCst).max(1);
            let wave_count = current_conc.min(total_llm_batches - batch_index);

            // Build wave: each batch is a Vec<TranslationEntry>
            let wave_batches: Vec<(usize, String, Vec<TranslationEntry>)> = (batch_index..batch_index + wave_count)
                .map(|bi| {
                    let batch = &smart_batches[bi];
                    let mod_name = batch.first().map(|(_, f)| f.to_string()).unwrap_or_default();

                    // Collect CFPA references for this batch
                    let mut batch_refs = Vec::new();
                    let mut seen_ref = HashSet::new();
                    for (entry, _) in batch {
                        if let Ok(matches) = cfpa::fuzzy_search(&dict_conn, &entry.text, &entry.language, &config.target_language, 5) {
                            for m in &matches {
                                if seen_ref.insert(m.source_text.clone()) {
                                    batch_refs.push((m.source_text.clone(), m.target_text.clone()));
                                }
                            }
                        }
                    }

                    let entries: Vec<TranslationEntry> = batch.iter().map(|(entry, _)| TranslationEntry {
                        key: entry.key.clone(),
                        text: entry.text.clone(),
                        mod_id: entry.mod_id.clone(),
                        source_lang: entry.language.clone(),
                        target_lang: config.target_language.clone(),
                        references: batch_refs.clone(),
                    }).collect();
                    (bi, mod_name, entries)
                })
                .collect();

            // Emit Translating status for all entries in this wave
            for (_, _, batch_entries) in &wave_batches {
                for te in batch_entries {
                    let fname = key_to_meta.get(te.key.as_str()).map(|&(_, f)| f).unwrap_or("");
                    let _ = entry_progress_tx.send(EntryProgress {
                        key: te.key.clone(),
                        mod_name: fname.to_string(),
                        source_text: te.text.clone(),
                        target_text: None,
                        status: EntryStatus::Translating,
                    });
                }
            }

            // Dispatch wave concurrently. Each batch fires on_batch_complete itself
            // and immediately emits PipelineProgress so the UI updates per-batch, not per-wave.
            let wave_results: Vec<(Vec<jobs::TranslationResult>, TokenUsage, bool)> = std::thread::scope(|s| {
                wave_batches.iter().map(|(_bi, mod_name, batch_entries)| {
                    s.spawn(|| {
                        let entry_progress_tx = &entry_progress_tx;
                        let mod_name = mod_name.clone();
                        let mod_name_ref: &str = &mod_name;

                        let on_complete = |results: &[TranslateResult]| {
                            for r in results {
                                let status = if r.success { EntryStatus::Completed } else { EntryStatus::Failed };
                                let _ = entry_progress_tx.send(EntryProgress {
                                    key: r.key.clone(),
                                    mod_name: mod_name_ref.to_string(),
                                    source_text: r.original_text.clone(),
                                    target_text: Some(r.translated_text.clone()),
                                    status,
                                });
                            }
                        };

                        let (results, token_usage) = client.translate_batch(batch_entries, Some(&on_complete));
                        let token = token_usage.unwrap_or_default();

                        // Emit per-batch progress immediately as each batch finishes
                        let current = _completed_batches.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = progress_tx.send(PipelineProgress {
                            current,
                            total: total_llm_batches,
                            phase: PipelinePhase::Translating,
                            mod_name: String::new(),
                            sub_step: Some(format!("{current}/{total_llm_batches} 批次")),
                            stage_status: StageStatus::Running,
                        });

                        let all_rate_limited = results.iter().all(|r| {
                            !r.success && r.error.as_deref().map_or(false, |e| e.starts_with("RATE_LIMITED"))
                        });

                        let converted: Vec<jobs::TranslationResult> = results.into_iter()
                            .map(|r| jobs::TranslationResult {
                                key: r.key,
                                source_text: r.original_text,
                                target_text: r.translated_text,
                                mod_id: String::new(),
                                mod_name: String::new(),
                                source_type: if r.success { "llm".to_string() } else { "failed".to_string() },
                            })
                            .collect();

                        (converted, token, all_rate_limited)
                    })
                }).collect::<Vec<_>>().into_iter().filter_map(|h| h.join().ok()).collect()
            });

            // Process results and check rate limit
            let mut wave_has_429 = false;
            let set_mod_meta = |entry: &mut jobs::TranslationResult| {
                if let Some(&(mid, fname)) = key_to_meta.get(entry.key.as_str()) {
                    if entry.mod_id.is_empty() { entry.mod_id = mid.to_string(); }
                    if entry.mod_name.is_empty() { entry.mod_name = fname.to_string(); }
                }
            };

            for (results, token, rate_limited) in &wave_results {
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

                if *rate_limited {
                    wave_has_429 = true;
                }
            }
            // Rate limit adaptation
            if wave_has_429 {
                client.consecutive_429s.fetch_add(1, Ordering::SeqCst);
                let count = client.consecutive_429s.load(Ordering::SeqCst);
                let current = client.effective_concurrency.load(Ordering::SeqCst);
                let reduced = (current / 2).max(1);
                client.effective_concurrency.store(reduced, Ordering::SeqCst);
                let wait_secs = match count {
                    1 => 30u64,
                    2 => 60,
                    _ => 120,
                };
                std::thread::sleep(Duration::from_secs(wait_secs));
            } else {
                client.consecutive_429s.store(0, Ordering::SeqCst);
                // 试探性恢复并发
                let current = client.effective_concurrency.load(Ordering::SeqCst);
                if current < initial_concurrency {
                    client.effective_concurrency.store(current + 1, Ordering::SeqCst);
                }
            }

            batch_index += wave_count;

            let _ = jobs::batch_append_results(&config.root, job_id, &batch_results);
            batch_results.clear();

            if batch_index < total_llm_batches && llm_cfg.rate_limit_rpm > 0 {
                let delay_ms = (60000.0 / (llm_cfg.rate_limit_rpm as f64 / current_conc as f64)).max(0.0) as u64;
                if delay_ms > 0 {
                    std::thread::sleep(Duration::from_millis(delay_ms.min(5000)));
                }
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
        assert_eq!(pending.len(), 2);
        // item.test.one has existing zh_cn translation
        let one = pending.iter().find(|(e, _, _)| e.key == "item.test.one").unwrap();
        assert_eq!(one.2.as_deref(), Some("物品一"));
        // item.test.two has no zh_cn translation
        let two = pending.iter().find(|(e, _, _)| e.key == "item.test.two").unwrap();
        assert_eq!(two.2, None);
    }
}
