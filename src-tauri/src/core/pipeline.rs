// Scan → Extract → Dictionary → LLM → Finalize pipeline.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use crate::core::models::*;
use crate::core::{cfpa, dictionary, jobs, logging, paths, scanner, shield};
use crate::core::llm::{LlmClient, TranslateResult, TranslationEntry};

// ── Cancel mechanism ──────────────────────────────────────────

use std::sync::Arc;

/// Injection-safe cancellation token for the translation pipeline.
///
/// Combines a cancel flag and an active task ID guard into a single
/// cloneable handle.  Designed to be passed through the pipeline so
/// that tests can inject their own token instead of relying on globals.
#[derive(Clone)]
pub struct CancelToken(Arc<CancelInner>);

struct CancelInner {
    cancelled: AtomicBool,
    active_task: Mutex<Option<String>>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self(Arc::new(CancelInner {
            cancelled: AtomicBool::new(false),
            active_task: Mutex::new(None),
        }))
    }

    /// Check whether the current translation job should stop.
    pub fn is_cancelled(&self, job_id: &str) -> bool {
        if self.0.cancelled.load(Ordering::SeqCst) {
            return true;
        }
        let task = self.0.active_task.lock().unwrap_or_else(|e| e.into_inner());
        task.as_ref().map_or(true, |id| id != job_id)
    }

    /// Signal the current translation to stop.
    pub fn cancel_current(&self) {
        *self.0.active_task.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.0.cancelled.store(true, Ordering::SeqCst);
    }

    /// Register a new translation job. Stores the new job ID first (under the mutex),
    /// then clears the cancel flag. This ordering eliminates the race window where
    /// `is_cancelled` could see `cancelled=false` (just cleared) but `active_task`
    /// still holding the stale ID.
    pub fn register_task(&self, job_id: &str) -> Option<String> {
        let mut task = self.0.active_task.lock().unwrap_or_else(|e| e.into_inner());
        let old = task.replace(job_id.to_string());
        // Only clear cancel AFTER the new task ID is visible under the mutex.
        self.0.cancelled.store(false, Ordering::SeqCst);
        old
    }

    /// Expose the inner `AtomicBool` for scanner integration.
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.0.cancelled
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

// Global default instance — used by backward-compatible free functions.
use std::sync::LazyLock;
static GLOBAL_CANCEL: LazyLock<CancelToken> = LazyLock::new(CancelToken::new);

/// Check whether the current translation job should stop.
pub fn is_translation_cancelled(job_id: &str) -> bool {
    GLOBAL_CANCEL.is_cancelled(job_id)
}

/// Signal the current translation to stop.
pub fn cancel_current_translation() {
    GLOBAL_CANCEL.cancel_current();
}

/// Register a new translation job.  Backward-compatible delegate to
/// `GLOBAL_CANCEL.register_task`.
pub fn register_translation_task(job_id: &str) -> Option<String> {
    GLOBAL_CANCEL.register_task(job_id)
}

// ── Pipeline context ───────────────────────────────────────────

/// Shared context carried through all pipeline phases.
/// Holds configuration, channels, and mutable phase-local state.
pub struct PipelineContext<'a> {
    pub config: &'a PipelineConfig,
    pub job_id: &'a str,
    pub cancel: &'a CancelToken,
    pub progress_tx: &'a mpsc::Sender<PipelineProgress>,
    pub log_tx: &'a mpsc::Sender<TranslateLogEntry>,
    pub entry_progress_tx: &'a mpsc::Sender<EntryProgress>,
    pub scan_summary: Option<ScanSummary>,
    pub dict_conn: Option<rusqlite::Connection>,
    pub dict_db_path: Option<std::path::PathBuf>,
    // Phase-owned data (no lifetime dependency — cloned at phase boundaries)
    pub pending_entries: Vec<(LanguageEntry, String, Option<String>)>,
    pub llm_only_entries: Vec<(LanguageEntry, String)>,
    pub total: usize,
    pub non_llm_count: usize,
    pub llm_count: usize,
    pub failed_count: usize,
    pub accumulated_token_usage: TokenUsage,
}

// ── Pending entry extraction ──────────────────────────────────

/// Extract ALL source entries.  Each entry carries the existing translation text
/// if available (from mod-internal target lang file, or from resource packs).
/// Entries without an existing translation go through dictionary → LLM.
pub fn extract_pending_entries(
    summary: &ScanSummary,
) -> Vec<(LanguageEntry, String, Option<String>)> {
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
        // Skip mods that already have built-in target language files —
        // they don't need dictionary matching or LLM translation.
        if mod_result.has_target_language {
            continue;
        }
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
            pending.push((entry.clone(), mod_result.file_name.clone(), existing));
        }
    }
    pending
}

/// 按原始顺序分批（允许单次请求混用多个模组的条目）
fn chunk_entries(
    entries: &[(LanguageEntry, String)],
    batch_size: usize,
) -> Vec<Vec<(LanguageEntry, String)>> {
    entries.chunks(batch_size.max(1)).map(|c| c.to_vec()).collect()
}

// ── Dictionary phase result ─────────────────────────────────

/// Result of the dictionary-matching phase (Phase 3).  `llm_only_entries`
/// contains entries that need LLM translation; the rest were handled.
pub struct DictionaryPhaseResult {
    pub processed: usize,
    pub non_llm_count: usize,
    pub llm_only_entries: Vec<(LanguageEntry, String)>,
}

/// Phase 3: Match every pending entry against the dictionary.
///   - Existing / skipped / dictionary-hit → written to job results + emitted as Completed / Skip / DictionaryHit
///   - LLM-needed entries → returned in `DictionaryPhaseResult.llm_only_entries`
fn dictionary_phase(
    ctx: &mut PipelineContext,
    pending: &[(LanguageEntry, String, Option<String>)],
    total: usize,
) -> Result<DictionaryPhaseResult, String> {
    let config = ctx.config;
    let job_id = ctx.job_id;
    let cancel = ctx.cancel;
    let progress_tx = ctx.progress_tx;
    let log_tx = ctx.log_tx;
    let entry_progress_tx = ctx.entry_progress_tx;

    let prefer_user_dict = config.llm.as_ref().map(|c| c.prefer_user_dict).unwrap_or(false);
    let dict_db_path = paths::dictionary_db_path(&config.root);
    let dict_conn = dictionary::open(&dict_db_path).map_err(|e| format!("打开词典失败: {e}"))?;
    ctx.dict_conn = Some(dict_conn);

    let mut processed = 0usize;
    let mut batch_results: Vec<jobs::TranslationResult> = Vec::new();
    let mut llm_only_entries: Vec<(LanguageEntry, String)> = Vec::new();

    const DICT_PHASE_BATCH: usize = 512;
    let mut entry_progress_buf: Vec<EntryProgress> = Vec::with_capacity(DICT_PHASE_BATCH);
    let mut log_buf: Vec<TranslateLogEntry> = Vec::with_capacity(DICT_PHASE_BATCH);

    let flush_dict_batch = |ep_buf: &mut Vec<EntryProgress>, l_buf: &mut Vec<TranslateLogEntry>| {
        if !ep_buf.is_empty() {
            for ep in ep_buf.drain(..) {
                let _ = entry_progress_tx.send(ep);
            }
        }
        if !l_buf.is_empty() {
            for entry in l_buf.drain(..) {
                let _ = log_tx.send(entry);
            }
        }
    };

    let dict_conn_ref = ctx.dict_conn.as_ref().unwrap();
    for (entry, file_name, existing_target) in pending {
        if cancel.is_cancelled(job_id) {
            break;
        }

        if let Some(target_text) = existing_target {
            batch_results.push(jobs::TranslationResult {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: target_text.clone(),
                mod_id: entry.mod_id.clone(),
                mod_name: file_name.to_string(),
                source_type: "existing".into(),
            });
            log_buf.push(TranslateLogEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: target_text.clone(),
                mod_name: file_name.to_string(),
                source_type: "existing".into(),
            });
            entry_progress_buf.push(EntryProgress {
                key: entry.key.clone(),
                mod_name: file_name.to_string(),
                source_text: entry.text.clone(),
                target_text: Some(target_text.clone()),
                status: EntryStatus::Completed,
                error_message: None,
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
            log_buf.push(TranslateLogEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                target_text: entry.text.clone(),
                mod_name: file_name.to_string(),
                source_type: "skipped".into(),
            });
            entry_progress_buf.push(EntryProgress {
                key: entry.key.clone(),
                mod_name: file_name.to_string(),
                source_text: entry.text.clone(),
                target_text: Some(entry.text.clone()),
                status: EntryStatus::Skip,
                error_message: None,
            });
        } else {
            let source_hash = dictionary::hash_text(&entry.text);
            match dictionary::search_by_hash(dict_conn_ref, &source_hash, &config.target_language) {
                Ok(results) => {
                    let dict_match = if prefer_user_dict {
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
                        log_buf.push(TranslateLogEntry {
                            key: entry.key.clone(),
                            source_text: entry.text.clone(),
                            target_text: de.target_text.clone(),
                            mod_name: file_name.to_string(),
                            source_type: "dictionary".into(),
                        });
                        entry_progress_buf.push(EntryProgress {
                            key: entry.key.clone(),
                            mod_name: file_name.to_string(),
                            source_text: entry.text.clone(),
                            target_text: Some(de.target_text.clone()),
                            status: EntryStatus::DictionaryHit,
                            error_message: None,
                        });
                    } else {
                        llm_only_entries.push((entry.clone(), file_name.clone()));
                    }
                }
                Err(_) => {
                    llm_only_entries.push((entry.clone(), file_name.clone()));
                }
            }
        }
        processed += 1;

        if entry_progress_buf.len() >= DICT_PHASE_BATCH {
            flush_dict_batch(&mut entry_progress_buf, &mut log_buf);
        }

        if processed % 64 == 0 {
            let _ = progress_tx.send(PipelineProgress {
                current: processed, total,
                phase: PipelinePhase::Dictionary,
                mod_name: String::new(), sub_step: None,
                stage_status: StageStatus::Running,
            });
        }
    }

    flush_dict_batch(&mut entry_progress_buf, &mut log_buf);

    let non_llm_count = processed - llm_only_entries.len();
    logging::append_main(format!(
        "词典匹配完成: 共 {processed} 条目, 非 LLM {non_llm_count}, 待 LLM 翻译 {}",
        llm_only_entries.len()
    )).ok();

    for (entry, file_name) in &llm_only_entries {
        let _ = entry_progress_tx.send(EntryProgress {
            key: entry.key.clone(),
            mod_name: file_name.to_string(),
            source_text: entry.text.clone(),
            target_text: None,
            status: EntryStatus::Pending,
            error_message: None,
        });
        let _ = log_tx.send(TranslateLogEntry {
            key: entry.key.clone(),
            source_text: entry.text.clone(),
            target_text: String::new(),
            mod_name: file_name.to_string(),
            source_type: "llm".into(),
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

    Ok(DictionaryPhaseResult { processed, non_llm_count, llm_only_entries })
}

// ── Phase trait ──────────────────────────────────────────────────

/// Outcome returned by each phase to the pipeline orchestrator.
pub enum PhaseOutcome {
    /// Proceed to the next phase normally.
    Continue,
    /// Stop the pipeline immediately and return this result.
    StopAndReturn(PipelineResult),
}

/// A single stage in the translation pipeline.
pub trait Phase {
    /// Human-readable name for logging / progress.
    fn name(&self) -> &'static str;
    /// Execute this phase.  Returns an outcome directing the orchestrator.
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, String>;
}

/// Ordered list of phases run in sequence.
pub struct Pipeline {
    pub phases: Vec<Box<dyn Phase>>,
}

impl Pipeline {
    /// Execute all phases in order.  Returns the aggregated `PipelineResult`.
    pub fn run(&self, ctx: &mut PipelineContext) -> Result<PipelineResult, String> {
        for phase in &self.phases {
            if ctx.cancel.is_cancelled(ctx.job_id) {
                break;
            }
            match phase.run(ctx)? {
                PhaseOutcome::Continue => {}
                PhaseOutcome::StopAndReturn(result) => return Ok(result),
            }
        }
        Err("Pipeline completed without a final result — Phase 5 not reached".to_string())
    }
}

/// Builder for constructing a `Pipeline` with compile-time phase ordering.
pub struct PipelineBuilder {
    phases: Vec<Box<dyn Phase>>,
}

impl PipelineBuilder {
    pub fn new() -> Self {
        Self { phases: Vec::new() }
    }

    pub fn phase(mut self, p: impl Phase + 'static) -> Self {
        self.phases.push(Box::new(p));
        self
    }

    pub fn build(self) -> Pipeline {
        Pipeline { phases: self.phases }
    }
}

// ── LLM phase result ───────────────────────────────────────────

/// Result of the LLM translation phase (Phase 4).
pub struct LlmPhaseResult {
    pub accumulated_token_usage: TokenUsage,
    pub llm_count: usize,
    pub failed_count: usize,
}

/// Phase 4: Send LLM-needed entries through the concurrent translation worker pool.
fn llm_phase(
    ctx: &PipelineContext,
    llm_only_entries: &[(LanguageEntry, String)],
    dict_db_path: &std::path::Path,
) -> Result<LlmPhaseResult, String> {
    let config = ctx.config;
    let job_id = ctx.job_id;
    let cancel = ctx.cancel;
    let progress_tx = ctx.progress_tx;
    let _log_tx = ctx.log_tx;
    let entry_progress_tx = ctx.entry_progress_tx;

    if llm_only_entries.is_empty() {
        logging::append_main("LLM 翻译阶段: 无待翻译条目，跳过".to_string()).ok();
        return Ok(LlmPhaseResult {
            accumulated_token_usage: TokenUsage::default(),
            llm_count: 0,
            failed_count: 0,
        });
    }

    let llm_cfg = config.llm.as_ref().ok_or_else(|| "LLM 未配置，但有待翻译条目需要 LLM 翻译".to_string())?;
    let effective_batch_size = llm_cfg.batch_size.max(1);

    let batches = chunk_entries(llm_only_entries, effective_batch_size);
    let total_llm_batches = batches.len();
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

    logging::append_main(format!(
        "LLM 翻译阶段开始: {} 条目, {} 批次, 并发 {initial_concurrency}, 模型 {}",
        llm_only_entries.len(),
        total_llm_batches,
        llm_cfg.model,
    )).ok();

    // ── 元数据索引（按位置对应，避免 HashMap 键碰撞） ────────
    let mut key_meta: Vec<Vec<(&str, &str, &str)>> = Vec::with_capacity(batches.len());
    for batch in &batches {
        let meta: Vec<(&str, &str, &str)> = batch.iter()
            .map(|(e, f)| (e.key.as_str(), e.mod_id.as_str(), f.as_str()))
            .collect();
        key_meta.push(meta);
    }

    let _ = progress_tx.send(PipelineProgress {
        current: 0, total: total_llm_batches,
        phase: PipelinePhase::Translating,
        mod_name: String::new(),
        sub_step: Some(format!("0/{total_llm_batches} 批次")),
        stage_status: StageStatus::Running,
    });

    // ── 持续并发工作池 ────────────────────────────────────
    let write_lock = std::sync::Mutex::new(());
    const RESULTS_FLUSH_INTERVAL: usize = 5;
    let active_workers = std::sync::atomic::AtomicUsize::new(0);
    let next_batch = std::sync::atomic::AtomicUsize::new(0);
    let completed_batches = std::sync::atomic::AtomicUsize::new(0);
    let global_llm_count = std::sync::atomic::AtomicUsize::new(0);
    let global_failed_count = std::sync::atomic::AtomicUsize::new(0);
    let token_usage_mutex = std::sync::Mutex::new(TokenUsage::default());

    std::thread::scope(|s| {
        for _ in 0..initial_concurrency {
            s.spawn(|| {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let worker_dict = match dictionary::open(dict_db_path) {
                        Ok(conn) => conn,
                        Err(e) => {
                            let _ = logging::append_job(job_id, format!("worker 打开词典失败: {e}"));
                            return;
                        }
                    };

                    active_workers.fetch_add(1, Ordering::Relaxed);
                    let mut worker_429_count = 0usize;
                    let batch_capacity = RESULTS_FLUSH_INTERVAL * effective_batch_size;
                    let mut result_buf: Vec<jobs::TranslationResult> = Vec::with_capacity(batch_capacity);
                    let mut buf_count = 0usize;

                    loop {
                        if cancel.is_cancelled(job_id) {
                            break;
                        }

                        let bi = next_batch.fetch_add(1, Ordering::Relaxed);
                        if bi >= total_llm_batches {
                            break;
                        }

                        if cancel.is_cancelled(job_id) {
                            break;
                        }

                        let batch = &batches[bi];
                        let meta = &key_meta[bi];

                        let mut batch_refs = Vec::new();
                        let mut seen_ref = HashSet::new();
                        for (entry, _) in batch {
                            if let Ok(matches) = cfpa::fuzzy_search(&worker_dict, &entry.text, &entry.language, &config.target_language, 5) {
                                for m in &matches {
                                    if seen_ref.insert(m.source_text.clone()) {
                                        batch_refs.push((m.source_text.clone(), m.target_text.clone()));
                                    }
                                }
                            }
                        }

                        let mut batch_shield_map: HashMap<String, (String, shield::ShieldResult)> = HashMap::new();
                        let entries: Vec<TranslationEntry> = batch.iter().map(|(entry, _)| {
                            let sr = shield::protect(&entry.text);
                            batch_shield_map.insert(entry.key.clone(), (entry.text.clone(), sr.clone()));
                            TranslationEntry {
                                key: entry.key.clone(),
                                text: sr.protected,
                                mod_id: entry.mod_id.clone(),
                                source_lang: entry.language.clone(),
                                target_lang: config.target_language.clone(),
                                references: batch_refs.clone(),
                            }
                        }).collect();

                        for (i, te) in entries.iter().enumerate() {
                            let original_text = batch_shield_map.get(te.key.as_str())
                                .map(|(orig, _)| orig.clone())
                                .unwrap_or_else(|| te.text.clone());
                            let _ = entry_progress_tx.send(EntryProgress {
                                key: te.key.clone(),
                                mod_name: meta[i].2.to_string(),
                                source_text: original_text,
                                target_text: None,
                                status: EntryStatus::Translating,
                                error_message: None,
                            });
                        }

                        let on_complete = |results: &[TranslateResult]| {
                            for (i, r) in results.iter().enumerate() {
                                let (restored_source, restored_target, valid) = shield_restore_result(r, &batch_shield_map);
                                let target_text = if !r.success {
                                    r.translated_text.clone()
                                } else if valid {
                                    restored_target
                                } else {
                                    restored_target.clone()
                                };
                                let status = if r.success && valid { EntryStatus::Completed }
                                    else if !r.success { EntryStatus::Failed }
                                    else { EntryStatus::Failed };
                                let error_message = if !r.success { r.error.clone() }
                                    else if !valid { Some("翻译结果缺少占位符，可能被 LLM 破坏".to_string()) }
                                    else { None };
                                let entry_mod_name = meta.get(i).map(|&(_, _, f)| f).unwrap_or("");
                                let _ = entry_progress_tx.send(EntryProgress {
                                    key: r.key.clone(),
                                    mod_name: entry_mod_name.to_string(),
                                    source_text: restored_source,
                                    target_text: Some(target_text),
                                    status,
                                    error_message,
                                });
                            }
                        };

                        let (results, token_usage) = client.translate_batch(&entries, Some(&on_complete));
                        let token = token_usage.unwrap_or_default();

                        let all_rate_limited = results.iter().all(|r| {
                            !r.success && r.error.as_deref().map_or(false, |e| e.starts_with("RATE_LIMITED"))
                        });

                        if all_rate_limited {
                            worker_429_count += 1;
                            let wait_secs = match worker_429_count {
                                1 => 30u64,
                                2 => 60,
                                _ => 120,
                            };
                            std::thread::sleep(Duration::from_secs(wait_secs));

                            let (retry_results, retry_token) = client.translate_batch(&entries, Some(&on_complete));
                            if let Some(t) = retry_token {
                                let mut tm = token_usage_mutex.lock().unwrap_or_else(|e| e.into_inner());
                                tm.prompt_tokens += t.prompt_tokens;
                                tm.completion_tokens += t.completion_tokens;
                                tm.total_tokens += t.total_tokens;
                            }
                            let retry_results: Vec<jobs::TranslationResult> = retry_results.into_iter()
                                .enumerate().map(|(i, r)| {
                                    let (restored_source, restored_target, valid) = shield_restore_result(&r, &batch_shield_map);
                                    let (s_text, t_text, s_type) = if r.success {
                                        (restored_source, restored_target, if valid { "llm" } else { "failed" }.to_string())
                                    } else {
                                        (restored_source, r.translated_text, "failed".to_string())
                                    };
                                    let &(_k, mid, fname) = &meta[i];
                                    jobs::TranslationResult {
                                        key: r.key,
                                        source_text: s_text,
                                        target_text: t_text,
                                        mod_id: mid.to_string(),
                                        mod_name: fname.to_string(),
                                        source_type: s_type,
                                    }
                                }).collect();

                            for entry in &retry_results {
                                if entry.source_type == "llm" { global_llm_count.fetch_add(1, Ordering::Relaxed); }
                                else if entry.source_type == "failed" { global_failed_count.fetch_add(1, Ordering::Relaxed); }
                            }
                            result_buf.extend(retry_results);
                        } else {
                            worker_429_count = 0;
                        }

                        if !all_rate_limited {
                            let mut tm = token_usage_mutex.lock().unwrap_or_else(|e| e.into_inner());
                            tm.prompt_tokens += token.prompt_tokens;
                            tm.completion_tokens += token.completion_tokens;
                            tm.total_tokens += token.total_tokens;
                        }

                        if !all_rate_limited {
                            for (i, r) in results.into_iter().enumerate() {
                                let (restored_source, restored_target, valid) = shield_restore_result(&r, &batch_shield_map);
                                let (s_text, t_text, s_type) = if r.success {
                                    (restored_source, restored_target, if valid { "llm" } else { "failed" }.to_string())
                                } else {
                                    (restored_source, r.translated_text, "failed".to_string())
                                };
                                let &(_k, mid, fname) = &meta[i];
                                let entry = jobs::TranslationResult {
                                    key: r.key,
                                    source_text: s_text,
                                    target_text: t_text,
                                    mod_id: mid.to_string(),
                                    mod_name: fname.to_string(),
                                    source_type: s_type,
                                };
                                if entry.source_type == "llm" { global_llm_count.fetch_add(1, Ordering::Relaxed); }
                                else if entry.source_type == "failed" { global_failed_count.fetch_add(1, Ordering::Relaxed); }
                                result_buf.push(entry);
                            }
                        }

                        buf_count += 1;
                        if buf_count % RESULTS_FLUSH_INTERVAL == 0 && !result_buf.is_empty() {
                            let _lock = write_lock.lock().unwrap_or_else(|e| e.into_inner());
                            let _ = jobs::batch_append_results(&config.root, job_id, &result_buf);
                            result_buf.clear();
                        }

                        let cb = completed_batches.fetch_add(1, Ordering::Relaxed) + 1;
                        let _ = progress_tx.send(PipelineProgress {
                            current: cb,
                            total: total_llm_batches,
                            phase: PipelinePhase::Translating,
                            mod_name: String::new(),
                            sub_step: Some(format!("{cb}/{total_llm_batches} 批次")),
                            stage_status: StageStatus::Running,
                        });

                        if !all_rate_limited && llm_cfg.rate_limit_rpm > 0 && initial_concurrency > 0 {
                            let per_worker_delay = (60000.0 * initial_concurrency as f64 / llm_cfg.rate_limit_rpm as f64) as u64;
                            if per_worker_delay > 0 {
                                std::thread::sleep(Duration::from_millis(per_worker_delay.min(60000)));
                            }
                        }
                    }

                    if !result_buf.is_empty() {
                        let _lock = write_lock.lock().unwrap_or_else(|e| e.into_inner());
                        let _ = jobs::batch_append_results(&config.root, job_id, &result_buf);
                    }
                }));

                if let Err(panic_err) = result {
                    let msg = if let Some(s) = panic_err.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_err.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "未知 panic".to_string()
                    };
                    let _ = logging::append_job(job_id, format!("LLM worker panic: {msg}"));
                }
            });
        }
    });

    if active_workers.load(Ordering::Relaxed) == 0 {
        return Err("所有 LLM 工作者启动失败，请检查词典数据库可用性".to_string());
    }

    let llm_count = global_llm_count.load(Ordering::SeqCst);
    let failed_count = global_failed_count.load(Ordering::SeqCst);
    logging::append_main(format!(
        "LLM 翻译阶段完成: 成功 {llm_count} 条目, 失败 {failed_count} 条目",
    )).ok();

    Ok(LlmPhaseResult {
        accumulated_token_usage: token_usage_mutex.into_inner().unwrap_or_else(|e| e.into_inner()),
        llm_count,
        failed_count,
    })
}

// ── Phase implementations ──────────────────────────────────────

struct ScanExtractPhase;

impl Phase for ScanExtractPhase {
    fn name(&self) -> &'static str { "scan+extract" }
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, String> {
        let _ = ctx.progress_tx.send(PipelineProgress {
            current: 0, total: 1, phase: PipelinePhase::Scanning,
            mod_name: String::new(), sub_step: None,
            stage_status: StageStatus::Running,
        });

        let scan_summary = resolve_scan(ctx.config, ctx.job_id, ctx.cancel, ctx.progress_tx)?;

        if scan_summary.cancelled || ctx.cancel.is_cancelled(ctx.job_id) {
            return Ok(PhaseOutcome::StopAndReturn(PipelineResult {
                completed: 0, non_llm_count: 0, llm_count: 0,
                token_usage: TokenUsage::default(),
                actual_source_language: ctx.config.source_language.clone(),
                job_id: ctx.job_id.to_string(),
            }));
        }

        ctx.scan_summary = Some(scan_summary.clone());
        ctx.dict_db_path = Some(paths::dictionary_db_path(&ctx.config.root));

        let _ = ctx.progress_tx.send(PipelineProgress {
            current: 0, total: 1, phase: PipelinePhase::Extracting,
            mod_name: String::new(), sub_step: None,
            stage_status: StageStatus::Running,
        });

        ctx.pending_entries = extract_pending_entries(&scan_summary);
        ctx.total = ctx.pending_entries.len().max(1);

        let _ = ctx.progress_tx.send(PipelineProgress {
            current: 1, total: 1, phase: PipelinePhase::Extracting,
            mod_name: String::new(), sub_step: None,
            stage_status: StageStatus::Completed,
        });

        if ctx.cancel.is_cancelled(ctx.job_id) {
            return Ok(PhaseOutcome::StopAndReturn(PipelineResult {
                completed: 0, non_llm_count: 0, llm_count: 0,
                token_usage: TokenUsage::default(),
                actual_source_language: scan_summary.source_language.clone(),
                job_id: ctx.job_id.to_string(),
            }));
        }

        Ok(PhaseOutcome::Continue)
    }
}

struct DictionaryPhase;

impl Phase for DictionaryPhase {
    fn name(&self) -> &'static str { "dictionary" }
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, String> {
        if ctx.pending_entries.is_empty() {
            ctx.non_llm_count = 0;
            return Ok(PhaseOutcome::Continue);
        }
        let pending = std::mem::take(&mut ctx.pending_entries);
        let total = ctx.total;
        let result = dictionary_phase(ctx, &pending, total)?;
        ctx.non_llm_count = result.non_llm_count;
        ctx.llm_only_entries = result.llm_only_entries;

        if ctx.cancel.is_cancelled(ctx.job_id) {
            return Ok(PhaseOutcome::StopAndReturn(PipelineResult {
                completed: ctx.non_llm_count,
                non_llm_count: ctx.non_llm_count,
                llm_count: 0,
                token_usage: TokenUsage::default(),
                actual_source_language: ctx.config.source_language.clone(),
                job_id: ctx.job_id.to_string(),
            }));
        }

        Ok(PhaseOutcome::Continue)
    }
}

struct LlmPhase;

impl Phase for LlmPhase {
    fn name(&self) -> &'static str { "llm" }
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, String> {
        let dict_db_path = ctx.dict_db_path.clone()
            .unwrap_or_else(|| paths::dictionary_db_path(&ctx.config.root));
        let llm_entries = std::mem::take(&mut ctx.llm_only_entries);
        let result = llm_phase(ctx, &llm_entries, &dict_db_path)?;
        ctx.accumulated_token_usage = result.accumulated_token_usage;
        ctx.llm_count = result.llm_count;
        ctx.failed_count = result.failed_count;
        Ok(PhaseOutcome::Continue)
    }
}

struct FinalizePhase;

impl Phase for FinalizePhase {
    fn name(&self) -> &'static str { "finalize" }
    fn run(&self, ctx: &mut PipelineContext) -> Result<PhaseOutcome, String> {
        let total = ctx.total;
        let non_llm_count = ctx.non_llm_count;
        let llm_count = ctx.llm_count;
        let failed_count = ctx.failed_count;
        let completed = non_llm_count + llm_count;

        if ctx.cancel.is_cancelled(ctx.job_id) {
            let _ = logging::append_job(ctx.job_id, "翻译任务在完成前被取消");
            save_job_progress(&ctx.config.root, ctx.job_id, completed, failed_count, jobs::TranslationStatus::Cancelled);
            return Ok(PhaseOutcome::StopAndReturn(PipelineResult {
                completed, non_llm_count, llm_count,
                token_usage: ctx.accumulated_token_usage.clone(),
                actual_source_language: ctx.config.source_language.clone(),
                job_id: ctx.job_id.to_string(),
            }));
        }

        if ctx.accumulated_token_usage.total_tokens > 0 {
            let _ = logging::append_job(ctx.job_id, format!(
                "LLM Token 使用: prompt={}, completion={}, total={}",
                ctx.accumulated_token_usage.prompt_tokens,
                ctx.accumulated_token_usage.completion_tokens,
                ctx.accumulated_token_usage.total_tokens,
            ));
        }

        let _ = ctx.progress_tx.send(PipelineProgress {
            current: total, total,
            phase: PipelinePhase::Completed,
            mod_name: String::new(), sub_step: None,
            stage_status: StageStatus::Completed,
        });

        let _ = logging::append_job(ctx.job_id, format!(
            "翻译完成: {total}/{total} 条目 (非 LLM: {non_llm_count}, LLM: {llm_count})"
        ));

        save_job_progress(&ctx.config.root, ctx.job_id, completed, failed_count, jobs::TranslationStatus::Completed);
        Ok(PhaseOutcome::StopAndReturn(PipelineResult {
            completed, non_llm_count, llm_count,
            token_usage: ctx.accumulated_token_usage.clone(),
            actual_source_language: ctx.config.source_language.clone(),
            job_id: ctx.job_id.to_string(),
        }))
    }
}

// ── Main pipeline ─────────────────────────────────────────────

/// Persist job progress counters to disk. Called in both completion and cancellation paths.
fn save_job_progress(root: &std::path::Path, job_id: &str, completed: usize, failed: usize, status: jobs::TranslationStatus) {
    let manager = jobs::JobManager::new(root.to_path_buf());
    if let Ok(Some(mut job)) = manager.load(job_id) {
        job.completed_entries = completed;
        job.failed_entries = failed;
        if matches!(status, jobs::TranslationStatus::Completed) {
            job.completed_at = Some(jobs::now_rfc3339());
        }
        job.status = status;
        if let Err(err) = manager.save(&job) {
            let _ = logging::append_job(job_id, format!("保存 job 状态失败: {err}"));
        }
    }
}

/// Restore shield tokens and validate a translation result.
/// Returns (restored_source, restored_target, valid).
pub fn shield_restore_result(
    result: &TranslateResult,
    shield_map: &HashMap<String, (String, shield::ShieldResult)>,
) -> (String, String, bool) {
    let Some((_, sr)) = shield_map.get(&result.key) else {
        return (result.original_text.clone(), result.translated_text.clone(), true);
    };
    let restored_source = shield::restore(&result.original_text, &sr.tokens);
    let restored_target = shield::restore(&result.translated_text, &sr.tokens);
    let valid = shield::validate(&sr.tokens, &restored_target);
    (restored_source, restored_target, valid)
}

/// Run the full translation pipeline. Emits progress and log events through channels.
pub fn run_pipeline(
    config: PipelineConfig,
    job_id: &str,
    cancel: &CancelToken,
    progress_tx: mpsc::Sender<PipelineProgress>,
    log_tx: mpsc::Sender<TranslateLogEntry>,
    entry_progress_tx: mpsc::Sender<EntryProgress>,
) -> Result<PipelineResult, String> {
    let mut ctx = PipelineContext {
        config: &config,
        job_id,
        cancel,
        progress_tx: &progress_tx,
        log_tx: &log_tx,
        entry_progress_tx: &entry_progress_tx,
        scan_summary: None,
        dict_conn: None,
        dict_db_path: None,
        pending_entries: Vec::new(),
        llm_only_entries: Vec::new(),
        total: 0,
        non_llm_count: 0,
        llm_count: 0,
        failed_count: 0,
        accumulated_token_usage: TokenUsage::default(),
    };

    let pipeline = PipelineBuilder::new()
        .phase(ScanExtractPhase)
        .phase(DictionaryPhase)
        .phase(LlmPhase)
        .phase(FinalizePhase)
        .build();

    pipeline.run(&mut ctx)
}

/// Resolve a ScanSummary: try to load from cached file, or run a new scan.
/// When running a scan, progress events are relayed through progress_tx.
fn resolve_scan(
    config: &PipelineConfig,
    _job_id: &str,
    cancel: &CancelToken,
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
                        let _ = logging::append_main(format!("从缓存加载扫描结果 (任务 {sid})"));
                        return Ok(summary);
                    }
                    let _ = logging::append_main(format!(
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
        config.instance_path.clone(),
        config.source_language.clone(),
        config.target_language.clone(),
        config.resource_pack_names.clone(),
        cancel.cancel_flag(),
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
                let _ = logging::append_main(format!("扫描结果写入失败 ({}): {err}", job_path.display()));
            }
        }
    }

    Ok(summary)
}

/// Retry failed entries from a previous translation job.
/// Skips scan/extract/dictionary phases, runs only LLM translation on
/// entries whose `source_type == "failed"`, and returns the new results.
pub fn retry_failed_entries(
    root: &std::path::Path,
    job_id: &str,
    source_language: &str,
    target_language: &str,
    llm_cfg: &LlmConfig,
    cancel: &CancelToken,
    progress_tx: &mpsc::Sender<PipelineProgress>,
    entry_progress_tx: &mpsc::Sender<EntryProgress>,
) -> Result<Vec<jobs::TranslationResult>, String> {
    use std::collections::HashMap;

    let manager = jobs::JobManager::new(root.to_path_buf());
    let all_results = manager.load_results(job_id)?;

    let failed: Vec<&jobs::TranslationResult> = all_results.iter()
        .filter(|r| r.source_type == "failed")
        .collect();

    if failed.is_empty() {
        return Ok(Vec::new());
    }

    let total = failed.len();
    let _ = progress_tx.send(PipelineProgress {
        current: 0, total,
        phase: PipelinePhase::Translating,
        mod_name: String::new(),
        sub_step: Some("重试失败条目...".to_string()),
        stage_status: StageStatus::Running,
    });

    let effective_concurrency = llm_cfg.concurrency.min(total).max(1);
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
        effective_concurrency: std::sync::atomic::AtomicUsize::new(effective_concurrency),
        consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
    };

    client.validate()?;

    let mut retried: Vec<jobs::TranslationResult> = Vec::with_capacity(total);
    let batch_size = llm_cfg.batch_size.max(1);
    let total_batches = (total + batch_size - 1) / batch_size;
    let mut completed_batches = 0usize;

    for chunk in failed.chunks(batch_size) {
        if cancel.is_cancelled(job_id) {
            break;
        }

        let mut shield_map: HashMap<String, (String, shield::ShieldResult)> = HashMap::new();
        let entries: Vec<TranslationEntry> = chunk.iter().map(|r| {
            let sr = shield::protect(&r.source_text);
            shield_map.insert(r.key.clone(), (r.source_text.clone(), sr.clone()));
            TranslationEntry {
                key: r.key.clone(),
                text: sr.protected,
                mod_id: r.mod_id.clone(),
                source_lang: source_language.to_string(),
                target_lang: target_language.to_string(),
                references: Vec::new(),
            }
        }).collect();

        // Send Translating status for each entry
        for r in chunk.iter() {
            let original_text = shield_map.get(&r.key)
                .map(|(orig, _)| orig.clone())
                .unwrap_or_else(|| r.source_text.clone());
            let _ = entry_progress_tx.send(EntryProgress {
                key: r.key.clone(),
                mod_name: r.mod_name.clone(),
                source_text: original_text,
                target_text: None,
                status: EntryStatus::Translating,
                error_message: None,
            });
        }

        // Build a (mod_id, mod_name) index keyed by TranslationResult key
        let meta: HashMap<&str, (&str, &str)> = chunk.iter()
            .map(|r| (r.key.as_str(), (r.mod_id.as_str(), r.mod_name.as_str())))
            .collect();

        let on_complete = |results: &[TranslateResult]| {
            for r in results {
                let (restored_source, restored_target, valid) = shield_restore_result(r, &shield_map);
                let target_text = if !r.success {
                    r.translated_text.clone()
                } else if valid {
                    restored_target
                } else {
                    restored_target.clone()
                };
                let status = if r.success && valid { EntryStatus::Completed }
                    else if !r.success { EntryStatus::Failed }
                    else { EntryStatus::Failed };
                let error_message = if !r.success { r.error.clone() }
                    else if !valid { Some("翻译结果缺少占位符，可能被 LLM 破坏".to_string()) }
                    else { None };
                let &(_, fname) = meta.get(r.key.as_str()).unwrap_or(&("", ""));
                let _ = entry_progress_tx.send(EntryProgress {
                    key: r.key.clone(),
                    mod_name: fname.to_string(),
                    source_text: restored_source,
                    target_text: Some(target_text),
                    status,
                    error_message,
                });
            }
        };

        let (results, _token) = client.translate_batch(&entries, Some(&on_complete));

        for r in results.into_iter() {
            let (restored_source, restored_target, valid) = shield_restore_result(&r, &shield_map);
            let (s_text, t_text, s_type) = if r.success {
                (restored_source, restored_target, if valid { "llm" } else { "failed" }.to_string())
            } else {
                (restored_source, r.translated_text, "failed".to_string())
            };
            let &(mid, fname) = meta.get(r.key.as_str()).unwrap_or(&("", ""));
            let entry = jobs::TranslationResult {
                key: r.key,
                source_text: s_text,
                target_text: t_text,
                mod_id: mid.to_string(),
                mod_name: fname.to_string(),
                source_type: s_type,
            };
            retried.push(entry);
        }

        completed_batches += 1;
        let _ = progress_tx.send(PipelineProgress {
            current: completed_batches,
            total: total_batches,
            phase: PipelinePhase::Translating,
            mod_name: String::new(),
            sub_step: Some(format!("{completed_batches}/{total_batches} 批次")),
            stage_status: StageStatus::Running,
        });
    }

    Ok(retried)
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
                has_target_language: false,
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
