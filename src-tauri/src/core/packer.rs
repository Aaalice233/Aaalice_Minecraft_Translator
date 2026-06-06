use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Sanitize a filename component to prevent path traversal attacks.
/// Replaces path separators and common dangerous characters with underscores.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '>' | '<' | '"' | '|' | '?' | '*' => '_',
            c if c.is_ascii_control() => '_',
            _ => ch,
        })
        .collect::<String>()
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
    /// 15  = 1.20.5–1.21.0
    /// 34  = 1.21.1–1.21.4
    /// 42+ = 1.21.5+
    /// Default 15 for backward compatibility.
    #[serde(default = "default_pack_format")]
    pub pack_format: u32,
}

fn default_pack_format() -> u32 { 15 }

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
                        let _mod_id = entry.file_name().to_string_lossy().to_string();
                        let lang_path = entry.path().join("lang").join(format!("{}.json", options.target_language));
                        if lang_path.exists() {
                            if let Ok(content) = std::fs::read_to_string(&lang_path) {
                                if let Ok(existing) = serde_json::from_str::<HashMap<String, String>>(&content) {
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

    // Generate pack.mcmeta
    std::fs::create_dir_all(&pack_dir)?;
    let mcmeta = serde_json::json!({
        "pack": {
            "pack_format": options.pack_format,
            "description": format!("{} - {}", options.build_name, options.target_language)
        }
    });
    std::fs::write(
        pack_dir.join("pack.mcmeta"),
        serde_json::to_string_pretty(&mcmeta)?,
    )?;

    // Note: 建议在资源包根目录放置 pack.png 作为资源包图标；
    // 没有图标时 Minecraft 仍可使用该资源包，但不会在选择界面显示预览图。

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

        std::fs::write(
            &lang_path,
            serde_json::to_string_pretty(&lang_map)?,
        )?;
    }

    // Generate zip (using safe_build_name to prevent path traversal)
    let zip_path = output_dir.join(format!("{}-{}.zip", safe_build_name, options.target_language));
    create_zip(&pack_dir, &zip_path)?;

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
        let name = path.strip_prefix(base)
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

/// Resolve a user-provided instance path to canonical form, preventing path traversal.
fn sanitize_instance_path(input: &str) -> io::Result<String> {
    let path = Path::new(input);
    // Use canonicalize to resolve symlinks and `..` components.
    // The instance path must exist, so canonicalize will succeed.
    let canonical = path
        .canonicalize()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "实例路径无效或不存在"))?;
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

    #[test]
    fn dry_run_returns_stats() {
        let entries = vec![
            PackEntry { mod_id: "testmod".into(), key: "test.key".into(), text: "你好".into(), source_text: "Hello".into() },
        ];
        let options = PackOptions {
            target_language: "zh_cn".into(),
            entries,
            build_name: "Aaalice-MC-Translator".into(),
            dry_run: true,
            output_dir: std::env::temp_dir().to_string_lossy().to_string(),
            pack_format: 15,
        };
        let result = generate_pack(&options).unwrap();
        assert_eq!(result.mod_count, 1);
        assert_eq!(result.entry_count, 1);
    }

    #[test]
    fn copy_to_resourcepacks_nonexistent_returns_error() {
        let result = copy_to_resourcepacks("/nonexistent/ pack.zip", "/tmp", false);
        assert!(result.is_err());
    }
}
