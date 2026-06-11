use crate::core::{packer, paths, settings};
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
pub async fn generate_pack_from_job(
    job_id: String,
    target_language: String,
    dry_run: bool,
    output_dir: Option<String>,
) -> Result<packer::PackResult, String> {
    info!("generate_pack_from_job: job_id={}, target_language={}, dry_run={}, output_dir={:?}", job_id, target_language, dry_run, output_dir);

    let result = tauri::async_runtime::spawn_blocking(move || {
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
            return Err("翻译结果为空或所有条目均未通过校验，无法生成资源包".to_string());
        }

        let output_dir = output_dir
            .map(|p| std::path::PathBuf::from(p))
            .unwrap_or_else(|| paths::build_output_dir(&root));
        std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

        // 从 settings 读取 outputPackName，替换占位符
        let root_path = root.clone();
        let build_name = {
            let s = settings::load_settings(&root_path).map_err(|e| format!("加载设置失败: {e}"))?;
            let has_placeholder = settings::has_mc_version_placeholder(&s.output_pack_name);
            let base = match settings::detect_mc_version(&s.instance_path) {
                Ok(ver) => settings::replace_version_placeholder(&s.output_pack_name, &ver),
                Err(e) if has_placeholder => {
                    return Err(format!(
                        "MC 版本检测失败，且 outputPackName 中包含 {{mc_version}} 占位符: {e}"
                    ));
                }
                Err(_) => s.output_pack_name.clone(),
            };
            // 追加简短日期戳，避免同一实例多次打包互相覆盖
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            // 使用低 32 位的秒级时间戳作为简短后缀（文件名安全：纯数字）
            let suffix = now & 0xFFFF_FFFF;
            format!("{base}-{suffix}")
        };

        let options = packer::PackOptions {
            target_language,
            entries,
            build_name,
            dry_run,
            output_dir: output_dir.to_string_lossy().to_string(),
            pack_format: 15,
            icon_path: None,
        };

        packer::generate_pack(&options).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("打包线程崩溃: {e}"))??;

    Ok(result)
}
