// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod screenshot;
use screenshot::{screenshot};
mod webdav;
mod fuzzy_search;
mod keywords;
use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use webdav::{webdav_backup, webdav_sync, webdav_test};
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::{rank_keywords};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let is_visible = window.is_visible().unwrap_or(false);
                let is_minimized = window.is_minimized().unwrap_or(false);
                if !is_visible {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_always_on_top(false);
                } else if is_minimized {
                    let _ = window.unminimize();
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_always_on_top(false);
                } else {
                    let _ = window.set_focus();
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_always_on_top(false);
                }
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_minimized = window.is_minimized().unwrap_or(false);
                            if !is_visible {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.set_always_on_top(true);
                                let _ = window.set_always_on_top(false);
                            } else if is_minimized {
                                let _ = window.unminimize();
                                std::thread::sleep(std::time::Duration::from_millis(100));
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.set_always_on_top(true);
                                let _ = window.set_always_on_top(false);
                            } else {
                                let _ = window.hide();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard::init())
        .invoke_handler(tauri::generate_handler![
            screenshot,
            webdav_test,
            webdav_backup,
            webdav_sync,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
