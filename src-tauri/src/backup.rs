use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use tauri::{command, AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::maintenance_lock::MaintenanceGuard;
use crate::zip_extract::{
    extract_zip_safely, ZipDirectoryCheck, ZipExtractContext, ZipExtractLimits, ZipPathDedup,
};

fn filesystem_is_case_sensitive(dir: &Path) -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let _ = dir;
        return false;
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let probe_id = uuid::Uuid::new_v4().simple().to_string();
        let upper = dir.join(format!("CaseProbe_{probe_id}"));
        let lower = dir.join(format!("caseprobe_{probe_id}"));
        if fs::write(&upper, b"upper").is_err() {
            return true;
        }
        let supports_distinct_paths = match fs::write(&lower, b"lower") {
            Ok(()) => fs::read(&upper).ok().as_deref() == Some(b"upper"),
            Err(_) => false,
        };
        let _ = fs::remove_file(&upper);
        let _ = fs::remove_file(&lower);
        supports_distinct_paths
    }
}

#[command]
pub async fn import_app_data_from_file(
    app_handle: AppHandle,
    _file_name: String,
    file_content: Vec<u8>,
) -> Result<(), String> {
    let _maintenance = MaintenanceGuard::acquire_app_maintenance()?;

    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    let temp_zip_path = data_dir.join("temp_import.zip");
    fs::write(&temp_zip_path, &file_content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    extract_app_backup_zip(temp_zip_path.as_path(), &temp_dir)?;

    restore_app_data_from_temp(&temp_dir, &data_dir)?;

    fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    fs::remove_file(&temp_zip_path)
        .map_err(|e| format!("Failed to remove temp zip file: {}", e))?;

    Ok(())
}

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<String, String> {
    let _maintenance = MaintenanceGuard::acquire_app_maintenance()?;

    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    if !data_dir.exists() {
        return Err(format!("Data directory does not exist: {:?}", data_dir));
    }

    let dest_path = PathBuf::from(&output_path);
    let write_result = compress_dir(&data_dir, &dest_path);

    match write_result {
        Ok(_) => Ok(dest_path.to_string_lossy().to_string()),
        Err(_e) => {
            let export_dir = app_handle
                .path()
                .document_dir()
                .map_err(|e| format!("Failed to get document_dir: {}", e))?;

            let file_name = PathBuf::from(&output_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "note-gen-backup.zip".to_string());

            let new_dest_path = export_dir.join(&file_name);
            compress_dir(&data_dir, &new_dest_path)?;
            Ok(new_dest_path.to_string_lossy().to_string())
        }
    }
}

#[command]
pub async fn import_app_data(app_handle: AppHandle, zip_path: String) -> Result<(), String> {
    let _maintenance = MaintenanceGuard::acquire_app_maintenance()?;

    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    extract_app_backup_zip(PathBuf::from(&zip_path).as_path(), &temp_dir)?;
    restore_app_data_from_temp(&temp_dir, &data_dir)?;

    fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    Ok(())
}

fn restore_app_data_from_temp(temp_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let dest_store_path = data_dir.join("store.json");
        fs::copy(&store_path, &dest_store_path)
            .map_err(|e| format!("Failed to copy store.json: {}", e))?;
    }

    for entry in
        fs::read_dir(temp_dir).map_err(|e| format!("Failed to read temp directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();

        if file_name == "store.json" {
            continue;
        }

        let file_name_str = file_name.to_string_lossy();
        if file_name_str.ends_with(".db-shm") || file_name_str.ends_with(".db-wal") {
            continue;
        }

        let src_path = entry.path();
        let dest_path = data_dir.join(&file_name);

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path).map_err(|e| {
                format!("Failed to copy file {}: {}", file_name.to_string_lossy(), e)
            })?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path).map_err(|e| {
                format!(
                    "Failed to copy directory {}: {}",
                    file_name.to_string_lossy(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

fn compress_dir(src_dir: &Path, dest_file: &Path) -> Result<(), String> {
    if let Some(parent) = dest_file.parent() {
        if parent != src_dir {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

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

    for entry in
        fs::read_dir(current_path).map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(base_path)
            .map_err(|e| format!("Failed to get relative path: {}", e))?;

        if path.is_file() {
            let file_name = relative_path.to_string_lossy();
            zip.start_file(file_name.as_ref(), *options)
                .map_err(|e| format!("Failed to start file in zip: {}", e))?;

            let mut file =
                fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            zip.write_all(&buffer)
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

fn extract_app_backup_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let case_insensitive = !filesystem_is_case_sensitive(dest_dir);
    extract_zip_safely(
        zip_path,
        ZipExtractContext {
            dest_dir,
            path_dedup: if case_insensitive {
                ZipPathDedup::CaseInsensitive
            } else {
                ZipPathDedup::CaseSensitive
            },
            directory_check: ZipDirectoryCheck::RawNameSuffix,
            limits: ZipExtractLimits::unlimited(),
            cancel: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip_extract::{zip_entry_is_directory, zip_path_dedup_key};
    use uuid::Uuid;

    fn write_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("create ZIP fixture");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            writer
                .start_file(*name, options)
                .expect("start ZIP fixture entry");
            writer.write_all(content).expect("write ZIP fixture entry");
        }
        writer.finish().expect("finish ZIP fixture");
    }

    fn filesystem_supports_case_sensitive_paths(dir: &Path) -> bool {
        let upper = dir.join("CaseTest_UPPER");
        let lower = dir.join("casetest_upper");
        if fs::write(&upper, b"upper").is_err() {
            return false;
        }
        let supports_distinct_paths = match fs::write(&lower, b"lower") {
            Ok(()) => fs::read(&upper).ok().as_deref() == Some(b"upper"),
            Err(_) => false,
        };
        let _ = fs::remove_file(&upper);
        let _ = fs::remove_file(&lower);
        supports_distinct_paths
    }

    #[test]
    #[cfg(not(windows))]
    fn app_backup_path_dedup_key_preserves_backslash_on_unix() {
        assert_eq!(zip_path_dedup_key(Path::new(r"a\b"), false), r"a\b");
        assert_ne!(
            zip_path_dedup_key(Path::new(r"a\b"), false),
            zip_path_dedup_key(Path::new("a/b"), false)
        );
    }

    #[test]
    #[cfg(windows)]
    fn app_backup_path_dedup_key_normalizes_backslash_on_windows() {
        assert_eq!(zip_path_dedup_key(Path::new(r"a\b"), false), "a/b");
    }

    #[test]
    fn app_backup_path_dedup_key_preserves_case_on_case_sensitive_filesystems() {
        assert_eq!(zip_path_dedup_key(Path::new("Foo.md"), false), "Foo.md");
        assert_ne!(
            zip_path_dedup_key(Path::new("Foo.md"), false),
            zip_path_dedup_key(Path::new("foo.md"), false)
        );
    }

    #[test]
    fn app_backup_path_dedup_key_folds_case_on_case_insensitive_filesystems() {
        assert_eq!(zip_path_dedup_key(Path::new("Foo.md"), true), "foo.md");
        assert_eq!(
            zip_path_dedup_key(Path::new("Foo.md"), true),
            zip_path_dedup_key(Path::new("foo.md"), true)
        );
    }

    #[test]
    fn filesystem_is_case_sensitive_matches_distinct_path_probe() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-case-probe-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_root).expect("create probe directory");
        assert_eq!(
            filesystem_is_case_sensitive(&test_root),
            filesystem_supports_case_sensitive_paths(&test_root)
        );
        fs::remove_dir_all(&test_root).expect("remove probe directory");
    }

    #[test]
    fn app_backup_extract_preserves_case_sensitive_paths() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-backup-case-test-{}", Uuid::new_v4()));
        let output_dir = test_root.join("output");
        fs::create_dir_all(&output_dir).expect("create output directory");
        if !filesystem_supports_case_sensitive_paths(&output_dir) {
            fs::remove_dir_all(&test_root).expect("remove test root");
            return;
        }

        let zip_path = test_root.join("backup.zip");
        write_test_zip(&zip_path, &[("Foo.md", b"upper"), ("foo.md", b"lower")]);

        extract_app_backup_zip(&zip_path, &output_dir).expect("extract backup");

        assert_eq!(
            fs::read(output_dir.join("Foo.md")).expect("read upper"),
            b"upper"
        );
        assert_eq!(
            fs::read(output_dir.join("foo.md")).expect("read lower"),
            b"lower"
        );
        fs::remove_dir_all(&test_root).expect("remove test root");
    }

    #[test]
    fn app_backup_roundtrip_preserves_distinct_files() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-backup-roundtrip-{}", Uuid::new_v4()));
        let source_dir = test_root.join("source");
        let restored_dir = test_root.join("restored");
        fs::create_dir_all(&source_dir).expect("create source");
        if !filesystem_supports_case_sensitive_paths(&source_dir) {
            fs::remove_dir_all(&test_root).expect("remove test root");
            return;
        }

        fs::write(source_dir.join("Foo.md"), b"upper").expect("write upper");
        fs::write(source_dir.join("foo.md"), b"lower").expect("write lower");

        let zip_path = test_root.join("backup.zip");
        compress_dir(&source_dir, &zip_path).expect("compress backup");
        fs::create_dir_all(&restored_dir).expect("create restored");
        extract_app_backup_zip(&zip_path, &restored_dir).expect("extract backup");

        assert_eq!(
            fs::read(restored_dir.join("Foo.md")).expect("read upper"),
            b"upper"
        );
        assert_eq!(
            fs::read(restored_dir.join("foo.md")).expect("read lower"),
            b"lower"
        );
        fs::remove_dir_all(&test_root).expect("remove test root");
    }

    #[cfg(not(windows))]
    #[test]
    fn app_backup_does_not_treat_backslash_suffix_as_directory_on_unix() {
        assert!(!zip_entry_is_directory("notes\\"));
    }

    #[test]
    fn existing_zip_output_files_are_never_overwritten() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-collision-test-{}", Uuid::new_v4()));
        let output_dir = test_root.join("output");
        fs::create_dir_all(&output_dir).expect("create collision test directory");
        let zip_path = test_root.join("backup.zip");
        write_test_zip(&zip_path, &[("existing.txt", b"replacement")]);
        let existing_file = output_dir.join("existing.txt");
        fs::write(&existing_file, b"original").expect("write existing file");

        assert!(extract_app_backup_zip(&zip_path, &output_dir).is_err());
        assert_eq!(
            fs::read(&existing_file).expect("read existing file"),
            b"original"
        );
        fs::remove_dir_all(&test_root).expect("remove collision test directory");
    }
}
