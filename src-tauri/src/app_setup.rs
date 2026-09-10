use crate::file_open;
use crate::local_mcp;
use crate::plugins;
use crate::screenshot::cleanup_temp_screenshot_dir;
use crate::tray::create_tray;
use crate::web_clipper;
use crate::window;
use tauri::App;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use tauri::Manager;

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    cleanup_temp_screenshot_dir(&app_handle);
    plugins::cleanup_plugin_artifacts(&app_handle);

    // 在 Windows 和 Linux 上明确禁用系统窗口装饰，使用自定义标题栏
    #[cfg(any(target_os = "windows", target_os = "linux"))]
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

    window::apply_startup_visibility(&app_handle);

    file_open::handle_initial_open_files(&app_handle);

    web_clipper::start_server(&app_handle);
    local_mcp::start_server(&app_handle);

    Ok(())
}
