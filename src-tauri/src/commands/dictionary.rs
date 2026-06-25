use crate::core::{dictionary, paths};
use tracing::{info, warn};

#[tauri::command]
pub fn search_dictionary(
    search: Option<String>,
    source_text: Option<String>,
    target_text: Option<String>,
    translation_key: Option<String>,
    mod_query: Option<String>,
    source_type: Option<String>,
    mod_id: Option<String>,
    source_lang: Option<String>,
    target_lang: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<dictionary::DictionaryEntry>, String> {
    info!(
        "search_dictionary: search={:?}, mod_id={:?}, source_lang={:?}, target_lang={:?}",
        search, mod_id, source_lang, target_lang
    );
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    if let Err(err) = dictionary::backfill_mod_names_from_jobs(&conn, &paths::jobs_dir(&root)) {
        warn!("search_dictionary: backfill_mod_names_from_jobs failed: {err}");
    }
    let query = dictionary::DictionaryQuery {
        search,
        source_text,
        target_text,
        translation_key,
        mod_query,
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
pub fn count_dictionary(query: dictionary::DictionaryQuery) -> Result<usize, String> {
    info!("count_dictionary");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    dictionary::count_matching(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_dictionary_selection(
    request: dictionary::DictionarySelectionDeleteRequest,
) -> Result<dictionary::DictionarySelectionDeleteResult, String> {
    info!("delete_dictionary_selection: mode={:?}", request.mode);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    dictionary::delete_selection(&conn, &request)
}

#[tauri::command]
pub fn update_dictionary_entry(id: i64, target_text: String) -> Result<bool, String> {
    info!(
        "update_dictionary_entry: id={}, target_text_len={}",
        id,
        target_text.len()
    );
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
pub fn clear_dictionary() -> Result<usize, String> {
    info!("clear_dictionary");
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(|e| e.to_string())?;
    let removed = dictionary::clear_local_entries(&conn).map_err(|e| e.to_string())?;
    let remaining = dictionary::count_local_entries(&conn).map_err(|e| e.to_string())?;
    if remaining != 0 {
        return Err(format!("清空词库后仍剩余 {remaining} 条本地词库条目"));
    }
    Ok(removed)
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
    let total = dictionary::count_local_entries(&conn).map_err(|e| e.to_string())?;
    let mod_ids = dictionary::distinct_mod_ids(&conn).map_err(|e| e.to_string())?;
    Ok(dictionary::DictionaryStats { total, mod_ids })
}
