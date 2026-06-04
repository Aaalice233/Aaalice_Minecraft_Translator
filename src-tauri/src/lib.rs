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
        .setup(|_app| {
            core::logging::init_main_log(&core::paths::runtime_root()?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_instance,
            commands::scan_instance,
            commands::open_path,
            commands::fetch_llm_models
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aaalice MC Translator");
}
