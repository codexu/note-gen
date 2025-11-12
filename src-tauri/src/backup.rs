use serde_json::Value;
use std::fs::{self, File};
use std::io::{Read, Write};
use tauri::{command, AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

// Constants for backup/restore operations
const TEMP_IMPORT_DIR: &str = "temp_import";
const STORE_JSON_FILE: &str = "store.json";
const SQLITE_SHM_SUFFIX: &str = "-shm";
const SQLITE_WAL_SUFFIX: &str = "-wal";

/// Check if a file should be skipped during backup/restore
fn should_skip_file(path: &str) -> bool {
    path.starts_with(TEMP_IMPORT_DIR)
        || path.ends_with(SQLITE_SHM_SUFFIX)
        || path.ends_with(SQLITE_WAL_SUFFIX)
}

/// Check if a file is store.json
fn is_store_json(path: &str) -> bool {
    path.starts_with(STORE_JSON_FILE)
}

/// Compress a directory to a zip file
fn add_directory_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    source_dir: &std::path::Path,
) -> Result<(), String> {
    for entry in WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path
            .strip_prefix(source_dir)
            .map_err(|e| format!("Failed to strip prefix: {}", e))?;

        // Skip root directory
        if name.as_os_str().is_empty() {
            continue;
        }

        let name_str = name.to_string_lossy();

        // Skip files that should not be exported
        if should_skip_file(&name_str) {
            continue;
        }

        let name_str = name_str.replace("\\", "/");

        if path.is_file() {
            zip.start_file(&name_str, SimpleFileOptions::default())
                .map_err(|e| format!("Failed to start file in zip: {}", e))?;

            let mut f = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read file: {}", e))?;

            zip.write_all(&buffer)
                .map_err(|e| format!("Failed to write to zip: {}", e))?;
        } else if path.is_dir() {
            zip.add_directory(&name_str, SimpleFileOptions::default())
                .map_err(|e| format!("Failed to add directory to zip: {}", e))?;
        }
    }

    Ok(())
}

/// Extract a zip file to a directory
fn extract_zip_to_dir(
    archive: &mut ZipArchive<File>,
    target_dir: &std::path::Path,
) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to get file from archive: {}", e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => target_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            // Directory
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            // File
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile =
                File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(())
}

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_data_dir.exists() {
        return Err("App data directory does not exist".to_string());
    }

    // Create zip archive using zip crate
    let file =
        File::create(&output_path).map_err(|e| format!("Failed to create zip file: {}", e))?;

    let mut zip = ZipWriter::new(file);

    // Recursively compress directory
    add_directory_to_zip(&mut zip, &app_data_dir)?;

    zip.finish()
        .map_err(|e| format!("Failed to finish zip: {}", e))?;

    Ok(())
}

#[command]
pub async fn import_app_data(app_handle: AppHandle, zip_path: String) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create temporary directory for extraction
    let temp_dir = app_data_dir.join(TEMP_IMPORT_DIR);
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Extract zip to temporary directory using zip crate
    let file = File::open(&zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    // Extract all files
    extract_zip_to_dir(&mut archive, &temp_dir)?;

    // Handle store.json
    let store_path = temp_dir.join(STORE_JSON_FILE);
    if store_path.exists() {
        let store_content = fs::read_to_string(&store_path)
            .map_err(|e| format!("Failed to read store.json: {}", e))?;

        let store_data: Value = serde_json::from_str(&store_content)
            .map_err(|e| format!("Failed to parse store.json: {}", e))?;

        // Get store instance and save data
        let store = app_handle
            .store(STORE_JSON_FILE)
            .map_err(|e| format!("Failed to get store: {}", e))?;

        if let Value::Object(obj) = store_data {
            for (key, value) in obj {
                store.set(&key, value);
            }
        }

        store
            .save()
            .map_err(|e| format!("Failed to save store: {}", e))?;
    }

    // Copy other files (except store.json and temp_import)
    for entry in WalkDir::new(&temp_dir).into_iter().filter_map(|e| e.ok()) {
        let src_path = entry.path();
        let rel_path = src_path
            .strip_prefix(&temp_dir)
            .map_err(|e| format!("Failed to strip prefix: {}", e))?;

        // Skip root directory
        if rel_path.as_os_str().is_empty() {
            continue;
        }

        let rel_path_str = rel_path.to_string_lossy();

        // Skip files that should not be imported
        if is_store_json(&rel_path_str) || should_skip_file(&rel_path_str) {
            continue;
        }

        let dest_path = app_data_dir.join(rel_path);

        if src_path.is_file() {
            // Ensure target directory exists
            if let Some(parent) = dest_path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file {}: {}", rel_path_str, e))?;
        } else if src_path.is_dir() {
            fs::create_dir_all(&dest_path)
                .map_err(|e| format!("Failed to create directory {}: {}", rel_path_str, e))?;
        }
    }

    // Clean up temporary directory
    fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to remove temp directory: {}", e))?;

    app_handle.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    /// Create test temporary directory structure
    fn create_test_dir_structure(base_dir: &Path) -> Result<(), std::io::Error> {
        // Create files and subdirectories
        fs::create_dir_all(base_dir.join("subdir"))?;
        fs::write(base_dir.join("test.txt"), "Hello World")?;
        fs::write(base_dir.join("subdir/nested.txt"), "Nested content")?;
        fs::write(base_dir.join(STORE_JSON_FILE), r#"{"key":"value"}"#)?;
        Ok(())
    }

    #[test]
    fn test_zip_and_unzip_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let source_dir = temp_dir.path().join("source");
        let zip_path = temp_dir.path().join("test.zip");
        let extract_dir = temp_dir.path().join("extract");

        // Create test data
        create_test_dir_structure(&source_dir).unwrap();

        // Test compression
        let file = File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);

        for entry in WalkDir::new(&source_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = path.strip_prefix(&source_dir).unwrap();

            if name.as_os_str().is_empty() {
                continue;
            }

            let name_str = name.to_string_lossy().replace("\\", "/");

            if path.is_file() {
                zip.start_file::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
                let mut f = File::open(path).unwrap();
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer).unwrap();
                zip.write_all(&buffer).unwrap();
            } else if path.is_dir() {
                zip.add_directory::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
            }
        }
        zip.finish().unwrap();

        // Verify zip file was created
        assert!(zip_path.exists());

        // Test decompression
        fs::create_dir_all(&extract_dir).unwrap();
        let file = File::open(&zip_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let outpath = match file.enclosed_name() {
                Some(path) => extract_dir.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).unwrap();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).unwrap();
                    }
                }
                let mut outfile = File::create(&outpath).unwrap();
                std::io::copy(&mut file, &mut outfile).unwrap();
            }
        }

        // Verify decompressed files
        assert!(extract_dir.join("test.txt").exists());
        assert!(extract_dir.join("subdir/nested.txt").exists());

        let content = fs::read_to_string(extract_dir.join("test.txt")).unwrap();
        assert_eq!(content, "Hello World");
    }

    #[test]
    #[cfg(not(target_os = "android"))]
    fn test_compatibility_with_system_zip() {
        use std::process::Command;

        let temp_dir = TempDir::new().unwrap();
        let source_dir = temp_dir.path().join("source");
        let zip_by_command = temp_dir.path().join("by_command.zip");
        let zip_by_crate = temp_dir.path().join("by_crate.zip");
        let extract_command = temp_dir.path().join("extract_command");
        let extract_crate = temp_dir.path().join("extract_crate");

        // Create test data
        create_test_dir_structure(&source_dir).unwrap();

        // Test 1: System zip command compression -> crate decompression
        // Use system zip command to compress
        let output = Command::new("zip")
            .arg("-r")
            .arg("-q")
            .arg(&zip_by_command)
            .arg(".")
            .current_dir(&source_dir)
            .output()
            .expect("Failed to execute zip command. Make sure 'zip' is installed.");

        assert!(
            output.status.success(),
            "Zip command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            zip_by_command.exists(),
            "Zip file was not created by command"
        );

        // Use crate to decompress the file created by system zip command
        fs::create_dir_all(&extract_crate).unwrap();
        let file = File::open(&zip_by_command).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let outpath = match file.enclosed_name() {
                Some(path) => extract_crate.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).unwrap();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).unwrap();
                    }
                }
                let mut outfile = File::create(&outpath).unwrap();
                std::io::copy(&mut file, &mut outfile).unwrap();
            }
        }

        // Verify decompression result
        assert!(
            extract_crate.join("test.txt").exists(),
            "test.txt not extracted from system zip"
        );
        assert!(
            extract_crate.join("subdir/nested.txt").exists(),
            "nested.txt not extracted from system zip"
        );

        let content = fs::read_to_string(extract_crate.join("test.txt")).unwrap();
        assert_eq!(content, "Hello World", "Content mismatch after crate unzip");

        // Test 2: crate compression -> system unzip command decompression
        // Use crate to compress
        let file = File::create(&zip_by_crate).unwrap();
        let mut zip = ZipWriter::new(file);

        for entry in WalkDir::new(&source_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = path.strip_prefix(&source_dir).unwrap();

            if name.as_os_str().is_empty() {
                continue;
            }

            let name_str = name.to_string_lossy().replace("\\", "/");

            if path.is_file() {
                zip.start_file::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
                let mut f = File::open(path).unwrap();
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer).unwrap();
                zip.write_all(&buffer).unwrap();
            } else if path.is_dir() {
                zip.add_directory::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
            }
        }
        zip.finish().unwrap();

        assert!(zip_by_crate.exists(), "Zip file was not created by crate");

        // Use system unzip command to decompress
        fs::create_dir_all(&extract_command).unwrap();
        let output = Command::new("unzip")
            .arg("-o") // Overwrite existing files
            .arg("-q") // Silent mode
            .arg(&zip_by_crate)
            .current_dir(&extract_command)
            .output()
            .expect("Failed to execute unzip command. Make sure 'unzip' is installed.");

        assert!(
            output.status.success(),
            "Unzip command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        // Verify decompression result
        assert!(
            extract_command.join("test.txt").exists(),
            "test.txt not extracted by system unzip"
        );
        assert!(
            extract_command.join("subdir/nested.txt").exists(),
            "nested.txt not extracted by system unzip"
        );

        let content = fs::read_to_string(extract_command.join("test.txt")).unwrap();
        assert_eq!(
            content, "Hello World",
            "Content mismatch after system unzip"
        );

        // Additional verification: compare decompressed files
        // Verify files compressed by both methods contain the same files
        let files_from_command: Vec<_> = fs::read_dir(&extract_crate)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();

        let files_from_crate: Vec<_> = fs::read_dir(&extract_command)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();

        assert_eq!(
            files_from_command.len(),
            files_from_crate.len(),
            "Different number of files extracted"
        );
    }

    #[test]
    fn test_skip_temp_import_directory() {
        let temp_dir = TempDir::new().unwrap();
        let app_data_dir = temp_dir.path().join("app_data");
        let zip_path = temp_dir.path().join("test.zip");

        // Create mock application data directory
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(app_data_dir.join("data.txt"), "test data").unwrap();

        // Create temp_import directory (simulating leftover from import)
        let temp_import = app_data_dir.join(TEMP_IMPORT_DIR);
        fs::create_dir_all(&temp_import).unwrap();
        fs::write(temp_import.join("should_not_be_exported.txt"), "temp data").unwrap();

        // Compress
        let file = File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);

        for entry in WalkDir::new(&app_data_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let name = path.strip_prefix(&app_data_dir).unwrap();

            if name.as_os_str().is_empty() {
                continue;
            }

            let name_str = name.to_string_lossy();

            // Skip temp_import directory
            if name_str.starts_with(TEMP_IMPORT_DIR) {
                continue;
            }

            let name_str = name_str.replace("\\", "/");

            if path.is_file() {
                zip.start_file::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
                let mut f = File::open(path).unwrap();
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer).unwrap();
                zip.write_all(&buffer).unwrap();
            } else if path.is_dir() {
                zip.add_directory::<_, _>(&name_str, SimpleFileOptions::default())
                    .unwrap();
            }
        }
        zip.finish().unwrap();

        // Decompress and verify
        let extract_dir = temp_dir.path().join("extract");
        fs::create_dir_all(&extract_dir).unwrap();
        let file = File::open(&zip_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let outpath = match file.enclosed_name() {
                Some(path) => extract_dir.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath).unwrap();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).unwrap();
                    }
                }
                let mut outfile = File::create(&outpath).unwrap();
                std::io::copy(&mut file, &mut outfile).unwrap();
            }
        }

        // Verify data.txt was exported
        assert!(
            extract_dir.join("data.txt").exists(),
            "data.txt should be exported"
        );

        // Verify temp_import directory was not exported
        assert!(
            !extract_dir.join("temp_import").exists(),
            "temp_import should NOT be exported"
        );
        assert!(
            !extract_dir
                .join("temp_import/should_not_be_exported.txt")
                .exists(),
            "temp files should NOT be exported"
        );
    }
}
