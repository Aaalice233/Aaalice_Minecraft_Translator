use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};

use tauri::Emitter;

use crate::core::{
    models::{InstanceValidation, LlmModel, LlmModelsResponse, ScanProgress, ScanSummary, Settings},
    paths, scanner, settings,
};

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    settings::load_settings(&paths::runtime_root().map_err(to_message)?).map_err(to_message)
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    settings::save_settings(&paths::runtime_root().map_err(to_message)?, &settings)
        .map_err(to_message)
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
    // Reset cancel flag for this scan
    SCAN_CANCEL.store(false, Ordering::SeqCst);

    let root = paths::runtime_root().map_err(to_message)?;

    // Channel: relay progress from blocking/rayon threads → async runtime context.
    // This avoids calling app.emit() from inside rayon's thread pool (which may
    // not reliably deliver events to the webview on Windows).
    let (progress_tx, progress_rx) = mpsc::channel::<ScanProgress>();
    let progress_tx_scan = progress_tx.clone();

    // Spawn a reader that receives progress from the channel and emits events
    // from a tokio blocking thread (not from rayon's thread pool), ensuring
    // events reliably reach the webview on Windows.
    let app_emit = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = progress_rx.recv() {
            if let Err(err) = app_emit.emit("scan-progress", &progress) {
                eprintln!("scan-progress emit error: {err}");
            }
        }
    });

    // Read pack names from persisted settings for resource pack filtering
    let settings = settings::load_settings(&root).ok();
    let (i18n_pack_name, vm_pack_name) = settings
        .as_ref()
        .map(|s| (s.i18n_pack_name.clone(), s.vm_pack_name.clone()))
        .unwrap_or_default();

    // Run the actual scan on a blocking thread; the scanner sends progress
    // updates through the channel instead of calling emit directly.
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

    // Drop our sender so the channel closes, letting the reader task exit.
    drop(progress_tx);

    result.map_err(to_message)
}

/// Request cancellation of the current scan.
/// The current stage completes before the scan stops (stage-boundary cancel).
#[tauri::command]
pub fn cancel_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(path).map_err(to_message)
}

#[tauri::command]
pub fn fetch_llm_models(base_url: String, api_key: String) -> Result<LlmModelsResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(to_message)?;
    let urls = model_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let response = client
            .get(&url)
            .bearer_auth(&api_key)
            .send()
            .map_err(to_message);

        let Ok(response) = response else {
            last_error = "模型列表请求失败".to_string();
            continue;
        };

        if !response.status().is_success() {
            last_error = format!("模型列表请求失败：HTTP {}", response.status());
            continue;
        }

        let body: serde_json::Value = response.json().map_err(to_message)?;
        let models = body
            .get("data")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?.to_string();
                        let owned_by = item
                            .get("owned_by")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string();
                        Some(LlmModel { id, owned_by })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        return Ok(LlmModelsResponse {
            models,
            source_url: url,
        });
    }

    Err(if last_error.is_empty() {
        "未能拉取模型列表".to_string()
    } else {
        last_error
    })
}

fn to_message(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn model_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        vec![format!("{trimmed}/models")]
    } else {
        vec![format!("{trimmed}/models"), format!("{trimmed}/v1/models")]
    }
}
