use tauri::{path::BaseDirectory, AppHandle, Manager};
use xcap::{image, Monitor};

#[allow(dead_code)]
#[tauri::command]
pub fn screenshot(app: AppHandle) -> String {
    let monitors = Monitor::all().unwrap();
    let mut path = String::new();
    for monitor in monitors {
        let current_monitor = app
            .get_webview_window("main")
            .unwrap()
            .current_monitor()
            .unwrap()
            .unwrap();
        let current_monitor_name = current_monitor.name().unwrap().to_string();

        if monitor.name() == current_monitor_name {
            let image = monitor.capture_image().unwrap();
            // 获取 app data 目录
            let file_path = app
                .path()
                .resolve("temp_screenshot.png", BaseDirectory::AppData)
                .unwrap();
            image.save(&file_path).unwrap();
            path = file_path.to_str().unwrap().to_string();
        };
    }
    path
    /* `std::string::String` value */
}

#[allow(dead_code)]
#[tauri::command]
pub fn screenshot_save(app: AppHandle, x: u32, y: u32, width: u32, height: u32) -> String {
    let file_path = app
        .path()
        .resolve("temp_screenshot.png", BaseDirectory::AppData)
        .unwrap();
    let image = image::open(&file_path).unwrap();
    let image = image.crop_imm(x, y, width, height);
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let save_path = app
        .path()
        .resolve(
            format!("screenshot/{}.png", &timestamp),
            BaseDirectory::AppData,
        )
        .unwrap();
    image.save(&save_path).unwrap();
    std::fs::remove_file(&file_path).unwrap();
    let file_name = format!("{}.png", timestamp);
    file_name
}
