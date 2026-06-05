use crate::core::{models::Settings, paths, settings};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    settings::load_settings(&paths::runtime_root().map_err(to_message)?).map_err(to_message)
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    settings::save_settings(&paths::runtime_root().map_err(to_message)?, &settings).map_err(to_message)
}
