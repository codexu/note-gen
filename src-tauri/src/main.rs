// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, SystemTray, SystemTrayEvent};
use tauri::SystemTrayMenu;

// 截图
use base64::{engine::general_purpose, Engine as _};
use screenshots::Screen;

#[tauri::command]
fn screenshot() -> String {
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
    let tray_menu = SystemTrayMenu::new();
    let tray = SystemTray::new().with_menu(tray_menu);
    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick {
              position: _,
              size: _,
              ..
            } => {
                println!("system tray received a left click");
                app.emit_all("left_click", ()).unwrap();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![screenshot, cut_words])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
