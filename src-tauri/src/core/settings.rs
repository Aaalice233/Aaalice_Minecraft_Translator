use std::{fs, io, path::Path};

use crate::core::models::Settings;

pub fn load_settings(root: &Path) -> io::Result<Settings> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(Settings::default());
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

pub fn save_settings(root: &Path, settings: &Settings) -> io::Result<()> {
    let data_dir = root.join("data");
    fs::create_dir_all(&data_dir)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    fs::write(settings_path(root), format!("{content}\n"))
}

fn settings_path(root: &Path) -> std::path::PathBuf {
    root.join("data").join("settings.json")
}
