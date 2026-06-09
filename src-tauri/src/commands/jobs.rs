use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use serde::Serialize;

use crate::core::{jobs, paths};
use tracing::info;

#[tauri::command]
pub fn clear_jobs_cache() -> Result<(), String> {
    info!("clear_jobs_cache");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let jobs_dir = paths::jobs_dir(&root);
    if !jobs_dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&jobs_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("scan_") || name.starts_with("translate_") || name.ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

// ── Cleanup old jobs ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupJobsResult {
    pub deleted_state_files: usize,
    pub deleted_results_files: usize,
    pub deleted_double_prefix_files: usize,
    pub kept_jobs: Vec<String>,
    pub freed_bytes: u64,
}

/// Clean up old job files from `data/jobs/`.
///
/// Returns a summary of cleaned files/results for UI confirmation.
/// Does NOT delete the most recent N complete jobs.
#[tauri::command]
pub fn cleanup_old_jobs(keep_count: Option<usize>) -> Result<CleanupJobsResult, String> {
    let keep = keep_count.unwrap_or(5);
    info!("cleanup_old_jobs: keep_count={}", keep);

    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let jobs_dir = paths::jobs_dir(&root);

    if !jobs_dir.is_dir() {
        return Ok(CleanupJobsResult::default());
    }

    // Categorize files
    let mut state_files: Vec<(String, std::time::SystemTime, u64)> = Vec::new();
    let mut double_prefix_files: Vec<PathBuf> = Vec::new();
    let mut result_files: HashMap<String, (PathBuf, u64)> = HashMap::new();

    for entry in std::fs::read_dir(&jobs_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();

        if name.ends_with(".tmp") {
            continue;
        }

        if name.starts_with("translate_translate_") {
            double_prefix_files.push(path);
            continue;
        }

        if !name.starts_with("translate_") {
            continue;
        }

        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let size = meta.len();

        // State file: translate_{jobId}.json (must NOT match _results.jsonl)
        if let Some(id) = name
            .strip_prefix("translate_")
            .and_then(|s| s.strip_suffix(".json"))
            .filter(|stem| !stem.contains("_results"))
        {
            let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            state_files.push((format!("translate_{}", id), mtime, size));
            continue;
        }

        // Results file: translate_{jobId}_results.jsonl
        if let Some(id) = name
            .strip_prefix("translate_")
            .and_then(|s| s.strip_suffix("_results.jsonl"))
        {
            result_files.insert(format!("translate_{}", id), (path, size));
        }
    }

    // Sort state files by mtime descending (newest first)
    state_files.sort_by(|a, b| b.1.cmp(&a.1));

    // Determine keep set: top N newest job IDs
    let kept_jobs: Vec<String> = state_files
        .iter()
        .take(keep)
        .map(|(id, ..)| id.clone())
        .collect();
    let keep_ids: HashSet<&str> = kept_jobs.iter().map(|s| s.as_str()).collect();

    let mut deleted_state = 0usize;
    let mut deleted_results = 0usize;
    let mut deleted_double = 0usize;
    let mut freed: u64 = 0;

    // 1. Delete all double-prefix legacy files
    for path in &double_prefix_files {
        if let Ok(meta) = path.metadata() {
            freed += meta.len();
        }
        if std::fs::remove_file(path).is_ok() {
            deleted_double += 1;
        }
    }

    // 2. Delete state files not in keep set + their companion results
    for (id, _, size) in &state_files {
        if !keep_ids.contains(id.as_str()) {
            let state_path = paths::translate_job_state_path(&root, id);
            if state_path.is_file() && std::fs::remove_file(&state_path).is_ok() {
                deleted_state += 1;
                freed += size;
            }
            if let Some((res_path, res_size)) = result_files.remove(id) {
                if std::fs::remove_file(&res_path).is_ok() {
                    deleted_results += 1;
                    freed += res_size;
                }
            }
        }
    }

    // 3.+4. Remove kept job results (otherwise orphan), delete remaining
    for id in &kept_jobs {
        result_files.remove(id.as_str());
    }
    for (_, (path, size)) in result_files {
        if std::fs::remove_file(&path).is_ok() {
            deleted_results += 1;
            freed += size;
        }
    }

    info!(
        "cleanup_old_jobs: deleted {} state, {} results, {} double-prefix, kept {}, freed {} bytes",
        deleted_state, deleted_results, deleted_double, kept_jobs.len(), freed
    );

    Ok(CleanupJobsResult {
        deleted_state_files: deleted_state,
        deleted_results_files: deleted_results,
        deleted_double_prefix_files: deleted_double,
        kept_jobs,
        freed_bytes: freed,
    })
}

#[tauri::command]
pub fn get_translation_job(job_id: String) -> Result<Option<jobs::TranslationJobState>, String> {
    info!("get_translation_job: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.load(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_latest_translation_job() -> Result<Option<jobs::TranslationJobState>, String> {
    info!("load_latest_translation_job");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.load_latest().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_latest_translation_job_meta() -> Result<Option<jobs::TranslationJobListItem>, String> {
    info!("load_latest_translation_job_meta");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.load_latest_meta().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_translation_jobs() -> Result<Vec<jobs::TranslationJobListItem>, String> {
    info!("list_translation_jobs");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.list_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_translation_results(job_id: String, mod_id: Option<String>) -> Result<Vec<jobs::TranslationResult>, String> {
    info!("load_translation_results: job_id={}, mod_id={:?}", job_id, mod_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    if let Some(mid) = mod_id {
        manager.load_results_by_mod(&job_id, &mid).map_err(|e| e.to_string())
    } else {
        manager.load_results(&job_id).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn load_translation_mod_summaries(job_id: String) -> Result<Vec<jobs::ModTranslationSummary>, String> {
    info!("load_translation_mod_summaries: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.load_mod_summaries(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_translation_entry(
    job_id: String,
    key: String,
    mod_name: String,
    mod_id: String,
    target_text: String,
) -> Result<(), String> {
    info!("save_translation_entry: job_id={}, key={}", job_id, key);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let out_path = paths::translate_job_results_path(&root, &job_id);

    // Read all lines (avoids deserializing all entries at once)
    let content = std::fs::read_to_string(&out_path)
        .map_err(|e| format!("读取翻译结果失败: {e}"))?;
    let mut lines: Vec<String> = content.lines().map(String::from).collect();

    // Build search fragments (safe JSON escaping via serde)
    let key_fragment = format!(r#""key":{},"#, serde_json::to_string(&key).map_err(|e| e.to_string())?);
    let mod_name_fragment = format!(r#""modName":{},"#, serde_json::to_string(&mod_name).map_err(|e| e.to_string())?);
    let mod_id_fragment = format!(r#""modId":{},"#, serde_json::to_string(&mod_id).map_err(|e| e.to_string())?);

    // Find matching line by string fragment search, parse only that one
    let found = lines.iter_mut().find(|line| {
        line.contains(&key_fragment)
            && line.contains(&mod_name_fragment)
            && line.contains(&mod_id_fragment)
    });

    match found {
        Some(line) => {
            let mut entry: jobs::TranslationResult = serde_json::from_str(line)
                .map_err(|e| format!("解析条目失败: {e}"))?;
            entry.target_text = target_text.clone();
            entry.source_type = "reviewed".to_string();
            *line = serde_json::to_string(&entry)
                .map_err(|e| format!("序列化失败: {e}"))?;
        }
        None => return Err(format!("未找到条目: key={key}, mod={mod_name}")),
    }

    // Write back atomically
    let mut output = String::with_capacity(content.len());
    for l in &lines {
        output.push_str(l);
        output.push('\n');
    }
    let tmp_path = out_path.with_extension("jsonl.tmp");
    if let Some(parent) = tmp_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::write(&tmp_path, &output)
        .map_err(|e| format!("写入临时文件失败: {e}"))?;
    std::fs::rename(&tmp_path, &out_path)
        .map_err(|e| format!("重命名失败: {e}"))?;

    Ok(())
}
