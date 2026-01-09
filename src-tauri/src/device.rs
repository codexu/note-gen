use tauri::command;

/// 获取设备唯一标识 - 桌面端实现
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[command]
pub fn get_device_id() -> Result<String, String> {
    machine_uid::get()
        .map_err(|e| format!("Failed to get device ID: {}", e))
}

/// 获取设备唯一标识 - Android 实现
#[cfg(target_os = "android")]
#[command]
pub fn get_device_id() -> Result<String, String> {
    get_or_create_device_id()
}

/// 获取设备唯一标识 - iOS 实现
#[cfg(target_os = "ios")]
#[command]
pub fn get_device_id() -> Result<String, String> {
    get_or_create_device_id()
}

/// 移动端通用的设备 ID 获取逻辑
#[cfg(any(target_os = "android", target_os = "ios"))]
fn get_or_create_device_id() -> Result<String, String> {
    // 使用更简单的方法：直接使用临时目录
    // 这样可以确保跨平台兼容性和权限访问
    let app_data_dir = std::env::temp_dir();
    
    let device_id_file = app_data_dir.join("note-gen-device-id.txt");
    
    // 如果文件存在，读取已有的 ID
    if device_id_file.exists() {
        if let Ok(id) = std::fs::read_to_string(&device_id_file) {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }
    
    // 如果文件不存在或读取失败，生成新的 UUID
    let new_id = uuid::Uuid::new_v4().to_string();
    
    // 确保目录存在（cache_dir 通常已存在，但为了安全还是检查一下）
    if let Some(parent) = device_id_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // 保存到文件
    std::fs::write(&device_id_file, &new_id)
        .map_err(|e| format!("Failed to write device ID: {}", e))?;
    
    Ok(new_id)
}
