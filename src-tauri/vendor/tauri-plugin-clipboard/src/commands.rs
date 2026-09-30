use crate::Clipboard;
use tauri::{command, AppHandle, Runtime, State, Window};

#[command]
pub fn has_text<R: Runtime>(
    _app: AppHandle<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<bool, String> {
    clipboard.has_text()
}

#[command]
pub fn has_image<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<bool, String> {
    clipboard.has_image()
}

#[command]
pub fn has_html<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<bool, String> {
    clipboard.has_html()
}

#[command]
pub fn has_rtf<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<bool, String> {
    clipboard.has_rtf()
}

#[command]
pub fn has_files<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<bool, String> {
    clipboard.has_files()
}

#[command]
pub fn available_types(
    clipboard: State<'_, Clipboard>,
) -> Result<crate::desktop::AvailableTypes, String> {
    clipboard.available_types()
}

#[command]
pub fn read_text<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<String, String> {
    clipboard.read_text()
}

#[command]
pub fn read_html<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<String, String> {
    clipboard.read_html()
}

#[command]
pub fn read_rtf<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<String, String> {
    clipboard.read_rtf()
}

#[command]
pub fn read_files<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<Vec<String>, String> {
    clipboard.read_files()
}

#[command]
pub fn read_files_uris<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<Vec<String>, String> {
    clipboard.read_files_uris()
}

#[command]
pub fn write_files_uris<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    files_uris: Vec<String>,
) -> Result<(), String> {
    clipboard.write_files_uris(files_uris)
}

#[command]
pub fn write_files<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    files_paths: Vec<String>,
) -> Result<(), String> {
    for file in &files_paths {
        if file.starts_with("file://") {
            return Err(format!(
                "Invalid file uri: {}. File uri should not start with file://",
                file
            ));
        }
    }
    let mut files_uris: Vec<String> = vec![];
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        for file in &files_paths {
            files_uris.push(format!("file://{}", file))
        }
    }

    #[cfg(target_os = "windows")]
    {
        for file in &files_paths {
            files_uris.push(file.clone())
        }
    }
    write_files_uris(_app, _window, clipboard, files_uris)
}

#[command]
pub fn write_text<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    text: String,
) -> Result<(), String> {
    clipboard.write_text(text)
}

#[command]
pub fn write_html<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    html: String,
) -> Result<(), String> {
    clipboard.write_html(html)
}

#[command]
pub fn write_html_and_text<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    html: String,
    text: String,
) -> Result<(), String> {
    clipboard.write_html_and_text(html, text)
}

#[command]
pub fn write_rtf<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    rtf: String,
) -> Result<(), String> {
    clipboard.write_rtf(rtf)
}

/// read image from clipboard and return a base64 string
#[command]
pub async fn read_image_base64<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<String, String> {
    clipboard.read_image_base64()
}

#[command]
pub async fn read_image_binary<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<Vec<u8>, String> {
    clipboard.read_image_binary()
}

/// write base64 image to clipboard
#[command]
pub async fn write_image_base64<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    base64_image: String,
) -> Result<(), String> {
    clipboard.write_image_base64(base64_image)
}

#[command]
pub async fn write_image_binary<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    clipboard.write_image_binary(bytes)
}

#[command]
pub fn clear<R: Runtime>(
    _app: AppHandle<R>,
    _window: Window<R>,
    clipboard: State<'_, Clipboard>,
) -> Result<(), String> {
    clipboard.clear()
}

#[command]
pub async fn start_monitor<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, Clipboard>,
) -> Result<(), String> {
    state.start_monitor(app)
}

#[command]
pub async fn stop_monitor<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, Clipboard>,
) -> Result<(), String> {
    state.stop_monitor(app)
}

#[command]
pub fn is_monitor_running<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, Clipboard>,
) -> bool {
    state.is_monitor_running()
}
