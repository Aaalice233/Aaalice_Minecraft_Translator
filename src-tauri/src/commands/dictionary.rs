use crate::core::{dictionary, paths};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

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
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let query = dictionary::DictionaryQuery {
        search,
        source_type,
        mod_id,
        source_lang,
        target_lang,
        limit,
        offset,
    };
    dictionary::search(&conn, &query).map_err(to_message)
}

#[tauri::command]
pub fn update_dictionary_entry(id: i64, target_text: String) -> Result<bool, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    dictionary::update_translation(&conn, id, &target_text).map_err(to_message)
}

#[tauri::command]
pub fn delete_dictionary_entry(id: i64) -> Result<bool, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    dictionary::delete(&conn, id).map_err(to_message)
}

#[tauri::command]
pub fn export_dictionary(file_path: String) -> Result<usize, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let lines = dictionary::export_jsonl(&conn).map_err(to_message)?;
    let content = lines.join("\n");
    std::fs::write(&file_path, content).map_err(to_message)?;
    Ok(lines.len())
}

#[tauri::command]
pub fn import_dictionary(file_path: String) -> Result<dictionary::ImportResult, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let content = std::fs::read_to_string(&file_path).map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let lines: Vec<&str> = content.lines().collect();
    dictionary::import_jsonl(&conn, &lines).map_err(to_message)
}

#[tauri::command]
pub fn get_dictionary_stats() -> Result<dictionary::DictionaryStats, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let conn = dictionary::open(&paths::dictionary_db_path(&root)).map_err(to_message)?;
    let total = dictionary::count(&conn).map_err(to_message)?;
    let mod_ids = dictionary::distinct_mod_ids(&conn).map_err(to_message)?;
    Ok(dictionary::DictionaryStats { total, mod_ids })
}
