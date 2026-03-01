use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager, command};

use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<(), String> {
    // 根据平台选择目录
    let data_dir = get_data_dir(&app_handle)?;

    if !data_dir.exists() {
        return Err("Data directory does not exist".to_string());
    }

    // 使用 zip crate 压缩
    compress_dir(&data_dir, &PathBuf::from(&output_path))?;

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

    // 处理 store.json - 直接替换文件而不是循环 set
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let dest_store_path = app_data_dir.join("store.json");
        fs::copy(&store_path, &dest_store_path)
            .map_err(|e| format!("Failed to copy store.json: {}", e))?;
    }

    // 复制其他文件
    for entry in fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();

        // 跳过 store.json，已经在上面处理过了
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

// 获取数据目录 - 支持移动端和桌面端
fn get_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    // 尝试获取 document_dir（移动端）
    if let Ok(doc_dir) = app_handle.path().document_dir() {
        return Ok(doc_dir);
    }

    // 回退到 app_data_dir（桌面端）
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data directory: {}", e))
}

// 使用 zip crate 压缩目录
fn compress_dir(src_dir: &Path, dest_file: &Path) -> Result<(), String> {
    let file =
        fs::File::create(dest_file).map_err(|e| format!("Failed to create zip file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let base_path = src_dir.to_path_buf();
    add_dir_to_zip(&mut zip, &base_path, &base_path, &options)?;

    zip.finish()
        .map_err(|e| format!("Failed to finish zip: {}", e))?;

    Ok(())
}

fn add_dir_to_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    base_path: &Path,
    current_path: &Path,
    options: &SimpleFileOptions,
) -> Result<(), String> {
    if !current_path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(current_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(base_path)
            .map_err(|e| format!("Failed to get relative path: {}", e))?;

        if path.is_file() {
            zip.start_file(
                relative_path.to_string_lossy(),
                *options,
            )
            .map_err(|e| format!("Failed to start file in zip: {}", e))?;

            let mut file = fs::File::open(&path)
                .map_err(|e| format!("Failed to open file: {}", e))?;

            std::io::copy(&mut file, zip)
                .map_err(|e| format!("Failed to write file to zip: {}", e))?;
        } else if path.is_dir() {
            let dir_name = format!("{}/", relative_path.to_string_lossy());
            zip.add_directory(&dir_name, *options)
                .map_err(|e| format!("Failed to add directory to zip: {}", e))?;

            add_dir_to_zip(zip, base_path, &path, options)?;
        }
    }

    Ok(())
}
