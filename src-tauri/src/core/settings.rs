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

/// 从 MC 实例 JSON 的 clientVersion 字段检测游戏版本号。
pub fn detect_mc_version(instance_path: &str) -> Result<String, String> {
    let dir = std::path::Path::new(instance_path);
    let instance_name = dir
        .file_name()
        .ok_or_else(|| "无效的实例路径".to_string())?;
    let instance_json_path = dir.join(format!("{}.json", instance_name.to_string_lossy()));
    let content = std::fs::read_to_string(&instance_json_path)
        .map_err(|e| format!("读取实例 JSON 失败: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析实例 JSON 失败: {e}"))?;
    json["clientVersion"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "实例 JSON 中未找到 clientVersion 字段".to_string())
}

/// 替换字符串中的所有 `{{mc_version}}` 占位符为指定版本号。
///
/// 不含占位符的字符串原样返回。预留扩展：后续支持更多占位符变量时
/// 可在此函数中统一处理。
pub fn replace_version_placeholder(input: &str, version: &str) -> String {
    input.replace("{{mc_version}}", version)
}

/// 判断字符串中是否包含 `{{mc_version}}` 占位符。
pub fn has_mc_version_placeholder(input: &str) -> bool {
    input.contains("{{mc_version}}")
}

/// 对 Settings 中所有涉及占位符的字段执行替换，返回一份新 Settings。
///
/// # 当前替换的字段
/// - `resource_pack_names` — 每个元素逐个替换
/// - `output_pack_name` — 单个字符串替换
///
/// # 设计说明
/// 返回新实例而非就地修改，确保原始 Settings 中的占位符文本不受影响。
pub fn apply_placeholders(settings: &Settings, version: &str) -> Settings {
    let mut s = settings.clone();
    s.resource_pack_names = s
        .resource_pack_names
        .iter()
        .map(|name| replace_version_placeholder(name, version))
        .collect();
    s.output_pack_name = replace_version_placeholder(&s.output_pack_name, version);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- replace_version_placeholder ---

    #[test]
    fn test_replace_version_placeholder() {
        assert_eq!(
            replace_version_placeholder("pack-{{mc_version}}.zip", "1.21.1"),
            "pack-1.21.1.zip"
        );
    }

    #[test]
    fn test_replace_version_placeholder_no_placeholder() {
        assert_eq!(
            replace_version_placeholder("pack-1.21.1.zip", "1.20.4"),
            "pack-1.21.1.zip"
        );
    }

    #[test]
    fn test_replace_version_placeholder_multiple() {
        assert_eq!(
            replace_version_placeholder("{{mc_version}}-{{mc_version}}.zip", "1.21"),
            "1.21-1.21.zip"
        );
    }

    // --- has_mc_version_placeholder ---

    #[test]
    fn test_has_placeholder_true() {
        assert!(has_mc_version_placeholder("pack-{{mc_version}}.zip"));
    }

    #[test]
    fn test_has_placeholder_false() {
        assert!(!has_mc_version_placeholder("pack-1.21.1.zip"));
    }

    // --- detect_mc_version ---

    #[test]
    fn test_detect_mc_version_invalid_path() {
        let result = detect_mc_version("C:/nonexistent_path_12345");
        assert!(result.is_err());
    }

    // --- apply_placeholders ---

    #[test]
    fn test_apply_placeholders_empty_list() {
        let mut s = Settings::default();
        s.resource_pack_names = vec![];
        let result = apply_placeholders(&s, "1.21.1");
        assert!(result.resource_pack_names.is_empty());
        assert_eq!(result.output_pack_name, "Aaalice-MC-Translator-1.21.1");
    }

    #[test]
    fn test_apply_placeholders_with_placeholder() {
        let mut s = Settings::default();
        s.resource_pack_names = vec!["pack-{{mc_version}}.zip".to_string()];
        s.output_pack_name = "custom-{{mc_version}}.zip".to_string();
        let result = apply_placeholders(&s, "1.20.4");
        assert_eq!(result.resource_pack_names[0], "pack-1.20.4.zip");
        assert_eq!(result.output_pack_name, "custom-1.20.4.zip");
    }

    #[test]
    fn test_apply_placeholders_without_placeholder() {
        let mut s = Settings::default();
        s.resource_pack_names = vec!["pack-fixed.zip".to_string()];
        s.output_pack_name = "custom-fixed.zip".to_string();
        let result = apply_placeholders(&s, "1.20.4");
        assert_eq!(result.resource_pack_names[0], "pack-fixed.zip");
        assert_eq!(result.output_pack_name, "custom-fixed.zip");
    }
}
