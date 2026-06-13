use tracing::info;

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    info!("open_path: path={}", path);
    open::that(path).map_err(|e| e.to_string())
}
