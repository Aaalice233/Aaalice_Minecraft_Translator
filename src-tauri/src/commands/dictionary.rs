use crate::core::{dictionary, jobs, paths};
use tracing::info;

#[tauri::command]
pub fn search_dictionary(
    search: Option<String>,
    source_type: Option<String>,
    mod_id: Option<String>,
    source_lang: Option<String>,
    target_lang: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<dictionary::DictionaryEntry>, String> {
    info!("search_dictionary: search={:?}, mod_id={:?}, source_lang={:?}, target_lang={:?}", search, mod_id, source_lang, target_lang);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let query = dictionary::DictionaryQuery {
        search,
        source_type,
        mod_id,
        source_lang,
        target_lang,
        limit,
        offset,
    };
    dictionary::search(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_dictionary_entry(id: i64, target_text: String) -> Result<bool, String> {
    info!("update_dictionary_entry: id={}, target_text_len={}", id, target_text.len());
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    dictionary::update_translation(&conn, id, &target_text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_dictionary_entry(id: i64) -> Result<bool, String> {
    info!("delete_dictionary_entry: id={}", id);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    dictionary::delete(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_dictionary(file_path: String) -> Result<usize, String> {
    info!("export_dictionary: file_path={}", file_path);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let lines = dictionary::export_jsonl(&conn).map_err(|e| e.to_string())?;
    let content = lines.join("\n");
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(lines.len())
}

#[tauri::command]
pub fn import_dictionary(file_path: String) -> Result<dictionary::ImportResult, String> {
    info!("import_dictionary: file_path={}", file_path);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    dictionary::import_jsonl(&conn, &lines).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_dictionary_stats() -> Result<dictionary::DictionaryStats, String> {
    info!("get_dictionary_stats");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let total = dictionary::count(&conn).map_err(|e| e.to_string())?;
    let mod_ids = dictionary::distinct_mod_ids(&conn).map_err(|e| e.to_string())?;
    Ok(dictionary::DictionaryStats { total, mod_ids })
}

/// Import existing translation results into the dictionary.
/// Reads the latest completed translation job and saves all LLM/reviewed entries.
/// Useful for migrating existing translations after enabling dictionary auto-save.
#[tauri::command]
pub fn import_translation_results_to_dictionary() -> Result<dictionary::ImportResult, String> {
    info!("import_translation_results_to_dictionary");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let manager = jobs::JobManager::new(root.clone());

    // Find the latest completed translation job
    let job = manager.load_latest()
        .map_err(|e| format!("加载翻译任务失败: {e}"))?
        .ok_or_else(|| "没有找到已完成的翻译任务".to_string())?;

    let results = manager.load_results(&job.job_id)
        .map_err(|e| format!("加载翻译结果失败: {e}"))?;

    let total = results.len();
    let skipped = results.iter().filter(|r| {
        r.source_type != "llm" && r.source_type != "reviewed" || r.target_text.trim().is_empty()
    }).count();

    let mut imported = 0usize;
    let mut conflicts = Vec::new();
    for r in &results {
        if r.source_type != "llm" && r.source_type != "reviewed" {
            continue;
        }
        if r.target_text.trim().is_empty() {
            continue;
        }
        let entry = dictionary::DictionaryEntry {
            id: None,
            source_text: r.source_text.clone(),
            target_text: r.target_text.clone(),
            source_lang: String::new(),
            target_lang: job.target_language.clone(),
            source_type: r.source_type.clone(),
            mod_id: Some(r.mod_id.clone()),
            translation_key: Some(r.key.clone()),
            context: None,
            confidence: 1.0,
            created_at: None,
            updated_at: None,
        };
        match dictionary::upsert(&conn, &entry) {
            Ok((_, is_new)) => {
                if is_new {
                    imported += 1;
                }
            }
            Err(e) => {
                conflicts.push(format!("条目 {} 导入失败: {e}", r.key));
            }
        }
    }

    info!(imported, total, "翻译结果导入词典完成");
    Ok(dictionary::ImportResult {
        imported,
        skipped,
        conflicts,
    })
}
