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
