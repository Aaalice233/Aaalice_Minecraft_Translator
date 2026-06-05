fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(path).map_err(to_message)
}

/// Placeholder — returns empty list; actual implementation deferred.
#[tauri::command]
pub fn fetch_game_versions() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Read a log file from disk, returning the last N lines.
#[tauri::command]
pub fn get_log_content(path: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(to_message)?;
    // Return last 500 lines
    let lines: Vec<&str> = content.lines().collect();
    let tail = lines.iter().rev().take(500).cloned().collect::<Vec<_>>();
    let tail: Vec<&str> = tail.into_iter().rev().collect();
    Ok(tail.join("\n"))
}
