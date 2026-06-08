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
pub fn list_translation_jobs() -> Result<Vec<jobs::TranslationJobState>, String> {
    info!("list_translation_jobs");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.list_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_translation_results(job_id: String) -> Result<Vec<jobs::TranslationResult>, String> {
    info!("load_translation_results: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager.load_results(&job_id).map_err(|e| e.to_string())
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
    let manager = jobs::JobManager::new(root.clone());
    let mut results = manager.load_results(&job_id)?;

    let entry = results
        .iter_mut()
        .find(|r| r.key == key && r.mod_name == mod_name && r.mod_id == mod_id)
        .ok_or_else(|| format!("未找到条目: key={key}, mod={mod_name}"))?;
    entry.target_text = target_text;
    entry.source_type = "reviewed".to_string();

    // Rewrite the entire JSONL atomically
    let out_path = paths::translate_job_results_path(&root, &job_id);
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let mut content = String::with_capacity(results.len() * 150);
    for r in &results {
        let line = serde_json::to_string(r).map_err(|e| format!("序列化失败: {e}"))?;
        content.push_str(&line);
        content.push('\n');
    }
    let tmp_path = out_path.with_extension("jsonl.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("写入临时文件失败: {e}"))?;
    std::fs::rename(&tmp_path, &out_path)
        .map_err(|e| format!("重命名失败: {e}"))?;

    Ok(())
}
