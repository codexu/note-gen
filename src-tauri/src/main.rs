// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod fuzzy_search;
mod keywords;
mod window;
mod app_setup;
mod backup;
mod mcp;
mod mcp_runtime;
mod device;
mod skills;
mod tray;
mod ai;

use screenshot::{cleanup_temp_screenshot_dir, screenshot};
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::{rank_keywords};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use skills::import_skill_zip;
use mcp::{start_mcp_stdio_server, stop_mcp_server, send_mcp_message, McpServerManager};
use mcp_runtime::{cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager};
use device::get_device_id;
use ai::{ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request, cancel_ai_request, AiRequestManager};

fn main() {
    tauri::Builder::default()
        // 核心插件 - 最先加载
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(window::handle_single_instance))

        // MCP 服务器管理器
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())

        // 系统级插件
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())

        // UI 相关插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())

        // 功能插件
        .plugin(tauri_plugin_updater::Builder::new().build())

        // 注册命令处理器
        .invoke_handler(tauri::generate_handler![
            screenshot,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
        ])

        // 应用设置 - 在所有插件和命令注册后
        .setup(app_setup::setup_app)

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            tauri::RunEvent::Exit => {
                cleanup_temp_screenshot_dir(&app_handle);
            }
            _ => {}
        });
}
