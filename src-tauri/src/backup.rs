use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};

use log::{info, error};
use tauri::{AppHandle, Manager, command};

use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipArchive;
use zip::ZipWriter;

#[command]
pub async fn import_app_data_from_file(
    app_handle: AppHandle,
    _file_name: String,
    file_content: Vec<u8>,
) -> Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    // 将文件内容保存到临时文件
    let temp_zip_path = data_dir.join("temp_import.zip");
    fs::write(&temp_zip_path, &file_content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // 创建临时目录用于解压
    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 使用 zip crate 解压
    extract_zip(temp_zip_path.as_path(), &temp_dir)?;

    // 处理 store.json
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let dest_store_path = data_dir.join("store.json");
        fs::copy(&store_path, &dest_store_path)
            .map_err(|e| format!("Failed to copy store.json: {}", e))?;
    }

    // 复制其他文件
    for entry in fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();

        if file_name == "store.json" {
            continue;
        }

        let src_path = entry.path();
        let dest_path = data_dir.join(&file_name);

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
    fs::remove_file(&temp_zip_path)
        .map_err(|e| format!("Failed to remove temp zip file: {}", e))?;

    // 注意：不再自动重启，由前端处理
    Ok(())
}

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<String, String> {
    info!("Starting export_app_data with output_path: {}", output_path);

    // 获取数据目录
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| {
            error!("Failed to get app_data_dir: {}", e);
            format!("Failed to get app_data_dir: {}", e)
        })?;

    info!("Data directory: {:?}", data_dir);

    if !data_dir.exists() {
        error!("Data directory does not exist: {:?}", data_dir);
        return Err(format!("Data directory does not exist: {:?}", data_dir));
    }

    // 列出目录内容用于调试
    let entries = fs::read_dir(&data_dir)
        .map_err(|e| {
            error!("Failed to read data directory: {}", e);
            format!("Failed to read data directory: {}", e)
        })?;

    let mut entry_count = 0;
    let mut entry_names = Vec::new();
    for entry in entries {
        if let Ok(e) = entry {
            entry_names.push(e.file_name().to_string_lossy().to_string());
            entry_count += 1;
        }
    }

    info!("Data directory has {} entries: {:?}", entry_count, entry_names);

    if entry_count == 0 {
        error!("Data directory is empty: {:?}", data_dir);
        return Err(format!("Data directory is empty: {:?}", data_dir));
    }

    // 尝试直接保存到用户选择的路径
    let dest_path = PathBuf::from(&output_path);
    info!("Trying to export to: {:?}", dest_path);

    // 尝试压缩
    let write_result = compress_dir(&data_dir, &dest_path);

    match write_result {
        Ok(_) => {
            info!("Compression completed successfully to user selected path");
            Ok(dest_path.to_string_lossy().to_string())
        }
        Err(e) => {
            error!("Failed to write to user selected path: {}", e);
            // 如果失败，尝试保存到 document_dir
            info!("Trying to save to document_dir instead");

            let export_dir = app_handle
                .path()
                .document_dir()
                .map_err(|e| {
                    error!("Failed to get document_dir: {}", e);
                    format!("Failed to get document_dir: {}", e)
                })?;

            let file_name = PathBuf::from(&output_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "note-gen-backup.zip".to_string());

            let new_dest_path = export_dir.join(&file_name);
            info!("Exporting to document_dir: {:?}", new_dest_path);

            compress_dir(&data_dir, &new_dest_path)?;
            info!("Compression completed successfully to document_dir");

            Ok(new_dest_path.to_string_lossy().to_string())
        }
    }
}

#[command]
pub async fn import_app_data(app_handle: AppHandle, zip_path: String) -> Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    // 创建临时目录用于解压
    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 使用 zip crate 解压
    extract_zip(PathBuf::from(&zip_path).as_path(), &temp_dir)?;

    // 处理 store.json
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let dest_store_path = data_dir.join("store.json");
        fs::copy(&store_path, &dest_store_path)
            .map_err(|e| format!("Failed to copy store.json: {}", e))?;
    }

    // 复制其他文件
    for entry in fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();

        if file_name == "store.json" {
            continue;
        }

        let src_path = entry.path();
        let dest_path = data_dir.join(&file_name);

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

    // 注意：不再自动重启，由前端处理
    Ok(())
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

// 使用 zip crate 压缩目录
fn compress_dir(src_dir: &Path, dest_file: &Path) -> Result<(), String> {
    info!("compress_dir: src_dir={:?}, dest_file={:?}", src_dir, dest_file);

    // 确保父目录存在（仅当父目录不同于源目录时）
    if let Some(parent) = dest_file.parent() {
        if parent != src_dir {
            info!("Creating parent directory if not exists: {:?}", parent);
            fs::create_dir_all(parent).map_err(|e| {
                error!("Failed to create parent directory: {}", e);
                format!("Failed to create parent directory: {}", e)
            })?;
        }
    }

    let file =
        fs::File::create(dest_file).map_err(|e| {
            error!("Failed to create zip file: {}", e);
            format!("Failed to create zip file: {}", e)
        })?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let base_path = src_dir.to_path_buf();
    add_dir_to_zip(&mut zip, &base_path, &base_path, &options)?;

    zip.finish().map_err(|e| {
        error!("Failed to finish zip: {}", e);
        format!("Failed to finish zip: {}", e)
    })?;

    // 检查生成的 zip 文件大小
    let metadata = fs::metadata(dest_file).map_err(|e| {
        error!("Failed to get zip file metadata: {}", e);
        format!("Failed to get zip file metadata: {}", e)
    })?;
    info!("Generated zip file size: {} bytes", metadata.len());

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

// 使用 zip crate 解压文件
fn extract_zip(src_file: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(src_file)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read file from zip: {}", e))?;

        let outpath = dest_dir.join(file.mangled_name());

        // 添加路径验证，防止 zip slip 攻击
        if !outpath.starts_with(dest_dir) {
            return Err("Invalid zip entry: path traversal detected".to_string());
        }

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }

            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create output file: {}", e))?;

            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(())
}
