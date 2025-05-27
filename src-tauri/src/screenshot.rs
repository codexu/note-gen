use tauri::{path::BaseDirectory, AppHandle, Manager};
use xcap::{image, Window};

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
pub fn screenshot(app: AppHandle) -> Vec<String> {
    let windows = Window::all().unwrap();

    let temp_screenshot_folder = app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
        .unwrap();
    
    std::fs::remove_dir_all(&temp_screenshot_folder).unwrap();
    std::fs::create_dir(&temp_screenshot_folder).unwrap();

    let mut file_names = Vec::new();

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
        file_names.push(path);

        i += 1;
    }
    file_names
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
