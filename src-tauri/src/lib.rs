mod webdav;
mod mcp;

use webdav::{webdav_backup, webdav_create_dir, webdav_sync, webdav_test};
use mcp::{start_mcp_stdio_server, stop_mcp_server, send_mcp_message, McpServerManager};

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
        .manage(McpServerManager::new())
        .invoke_handler(tauri::generate_handler![
            webdav_test,
            webdav_backup,
            webdav_sync,
            webdav_create_dir,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
