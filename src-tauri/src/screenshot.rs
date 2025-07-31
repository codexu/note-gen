use tauri::{path::BaseDirectory, AppHandle, Manager};
use xcap::{Window};

#[cfg(target_os = "macos")]
use core_graphics::display::CGDisplay;

#[derive(serde::Serialize, serde::Deserialize)]
#[derive(Clone)]
pub struct ScreenshotImage {
    name: String,
    path: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    z: i32,
}

fn normalized(s: &str) -> String {
    s.replace(" ", "-")
    .replace("/", "-")
    .replace("\\", "-")
    .replace("*", "-")
    .replace("?", "-")
    .replace(":", "-")
    .replace("<", "-")
    .replace(">", "-")
    .replace("|", "-")
}

#[allow(dead_code)]
#[tauri::command]
pub fn screenshot(app: AppHandle) -> Vec<ScreenshotImage> {
    #[cfg(target_os = "macos")]
    {
        let display = CGDisplay::main();
        let _ = display.image();
    }
    
    let windows = Window::all().unwrap();

    let temp_screenshot_folder = app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
        .unwrap();
    if std::fs::metadata(&temp_screenshot_folder).is_ok() {
        std::fs::remove_dir_all(&temp_screenshot_folder).unwrap();
    }
    std::fs::create_dir(&temp_screenshot_folder).unwrap();

    let mut files: Vec<ScreenshotImage> = Vec::new();

    let mut i = 0;
    for window in windows {
        // 已最小化的窗口跳过
        if window.is_minimized().unwrap() {
            continue;
        }
        
        // 获取窗口属性
        let title = window.title().unwrap_or_default();
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        let x = window.x().unwrap_or(0);
        let y = window.y().unwrap_or(0);
        let z = window.z().unwrap_or(0);
        let system_titles = vec!["Dock", "Menu Bar", "MenuBar", "Status", "Notification Center", "", "Desktop", "NoteGen"];
        
        if system_titles.contains(&title.as_str()) || 
           title.len() < 2 ||
           width < 150 || 
           height < 150 {
            continue;
        }
        
        let image = window.capture_image().unwrap();
        let path = format!(
            "{}/window-{}-{}.png",
            temp_screenshot_folder.display(),
            i,
            normalized(&window.title().unwrap())
        );
        match image.save(&path) {
            Ok(_) => println!("保存成功: {:?}", path),
            Err(e) => println!("保存失败: {:?}", e),
        };
        files.push(ScreenshotImage {
            name: title,
            path,
            width,
            height,
            x,
            y,
            z,
        });

        i += 1;
    }
    files
}
