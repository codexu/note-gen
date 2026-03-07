mod mcp;
mod device;
mod backup;
mod skills;

use mcp::{start_mcp_stdio_server, stop_mcp_server, send_mcp_message, McpServerManager};
use device::get_device_id;
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use skills::import_skill_zip;

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
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            get_device_id,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
