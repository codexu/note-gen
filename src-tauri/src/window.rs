use tauri::{Manager, WindowEvent, AppHandle};

pub fn setup_window_events(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            handle_window_event(event, &window_clone, &app_handle);
        });
    }
    Ok(())
}

fn handle_window_event(event: &WindowEvent, window: &tauri::WebviewWindow, app_handle: &AppHandle) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // 阻止默认关闭行为
            api.prevent_close();
            
            #[cfg(target_os = "macos")]
            {
                // 检查是否处于全屏状态，如果是则先退出全屏
                if let Ok(is_fullscreen) = window.is_fullscreen() {
                    if is_fullscreen {
                        let _ = window.set_fullscreen(false);
                        // 等待退出全屏动画完成
                        std::thread::sleep(std::time::Duration::from_millis(300));
                    }
                }
            }
            
            // 隐藏窗口到托盘
            let _ = window.hide();
            #[cfg(target_os = "macos")]
            let _ = app_handle.hide();
        }
        _ => {}
    }
}

pub fn handle_single_instance(app: &AppHandle, _argv: Vec<String>, _cwd: String) {
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
}

#[cfg(target_os = "macos")]
pub fn handle_macos_reopen(app_handle: &AppHandle, has_visible_windows: bool) {
    if !has_visible_windows {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = app_handle.show();
        }
    }
}
