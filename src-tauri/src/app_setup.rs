use tauri::App;
#[cfg(target_os = "windows")]
use tauri::Manager;
use crate::screenshot::cleanup_temp_screenshot_dir;
use crate::window;
use crate::tray::create_tray;
use crate::file_open;

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    cleanup_temp_screenshot_dir(&app_handle);

    // 在 Windows 上明确禁用窗口装饰
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_decorations(false);
            let _ = window.set_title("NoteGen");
        }
    }

    // 设置窗口事件监听器
    window::setup_window_events(&app_handle)?;

    // 创建系统托盘
    let _tray = create_tray(&app_handle)?;

    file_open::handle_initial_open_files(&app_handle);

    Ok(())
}
