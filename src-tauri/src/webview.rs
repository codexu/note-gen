use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn create_webview_window(
    app_handle: AppHandle,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    let window_title = title.unwrap_or_else(|| "WebView".to_string());
    
    // 生成唯一的窗口标识符
    let window_label = format!("webview_{}", chrono::Utc::now().timestamp_millis());
    
    match WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?),
    )
    .title(&window_title)
    .inner_size(800.0, 600.0)
    .min_inner_size(400.0, 300.0)
    .max_inner_size(1920.0, 1080.0)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .decorations(true)
    .always_on_top(false)
    .skip_taskbar(false)
    .center()
    .focused(true)
    .build() {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to create webview window: {}", e)),
    }
}

#[tauri::command]
pub async fn close_webview_window(app_handle: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.close().map_err(|e| format!("Failed to close window: {}", e))
    } else {
        Err("WebView window not found".to_string())
    }
}

#[tauri::command]
pub async fn list_webview_windows(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let windows = app_handle.webview_windows();
    let webview_labels: Vec<String> = windows
        .keys()
        .filter(|label| label.starts_with("webview_"))
        .cloned()
        .collect();
    
    Ok(webview_labels)
}