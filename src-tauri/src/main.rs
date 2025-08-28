// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod webdav;
mod fuzzy_search;
mod keywords;
mod tray;
mod window;
mod app_setup;
mod backup;

use screenshot::{screenshot};
use webdav::{webdav_backup, webdav_sync, webdav_test, webdav_create_dir};
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::{rank_keywords};
use backup::{export_app_data, import_app_data};
use tauri::RunEvent;

fn main() {
    tauri::Builder::default()
        // 核心插件 - 最先加载
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(window::handle_single_instance))
        
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
            webdav_test,
            webdav_backup,
            webdav_sync,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
            webdav_create_dir,
            export_app_data,
            import_app_data,
        ])
        
        // 应用设置 - 在所有插件和命令注册后
        .setup(app_setup::setup_app)
        
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { has_visible_windows, .. } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            _ => {}
        });
}
