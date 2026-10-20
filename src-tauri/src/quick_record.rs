use tauri::{Manager, WebviewWindow};

#[cfg(target_os = "windows")]
mod foreground {
    use std::sync::Mutex;
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
            IsWindowVisible, SetForegroundWindow,
        },
    };

    // Store the process ID too: a closed window's handle can be reused.
    static PREVIOUS: Mutex<Option<(isize, u32)>> = Mutex::new(None);

    pub fn remember() {
        unsafe {
            let window = GetForegroundWindow();
            let mut process_id = 0;
            GetWindowThreadProcessId(window, Some(&mut process_id));
            if let Ok(mut previous) = PREVIOUS.lock() {
                *previous = (process_id != 0 && process_id != std::process::id())
                    .then_some((window.0 as isize, process_id));
            }
        }
    }

    pub fn restore() -> bool {
        let target = PREVIOUS.lock().ok().and_then(|mut previous| previous.take());
        let Some((handle, expected_process_id)) = target else {
            return false;
        };
        unsafe {
            let window = HWND(handle as *mut std::ffi::c_void);
            let mut process_id = 0;
            GetWindowThreadProcessId(window, Some(&mut process_id));
            process_id == expected_process_id
                && process_id != std::process::id()
                && IsWindow(window).as_bool()
                && IsWindowVisible(window).as_bool()
                && !IsIconic(window).as_bool()
                && SetForegroundWindow(window).as_bool()
        }
    }
}

#[tauri::command]
pub fn remember_quick_record_foreground(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can prepare quick recording".into());
    }
    #[cfg(target_os = "windows")]
    {
        // Repeated shortcuts while recording must preserve the original target.
        let recording = window.app_handle().get_webview_window("quick-record")
            .is_some_and(|quick| quick.is_focused().unwrap_or(false));
        if !recording {
            foreground::remember();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_quick_record_window(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "quick-record" {
        return Err("Only the quick record window can dismiss itself".into());
    }
    // Do not steal focus when a save finishes after the user switches windows.
    if window.is_focused().map_err(|error| error.to_string())? {
        #[cfg(target_os = "macos")]
        window.app_handle().hide().map_err(|error| error.to_string())?;

        #[cfg(not(target_os = "macos"))]
        {
            #[cfg(target_os = "windows")]
            let restored = foreground::restore();
            #[cfg(not(target_os = "windows"))]
            let restored = false;

            // If the previous app closed or Windows refuses activation, keep
            // NoteGen's other windows from becoming the activation fallback.
            if !restored {
                for other in window.app_handle().webview_windows().values() {
                    if other.label() != "quick-record" {
                        other.hide().map_err(|error| error.to_string())?;
                    }
                }
            }
        }
    }
    window.hide().map_err(|error| error.to_string())
}
