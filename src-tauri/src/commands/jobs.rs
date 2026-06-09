use crate::core::{jobs, paths};
use tracing::info;



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
