mod webdav;
use webdav::{webdav_backup, webdav_create_dir, webdav_sync, webdav_test};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            webdav_test,
            webdav_backup,
            webdav_sync,
            webdav_create_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
