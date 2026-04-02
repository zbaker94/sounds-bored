mod commands;

use std::collections::HashMap;
use std::sync::Mutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(commands::DownloadJobs(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::start_download,
            commands::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet_with_name() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_with_empty_string() {
        let result = greet("");
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_with_special_characters() {
        let result = greet("@#$%");
        assert_eq!(result, "Hello, @#$%! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_with_unicode() {
        let result = greet("世界");
        assert_eq!(result, "Hello, 世界! You've been greeted from Rust!");
    }

    #[test]
    fn test_greet_with_long_name() {
        let long_name = "a".repeat(1000);
        let result = greet(&long_name);
        assert!(result.starts_with("Hello, "));
        assert!(result.ends_with("! You've been greeted from Rust!"));
        assert!(result.contains(&long_name));
    }
}
