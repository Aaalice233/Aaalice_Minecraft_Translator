use crate::core::{packer, paths};
use tracing::info;

#[tauri::command]
pub fn generate_translation_pack(
    entries: Vec<packer::PackEntry>,
    target_language: String,
    dry_run: bool,
    pack_format: Option<u32>,
) -> Result<packer::PackResult, String> {
    info!("generate_translation_pack: entries={}, target_language={}, dry_run={}", entries.len(), target_language, dry_run);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: "Aaalice-MC-Translator".to_string(),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
        pack_format: pack_format.unwrap_or(15),
    };

    packer::generate_pack(&options).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::core::jobs::TranslationResult;

    fn make_result(key: &str, source: &str, target: &str, stype: &str) -> TranslationResult {
        TranslationResult {
            key: key.into(), source_text: source.into(), target_text: target.into(),
            mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: stype.into(),
        }
    }

    #[test]
    fn failed_entries_filtered_out_from_pack_generation() {
        let results = vec![
            make_result("good.key.1", "Hello", "你好", "llm"),
            make_result("bad.key.1", "%s items", "个物品", "failed"),
            make_result("good.key.2", "World", "世界", "dictionary"),
            make_result("bad.key.2", "Error text", "", "failed"),
        ];

        let valid: Vec<_> = results.into_iter().filter(|r| r.source_type != "failed").collect();

        assert_eq!(valid.len(), 2);
        assert!(valid.iter().all(|r| r.source_type != "failed"));
        assert!(valid.iter().any(|r| r.key == "good.key.1"));
        assert!(valid.iter().any(|r| r.key == "good.key.2"));
    }

    #[test]
    fn all_failed_entries_produces_empty_pack() {
        let results = vec![make_result("bad.key.1", "%s fail", "失败", "failed")];
        let valid: Vec<_> = results.into_iter().filter(|r| r.source_type != "failed").collect();
        assert_eq!(valid.len(), 0);
    }
}

#[tauri::command]
pub fn copy_pack_to_instance(
    pack_zip_path: String,
    instance_path: String,
    overwrite: bool,
) -> Result<packer::CopyResult, String> {
    info!("copy_pack_to_instance: pack={}, instance={}, overwrite={}", pack_zip_path, instance_path, overwrite);
    packer::copy_to_resourcepacks(&pack_zip_path, &instance_path, overwrite).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_pack_from_job(
    job_id: String,
    target_language: String,
    dry_run: bool,
) -> Result<packer::PackResult, String> {
    info!("generate_pack_from_job: job_id={}, target_language={}, dry_run={}", job_id, target_language, dry_run);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = crate::core::jobs::JobManager::new(root.clone());

    manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    let total_results = results.len();
    let valid_results: Vec<_> = results.into_iter().filter(|r| r.source_type != "failed").collect();
    let filtered_count = total_results - valid_results.len();
    if filtered_count > 0 {
        info!("过滤 {} 个失败条目 (任务 {})", filtered_count, job_id);
    }

    let entries: Vec<packer::PackEntry> = valid_results
        .into_iter()
        .map(|r| packer::PackEntry {
            mod_id: r.mod_id,
            key: r.key,
            text: r.target_text,
            source_text: r.source_text,
        })
        .collect();

    if entries.is_empty() {
        return Err(
            "翻译结果为空或所有条目均未通过校验，无法生成资源包".to_string(),
        );
    }

    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: format!("Aaalice-MC-Translator-{job_id}"),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
        pack_format: 15,
    };

    packer::generate_pack(&options).map_err(|e| e.to_string())
}
