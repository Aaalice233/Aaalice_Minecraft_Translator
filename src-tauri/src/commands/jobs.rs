use crate::core::{jobs, paths};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn clear_jobs_cache() -> Result<(), String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let jobs_dir = paths::jobs_dir(&root);
    if !jobs_dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&jobs_dir).map_err(to_message)? {
        let entry = entry.map_err(to_message)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("scan_") || name.starts_with("translate_") || name.ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_translation_job(job_id: String) -> Result<Option<jobs::TranslationJobState>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root);
    manager.load(&job_id)
}

#[tauri::command]
pub fn load_latest_translation_job() -> Result<Option<jobs::TranslationJobState>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root);
    manager.load_latest()
}

#[tauri::command]
pub fn list_translation_jobs() -> Result<Vec<jobs::TranslationJobState>, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root);
    manager.list_all()
}
