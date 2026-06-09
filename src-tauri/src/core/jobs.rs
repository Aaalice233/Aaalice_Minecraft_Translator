// Translation job state machine
//
// Each translation run ("job") is associated with a prior scan via scan_job_id.
// The job freezes a list of pending entries at creation time so the user sees
// a consistent set regardless of subsequent filesystem changes.
//
// Storage layout in data/jobs/:
//   {scanJobId}.json                       — ScanSummary (written by scanner)
//   translate_{jobId}.json                 — TranslationJobState (lightweight, stats only)
//   translate_{jobId}_results.jsonl        — TranslationResult (one JSON object per line)
//
// Atomicity: job state files are written via tmp + rename so a crash during
// write corrupts at most one incomplete batch.

use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::{logging, models::{ScanSummary, TokenUsage}, paths};

// ── Re-export all job types ─────────────────────────────────────────

pub use self::types::*;

mod types {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
    #[serde(rename_all = "camelCase")]
    pub enum TranslationStatus {
        #[default]
        Pending,
        Running,
        Paused,
        Completed,
        Failed,
        Cancelled,
    }

    /// A single pending-translation entry extracted from ScanSummary at job creation time.
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct PendingEntry {
        pub key: String,
        pub source_text: String,
        pub mod_id: String,
        pub mod_name: String,
    }

    /// One translated result — lines in the .jsonl results file.
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct TranslationResult {
        pub key: String,
        pub source_text: String,
        pub target_text: String,
        pub mod_id: String,
        pub mod_name: String,
        pub source_type: String,
    }

    /// Lightweight job metadata persisted to translate_{jobId}.json.
    /// Translation bodies live in the companion .jsonl file.
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct TranslationJobState {
        pub job_id: String,
        pub scan_job_id: String,
        pub status: TranslationStatus,
        pub source_language: String,
        pub target_language: String,
        pub entries: Vec<PendingEntry>,
        pub completed_entries: usize,
        pub failed_entries: usize,
        pub token_usage: TokenUsage,
        pub created_at: String,
        pub completed_at: Option<String>,
    }

    /// Lightweight job summary returned by `list_all()`, excluding the full `entries` list.
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct TranslationJobListItem {
        pub job_id: String,
        pub scan_job_id: String,
        pub status: TranslationStatus,
        pub source_language: String,
        pub target_language: String,
        pub completed_entries: usize,
        pub failed_entries: usize,
        pub created_at: String,
        pub completed_at: Option<String>,
    }

    /// Per-module translation result summary (entry count only, no full entries).
    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct ModTranslationSummary {
        pub mod_id: String,
        pub entry_count: usize,
    }
}

// ── JobManager ──────────────────────────────────────────────────────

/// Manages creation, persistence, and querying of translation jobs.
pub struct JobManager {
    root: PathBuf,
}

impl JobManager {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    // ── Create ──────────────────────────────────────────────────────

    /// Create a new translation job from a previously persisted scan.
    ///
    /// Loads `{scan_job_id}.json`, computes the pending-entry list
    /// (source-language entries whose key has no target-language counterpart),
    /// and writes the initial job state to disk.
    pub fn create_from_scan(&self, scan_job_id: &str) -> Result<TranslationJobState, String> {
        let job_id = logging::new_job_id("translate");
        self.create_from_scan_with_job_id(scan_job_id, &job_id)
    }

    /// Same as `create_from_scan` but uses a caller-provided `job_id` instead of
    /// generating a new one.  This allows `start_translation` to create the job
    /// metadata file before the pipeline runs, using the same `job_id` that
    /// was already assigned.
    pub fn create_from_scan_with_job_id(&self, scan_job_id: &str, job_id: &str) -> Result<TranslationJobState, String> {
        let summary = self.load_scan_summary(scan_job_id)?;

        // Ensure jobs directory exists
        let jobs_dir = paths::jobs_dir(&self.root);
        std::fs::create_dir_all(&jobs_dir)
            .map_err(|e| format!("创建 jobs 目录失败: {e}"))?;

        let entries = crate::core::pipeline::extract_pending_entries(&summary)
            .into_iter()
            .map(|(entry, file_name, _existing)| PendingEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                mod_id: entry.mod_id.clone(),
                mod_name: file_name.to_string(),
            })
            .collect();

        let job = TranslationJobState {
            job_id: job_id.to_string(),
            scan_job_id: scan_job_id.to_string(),
            status: TranslationStatus::Pending,
            source_language: summary.source_language.clone(),
            target_language: summary.target_language.clone(),
            entries,
            completed_entries: 0,
            failed_entries: 0,
            token_usage: TokenUsage::default(),
            created_at: now_rfc3339(),
            completed_at: None,
        };

        // Write initial state before returning so the file exists even if
        // the caller crashes before starting the first batch.
        self.save(&job)?;

        logging::append_job(
            job_id,
            format!(
                "翻译 Job 创建: scan_job_id={scan_job_id}, 待翻译条目={}",
                job.entries.len()
            ),
        )
        .map_err(|e| format!("日志写入失败: {e}"))?;

        Ok(job)
    }

    // ── Persist ──────────────────────────────────────────────────────

    /// Atomically save job state. Writes to a .tmp file first, then
    /// renames over the target so a crash during write never truncates
    /// the real file.
    pub fn save(&self, job: &TranslationJobState) -> Result<(), String> {
        let path = paths::translate_job_state_path(&self.root, &job.job_id);
        let tmp_path = path.with_extension("json.tmp");

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 ({}): {e}", parent.display()))?;
        }

        let json = serde_json::to_string_pretty(job)
            .map_err(|e| format!("序列化 job 状态失败: {e}"))?;

        std::fs::write(&tmp_path, &json)
            .map_err(|e| format!("写入 job 状态失败 ({}): {e}", tmp_path.display()))?;

        std::fs::rename(&tmp_path, &path)
            .map_err(|e| format!("重命名 job 状态文件失败: {e}"))?;

        Ok(())
    }

    // ── Cleanup ─────────────────────────────────────────────────────

    /// Remove all non-current translation job files (translate_*.json and translate_*.jsonl)
    /// from the jobs directory. Called at the start of a new translation flow.
    /// Only the job with `current_job_id` is kept; all other translate_ files are deleted.
    pub fn cleanup_old_translation_jobs(&self, current_job_id: &str) -> Result<(), String> {
        let jobs_dir = paths::jobs_dir(&self.root);
        if !jobs_dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&jobs_dir).map_err(|e| format!("读取 jobs 目录失败: {e}"))? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let is_translate = name.starts_with("translate_")
                        && (name.ends_with(".json") || name.ends_with(".jsonl"))
                        && !name.ends_with(".json.tmp");
                    let is_current = name == format!("translate_{current_job_id}.json")
                        || name == format!("translate_{current_job_id}_results.jsonl");
                    if is_translate && !is_current {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
        Ok(())
    }

    // ── Load ─────────────────────────────────────────────────────────

    /// Load a specific translation job by its job_id.
    /// Tries the canonical path first, then falls back to the legacy
    /// double-prefix path for files created before prefix normalization.
    pub fn load(&self, job_id: &str) -> Result<Option<TranslationJobState>, String> {
        let path = paths::translate_job_state_path(&self.root, job_id);
        if path.is_file() {
            return read_job_file(&path);
        }
        // Backward compatibility: try legacy double-prefix path
        let legacy = self.root.join("data").join("jobs")
            .join(format!("translate_{job_id}.json"));
        if legacy.is_file() {
            return read_job_file(&legacy);
        }
        Ok(None)
    }

    /// Find the most recent translation job on disk (by mtime).
    pub fn load_latest(&self) -> Result<Option<TranslationJobState>, String> {
        read_latest_job_file::<TranslationJobState>(self.list_job_files()?, "job")
    }

    /// Load the most recent translation job metadata (no `entries` list).
    pub fn load_latest_meta(&self) -> Result<Option<TranslationJobListItem>, String> {
        read_latest_job_file::<TranslationJobListItem>(self.list_job_files()?, "元数据")
    }

    /// List all translation jobs on disk, sorted by mtime descending (newest first).
    /// Returns lightweight `TranslationJobListItem` (no `entries` list).
    pub fn list_all(&self) -> Result<Vec<TranslationJobListItem>, String> {
        let entries = self.list_job_files()?;
        let mut jobs = Vec::with_capacity(entries.len());

        for entry in entries {
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| format!("读取 job 文件失败: {e}"))?;
            if let Ok(job) = serde_json::from_str::<TranslationJobListItem>(&content) {
                jobs.push(job);
            }
        }

        Ok(jobs)
    }

    /// Internal: list translation job files sorted by mtime descending.
    fn list_job_files(&self) -> Result<Vec<std::fs::DirEntry>, String> {
        let jobs_dir = paths::jobs_dir(&self.root);
        if !jobs_dir.is_dir() {
            return Ok(Vec::new());
        }

        let mut entries: Vec<_> = std::fs::read_dir(&jobs_dir)
            .map_err(|e| format!("读取 jobs 目录失败: {e}"))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                let fname = e.file_name();
                let name = fname.to_string_lossy();
                name.starts_with("translate_") && name.ends_with(".json")
                    && !name.ends_with(".tmp")
            })
            .collect();

        entries.sort_by(|a, b| {
            b.metadata()
                .and_then(|m| m.modified())
                .ok()
                .cmp(&a.metadata().and_then(|m| m.modified()).ok())
        });

        Ok(entries)
    }

    // ── Results (JSONL) ──────────────────────────────────────────────

    /// Append one translated result to the job's .jsonl results file.
    pub fn append_result(&self, job_id: &str, result: &TranslationResult) -> Result<(), String> {
        let path = paths::translate_job_results_path(&self.root, job_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 ({}): {e}", parent.display()))?;
        }

        let mut line = serde_json::to_string(result)
            .map_err(|e| format!("序列化翻译结果失败: {e}"))?;
        line.push('\n');

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("打开翻译结果文件失败 ({}): {e}", path.display()))?;

        file.write_all(line.as_bytes())
            .map_err(|e| format!("写入翻译结果失败: {e}"))?;

        Ok(())
    }

    /// Read all results for a job from its .jsonl file.
    /// Tries the canonical path first, then falls back to the legacy
    /// double-prefix path for files created before the prefix fix.
    pub fn load_results(&self, job_id: &str) -> Result<Vec<TranslationResult>, String> {
        let path = paths::translate_job_results_path(&self.root, job_id);
        if path.is_file() {
            return parse_results_file(&path);
        }
        // Backward compatibility: try legacy double-prefix path
        let legacy = self.root.join("data").join("jobs")
            .join(format!("translate_{job_id}_results.jsonl"));
        if legacy.is_file() {
            return parse_results_file(&legacy);
        }
        Ok(Vec::new())
    }

    /// Read results for a specific mod (filtered on the Rust side).
    /// Avoids transmitting full result set over IPC when only one mod is needed.
    pub fn load_results_by_mod<'a>(&self, job_id: &str, mod_id: &'a str) -> Result<Vec<TranslationResult>, String> {
        let results = self.load_results(job_id)?;
        Ok(results.into_iter().filter(|r| r.mod_id == mod_id).collect())
    }

    /// Lightweight per-mod entry counts (scans JSONL without storing full entries).
    /// Returns sorted by entry_count descending.
    pub fn load_mod_summaries(&self, job_id: &str) -> Result<Vec<ModTranslationSummary>, String> {
        let path = paths::translate_job_results_path(&self.root, job_id);
        if !path.is_file() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取翻译结果失败 ({}): {e}", path.display()))?;
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for line in content.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(result) = serde_json::from_str::<TranslationResult>(line) {
                *counts.entry(result.mod_id).or_insert(0) += 1;
            }
        }
        let mut result: Vec<_> = counts.into_iter()
            .map(|(mod_id, entry_count)| ModTranslationSummary { mod_id, entry_count })
            .collect();
        result.sort_by(|a, b| b.entry_count.cmp(&a.entry_count));
        Ok(result)
    }

    // ── Helpers ──────────────────────────────────────────────────────

    fn load_scan_summary(&self, scan_job_id: &str) -> Result<ScanSummary, String> {
        let path = paths::job_state_path(&self.root, scan_job_id);
        if !path.is_file() {
            return Err(format!(
                "未找到扫描结果，请先扫描实例: {}",
                path.display()
            ));
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取扫描结果失败 ({}): {e}", path.display()))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析扫描结果失败: {e}"))
    }
}

// ── Internal helpers ────────────────────────────────────────────────

/// Read and deserialize the newest file from a pre-sorted list of job file entries.
fn read_latest_job_file<T: serde::de::DeserializeOwned>(
    entries: Vec<std::fs::DirEntry>,
    label: &str,
) -> Result<Option<T>, String> {
    match entries.into_iter().next() {
        Some(entry) => {
            let content = std::fs::read_to_string(entry.path())
                .map_err(|e| format!("读取 job 文件失败: {e}"))?;
            serde_json::from_str(&content)
                .map(Some)
                .map_err(|e| format!("解析 {label} 失败: {e}"))
        }
        None => Ok(None),
    }
}

fn read_job_file(path: &std::path::Path) -> Result<Option<TranslationJobState>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取 job 状态失败 ({}): {e}", path.display()))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("解析 job 状态失败: {e}"))
}

fn parse_results_file(path: &std::path::Path) -> Result<Vec<TranslationResult>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取翻译结果失败 ({}): {e}", path.display()))?;
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<TranslationResult>(line)
                .map_err(|e| format!("解析翻译结果行失败: {e}"))
        })
        .collect()
}

/// Append multiple translation results to a job's .jsonl file in one IO operation.
pub fn batch_append_results(
    root: &std::path::Path,
    job_id: &str,
    results: &[TranslationResult],
) -> Result<(), String> {
    let path = paths::translate_job_results_path(root, job_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 ({}): {e}", parent.display()))?;
    }

    let mut lines = String::with_capacity(results.len() * 120);
    for r in results {
        lines.push_str(
            &serde_json::to_string(r)
                .map_err(|e| format!("序列化翻译结果失败: {e}"))?,
        );
        lines.push('\n');
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开翻译结果文件失败 ({}): {e}", path.display()))?;

    file.write_all(lines.as_bytes())
        .map_err(|e| format!("写入翻译结果失败: {e}"))?;

    Ok(())
}

// ── Free functions ──────────────────────────────────────────────────

/// RFC 3339-ish timestamp string (e.g. "2026-06-05T12:34:56+08:00").
pub fn now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}+08:00",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since 1970-01-01 to (year, month, day).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pending_from_basic_mod_results() {
        use crate::core::models::{LanguageEntry, ModScanResult};

        let summary = ScanSummary {
            job_id: "test".into(),
            instance_path: "".into(),
            validation: crate::core::models::InstanceValidation {
                instance_path: "".into(),
                is_valid: true,
                mods_path: "".into(),
                resourcepacks_path: "".into(),
                warnings: vec![],
            },
            mods: vec![ModScanResult {
                mod_id: "testmod".into(),
                file_name: "testmod-1.0.jar".into(),
                jar_path: "".into(),
                language_file_count: 2,
                recovered_language_files: 0,
                failed_language_files: 0,
                source_language: "auto".into(),
                resolved_source_language: "en_us".into(),
                target_language: "zh_cn".into(),
                source_entries: 3,
                target_entries: 1,
                has_target_language: false,
                formats: vec!["json".into()],
                entries: vec![
                    LanguageEntry {
                        mod_id: "testmod".into(),
                        key: "item.a".into(),
                        text: "Item A".into(),
                        text_hash: "h1".into(),
                        language: "en_us".into(),
                        format: "json".into(),
                        source_file: "assets/testmod/lang/en_us.json".into(),
                    },
                    LanguageEntry {
                        mod_id: "testmod".into(),
                        key: "item.b".into(),
                        text: "Item B".into(),
                        text_hash: "h2".into(),
                        language: "en_us".into(),
                        format: "json".into(),
                        source_file: "assets/testmod/lang/en_us.json".into(),
                    },
                    LanguageEntry {
                        mod_id: "testmod".into(),
                        key: "item.c".into(),
                        text: "Item C".into(),
                        text_hash: "h3".into(),
                        language: "en_us".into(),
                        format: "json".into(),
                        source_file: "assets/testmod/lang/en_us.json".into(),
                    },
                    // Target entry (zh_cn) — only for item.a
                    LanguageEntry {
                        mod_id: "testmod".into(),
                        key: "item.a".into(),
                        text: "物品 A".into(),
                        text_hash: "h4".into(),
                        language: "zh_cn".into(),
                        format: "json".into(),
                        source_file: "assets/testmod/lang/zh_cn.json".into(),
                    },
                ],
                warnings: vec![],
            }],
            resource_packs: vec![],
            source_language: "auto".into(),
            target_language: "zh_cn".into(),
            total_language_files: 2,
            total_source_entries: 3,
            total_target_entries: 1,
            total_pending_entries: 2,
            resource_pack_covered_entries: 0,
            actual_pending_entries: 2,
            warnings: vec![],
            cancelled: false,
        };

        let pending: Vec<PendingEntry> = crate::core::pipeline::extract_pending_entries(&summary)
            .into_iter()
            .map(|(entry, file_name, _existing)| PendingEntry {
                key: entry.key.clone(),
                source_text: entry.text.clone(),
                mod_id: entry.mod_id.clone(),
                mod_name: file_name.to_string(),
            })
            .collect();
        assert_eq!(pending.len(), 3);
        assert!(pending.iter().any(|e| e.key == "item.a"));
        assert!(pending.iter().any(|e| e.key == "item.b"));
        assert!(pending.iter().any(|e| e.key == "item.c"));
        assert!(pending.iter().all(|e| e.mod_name == "testmod-1.0.jar"));
    }

    #[test]
    fn civil_date_roundtrip() {
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));

        let today_days = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            / 86400;
        let (y, _, _) = civil_from_days(today_days as i64);
        assert!(y >= 2024 && y <= 2030);
    }
}
