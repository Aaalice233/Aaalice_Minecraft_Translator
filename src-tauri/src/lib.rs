// Rust 1.96.0 (RFC 3614) 将 .<identifier>" 解析为 prefix literal。
// 本 crate 在字符串中广泛使用 .json / .lang / .jar / .zip 等扩展名，
// 这些是非意图的 prefix literal 触发。通过 lint 允许统一抑制。
#![allow(unknown_lints, rust_2021_prefixes_incompatible_syntax)]

pub mod commands;
pub mod core;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "show_main_window";
const TRAY_QUIT_ID: &str = "quit_app";

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        tracing::warn!("main window not found while handling tray show action");
        return;
    };

    if let Err(error) = window.show() {
        tracing::warn!(%error, "failed to show main window from tray");
        return;
    }

    if let Err(error) = window.set_focus() {
        tracing::warn!(%error, "failed to focus main window from tray");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Limit rayon to 4 threads so UI thread doesn't starve during parallel scan
    rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build_global()
        .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(commands::LogOffset(std::sync::Mutex::new((0, 0))))
        .setup(|app| {
            let root = core::paths::runtime_root()?;
            core::logging::init(&root)?;
            let _ = core::paths::clear_scan_cache(&root);

            let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Aaalice MC Translator")
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            } else {
                tracing::warn!("default window icon not found; tray icon may not render correctly");
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(app);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW_LABEL {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        tracing::warn!(%error, "failed to hide main window to tray");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_instance,
            commands::scan_instance,
            commands::scan_and_diff,
            commands::cancel_scan,
            commands::pick_instance_folder,
            commands::open_path,
            commands::fetch_llm_models,
            commands::check_llm_connection,
            commands::list_fonts,
            commands::read_logs,
            // P2: Dictionary
            commands::search_dictionary,
            commands::count_dictionary,
            commands::update_dictionary_entry,
            commands::delete_dictionary_entry,
            commands::delete_dictionary_selection,
            commands::clear_dictionary,
            commands::export_dictionary,
            commands::import_dictionary,
            commands::get_dictionary_stats,
            commands::check_i18n_dict_update,
            commands::update_i18n_dict,
            // P4: Pack
            commands::copy_pack_to_instance,
            // Translation
            commands::start_translation,
            commands::cancel_translation,
            commands::get_translation_job,
            commands::load_latest_translation_job,
            commands::load_latest_translation_job_meta,
            commands::validate_translation,
            commands::retry_failed_entries,
            commands::translate_single_entry,
            commands::load_translation_results,
            commands::load_translation_mod_summaries,
            commands::save_translation_entry,
            commands::mark_job_reviewed,
            commands::generate_pack_from_job,
            // Warmup
            commands::run_warmup,
            commands::cancel_warmup,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aaalice MC Translator");
}
