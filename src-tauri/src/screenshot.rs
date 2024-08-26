use xcap::Monitor;

#[tauri::command]
pub fn screenshot_path() -> String {
    let monitors = Monitor::all().unwrap();
    let main_monitor = monitors.get(0).unwrap();
    let image = main_monitor.capture_image().unwrap();
    // 获取app目录
    let app_dir = tauri::api::path::data_dir().unwrap().join("com.codexu.note.gen");
    // 判断 app_dir/note.gen 是否存在，不存在则创建
    if !app_dir.clone().exists() {
        let _ = std::fs::create_dir(app_dir.clone());
    }
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let file_path = app_dir.join(format!("{}.png", timestamp));
    image.save(app_dir.join(format!("{}.png", timestamp))).unwrap();
    file_path.to_str().unwrap().to_string()
}