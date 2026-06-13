use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};
use tracing::info;

use crate::core::models::{Settings, StageStatus, WarmupPhase, WarmupProgress};
use crate::core::{paths, settings};

/// Global cancellation flag shared across warmup phases.
static WARMUP_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Track whether we've done a full warmup before (file marker).
fn first_launch_marker_path(root: &std::path::Path) -> PathBuf {
    root.join("data").join(".warmup_done")
}

fn is_first_launch(root: &std::path::Path) -> bool {
    !first_launch_marker_path(root).exists()
}

fn mark_warmup_done(root: &std::path::Path) {
    let path = first_launch_marker_path(root);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, b"1");
}

/// Phase 1: Load and validate settings (0–25%)
fn phase_settings(root: &PathBuf, app: &AppHandle) -> Result<Settings, String> {
    info!("Warmup Phase 1: 加载设置");
    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Settings,
            percent: 5,
            status: StageStatus::Running,
            message: Some("加载设置…".to_string()),
            error: None,
        },
    );

    let settings = settings::load_settings(root).map_err(|e| format!("加载设置失败: {e}"))?;

    // Brief pause to let the animation breathe
    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Settings,
            percent: 25,
            status: StageStatus::Completed,
            message: Some("设置已加载".to_string()),
            error: None,
        },
    );

    Ok(settings)
}

/// Phase 2: Validate local metadata (instance path, mods directory) (25–50%)
fn phase_local(settings: &Settings, app: &AppHandle) -> Result<(), String> {
    info!("Warmup Phase 2: 验证本地元数据");

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Local,
            percent: 28,
            status: StageStatus::Running,
            message: Some("验证实例路径…".to_string()),
            error: None,
        },
    );

    if !settings.instance_path.is_empty() {
        let instance = std::path::Path::new(&settings.instance_path);
        if !instance.exists() {
            info!("实例路径不存在: {}", settings.instance_path);
        } else {
            // Check mods directory
            let mods_dir = instance.join("mods");
            if mods_dir.exists() {
                info!("实例 mods 目录存在: {}", mods_dir.display());
            }
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Local,
            percent: 50,
            status: StageStatus::Completed,
            message: Some("本地元数据已加载".to_string()),
            error: None,
        },
    );

    Ok(())
}

/// Phase 3: Open and verify dictionary database (50–75%)
fn phase_dictionary(root: &PathBuf, app: &AppHandle) -> Result<(), String> {
    info!("Warmup Phase 3: 词典预热");

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Dictionary,
            percent: 55,
            status: StageStatus::Running,
            message: Some("打开词典数据库…".to_string()),
            error: None,
        },
    );

    let db_path = paths::dictionary_db_path(root);
    let db_exists = db_path.exists();

    // Try to open the database to verify it's valid
    match rusqlite::Connection::open(&db_path) {
        Ok(conn) => {
            // Verify the schema exists
            let table_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dictionary_entries'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| format!("词典数据库查询失败: {e}"))?;

            if table_count > 0 {
                let has_entry = conn
                    .query_row("SELECT 1 FROM dictionary_entries LIMIT 1", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .is_ok();
                info!("词典就绪: has_entry={has_entry} (新建: {})", !db_exists);
            }
        }
        Err(e) => {
            // If DB doesn't exist yet, that's fine — it'll be created on first use
            if db_exists {
                info!("词典数据库存在但无法打开: {e} — 将在首次使用时重建");
            } else {
                info!("词典数据库尚未创建，将在首次使用时初始化");
            }
        }
    }

    info!("预热跳过内置 i18n 模组词典导入，可在设置页手动检查并更新");

    // Brief pause
    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Dictionary,
            percent: 75,
            status: StageStatus::Completed,
            message: Some("词典已就绪".to_string()),
            error: None,
        },
    );

    Ok(())
}

/// Phase 4: Quick LLM connectivity check / model fetch (75–100%)
/// On subsequent launches, skip the HTTP model fetch (already cached).
fn phase_llm(settings: &Settings, app: &AppHandle, is_first: bool) -> Result<(), String> {
    info!("Warmup Phase 4: LLM 连接检查");

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Llm,
            percent: 80,
            status: StageStatus::Running,
            message: Some("验证 LLM 配置…".to_string()),
            error: None,
        },
    );

    // Build a minimal client just for validation
    if settings.api_key.is_empty() || settings.base_url.is_empty() {
        info!("LLM 未配置完整，跳过连接检查");
        let _ = app.emit(
            "warmup-progress",
            WarmupProgress {
                phase: WarmupPhase::Llm,
                percent: 95,
                status: StageStatus::Completed,
                message: Some("LLM 未配置".to_string()),
                error: None,
            },
        );
        return Ok(());
    }

    let client = crate::core::llm::LlmClient {
        base_url: settings.base_url.clone(),
        api_key: settings.api_key.clone(),
        model: settings.model.clone(),
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        concurrency: 1,
        batch_size: 1,
        retry_count: 1,
        timeout_secs: 10,
        system_prompt: String::new(),
        http_client: crate::core::llm::LlmClient::build_http_client(10),
        effective_concurrency: std::sync::atomic::AtomicUsize::new(1),
        consecutive_429s: std::sync::atomic::AtomicUsize::new(0),
    };

    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Llm,
            percent: 85,
            status: StageStatus::Running,
            message: Some("检查 LLM 连接…".to_string()),
            error: None,
        },
    );

    match client.validate() {
        Ok(()) => {
            if is_first {
                // Only fetch model list on first launch (cached afterwards)
                info!("LLM 配置有效，正在获取模型列表 (首次启动)…");
                let fetch_result = crate::commands::llm::fetch_llm_models_internal(
                    settings.base_url.clone(),
                    settings.api_key.clone(),
                );
                match fetch_result {
                    Ok(_) => info!("LLM 模型列表获取成功"),
                    Err(e) => info!("LLM 模型列表获取失败 (非阻塞): {e}"),
                }
            } else {
                info!("LLM 配置有效，跳过模型列表 (后续启动)");
            }

            let _ = app.emit(
                "warmup-progress",
                WarmupProgress {
                    phase: WarmupPhase::Llm,
                    percent: 98,
                    status: StageStatus::Completed,
                    message: Some("LLM 已就绪".to_string()),
                    error: None,
                },
            );
        }
        Err(e) => {
            info!("LLM 配置验证未通过: {e}");
            let _ = app.emit(
                "warmup-progress",
                WarmupProgress {
                    phase: WarmupPhase::Llm,
                    percent: 95,
                    status: StageStatus::Completed,
                    message: Some("LLM 离线模式".to_string()),
                    error: Some(e),
                },
            );
        }
    }

    Ok(())
}

/// Emit a final completed event so the frontend can transition out of splash.
fn emit_completed(app: &AppHandle) {
    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase: WarmupPhase::Completed,
            percent: 100,
            status: StageStatus::Completed,
            message: Some("预热完成".to_string()),
            error: None,
        },
    );
}

/// Emit a failed-phase progress event.
fn emit_failed(app: &AppHandle, phase: WarmupPhase, percent: u8, error: String) {
    let _ = app.emit(
        "warmup-progress",
        WarmupProgress {
            phase,
            percent,
            status: StageStatus::Failed,
            message: None,
            error: Some(error),
        },
    );
}

/// Check cancellation flag and emit completed if cancelled.
fn check_cancelled(app: &AppHandle) -> bool {
    if WARMUP_CANCELLED.load(Ordering::SeqCst) {
        info!("预热已取消");
        emit_completed(app);
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn run_warmup(app: AppHandle) -> Result<(), String> {
    info!("run_warmup: 开始预热");

    // Reset cancellation flag
    WARMUP_CANCELLED.store(false, Ordering::SeqCst);

    // Resolve root path
    let root = paths::runtime_root().map_err(|e| format!("无法获取运行根路径: {e}"))?;
    let first = is_first_launch(&root);
    info!("首次启动: {first}");

    // ── Phase 1: Settings ──
    let settings = match phase_settings(&root, &app) {
        Ok(s) => s,
        Err(e) => {
            info!("设置阶段失败 (非阻塞): {e}");
            emit_failed(&app, WarmupPhase::Settings, 25, e.clone());
            // Still continue with default settings
            Settings::default()
        }
    };

    if check_cancelled(&app) {
        return Ok(());
    }

    // ── Phase 2: Local metadata ──
    if let Err(e) = phase_local(&settings, &app) {
        info!("本地元数据阶段失败 (非阻塞): {e}");
        emit_failed(&app, WarmupPhase::Local, 50, e);
    }

    if check_cancelled(&app) {
        return Ok(());
    }

    // ── Phase 3: Dictionary ──
    if let Err(e) = phase_dictionary(&root, &app) {
        info!("词典阶段失败 (非阻塞): {e}");
        emit_failed(&app, WarmupPhase::Dictionary, 75, e);
    }

    if check_cancelled(&app) {
        return Ok(());
    }

    // ── Phase 4: LLM ──
    if let Err(e) = phase_llm(&settings, &app, first) {
        info!("LLM 阶段失败 (非阻塞): {e}");
        emit_failed(&app, WarmupPhase::Llm, 100, e);
    }

    // Mark warmup as done for subsequent launches
    mark_warmup_done(&root);

    // Final completed event
    emit_completed(&app);

    info!("run_warmup: 预热完成");
    Ok(())
}

#[tauri::command]
pub fn cancel_warmup() -> Result<(), String> {
    info!("cancel_warmup");
    WARMUP_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}
