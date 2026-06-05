use crate::core::{jobs, models::ValidationReport, paths};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn validate_translation(job_id: String) -> Result<ValidationReport, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = jobs::JobManager::new(root.clone());

    let _job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    let pending: Vec<jobs::PendingEntry> = _job.entries.clone();
    let report = crate::core::shield::validate_translation_results(&pending, &results);
    Ok(report)
}
