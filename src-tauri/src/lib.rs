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
        .setup(|_app| {
            core::logging::init_main_log(&core::paths::runtime_root()?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_instance,
            commands::scan_instance,
            commands::load_latest_scan_summary,
            commands::cancel_scan,
            commands::pick_instance_folder,
            commands::open_path,
            commands::fetch_llm_models,
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aaalice MC Translator");
}
