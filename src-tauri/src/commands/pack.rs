use crate::core::{dictionary, packer, paths};
use tracing::info;



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
    update_dictionary: bool,
) -> Result<packer::PackResult, String> {
    info!("generate_pack_from_job: job_id={}, target_language={}, dry_run={}, update_dictionary={}", job_id, target_language, dry_run, update_dictionary);
    let root = paths::runtime_root().map_err(|e| e.to_string())?;
    let manager = crate::core::jobs::JobManager::new(root.clone());

    manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    // ── Save LLM/reviewed results to dictionary if requested ──
    if update_dictionary && !dry_run {
        let dict_db_path = paths::dictionary_db_path(&root);
        let conn = dictionary::open(&dict_db_path).map_err(|e| format!("打开词典失败: {e}"))?;
        let (inserted, updated) = dictionary::save_llm_results_to_dictionary(&conn, &results, &target_language)
            .map_err(|e| format!("保存到词典失败: {e}"))?;
        info!("词典更新: 新增 {inserted} 条, 更新 {updated} 条 (任务 {job_id})");
    }

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
