use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use tauri::{AppHandle, Manager};

const DATABASE_FILES: [&str; 3] = ["note.db", "note.db-wal", "note.db-shm"];

#[tauri::command]
pub fn delete_local_database(app: AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位数据库目录：{error}"))?;
    remove_local_database_files(&config_dir)
}

pub(crate) fn remove_local_database_files(directory: &Path) -> Result<(), String> {
    for file_name in DATABASE_FILES {
        let path = directory.join(file_name);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法删除 {}：{error}", path.display())),
        }
    }

    Ok(())
}
