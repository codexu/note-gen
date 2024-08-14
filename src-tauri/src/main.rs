// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent};
use tauri::SystemTrayMenu;

// 截图
use base64::{engine::general_purpose, Engine as _};
use screenshots::Screen;

#[tauri::command]
fn screenshot_base64() -> String {
    let screen = Screen::from_point(100, 100).unwrap();
    let image = screen
        .capture().unwrap();
    let buffer = image.buffer();
    let base64_str = general_purpose::STANDARD_NO_PAD.encode(buffer);
    base64_str
}

// 关键词提取
use jieba_rs::Jieba;
use jieba_rs::{TfIdf, KeywordExtract};
#[tauri::command]
fn cut_words(str: String) -> Vec<String> {
    let jieba = Jieba::new();
    let keyword_extractor = TfIdf::default();
    let top_key = keyword_extractor.extract_keywords(
        &jieba,
        &str,
        5,
        vec![],
    );
    top_key.iter().map(|x| x.keyword.clone()).collect()
}

fn main() {
    let screenshot = CustomMenuItem::new("screenshot".to_string(), "记录");
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(screenshot)
        .add_item(quit);
   
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
        .invoke_handler(tauri::generate_handler![screenshot_base64, cut_words])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
