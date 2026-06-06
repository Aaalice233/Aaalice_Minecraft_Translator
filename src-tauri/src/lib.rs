// Rust 1.96.0 (RFC 3614) 将 .<identifier>" 解析为 prefix literal。
// 本 crate 在字符串中广泛使用 .json / .lang / .jar / .zip 等扩展名，
// 这些是非意图的 prefix literal 触发。通过 lint 允许统一抑制。
#![allow(unknown_lints, rust_2021_prefixes_incompatible_syntax)]

pub mod commands;
pub mod core;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Limit rayon to 4 threads so UI thread doesn't starve during parallel scan
    rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build_global()
        .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::LogOffset(std::sync::Mutex::new(0)))
        .setup(|_app| {
            let root = core::paths::runtime_root()?;
            core::logging::init_main_log(&root)?;
            let _ = core::paths::clear_scan_cache(&root);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_instance,
            commands::scan_instance,
            commands::cancel_scan,
            commands::pick_instance_folder,
            commands::open_path,
            commands::fetch_llm_models,
            commands::list_fonts,
            commands::read_logs,
            // P2: Dictionary
            commands::search_dictionary,
            commands::update_dictionary_entry,
            commands::delete_dictionary_entry,
            commands::export_dictionary,
            commands::import_dictionary,
            commands::get_dictionary_stats,
            // P4: Pack
            commands::generate_translation_pack,
            commands::copy_pack_to_instance,
            // Translation
            commands::start_translation,
            commands::cancel_translation,
            commands::clear_jobs_cache,
            commands::get_translation_job,
            commands::load_latest_translation_job,
            commands::validate_translation,
            commands::generate_pack_from_job,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aaalice MC Translator");
}
