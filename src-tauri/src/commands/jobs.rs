use crate::core::{dictionary, jobs, paths};
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
pub fn load_translation_results(
    job_id: String,
    mod_id: Option<String>,
) -> Result<Vec<jobs::TranslationResult>, String> {
    info!(
        "load_translation_results: job_id={}, mod_id={:?}",
        job_id, mod_id
    );
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    let results = if let Some(mid) = &mod_id {
        manager
            .load_results_by_mod(&job_id, mid)
            .map_err(|e| e.to_string())
    } else {
        manager.load_results(&job_id).map_err(|e| e.to_string())
    }?;
    info!(
        "load_translation_results: returned {} results",
        results.len()
    );
    Ok(results)
}

#[tauri::command]
pub fn load_translation_mod_summaries(
    job_id: String,
) -> Result<Vec<jobs::ModTranslationSummary>, String> {
    info!("load_translation_mod_summaries: job_id={}", job_id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root);
    manager
        .load_mod_summaries(&job_id)
        .map_err(|e| e.to_string())
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
    manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;
    let out_path = paths::translate_job_results_path(&root, &job_id);

    let content =
        std::fs::read_to_string(&out_path).map_err(|e| format!("读取翻译结果失败: {e}"))?;
    let mut lines: Vec<String> = content.lines().map(String::from).collect();

    let mut reviewed_entry: Option<jobs::TranslationResult> = None;
    for line in &mut lines {
        let mut entry: jobs::TranslationResult =
            serde_json::from_str(line).map_err(|e| format!("解析条目失败: {e}"))?;
        if entry.key == key && entry.mod_name == mod_name && entry.mod_id == mod_id {
            entry.target_text = target_text.clone();
            entry.source_type = "reviewed".to_string();
            *line = serde_json::to_string(&entry).map_err(|e| format!("序列化失败: {e}"))?;
            reviewed_entry = Some(entry);
            break;
        }
    }
    let reviewed_entry =
        reviewed_entry.ok_or_else(|| format!("未找到条目: key={key}, mod={mod_name}"))?;

    // Write back atomically
    let mut output = String::with_capacity(content.len());
    for l in &lines {
        output.push_str(l);
        output.push('\n');
    }
    let tmp_path = out_path.with_extension("jsonl.tmp");
    if let Some(parent) = tmp_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::write(&tmp_path, &output).map_err(|e| format!("写入临时文件失败: {e}"))?;
    std::fs::rename(&tmp_path, &out_path).map_err(|e| format!("重命名失败: {e}"))?;

    let job = manager.refresh_counts_from_results(&job_id)?;

    let conn = dictionary::open(&paths::dictionary_db_path(&root))
        .map_err(|e| format!("打开词典失败，校对结果已写入任务文件但未同步到词典: {e}"))?;
    let dict_entry = dictionary::DictionaryEntry {
        id: None,
        source_text: reviewed_entry.source_text,
        target_text: reviewed_entry.target_text,
        source_lang: job.source_language,
        target_lang: job.target_language,
        source_type: "reviewed".to_string(),
        mod_id: Some(mod_id),
        translation_key: Some(key),
        context: None,
        confidence: 1.0,
        created_at: None,
        updated_at: None,
    };
    dictionary::upsert(&conn, &dict_entry)
        .map_err(|e| format!("校对结果已写入任务文件，但同步到词典失败: {e}"))?;

    Ok(())
}
