use std::{
    collections::{BTreeSet, HashSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

/// Maximum uncompressed size for a single language file inside a jar (50 MB).
/// Prevents OOM from malformed or oversized language data.
const MAX_LANG_FILE_SIZE: u64 = 50 * 1024 * 1024;

use rayon::prelude::*;

use zip::ZipArchive;

use crate::core::{
    dictionary, logging,
    models::{
        InstanceValidation, LanguageEntry, ModScanResult, ResourcePackScanResult, ScanPhase,
        ScanProgress, ScanSummary, ScanWarning, StageStatus,
    },
    paths::display_path,
};

pub fn validate_instance(path: String) -> io::Result<InstanceValidation> {
    let instance_path = PathBuf::from(path);
    let mods_path = instance_path.join("mods");
    let resourcepacks_path = instance_path.join("resourcepacks");
    let mut warnings = Vec::new();

    if !mods_path.is_dir() {
        warnings.push(warning(
            "missing_mods",
            "未找到 mods/，无法扫描模组语言文件",
            &mods_path,
        ));
    }

    for required in ["resourcepacks", "config", "saves"] {
        let required_path = instance_path.join(required);
        if !required_path.exists() {
            warnings.push(warning(
                &format!("missing_{required}"),
                &format!("未找到 {required}/，本阶段会跳过相关扫描"),
                &required_path,
            ));
        }
    }

    let options_path = instance_path.join("options.txt");
    if !options_path.exists() {
        warnings.push(warning(
            "missing_options",
            "未找到 options.txt，不影响模组语言文件扫描",
            &options_path,
        ));
    }

    Ok(InstanceValidation {
        instance_path: display_path(&instance_path),
        is_valid: mods_path.is_dir(),
        mods_path: display_path(mods_path),
        resourcepacks_path: display_path(resourcepacks_path),
        warnings,
    })
}

pub fn scan_instance(
    path: String,
    source_language: String,
    target_language: String,
    resource_pack_names: Vec<String>,
    cancel: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(ScanProgress) + Sync),
) -> io::Result<ScanSummary> {
    let source_language = normalize_source_language(&source_language)?;
    let target_language = normalize_target_language(&target_language)?;
    let job_id = logging::new_job_id("scan");
    let validation = validate_instance(path.clone())?;
    logging::append_main(format!("扫描任务创建成功，任务 ID: {job_id}"))?;
    logging::append_job(
        &job_id,
        format!("开始扫描实例: {}", validation.instance_path),
    )?;

    if !validation.is_valid {
        logging::append_error(&job_id, "实例缺少 mods/，扫描失败")?;
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "实例缺少 mods/，无法扫描",
        ));
    }

    let instance_path = PathBuf::from(&path);

    // Stage 1: scan mods (existing, unchanged)
    let mods = scan_mods(
        &instance_path.join("mods"),
        &source_language,
        &target_language,
        cancel,
        progress,
    )?;

    // Stage 2: resource packs — can be skipped on cancel
    let resource_packs = if cancel() {
        Vec::new()
    } else {
        progress(ScanProgress {
            current: 0,
            total: 0,
            mod_name: String::new(),
            phase: ScanPhase::ResourcePacks,
            sub_step: None,
            stage_status: StageStatus::Running,
        });
        scan_resourcepacks(
            &instance_path.join("resourcepacks"),
            &target_language,
            &resource_pack_names,
            progress,
        )?
    };

    // Stage 3: aggregate — ALWAYS runs regardless of cancel.
    // Aggregation is required to construct a valid ScanSummary.
    let total_language_files = mods.iter().map(|m| m.language_file_count).sum();
    let total_source_entries = mods.iter().map(|m| m.source_entries).sum();
    let total_target_entries = mods.iter().map(|m| m.target_entries).sum();
    // Count pending entries using key-by-key comparison (consistent with extract_pending_entries)
    // Mods with built-in target language files are excluded — they don't need translation.
    let total_pending_entries: usize = mods
        .iter()
        .filter(|m| !m.has_target_language)
        .map(|m| {
            let target_keys: HashSet<&str> = m
                .entries
                .iter()
                .filter(|e| e.language == m.target_language)
                .map(|e| e.key.as_str())
                .collect();
            m.entries
                .iter()
                .filter(|e| {
                    e.language == m.resolved_source_language
                        && !target_keys.contains(e.key.as_str())
                })
                .count()
        })
        .sum();

    // Stage 3b: match resource pack entries against mod source entries
    // to determine how many pending entries are already covered.
    let resource_pack_keys: HashSet<(&str, &str)> = resource_packs
        .iter()
        .flat_map(|rp| rp.entries.iter())
        .map(|e| (e.mod_id.as_str(), e.key.as_str()))
        .collect();
    let resource_pack_covered_entries: usize = {
        let rp_keys = &resource_pack_keys;
        mods.iter()
            .filter(|m| !m.has_target_language)
            .flat_map(|m| {
                let src_lang = m.resolved_source_language.as_str();
                m.entries.iter().filter(move |e| {
                    e.language == src_lang && rp_keys.contains(&(e.mod_id.as_str(), e.key.as_str()))
                })
            })
            .count()
    };
    // Actual pending entries: exclude both built-in target language translations
    // AND resource-pack-covered entries (they don't need LLM translation).
    let actual_pending_entries =
        total_pending_entries.saturating_sub(resource_pack_covered_entries);

    let mut warnings = validation.warnings.clone();
    warnings.extend(mods.iter().flat_map(|m| m.warnings.clone()));

    // Emit aggregate progress event only if not cancelled
    if !cancel() {
        progress(ScanProgress {
            current: 0,
            total: 1,
            mod_name: String::new(),
            phase: ScanPhase::Aggregate,
            sub_step: None,
            stage_status: StageStatus::Running,
        });
        progress(ScanProgress {
            current: 1,
            total: 1,
            mod_name: String::new(),
            phase: ScanPhase::Aggregate,
            sub_step: None,
            stage_status: StageStatus::Completed,
        });
    }

    let (dictionary_cache_hits, dictionary_cache_total) = if !cancel() {
        progress(ScanProgress {
            current: 0,
            total: 1,
            mod_name: String::new(),
            phase: ScanPhase::Dictionary,
            sub_step: Some("统计词典缓存命中".to_string()),
            stage_status: StageStatus::Running,
        });

        let counts = count_dictionary_cache_hits(&mods, &target_language);

        progress(ScanProgress {
            current: 1,
            total: 1,
            mod_name: String::new(),
            phase: ScanPhase::Dictionary,
            sub_step: Some("词典缓存命中统计完成".to_string()),
            stage_status: StageStatus::Completed,
        });
        counts
    } else {
        (0, 0)
    };

    // Stage 4: log — only write if not cancelled.
    // Emit per-mod progress so the frontend shows realtime granularity
    // instead of a single 0/1→1/1 jump (which felt frozen for seconds).
    if !cancel() {
        let total_mods = mods.len();
        progress(ScanProgress {
            current: 0,
            total: total_mods,
            mod_name: String::new(),
            phase: ScanPhase::Log,
            sub_step: None,
            stage_status: StageStatus::Running,
        });

        logging::append_job(
            &job_id,
            format!(
                "扫描完成：模组 {} 个，语言文件 {} 个，{} {} 条，{} {} 条，资源包 {} 个",
                mods.len(),
                total_language_files,
                source_language,
                total_source_entries,
                target_language,
                total_target_entries,
                resource_packs.len()
            ),
        )?;

        // Per-mod breakdown with per-mod progress emission
        for (i, mod_result) in mods.iter().enumerate() {
            let pending = mod_result
                .source_entries
                .saturating_sub(mod_result.target_entries);
            logging::append_job(
                &job_id,
                format!(
                    "[模组] {}: 来源条目={} 目标条目={} 待翻译={}",
                    mod_result.file_name,
                    mod_result.source_entries,
                    mod_result.target_entries,
                    pending
                ),
            )?;

            progress(ScanProgress {
                current: i + 1,
                total: total_mods,
                mod_name: mod_result.file_name.clone(),
                phase: ScanPhase::Log,
                sub_step: None,
                stage_status: StageStatus::Running,
            });
        }

        // Total summary
        logging::append_job(
            &job_id,
            format!(
                "扫描汇总: {} 模组, {} 语言文件, {} 来源条目, {} 目标条目, {} 待翻译条目",
                mods.len(),
                total_language_files,
                total_source_entries,
                total_target_entries,
                total_pending_entries
            ),
        )?;

        progress(ScanProgress {
            current: total_mods,
            total: total_mods,
            mod_name: String::new(),
            phase: ScanPhase::Log,
            sub_step: None,
            stage_status: StageStatus::Completed,
        });

        logging::append_main(format!(
            "扫描完成：{} 模组, {} 语言文件, {} 来源条目, {} 目标条目, {} 待翻译",
            mods.len(),
            total_language_files,
            total_source_entries,
            total_target_entries,
            actual_pending_entries
        ))?;
    }

    // Log cancellation to main log if mid-flight cancel happened
    if cancel() {
        logging::append_main("扫描已被用户取消".to_string())?;
    }

    let cancelled = cancel();

    Ok(ScanSummary {
        job_id,
        instance_path: display_path(instance_path),
        validation,
        mods,
        resource_packs,
        source_language,
        target_language,
        total_language_files,
        total_source_entries,
        total_target_entries,
        total_pending_entries,
        resource_pack_covered_entries,
        actual_pending_entries,
        dictionary_cache_hits,
        dictionary_cache_total,
        warnings,
        cancelled,
    })
}

pub fn scan_mods(
    mods_path: &Path,
    source_language: &str,
    target_language: &str,
    cancel: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(ScanProgress) + Sync),
) -> io::Result<Vec<ModScanResult>> {
    if !mods_path.is_dir() {
        return Ok(Vec::new());
    }

    let entries: Vec<_> = fs::read_dir(mods_path)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("jar"))
        .collect();
    let total = entries.len();

    if total == 0 {
        return Ok(Vec::new());
    }

    // Parallel scan with atomic progress counter
    let completed = AtomicUsize::new(0);
    let mut results: Vec<ModScanResult> = entries
        .par_iter()
        .map(|entry| {
            let path = entry.path();
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();

            // Check cancel before doing heavy IO (zip reading)
            let result = if cancel() {
                ModScanResult {
                    mod_id: String::new(),
                    file_name: file_name.clone(),
                    jar_path: String::new(),
                    language_file_count: 0,
                    recovered_language_files: 0,
                    failed_language_files: 0,
                    source_language: source_language.to_string(),
                    resolved_source_language: String::new(),
                    target_language: target_language.to_string(),
                    source_entries: 0,
                    target_entries: 0,
                    has_target_language: false,
                    formats: Vec::new(),
                    entries: Vec::new(),
                    warnings: Vec::new(),
                }
            } else {
                scan_mod_jar(&path, &file_name, source_language, target_language)
            };

            let current = completed.fetch_add(1, Ordering::SeqCst) + 1;
            progress(ScanProgress {
                current,
                total,
                mod_name: file_name,
                phase: ScanPhase::Scan,
                sub_step: None,
                stage_status: StageStatus::Running,
            });
            result
        })
        .collect();

    results.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(results)
}

fn count_dictionary_cache_hits(mods: &[ModScanResult], target_language: &str) -> (usize, usize) {
    let root = match crate::core::paths::runtime_root() {
        Ok(root) => root,
        Err(err) => {
            tracing::warn!("解析运行目录失败 (缓存检测跳过): {err}");
            return (0, 0);
        }
    };
    let dict_db_path = crate::core::paths::dictionary_db_path(&root);
    let dict_conn = match dictionary::open(&dict_db_path) {
        Ok(conn) => conn,
        Err(err) => {
            tracing::warn!("打开词典失败 (缓存检测跳过): {err}");
            return (0, 0);
        }
    };
    let target_hashes = match dictionary::load_source_hashes_for_target(&dict_conn, target_language)
    {
        Ok(hashes) => hashes,
        Err(err) => {
            tracing::warn!("词典缓存命中检测失败: {err}");
            return (0, 0);
        }
    };

    let mut total = 0usize;
    let mut hits = 0usize;
    for mod_result in mods.iter().filter(|m| !m.has_target_language) {
        let src_lang = &mod_result.resolved_source_language;
        for entry in mod_result
            .entries
            .iter()
            .filter(|e| e.language == *src_lang)
        {
            total += 1;
            let source_hash = dictionary::hash_text(&entry.text);
            if target_hashes.contains(&source_hash) {
                hits += 1;
            }
        }
    }

    (hits, total)
}

pub fn scan_resourcepacks(
    resourcepacks_path: &Path,
    target_language: &str,
    resource_pack_names: &[String],
    progress: &(dyn Fn(ScanProgress) + Sync),
) -> io::Result<Vec<ResourcePackScanResult>> {
    let mut results = Vec::new();
    if !resourcepacks_path.is_dir() {
        return Ok(results);
    }

    let names_lower: Vec<String> = resource_pack_names
        .iter()
        .map(|n| n.to_ascii_lowercase())
        .collect();
    let stripped_refs: Vec<&str> = names_lower
        .iter()
        .map(|lower| {
            lower
                .strip_suffix(".zip")
                .unwrap_or(lower)
                .trim_end_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '.')
        })
        .collect();
    let is_known_pack = |name: &str| -> bool {
        let lower = name.to_ascii_lowercase();
        let stripped = lower
            .strip_suffix(".zip")
            .unwrap_or(&lower)
            .trim_end_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '.');
        stripped_refs.iter().any(|sr| *sr == stripped)
    };

    // Pre-collect known packs and sort by name so progress emission order
    // matches the final result sort order.
    let mut known_packs: Vec<_> = fs::read_dir(resourcepacks_path)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let path = entry.path();
            let name = file_name(&path);
            is_known_pack(&name)
                && (path.is_dir() || path.extension().and_then(|v| v.to_str()) == Some("zip"))
        })
        .collect();
    known_packs.sort_by(|a, b| file_name(&a.path()).cmp(&file_name(&b.path())));
    let total = known_packs.len();

    for (index, entry) in known_packs.into_iter().enumerate() {
        let path = entry.path();
        let name = file_name(&path);
        progress(ScanProgress {
            current: index,
            total,
            mod_name: name.clone(),
            phase: ScanPhase::ResourcePacks,
            sub_step: None,
            stage_status: StageStatus::Running,
        });
        if path.is_dir() {
            results.push(scan_resourcepack_dir(&path, target_language)?);
        } else {
            results.push(scan_resourcepack_zip(&path, target_language));
        }
        progress(ScanProgress {
            current: index + 1,
            total,
            mod_name: name,
            phase: ScanPhase::ResourcePacks,
            sub_step: None,
            stage_status: StageStatus::Running,
        });
    }

    results.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(results)
}

fn scan_mod_jar(
    path: &Path,
    file_name: &str,
    source_language: &str,
    target_language: &str,
) -> ModScanResult {
    let file_name = file_name.to_string();
    let mut warnings = Vec::new();
    let mut entries = Vec::new();
    let mut formats = BTreeSet::new();
    let mut language_files = BTreeSet::new();
    let mut recovered_language_files = 0;
    let mut failed_language_files = 0;
    let mut target_language_file_exists = false;

    match fs::File::open(path).and_then(|file| {
        ZipArchive::new(file).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
    }) {
        Ok(mut archive) => {
            // Phase 1: zero IO — collect from in-memory central directory
            let lang_indices: Vec<usize> = {
                archive
                    .file_names()
                    .enumerate()
                    .filter(|(_, name)| is_supported_lang_file(&name.replace('\\', "/")))
                    .map(|(i, _)| i)
                    .collect()
            };
            // Phase 2: only seek + read matching entries
            for index in lang_indices {
                let Ok(mut file) = archive.by_index(index) else {
                    continue;
                };
                let name = file.name().replace('\\', "/");

                if parse_lang_path(&name).is_some_and(|(_, language)| language == target_language) {
                    target_language_file_exists = true;
                }

                // Guard against oversized language files (OOM prevention)
                let uncompressed_size = file.size();
                if uncompressed_size > MAX_LANG_FILE_SIZE {
                    warnings.push(warning(
                        "lang_file_too_large",
                        &format!("语言文件过大 ({uncompressed_size} bytes > {MAX_LANG_FILE_SIZE} max)，已跳过"),
                        path,
                    ));
                    failed_language_files += 1;
                    continue;
                }

                let mut bytes = Vec::with_capacity(uncompressed_size as usize);
                if let Err(err) = file.read_to_end(&mut bytes) {
                    warnings.push(warning(
                        "lang_read_failed",
                        &format!("读取语言文件失败：{err}"),
                        path,
                    ));
                    failed_language_files += 1;
                    continue;
                }
                let content = decode_language_content(&bytes);

                let format = if name.ends_with(".json") {
                    "json"
                } else {
                    "lang"
                };
                formats.insert(format.to_string());
                language_files.insert(name.clone());
                let parsed = parse_language_entries(&name, &content, format, path, &mut warnings);
                match parsed {
                    ParseOutcome::Strict(e) => entries.extend(e),
                    ParseOutcome::Recovered(e) => {
                        recovered_language_files += 1;
                        entries.extend(e);
                    }
                    ParseOutcome::Failed => {
                        failed_language_files += 1;
                    }
                }
            }
        }
        Err(err) => warnings.push(warning(
            "jar_open_failed",
            &format!("打开 jar 失败：{err}"),
            path,
        )),
    }

    let mod_id = entries
        .first()
        .map(|entry| entry.mod_id.clone())
        .or_else(|| infer_mod_id_from_file_name(&file_name))
        .unwrap_or_else(|| "unknown".to_string());
    let resolved_source_language =
        resolve_source_language(&entries, source_language, target_language);
    // 当检测到的源语言与目标语言相同时，该模组可能已被汉化或只有目标语言文件
    if resolved_source_language == target_language {
        warnings.push(warning(
            "source_equals_target",
            &format!("检测到的源语言 ({resolved_source_language}) 与目标语言相同，该模组可能已被汉化或语言文件配置有误"),
            path,
        ));
    }
    let source_entries = entries
        .iter()
        .filter(|entry| entry.language == resolved_source_language)
        .count();
    let target_entries = entries
        .iter()
        .filter(|entry| entry.language == target_language)
        .count();

    ModScanResult {
        mod_id,
        file_name,
        jar_path: display_path(path),
        language_file_count: language_files.len(),
        recovered_language_files,
        failed_language_files,
        source_language: source_language.to_string(),
        resolved_source_language,
        target_language: target_language.to_string(),
        source_entries,
        target_entries,
        has_target_language: target_language_file_exists,
        formats: formats.into_iter().collect(),
        entries,
        warnings,
    }
}

fn scan_resourcepack_dir(path: &Path, target_language: &str) -> io::Result<ResourcePackScanResult> {
    let mut lang_file_count = 0;
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    let has_pack_meta = path.join("pack.mcmeta").is_file();
    let assets_path = path.join("assets");

    if assets_path.is_dir() {
        collect_resourcepack_lang_dir(
            &assets_path,
            &assets_path,
            target_language,
            &mut lang_file_count,
            &mut entries,
            &mut warnings,
        )?;
    }

    let entry_count = entries.len();
    Ok(ResourcePackScanResult {
        name: file_name(path),
        path: display_path(path),
        source_type: infer_pack_source_type(path),
        is_archive: false,
        has_pack_meta,
        lang_file_count,
        entry_count,
        entries,
        warnings,
    })
}

fn scan_resourcepack_zip(path: &Path, target_language: &str) -> ResourcePackScanResult {
    let mut lang_file_count = 0;
    let mut entries = Vec::new();
    let mut has_pack_meta = false;
    let mut warnings: Vec<ScanWarning> = Vec::new();

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(err) => {
            warnings.push(ScanWarning {
                code: "resourcepack_open_failed".to_string(),
                message: format!("无法打开资源包文件: {err}"),
                path: display_path(path),
            });
            return ResourcePackScanResult {
                name: file_name(path),
                path: display_path(path),
                source_type: infer_pack_source_type(path),
                is_archive: true,
                has_pack_meta: false,
                lang_file_count: 0,
                entry_count: 0,
                entries: Vec::new(),
                warnings,
            };
        }
    };

    match ZipArchive::new(file) {
        Ok(mut archive) => {
            // Check pack.mcmeta from in-memory (zero IO)
            if archive
                .file_names()
                .any(|n| n == "pack.mcmeta" || n.ends_with("/pack.mcmeta"))
            {
                has_pack_meta = true;
            }
            // Zero-IO filter
            let lang_indices: Vec<usize> = {
                archive
                    .file_names()
                    .enumerate()
                    .filter(|(_, name)| {
                        is_target_lang_file(&name.replace('\\', "/"), target_language)
                    })
                    .map(|(i, _)| i)
                    .collect()
            };
            for index in lang_indices {
                let Ok(mut file) = archive.by_index(index) else {
                    continue;
                };
                let mut bytes = Vec::new();
                if file.read_to_end(&mut bytes).is_ok() {
                    let content = decode_language_content(&bytes);
                    lang_file_count += 1;
                    let name = file.name().replace('\\', "/");
                    let file_entries = parse_resourcepack_lang_file(&name, &content, &mut warnings);
                    entries.extend(file_entries);
                }
            }
        }
        Err(err) => {
            warnings.push(ScanWarning {
                code: "resourcepack_zip_open_failed".to_string(),
                message: format!("解析资源包 zip 失败: {err}"),
                path: display_path(path),
            });
        }
    }

    let entry_count = entries.len();
    ResourcePackScanResult {
        name: file_name(path),
        path: display_path(path),
        source_type: infer_pack_source_type(path),
        is_archive: true,
        has_pack_meta,
        lang_file_count,
        entry_count,
        entries,
        warnings,
    }
}

fn collect_resourcepack_lang_dir(
    assets_root: &Path,
    current: &Path,
    target_language: &str,
    lang_file_count: &mut usize,
    entries: &mut Vec<LanguageEntry>,
    warnings: &mut Vec<ScanWarning>,
) -> io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let child = entry.path();
        if child.is_dir() {
            collect_resourcepack_lang_dir(
                assets_root,
                &child,
                target_language,
                lang_file_count,
                entries,
                warnings,
            )?;
            continue;
        }
        let path_str = display_path(&child);
        if !is_target_lang_file(&path_str, target_language) {
            continue;
        }
        let bytes = fs::read(&child)?;
        let content = decode_language_content(&bytes);
        *lang_file_count += 1;

        // Compute assets-relative path for parse_lang_path compatibility.
        // e.g. from full path ".../VM_汉化包/assets/placeholdermod/lang/zh_cn.lang"
        // produce "assets/placeholdermod/lang/zh_cn.lang"
        let pack_path = child
            .strip_prefix(assets_root)
            .ok()
            .map(|rel| format!("assets/{}", rel.display().to_string().replace('\\', "/")))
            .unwrap_or_else(|| path_str.clone());

        let file_entries = parse_resourcepack_lang_file(&pack_path, &content, warnings);
        entries.extend(file_entries);
    }
    Ok(())
}

fn parse_language_entries(
    name: &str,
    content: &str,
    format: &str,
    jar_path: &Path,
    warnings: &mut Vec<ScanWarning>,
) -> ParseOutcome {
    let Some((mod_id, language)) = parse_lang_path(name) else {
        return ParseOutcome::Failed;
    };

    match format {
        "json" => parse_json_entries(&mod_id, &language, name, content, jar_path, warnings),
        "lang" => ParseOutcome::Strict(parse_lang_entries(&mod_id, &language, name, content)),
        _ => ParseOutcome::Failed,
    }
}

/// Result of parsing a single language file.
enum ParseOutcome {
    /// Parsed successfully via standard JSON/serde.
    Strict(Vec<LanguageEntry>),
    /// Parsed via lenient recovery (fallback parser).
    Recovered(Vec<LanguageEntry>),
    /// Failed to parse.
    Failed,
}

fn parse_json_entries(
    mod_id: &str,
    language: &str,
    source_file: &str,
    content: &str,
    jar_path: &Path,
    warnings: &mut Vec<ScanWarning>,
) -> ParseOutcome {
    let content = content.trim_start_matches('\u{feff}');
    if content.trim().is_empty() {
        return ParseOutcome::Strict(Vec::new());
    }

    match serde_json::from_str::<serde_json::Value>(content) {
        Ok(serde_json::Value::Object(map)) => {
            let entries = map
                .into_iter()
                .filter_map(|(key, value)| {
                    json_lang_value_to_text(value).map(|text| {
                        language_entry(mod_id, language, "json", source_file, key, text)
                    })
                })
                .collect();
            ParseOutcome::Strict(entries)
        }
        Ok(_) => {
            warnings.push(warning(
                "json_parse_failed",
                &format!("跳过非对象 JSON 语言文件 {source_file}"),
                jar_path,
            ));
            ParseOutcome::Failed
        }
        Err(err) => {
            let lenient_entries =
                parse_lenient_json_lang_entries(mod_id, language, source_file, content);
            if !lenient_entries.is_empty() {
                return ParseOutcome::Recovered(lenient_entries);
            }
            warnings.push(warning(
                "json_parse_failed",
                &format!("跳过无法解析的 JSON 语言文件 {source_file}: {err}"),
                jar_path,
            ));
            ParseOutcome::Failed
        }
    }
}

fn json_lang_value_to_text(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text),
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        serde_json::Value::Null | serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            None
        }
    }
}

fn decode_language_content(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16_bytes(&bytes[2..], false);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16_bytes(&bytes[2..], true);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn decode_utf16_bytes(bytes: &[u8], big_endian: bool) -> String {
    let units = bytes.chunks_exact(2).map(|chunk| {
        if big_endian {
            u16::from_be_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_le_bytes([chunk[0], chunk[1]])
        }
    });
    std::char::decode_utf16(units)
        .map(|item| item.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

fn parse_lenient_json_lang_entries(
    mod_id: &str,
    language: &str,
    source_file: &str,
    content: &str,
) -> Vec<LanguageEntry> {
    let chars: Vec<char> = content.trim_start_matches('\u{feff}').chars().collect();
    let mut index = 0;
    let mut entries = Vec::new();

    while index < chars.len() {
        skip_until_quote(&chars, &mut index);
        let Some(key) = read_quoted_until_next_quote(&chars, &mut index) else {
            break;
        };
        skip_ws_and_comments(&chars, &mut index);
        if chars.get(index) != Some(&':') {
            index = index.saturating_add(1);
            continue;
        }
        index += 1;
        skip_ws_and_comments(&chars, &mut index);
        if chars.get(index) != Some(&'"') {
            continue;
        }

        let Some(text) = read_lang_value(&chars, &mut index) else {
            break;
        };
        entries.push(language_entry(
            mod_id,
            language,
            "json",
            source_file,
            key,
            text,
        ));
    }

    entries
}

fn skip_until_quote(chars: &[char], index: &mut usize) {
    while *index < chars.len() && chars[*index] != '"' {
        *index += 1;
    }
}

fn skip_ws_and_comments(chars: &[char], index: &mut usize) {
    loop {
        while *index < chars.len() && chars[*index].is_whitespace() {
            *index += 1;
        }

        if chars.get(*index) == Some(&'/') && chars.get(*index + 1) == Some(&'/') {
            *index += 2;
            while *index < chars.len() && chars[*index] != '\n' {
                *index += 1;
            }
            continue;
        }

        if chars.get(*index) == Some(&'/') && chars.get(*index + 1) == Some(&'*') {
            *index += 2;
            while *index + 1 < chars.len() && !(chars[*index] == '*' && chars[*index + 1] == '/') {
                *index += 1;
            }
            *index = (*index + 2).min(chars.len());
            continue;
        }

        break;
    }
}

fn read_quoted_until_next_quote(chars: &[char], index: &mut usize) -> Option<String> {
    if chars.get(*index) != Some(&'"') {
        return None;
    }
    *index += 1;
    let mut value = String::new();
    let mut escaped = false;
    while *index < chars.len() {
        let ch = chars[*index];
        *index += 1;
        if escaped {
            value.push(unescape_json_char(ch));
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            return Some(value);
        }
        value.push(ch);
    }
    None
}

fn read_lang_value(chars: &[char], index: &mut usize) -> Option<String> {
    if chars.get(*index) != Some(&'"') {
        return None;
    }
    *index += 1;
    let mut value = String::new();
    let mut escaped = false;
    while *index < chars.len() {
        let ch = chars[*index];
        *index += 1;
        if escaped {
            value.push(unescape_json_char(ch));
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' && looks_like_value_end(chars, *index) {
            return Some(value);
        }
        value.push(ch);
    }
    None
}

fn looks_like_value_end(chars: &[char], mut index: usize) -> bool {
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    matches!(chars.get(index), Some(',') | Some('}') | Some('"') | None)
}

fn unescape_json_char(ch: char) -> char {
    match ch {
        'n' => '\n',
        'r' => '\r',
        't' => '\t',
        '"' => '"',
        '\\' => '\\',
        '/' => '/',
        'b' => '\u{0008}',
        'f' => '\u{000c}',
        other => other,
    }
}

fn parse_lang_entries(
    mod_id: &str,
    language: &str,
    source_file: &str,
    content: &str,
) -> Vec<LanguageEntry> {
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, text) = trimmed.split_once('=')?;
            Some(language_entry(
                mod_id,
                language,
                "lang",
                source_file,
                key.trim().to_string(),
                text.trim().to_string(),
            ))
        })
        .collect()
}

fn language_entry(
    mod_id: &str,
    language: &str,
    format: &str,
    source_file: &str,
    key: String,
    text: String,
) -> LanguageEntry {
    LanguageEntry {
        mod_id: mod_id.to_string(),
        key,
        text_hash: hash_text(&text),
        text,
        language: language.to_string(),
        format: format.to_string(),
        source_file: source_file.to_string(),
    }
}

/// Parse a single language file (JSON or .lang) inside a resource pack into LanguageEntry objects.
/// Reuses the same parsing logic as mod jar language file parsing.
fn parse_resourcepack_lang_file(
    name: &str,
    content: &str,
    warnings: &mut Vec<ScanWarning>,
) -> Vec<LanguageEntry> {
    let format = if name.ends_with(".json") {
        "json"
    } else {
        "lang"
    };
    match parse_language_entries(name, content, format, Path::new(name), warnings) {
        ParseOutcome::Strict(e) | ParseOutcome::Recovered(e) => e,
        ParseOutcome::Failed => Vec::new(),
    }
}

fn parse_lang_path(path: &str) -> Option<(String, String)> {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 4 || parts[0] != "assets" || parts[2] != "lang" {
        return None;
    }
    let language = parts[3]
        .strip_suffix(".json")
        .or_else(|| parts[3].strip_suffix(".lang"))?;
    Some((parts[1].to_string(), language.to_string()))
}

fn is_supported_lang_file(path: &str) -> bool {
    parse_lang_path(path).is_some()
}

fn is_target_lang_file(path: &str, target_language: &str) -> bool {
    (path.starts_with("assets/") || path.contains("/assets/"))
        && path.contains("/lang/")
        && (path.ends_with(&format!("/{target_language}.json"))
            || path.ends_with(&format!("/{target_language}.lang")))
}

fn normalize_source_language(value: &str) -> io::Result<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() || normalized == "auto" {
        return Ok("auto".to_string());
    }
    if is_locale_code(&normalized) {
        return Ok(normalized);
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "来源语言必须是 auto 或合法 Minecraft locale code",
    ))
}

fn normalize_target_language(value: &str) -> io::Result<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "auto" || !is_locale_code(&normalized) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "目标语言必须是合法 Minecraft locale code，且不能为 auto",
        ));
    }
    Ok(normalized)
}

fn is_locale_code(value: &str) -> bool {
    let Some((language, region)) = value.split_once('_') else {
        return false;
    };
    (2..=3).contains(&language.len())
        && (2..=8).contains(&region.len())
        && language.chars().all(|ch| ch.is_ascii_lowercase())
        && region
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
}

fn resolve_source_language(
    entries: &[LanguageEntry],
    source_language: &str,
    target_language: &str,
) -> String {
    if source_language != "auto" {
        return source_language.to_string();
    }

    if entries.is_empty() {
        return String::new();
    }

    let available = entries
        .iter()
        .map(|entry| entry.language.as_str())
        .collect::<BTreeSet<_>>();
    if available.contains("en_us") {
        return "en_us".to_string();
    }
    for candidate in ["en_gb", "zh_cn", "ja_jp", "ko_kr"] {
        if candidate != target_language && available.contains(candidate) {
            return candidate.to_string();
        }
    }
    if let Some(candidate) = available.iter().find(|item| **item != target_language) {
        return (*candidate).to_string();
    }
    if available.contains(target_language) {
        return target_language.to_string();
    }
    String::new()
}

fn infer_pack_source_type(path: &Path) -> String {
    let name = file_name(path).to_ascii_lowercase();
    // CFPAOrg i18n packs use filenames like "Minecraft-Mod-Language-Modpack-Converted-..."
    // or "...-i18n-..." / "...-i18nupdates-..."
    if name.contains("i18n") || name.contains("mod-language") {
        "i18n".to_string()
    } else if name.contains("vmtranslation")
        || name.contains("vm翻译")
        || name.contains("vm_汉化")
        || name.contains("汉化包")
        || name == "vm_汉化包"
    {
        "vm".to_string()
    } else {
        "normal".to_string()
    }
}

fn infer_mod_id_from_file_name(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".jar").unwrap_or(file_name);
    // Split by '-' and collect segments until one looks like a version number
    // (starts with a digit and contains a dot or is entirely numeric).
    let mut mod_id_parts: Vec<&str> = Vec::new();
    for segment in stem.split('-') {
        if segment.is_empty() {
            continue;
        }
        // Check if this segment looks like a version number
        let first_char = segment.chars().next().unwrap_or(' ');
        if first_char.is_ascii_digit()
            && (segment.contains('.') || segment.chars().all(|c| c.is_ascii_digit()))
        {
            break; // Version number found — stop here
        }
        // Skip known forge/fabric/neoforge loader prefixes
        let lower = segment.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "forge" | "fabric" | "neoforge" | "universal"
        ) {
            continue;
        }
        mod_id_parts.push(segment);
    }
    let mod_id = mod_id_parts
        .join("-")
        .trim_matches('-')
        .to_ascii_lowercase();
    (!mod_id.is_empty()).then_some(mod_id)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn warning(code: &str, message: &str, path: &Path) -> ScanWarning {
    ScanWarning {
        code: code.to_string(),
        message: message.to_string(),
        path: display_path(path),
    }
}

// Re-export the deterministic hash_text from dictionary module.
// Both scanner and dictionary must use the same stable hash algorithm
// so that LanguageEntry.text_hash can cross-reference dictionary entries.
pub use dictionary::hash_text;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn fixtures_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tests")
            .join("fixtures")
            .join("modpacks")
            .join("basic_pack")
    }

    #[test]
    fn validates_instance_with_only_mods_required() {
        let validation = validate_instance(display_path(fixtures_root())).unwrap();
        assert!(validation.is_valid);
        assert!(validation
            .warnings
            .iter()
            .all(|item| item.code != "missing_mods"));
    }

    #[test]
    fn scans_mod_jars_and_detects_existing_zh_cn() {
        let cancel = AtomicBool::new(false);
        let mods = scan_mods(
            &fixtures_root().join("mods"),
            "auto",
            "zh_cn",
            &|| cancel.load(Ordering::SeqCst),
            &|_| {},
        )
        .unwrap();
        let example = mods
            .iter()
            .find(|item| item.mod_id == "examplemod")
            .unwrap();
        let placeholder = mods
            .iter()
            .find(|item| item.mod_id == "placeholdermod")
            .unwrap();

        assert_eq!(example.resolved_source_language, "en_us");
        assert_eq!(example.source_entries, 5);
        assert_eq!(example.target_entries, 1);
        assert!(example.has_target_language);
        assert_eq!(placeholder.source_entries, 3);
        assert!(placeholder.formats.contains(&"lang".to_string()));
    }

    #[test]
    fn scans_resource_pack_sources() {
        let names: Vec<String> = vec!["i18n-example.zip".to_string(), "VM_汉化包".to_string()];
        let packs = scan_resourcepacks(
            &fixtures_root().join("resourcepacks"),
            "zh_cn",
            &names,
            &|_| {},
        )
        .unwrap();
        let i18n = packs
            .iter()
            .find(|item| item.source_type == "i18n")
            .unwrap();
        let vm = packs.iter().find(|item| item.source_type == "vm").unwrap();

        assert!(i18n.is_archive);
        assert!(i18n.has_pack_meta);
        assert_eq!(i18n.entry_count, 2);
        assert_eq!(i18n.entries.len(), 2);
        // Entries may be in any order (ZipArchive enumeration order); check by key
        let find_i18n_entry = |key: &str| i18n.entries.iter().find(|e| e.key == key).unwrap();
        assert_eq!(
            find_i18n_entry("item.examplemod.energy_cell").text,
            "能量单元"
        );
        assert_eq!(
            find_i18n_entry("message.examplemod.open").text,
            "按住 %s 打开 %s 界面"
        );
        assert!(i18n.entries.iter().all(|e| e.language == "zh_cn"));

        assert!(!vm.is_archive);
        assert_eq!(vm.entry_count, 1);
        assert_eq!(vm.entries.len(), 1);
        assert_eq!(vm.entries[0].key, "item.placeholdermod.wrench");
        assert_eq!(vm.entries[0].text, "占位扳手");
        assert_eq!(vm.entries[0].language, "zh_cn");
        assert_eq!(vm.entries[0].format, "lang");
    }

    #[test]
    fn target_language_changes_resource_pack_matching() {
        let names: Vec<String> = vec!["i18n-example.zip".to_string(), "VM_汉化包".to_string()];
        let packs = scan_resourcepacks(
            &fixtures_root().join("resourcepacks"),
            "ja_jp",
            &names,
            &|_| {},
        )
        .unwrap();
        assert!(packs.iter().all(|item| item.entry_count == 0));
    }

    #[test]
    fn parses_common_lenient_minecraft_lang_json() {
        let content = r#"{
          // JSONC comments appear in some mods.
          "mod.example.title": "Example",
          "mod.example.multiline": "First line

Second line",
          "mod.example.missing_comma": "Still readable"
          "mod.example.next": "Next value"
        }"#;

        let entries = parse_lenient_json_lang_entries(
            "example",
            "en_us",
            "assets/example/lang/en_us.json",
            content,
        );

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[1].text, "First line\n\nSecond line");
        assert_eq!(entries[2].key, "mod.example.missing_comma");
        assert_eq!(entries[3].text, "Next value");
    }

    #[test]
    fn empty_json_language_file_is_valid_empty_table() {
        let mut warnings = Vec::new();
        let parsed = parse_json_entries(
            "example",
            "sk_sk",
            "assets/example/lang/sk_sk.json",
            "",
            Path::new("example.jar"),
            &mut warnings,
        );

        match parsed {
            ParseOutcome::Strict(entries) => assert!(entries.is_empty()),
            _ => panic!("empty json language file should parse as an empty table"),
        }
        assert!(warnings.is_empty());
    }

    #[test]
    fn parses_utf16le_json_language_file() {
        let source = "{\r\n  \"item.eoas.emerald_on_a_stick\": \"绿宝石棒\"\r\n}";
        let mut bytes = vec![0xff, 0xfe];
        for unit in source.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let content = decode_language_content(&bytes);
        let mut warnings = Vec::new();
        let parsed = parse_json_entries(
            "eoas",
            "zh_cn",
            "assets/eoas/lang/zh_cn.json",
            &content,
            Path::new("eoas.jar"),
            &mut warnings,
        );

        match parsed {
            ParseOutcome::Strict(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].key, "item.eoas.emerald_on_a_stick");
                assert_eq!(entries[0].text, "绿宝石棒");
            }
            _ => panic!("utf-16le json language file should parse"),
        }
        assert!(warnings.is_empty());
    }

    #[test]
    fn progress_callback_is_called_for_each_jar() {
        let calls = AtomicUsize::new(0);
        let cancel = AtomicBool::new(false);
        let mods = scan_mods(
            &fixtures_root().join("mods"),
            "auto",
            "zh_cn",
            &|| cancel.load(Ordering::SeqCst),
            &|p: ScanProgress| {
                calls.fetch_add(1, Ordering::SeqCst);
                assert!(p.current >= 1);
                assert_eq!(p.total, 2);
                assert!(p.phase == ScanPhase::Scan);
            },
        )
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), mods.len());
        assert!(mods.len() > 0);
    }
}
