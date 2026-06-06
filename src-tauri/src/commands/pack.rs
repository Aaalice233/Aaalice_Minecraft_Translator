use crate::core::{packer, paths};

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn generate_translation_pack(
    entries: Vec<packer::PackEntry>,
    target_language: String,
    dry_run: bool,
    pack_format: Option<u32>,
) -> Result<packer::PackResult, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(to_message)?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: "Aaalice-MC-Translator".to_string(),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
        pack_format: pack_format.unwrap_or(15),
    };

    packer::generate_pack(&options).map_err(to_message)
}

#[tauri::command]
pub fn copy_pack_to_instance(
    pack_zip_path: String,
    instance_path: String,
    overwrite: bool,
) -> Result<packer::CopyResult, String> {
    packer::copy_to_resourcepacks(&pack_zip_path, &instance_path, overwrite).map_err(to_message)
}

#[tauri::command]
pub fn generate_pack_from_job(
    job_id: String,
    target_language: String,
    dry_run: bool,
) -> Result<packer::PackResult, String> {
    let root = paths::runtime_root().map_err(to_message)?;
    let manager = crate::core::jobs::JobManager::new(root.clone());

    let _job = manager
        .load(&job_id)?
        .ok_or_else(|| format!("翻译任务 {job_id} 未找到"))?;

    let results = manager.load_results(&job_id)?;

    let entries: Vec<packer::PackEntry> = results
        .into_iter()
        .map(|r| packer::PackEntry {
            mod_id: r.mod_id,
            key: r.key,
            text: r.target_text,
            source_text: r.source_text,
        })
        .collect();

    if entries.is_empty() {
        return Err("翻译结果为空，无法生成资源包".to_string());
    }

    let output_dir = paths::build_output_dir(&root);
    std::fs::create_dir_all(&output_dir).map_err(to_message)?;

    let options = packer::PackOptions {
        target_language,
        entries,
        build_name: format!("Aaalice-MC-Translator-{job_id}"),
        dry_run,
        output_dir: output_dir.to_string_lossy().to_string(),
        pack_format: 15,
    };

    packer::generate_pack(&options).map_err(to_message)
}
