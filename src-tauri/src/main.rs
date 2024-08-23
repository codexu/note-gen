// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
use screenshot::screenshot_path;
mod keyword;
use keyword::cut_words;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent};
use tauri::SystemTrayMenu;

fn main() {
    let screenshot_item = CustomMenuItem::new("screenshot".to_string(), "记录");
    let quit_item = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(screenshot_item)
        .add_item(quit_item);
   
    let tray = SystemTray::new().with_menu(tray_menu);
    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                  "quit" => {
                    std::process::exit(0);
                  }
                  "screenshot" => {
                    app.emit_all("screenshot", ()).unwrap();
                  }
                  _ => {}
                }
              }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![screenshot_path, cut_words])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
