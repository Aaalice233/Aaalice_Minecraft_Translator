use tracing::info;

use crate::core::{models::Settings, paths, settings};

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    info!("get_settings");
    settings::load_settings(&paths::runtime_root().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    info!("save_settings");
    settings::save_settings(
        &paths::runtime_root().map_err(|e| e.to_string())?,
        &settings,
    )
    .map_err(|e| e.to_string())
}
