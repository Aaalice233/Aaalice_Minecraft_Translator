use crate::core::{packer, paths, settings};
use tracing::info;

#[tauri::command]
pub fn copy_pack_to_instance(
    pack_zip_path: String,
    instance_path: String,
    overwrite: bool,
) -> Result<packer::CopyResult, String> {
    info!(
        "copy_pack_to_instance: pack={}, instance={}, overwrite={}",
        pack_zip_path, instance_path, overwrite
    );
    packer::copy_to_resourcepacks(&pack_zip_path, &instance_path, overwrite)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_pack_from_job(
    job_id: String,
    target_language: String,
    dry_run: bool,
    output_dir: Option<String>,
) -> Result<packer::PackResult, String> {
    info!(
        "generate_pack_from_job: job_id={}, target_language={}, dry_run={}, output_dir={:?}",
        job_id, target_language, dry_run, output_dir
    );

    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = paths::runtime_root().map_err(|e| e.to_string())?;
        let manager = crate::core::jobs::JobManager::new(root.clone());

        let job = manager.refresh_counts_from_results(&job_id)?;
        if job.failed_entries > 0 {
            return Err(format!(
                "翻译任务 {job_id} 仍有 {} 条失败或缺失条目，无法生成资源包",
                job.failed_entries
            ));
        }
        let scan_summary = manager
            .load_scan_summary(&job.scan_job_id)
            .map_err(|e| format!("读取翻译任务关联扫描结果失败: {e}"))?;

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
            return Err("翻译结果为空或所有条目均未通过校验，无法生成资源包".to_string());
        }

        let output_dir = output_dir
            .map(|p| std::path::PathBuf::from(p))
            .unwrap_or_else(|| paths::build_output_dir(&root));
        std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

        // 从 settings 读取 outputPackName，替换占位符
        let root_path = root.clone();
        let (build_name, pack_format) = {
            let s =
                settings::load_settings(&root_path).map_err(|e| format!("加载设置失败: {e}"))?;
            let instance_path = scan_summary.instance_path.as_str();
            match settings::detect_mc_version(instance_path) {
                Ok(ver) => (
                    settings::replace_version_placeholder(&s.output_pack_name, &ver),
                    packer::pack_format_for_mc_version(&ver),
                ),
                Err(e) => return Err(format!("MC 版本检测失败，无法确定资源包 pack_format: {e}")),
            }
        };

        let options = packer::PackOptions {
            target_language,
            entries,
            build_name,
            dry_run,
            output_dir: output_dir.to_string_lossy().to_string(),
            pack_format,
            icon_path: None,
        };

        packer::generate_pack(&options).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("打包线程崩溃: {e}"))??;

    Ok(result)
}
