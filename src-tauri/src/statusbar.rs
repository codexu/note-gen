use tauri::command;

#[command]
pub fn set_statusbar_color(color: String, is_dark: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        // Android 状态栏颜色设置需要通过 WebView 的 evaluateJavascript 来调用 Android API
        // 这里我们返回成功，实际的颜色设置会在前端通过 WebView 的方式处理
        Ok(())
    }
    
    #[cfg(not(target_os = "android"))]
    {
        // 非 Android 平台不需要设置
        Ok(())
    }
}
