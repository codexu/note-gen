use std::process::Command;
use std::path::Path;
use std::fs;
use tauri::{command, AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use serde_json::Value;

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_data_dir.exists() {
        return Err("App data directory does not exist".to_string());
    }

    // 使用系统zip命令创建压缩包
    let output = Command::new("zip")
        .arg("-r")  // 递归压缩
        .arg("-q")  // 静默模式
        .arg(&output_path)  // 输出文件路径
        .arg(".")  // 压缩当前目录下所有内容
        .current_dir(&app_data_dir)  // 设置工作目录为AppData目录
        .output()
        .map_err(|e| format!("Failed to execute zip command: {}", e))?;

    let stderr_msg = String::from_utf8_lossy(&output.stderr);
    
    if !output.status.success() {
        return Err(format!("Zip command failed: {}", stderr_msg));
    }

    Ok(())
}

#[command]
pub async fn import_app_data(app_handle: AppHandle, zip_path: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // 创建临时目录用于解压
    let temp_dir = app_data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 解压到临时目录
    let output = Command::new("unzip")
        .arg("-o")  // 覆盖已存在的文件
        .arg("-q")  // 静默模式，避免交互
        .arg(&zip_path)  // zip文件路径
        .current_dir(&temp_dir)  // 设置工作目录为临时目录
        .output()
        .map_err(|e| format!("Failed to execute unzip command: {}", e))?;

    let stderr_msg = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!("Unzip command failed: {}", stderr_msg));
    }

    // 处理 store.json
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let store_content = fs::read_to_string(&store_path)
            .map_err(|e| format!("Failed to read store.json: {}", e))?;
        
        let store_data: Value = serde_json::from_str(&store_content)
            .map_err(|e| format!("Failed to parse store.json: {}", e))?;

        // 获取 store 实例并保存数据
        let store = app_handle.store("store.json")
            .map_err(|e| format!("Failed to get store: {}", e))?;
        
        if let Value::Object(obj) = store_data {
            for (key, value) in obj {
                store.set(&key, value);
            }
        }
        
        store.save().map_err(|e| format!("Failed to save store: {}", e))?;
    }

    // 复制其他文件（除了 store.json）
    for entry in fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();
        
        // 跳过 store.json，因为已经通过 store API 处理了
        if file_name == "store.json" {
            continue;
        }
        
        let src_path = entry.path();
        let dest_path = app_data_dir.join(&file_name);
        
        if src_path.is_file() {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file {}: {}", file_name.to_string_lossy(), e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy directory {}: {}", file_name.to_string_lossy(), e))?;
        }
    }

    // 清理临时目录
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to remove temp directory: {}", e))?;

    
    app_handle.restart();
}

// 递归复制目录的辅助函数
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        
        if src_path.is_file() {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        }
    }
    
    Ok(())
}
