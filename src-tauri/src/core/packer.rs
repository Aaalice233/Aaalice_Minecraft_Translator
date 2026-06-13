use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Replace dangerous path characters with underscores.
fn sanitize_name(name: &str) -> String {
    name.replace(
        |c: char| {
            c.is_ascii_control()
                || matches!(c, '/' | '\\' | ':' | '>' | '<' | '"' | '|' | '?' | '*')
        },
        "_",
    )
    .trim_matches('.')
    .to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackEntry {
    pub mod_id: String,
    pub key: String,
    pub text: String,
    pub source_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackOptions {
    pub target_language: String,
    pub entries: Vec<PackEntry>,
    pub build_name: String,
    pub dry_run: bool,
    pub output_dir: String,
    /// Minecraft resource pack format version.
    /// 15 = 1.20–1.20.1, 18 = 1.20.2, 22 = 1.20.3–1.20.4,
    /// 32 = 1.20.5–1.20.6, 34 = 1.21–1.21.1.
    /// Default 15 for backward compatibility.
    #[serde(default = "default_pack_format")]
    pub pack_format: u32,

    /// Optional path to a PNG image used as the resource pack icon (pack.png).
    /// When provided and the file exists, it is included at the root of the pack.
    /// Recommended size: 128×128 pixels.
    #[serde(default)]
    pub icon_path: Option<String>,
}

fn default_pack_format() -> u32 {
    15
}

pub fn pack_format_for_mc_version(version: &str) -> u32 {
    let parts: Vec<u32> = version
        .split(['.', '-'])
        .take(3)
        .filter_map(|part| part.parse::<u32>().ok())
        .collect();
    let major = parts.first().copied().unwrap_or(0);
    let minor = parts.get(1).copied().unwrap_or(0);
    let patch = parts.get(2).copied().unwrap_or(0);

    match (major, minor, patch) {
        (1, 21, 0..=1) => 34,
        (1, 20, 5..=u32::MAX) => 32,
        (1, 20, 3..=4) => 22,
        (1, 20, 2) => 18,
        (1, 20, 0..=1) => 15,
        _ => default_pack_format(),
    }
}

fn format_generated_at() -> String {
    chrono::Local::now()
        .format("%Y年%m月%d日 %H:%M")
        .to_string()
}

/// Default pack icon embedded at compile time.
/// 128×128 PNG, sourced from assets/pack.png at project root.
const DEFAULT_PACK_ICON: &[u8] = include_bytes!("../../../assets/pack.png");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub output_dir: String,
    pub zip_path: String,
    pub mod_count: usize,
    pub entry_count: usize,
    pub conflicts: Vec<ConflictInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub mod_id: String,
    pub key: String,
    pub source_text: String,
    pub dictionary_text: String,
    pub existing_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub success: bool,
    pub target_path: String,
    pub replaced: bool,
}

/// Generate the resource pack directory structure and optionally the zip.
pub fn generate_pack(options: &PackOptions) -> io::Result<PackResult> {
    tracing::info!(entry_count = options.entries.len(), language = %options.target_language, "Generating resource pack");
    let output_dir = PathBuf::from(&options.output_dir);
    // Sanitize build_name before using it in file paths to prevent traversal
    let safe_build_name = sanitize_name(&options.build_name);
    let pack_dir = output_dir.join(format!("{}-{}", safe_build_name, options.target_language));

    if options.dry_run {
        // Dry run: just compute stats without writing
        let mut conflicts = Vec::new();
        // Only check conflicts if the pack directory already exists
        if pack_dir.is_dir() {
            if let Ok(pack_dir_path) = std::fs::read_dir(&pack_dir) {
                for entry in pack_dir_path.flatten() {
                    if entry.path().is_dir() {
                        let lang_path = entry
                            .path()
                            .join("lang")
                            .join(format!("{}.json", options.target_language));
                        if lang_path.exists() {
                            if let Ok(content) = std::fs::read_to_string(&lang_path) {
                                if let Ok(existing) =
                                    serde_json::from_str::<HashMap<String, String>>(&content)
                                {
                                    for e in &options.entries {
                                        if let Some(existing_text) = existing.get(&e.key) {
                                            if existing_text != &e.text {
                                                conflicts.push(ConflictInfo {
                                                    mod_id: e.mod_id.clone(),
                                                    key: e.key.clone(),
                                                    source_text: e.source_text.clone(),
                                                    dictionary_text: e.text.clone(),
                                                    existing_text: existing_text.clone(),
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut mod_set = std::collections::BTreeSet::new();
        for e in &options.entries {
            mod_set.insert(e.mod_id.clone());
        }
        return Ok(PackResult {
            output_dir: options.output_dir.clone(),
            zip_path: String::new(),
            mod_count: mod_set.len(),
            entry_count: options.entries.len(),
            conflicts,
        });
    }

    // Group entries by mod_id
    let mut by_mod: HashMap<String, Vec<&PackEntry>> = HashMap::new();
    for entry in &options.entries {
        by_mod.entry(entry.mod_id.clone()).or_default().push(entry);
    }

    // Generate pack.mcmeta with a broad supported_formats range so the pack
    // works across MC versions without being silently disabled.
    // Uses array format [min, max] — compatible with MC 1.20.5+ (pack_format 32+)
    // which first introduced supported_formats support. Object format
    // {min_inclusive, max_inclusive} was added in 1.21.5 (pack_format 42+).
    std::fs::create_dir_all(&pack_dir)?;
    let generated_at = format_generated_at();
    let mcmeta = serde_json::json!({
        "pack": {
            "pack_format": options.pack_format,
            "description": format!(
                "§6Aaalice MC Translator§r\n§7模组 {} 个 · 文本 {} 条\n§8生成于 {} · {}",
                by_mod.len(),
                options.entries.len(),
                generated_at,
                options.build_name,
            ),
            "supported_formats": [1, 99]
        }
    });
    std::fs::write(
        pack_dir.join("pack.mcmeta"),
        serde_json::to_string_pretty(&mcmeta)?,
    )?;

    // Write default embedded icon; overwrite with custom path if provided.
    // Embedding the default icon avoids runtime path-resolution issues
    // between dev and installed modes.
    if let Err(e) = std::fs::write(pack_dir.join("pack.png"), DEFAULT_PACK_ICON) {
        tracing::warn!(error = %e, "Failed to write default pack icon");
    }
    if let Some(ref icon_path) = options.icon_path {
        let icon_src = Path::new(icon_path);
        if icon_src.exists() {
            match std::fs::copy(icon_src, pack_dir.join("pack.png")) {
                Ok(_) => tracing::info!(path = %icon_src.display(), "Custom icon copied to pack"),
                Err(e) => {
                    tracing::warn!(path = %icon_src.display(), error = %e, "Failed to copy custom pack icon")
                }
            }
        }
    }

    // Generate language files per mod
    let mut conflicts = Vec::new();
    for (mod_id, entries) in &by_mod {
        let lang_dir = pack_dir.join("assets").join(mod_id).join("lang");
        std::fs::create_dir_all(&lang_dir)?;

        let lang_path = lang_dir.join(format!("{}.json", options.target_language));
        let mut lang_map: HashMap<String, String> = HashMap::new();

        // Load existing entries if file exists
        if lang_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&lang_path) {
                if let Ok(existing) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    // Check for conflicts
                    for e in entries {
                        if let Some(existing_text) = existing.get(&e.key) {
                            if existing_text != &e.text {
                                conflicts.push(ConflictInfo {
                                    mod_id: mod_id.clone(),
                                    key: e.key.clone(),
                                    source_text: e.source_text.clone(),
                                    dictionary_text: e.text.clone(),
                                    existing_text: existing_text.clone(),
                                });
                            }
                        }
                    }
                    lang_map = existing;
                }
            }
        }

        // Add/replace entries
        for e in entries {
            lang_map.insert(e.key.clone(), e.text.clone());
        }

        std::fs::write(&lang_path, serde_json::to_string_pretty(&lang_map)?)?;
    }

    // Generate zip (using safe_build_name to prevent path traversal)
    let zip_path = output_dir.join(format!(
        "{}-{}.zip",
        safe_build_name, options.target_language
    ));
    create_zip(&pack_dir, &zip_path)?;

    // Clean up the source directory; only the zip is needed as final output.
    if let Err(e) = std::fs::remove_dir_all(&pack_dir) {
        tracing::warn!(path = %pack_dir.display(), error = %e, "Failed to clean up pack source directory");
    }

    let zip_size = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
    tracing::info!(
        entry_count = options.entries.len(),
        mod_count = by_mod.len(),
        zip_size,
        "Resource pack generated successfully"
    );
    Ok(PackResult {
        output_dir: options.output_dir.clone(),
        zip_path: zip_path.to_string_lossy().to_string(),
        mod_count: by_mod.len(),
        entry_count: options.entries.len(),
        conflicts,
    })
}

/// Create a zip file from a directory.
fn create_zip(source_dir: &Path, zip_path: &Path) -> io::Result<()> {
    let file = std::fs::File::create(zip_path)?;
    let mut zip_writer = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir_to_zip(&mut zip_writer, source_dir, source_dir, &options)?;
    zip_writer.finish()?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    base: &Path,
    current: &Path,
    options: &zip::write::FileOptions<()>,
) -> io::Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .strip_prefix(base)
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "path strip failed"))?
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&format!("{name}/"), *options)?;
            add_dir_to_zip(zip, base, &path, options)?;
        } else {
            zip.start_file(&name, *options)?;
            let mut file = std::fs::File::open(&path)?;
            // Use streaming copy (8 KB chunks) instead of reading the entire
            // file into memory to reduce peak memory usage on large files.
            std::io::copy(&mut file, &mut *zip)?;
        }
    }
    Ok(())
}

/// Canonicalize a path and reject system-directory symlink attacks.
fn sanitize_instance_path(input: &str) -> io::Result<String> {
    let path = Path::new(input);
    // Use canonicalize to resolve symlinks and `..` components.
    // The instance path must exist, so canonicalize will succeed.
    let canonical = path
        .canonicalize()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "实例路径无效或不存在"))?;

    // Defense-in-depth: after resolving symlinks, verify the path is not in a
    // protected system directory. This prevents an attacker from using a symlink
    // inside the instance path to redirect file operations to arbitrary locations.
    #[cfg(windows)]
    {
        let canonical_lower = canonical.to_string_lossy().to_lowercase();
        let disallowed = [
            "\\windows\\",
            "\\program files\\",
            "\\program files (x86)\\",
            "\\system32\\",
            "\\syswow64\\",
        ];
        for prefix in &disallowed {
            if canonical_lower.contains(prefix) {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("路径指向系统目录，已被拒绝: {}", canonical.display()),
                ));
            }
        }
    }

    Ok(canonical.to_string_lossy().to_string())
}

/// Copy the generated pack zip to the instance's resourcepacks directory.
pub fn copy_to_resourcepacks(
    pack_zip_path: &str,
    instance_path: &str,
    overwrite: bool,
) -> io::Result<CopyResult> {
    // Validate source path (generated by the app, but defense-in-depth)
    let source = PathBuf::from(pack_zip_path);
    let source_canonical = source
        .canonicalize()
        .map_err(|_| io::Error::new(io::ErrorKind::NotFound, "资源包文件不存在"))?;

    // Sanitize instance_path to prevent path traversal
    let safe_instance_path = sanitize_instance_path(instance_path)?;

    let resourcepacks_dir = PathBuf::from(safe_instance_path).join("resourcepacks");
    std::fs::create_dir_all(&resourcepacks_dir)?;

    // Use source_canonical's file_name to prevent any injection via pack_zip_path
    let file_name = source_canonical
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "无效的文件名"))?;
    let target = resourcepacks_dir.join(file_name);
    let mut replaced = false;

    if target.exists() {
        if !overwrite {
            tracing::warn!(path = %target.display(), "Target resource pack already exists, not overwriting");
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("目标文件已存在: {}", target.display()),
            ));
        }
        replaced = true;
    }

    std::fs::copy(&source_canonical, &target)?;

    Ok(CopyResult {
        success: true,
        target_path: target.to_string_lossy().to_string(),
        replaced,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn pack_format_matches_common_mc_versions() {
        assert_eq!(pack_format_for_mc_version("1.21.1"), 34);
        assert_eq!(pack_format_for_mc_version("1.21"), 34);
        assert_eq!(pack_format_for_mc_version("1.20.6"), 32);
        assert_eq!(pack_format_for_mc_version("1.20.4"), 22);
        assert_eq!(pack_format_for_mc_version("1.20.2"), 18);
        assert_eq!(pack_format_for_mc_version("1.20.1"), 15);
    }

    #[test]
    fn dry_run_returns_stats() {
        let entries = vec![PackEntry {
            mod_id: "testmod".into(),
            key: "test.key".into(),
            text: "你好".into(),
            source_text: "Hello".into(),
        }];
        let options = PackOptions {
            target_language: "zh_cn".into(),
            entries,
            build_name: "Aaalice-MC-Translator".into(),
            dry_run: true,
            output_dir: std::env::temp_dir().to_string_lossy().to_string(),
            pack_format: 15,
            icon_path: None,
        };
        let result = generate_pack(&options).unwrap();
        assert_eq!(result.mod_count, 1);
        assert_eq!(result.entry_count, 1);
    }

    #[test]
    fn generated_pack_includes_embedded_icon() {
        let tmp = std::env::temp_dir().join("packer-test-icon");
        let _ = std::fs::remove_dir_all(&tmp);
        let entries = vec![PackEntry {
            mod_id: "testmod".into(),
            key: "test.key".into(),
            text: "你好".into(),
            source_text: "Hello".into(),
        }];
        let options = PackOptions {
            target_language: "zh_cn".into(),
            entries,
            build_name: "IconTest".into(),
            dry_run: false,
            output_dir: tmp.to_string_lossy().to_string(),
            pack_format: 15,
            icon_path: None,
        };
        let result = generate_pack(&options).unwrap();
        assert!(
            std::path::Path::new(&result.zip_path).exists(),
            "ZIP file should exist"
        );

        // Verify pack.png exists inside the zip with valid PNG magic bytes
        let zip_file = std::fs::File::open(&result.zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();
        let mut icon_entry = archive
            .by_name("pack.png")
            .expect("pack.png should be in ZIP");
        let mut header = [0u8; 8];
        icon_entry.read_exact(&mut header).unwrap();
        assert_eq!(
            header,
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            "pack.png must have valid PNG magic bytes"
        );

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn generated_pack_metadata_includes_time_without_changing_zip_name() {
        let tmp = std::env::temp_dir().join("packer-test-metadata");
        let _ = std::fs::remove_dir_all(&tmp);
        let entries = vec![PackEntry {
            mod_id: "testmod".into(),
            key: "test.key".into(),
            text: "你好".into(),
            source_text: "Hello".into(),
        }];
        let options = PackOptions {
            target_language: "zh_cn".into(),
            entries,
            build_name: "MetaTest".into(),
            dry_run: false,
            output_dir: tmp.to_string_lossy().to_string(),
            pack_format: 34,
            icon_path: None,
        };
        let result = generate_pack(&options).unwrap();
        assert!(
            result.zip_path.ends_with("MetaTest-zh_cn.zip"),
            "ZIP filename format must stay buildName-targetLanguage.zip"
        );

        let zip_file = std::fs::File::open(&result.zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();
        let mut mcmeta_entry = archive
            .by_name("pack.mcmeta")
            .expect("pack.mcmeta should be in ZIP");
        let mut mcmeta = String::new();
        mcmeta_entry.read_to_string(&mut mcmeta).unwrap();
        let value: serde_json::Value = serde_json::from_str(&mcmeta).unwrap();
        assert_eq!(value["pack"]["pack_format"].as_u64(), Some(34));
        let description = value["pack"]["description"].as_str().unwrap();
        assert!(description.contains("Aaalice MC Translator"));
        assert!(description.contains("模组 1 个 · 文本 1 条"));
        assert!(description.contains("生成于 "));
        assert!(description.contains("年"));
        assert!(description.contains("月"));
        assert!(description.contains("日"));
        assert!(description.contains("MetaTest"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_to_resourcepacks_nonexistent_returns_error() {
        let result = copy_to_resourcepacks("/nonexistent/ pack.zip", "/tmp", false);
        assert!(result.is_err());
    }

    #[test]
    fn sanitize_valid_instance_path_succeeds() {
        // Verify that a normal, non-system directory passes sanitization.
        let tmp = std::env::temp_dir();
        let result = sanitize_instance_path(&tmp.to_string_lossy());
        assert!(result.is_ok(), "Temp dir should be accepted: {:?}", result);
    }

    #[test]
    fn sanitize_nonexistent_path_fails() {
        // Verify that a non-existent path is rejected.
        let result = sanitize_instance_path("C:\\nonexistent_path_12345");
        assert!(result.is_err());
    }
}
