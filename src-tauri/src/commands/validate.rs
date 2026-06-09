use tracing::info;

use crate::core::{jobs, models::ValidationReport, paths};

#[tauri::command]
pub fn validate_translation(job_id: String) -> Result<ValidationReport, String> {
    info!("validate_translation: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root.clone());

    let job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    let pending: Vec<jobs::PendingEntry> = job.entries.clone();
    let report = crate::core::shield::validate_translation_results(&pending, &results);
    Ok(report)
}

/// Mark a translation job as reviewed (校对完成).
/// Sets status to Reviewed and records the timestamp.
#[tauri::command]
pub fn mark_job_reviewed(job_id: String) -> Result<(), String> {
    info!("mark_job_reviewed: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root.clone());
    let mut job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    if job.status != jobs::TranslationStatus::Completed
        && job.status != jobs::TranslationStatus::Reviewed
    {
        return Err(format!(
            "翻译任务 {job_id} 尚未完成（当前状态: {:?}），无法标记为已校对",
            job.status
        ));
    }

    job.status = jobs::TranslationStatus::Reviewed;
    job.reviewed = Some(true);
    job.reviewed_at = Some(jobs::now_rfc3339());
    manager.save(&job)
}
