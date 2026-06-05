use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

use crate::core::{
    models::{InstanceValidation, ScanProgress, ScanSummary},
    paths, scanner, settings,
};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[tauri::command]
pub fn validate_instance(path: String) -> Result<InstanceValidation, String> {
    scanner::validate_instance(path).map_err(to_message)
}

#[tauri::command]
pub async fn scan_instance(
    app: tauri::AppHandle,
    path: String,
    source_language: String,
    target_language: String,
) -> Result<ScanSummary, String> {
    SCAN_CANCEL.store(false, Ordering::SeqCst);

    let root = paths::runtime_root().map_err(to_message)?;
    let (progress_tx, progress_rx) = mpsc::channel::<ScanProgress>();
    let progress_tx_scan = progress_tx.clone();

    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("scan-progress", &progress) {
                eprintln!("scan-progress emit error: {err}");
            }
        }
    });

    let s = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = s
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    let root_for_save = root.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_instance(
            &root,
            path,
            source_language,
            target_language,
            i18n_pack_name,
            vm_pack_name,
            &SCAN_CANCEL,
            &|progress: ScanProgress| {
                let _ = progress_tx_scan.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    drop(progress_tx);
    let summary = result.map_err(to_message)?;

    if !summary.cancelled {
        if let Ok(json) = serde_json::to_string_pretty(&summary) {
            let job_path = paths::job_state_path(&root_for_save, &summary.job_id);
            if let Some(parent) = job_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(err) = std::fs::write(&job_path, json) {
                let _ = crate::core::logging::append_main(&root_for_save, format!("扫描结果写入失败 ({}): {err}", job_path.display()));
            }
        }
    }

    Ok(summary)
}

#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn pick_instance_folder(app: tauri::AppHandle, locale: Option<String>) -> Result<Option<String>, String> {
    let _ = locale;
    match app.dialog().file().set_title("选择实例").blocking_pick_folder() {
        Some(path) => {
            let path_str = path.into_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}
