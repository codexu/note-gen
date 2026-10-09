use tauri::{path::BaseDirectory, AppHandle, Manager};
use xcap::Window;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ScreenshotImage {
    name: String,
    path: String,
    source: String,
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

pub fn cleanup_temp_screenshot_dir(app: &AppHandle) {
    if let Ok(temp_screenshot_folder) = app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
    {
        if std::fs::metadata(&temp_screenshot_folder).is_ok() {
            let _ = std::fs::remove_dir_all(&temp_screenshot_folder);
        }
    }
}

#[allow(dead_code)]
#[tauri::command]
pub fn screenshot(app: AppHandle) -> Result<Vec<ScreenshotImage>, String> {
    #[cfg(target_os = "macos")]
    {
        let access = core_graphics::access::ScreenCaptureAccess;
        if !access.preflight() && !access.request() {
            return Err("SCREEN_CAPTURE_PERMISSION_REQUIRED".to_string());
        }
    }

    let temp_screenshot_folder = app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve screenshot cache directory: {error}"))?;
    cleanup_temp_screenshot_dir(&app);
    std::fs::create_dir_all(&temp_screenshot_folder)
        .map_err(|error| format!("Failed to create screenshot cache directory: {error}"))?;

    let mut files: Vec<ScreenshotImage> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    let windows = match Window::all() {
        Ok(windows) => windows,
        Err(error) => {
            errors.push(format!("Failed to list windows: {error}"));
            Vec::new()
        }
    };
    let mut i = 0;
    for window in windows {
        // 已最小化的窗口跳过
        if window.is_minimized().unwrap_or(true) {
            continue;
        }

        // 获取窗口属性
        let title = window.title().unwrap_or_default();
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        let x = window.x().unwrap_or(0);
        let y = window.y().unwrap_or(0);
        let z = window.z().unwrap_or(0);
        let system_titles = vec![
            "Dock",
            "Menu Bar",
            "MenuBar",
            "Status",
            "Notification Center",
            "",
            "Desktop",
            "NoteGen",
        ];

        if system_titles.contains(&title.as_str()) || title.len() < 2 || width < 150 || height < 150
        {
            continue;
        }

        let image = match window.capture_image() {
            Ok(image) => image,
            Err(error) => {
                println!("窗口截图失败: {:?}: {:?}", title, error);
                continue;
            }
        };
        let path = format!(
            "{}/window-{}-{}.png",
            temp_screenshot_folder.display(),
            i,
            normalized(&title)
        );
        match image.save(&path) {
            Ok(_) => println!("保存成功: {:?}", path),
            Err(e) => println!("保存失败: {:?}", e),
        };
        files.push(ScreenshotImage {
            name: title,
            path,
            source: "window".to_string(),
            width,
            height,
            x,
            y,
            z,
        });

        i += 1;
    }

    if files.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }

    Ok(files)
}
