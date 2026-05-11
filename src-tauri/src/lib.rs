mod commands;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(commands::DownloadJobs(Arc::new(Mutex::new(HashMap::new()))))
        .manage(commands::ExportJobs(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![
            commands::start_download,
            commands::cancel_download,
            commands::export_project,
            commands::cancel_export,
            commands::pick_folder_and_grant,
            commands::pick_file_and_grant,
            commands::pick_files_and_grant,
            commands::restore_path_scope,
            commands::open_path_in_explorer,
            commands::extract_cover_art,
            commands::start_audio_analysis,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
