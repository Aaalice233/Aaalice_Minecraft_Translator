use std::{fs, io, path::Path};

use crate::core::models::Settings;

/// Maximum settings file size (1 MB) — prevents OOM from corrupted files.
const MAX_SETTINGS_FILE_SIZE: u64 = 1 * 1024 * 1024;

pub fn load_settings(root: &Path) -> io::Result<Settings> {
    let path = settings_path(root);
    tracing::info!(path = %path.display(), "Loading settings");
    if !path.exists() {
        tracing::warn!(path = %path.display(), "Settings file not found, using defaults");
        return Ok(Settings::default());
    }

    // Size guard against corrupted/oversized files
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_SETTINGS_FILE_SIZE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!(
            "settings.json 文件过大 ({} bytes > {} max)",
            metadata.len(), MAX_SETTINGS_FILE_SIZE
        )));
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

/// Validate settings fields, returning an error for out-of-range values.
fn validate_settings(settings: &Settings) -> io::Result<()> {
    if settings.temperature.is_nan() || !(0.0..=2.0).contains(&settings.temperature) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "temperature 必须在 0.0–2.0 范围内"));
    }
    if settings.concurrency == 0 || settings.concurrency > 100 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "concurrency 必须在 1–100 范围内"));
    }
    if settings.batch_size == 0 || settings.batch_size > 500 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "batchSize 必须在 1–500 范围内"));
    }
    if settings.timeout_secs < 10 || settings.timeout_secs > 600 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "timeoutSecs 必须在 10–600 范围内"));
    }
    if settings.retry_count > 20 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "retryCount 不能超过 20"));
    }
    Ok(())
}

pub fn save_settings(root: &Path, settings: &Settings) -> io::Result<()> {
    tracing::info!(path = %settings_path(root).display(), "Saving settings");
    validate_settings(settings)?;
    let data_dir = root.join("data");
    fs::create_dir_all(&data_dir)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    fs::write(settings_path(root), format!("{content}\n"))
}

fn settings_path(root: &Path) -> std::path::PathBuf {
    root.join("data").join("settings.json")
}
