use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortablePath {
    normalized: String,
    case_folded: String,
}

#[tauri::command]
pub fn self_hosted_portable_path(relative_path: String) -> Result<PortablePath, String> {
    let normalized = validate_relative_path(&relative_path)?;
    Ok(PortablePath {
        case_folded: normalized.to_lowercase(),
        normalized,
    })
}

#[tauri::command]
pub fn self_hosted_import_object_id(
    workspace_id: String,
    relative_path: String,
) -> Result<String, String> {
    let namespace = Uuid::parse_str(&workspace_id).map_err(|_| "Workspace ID is invalid".to_string())?;
    let normalized = validate_relative_path(&relative_path)?;
    Ok(Uuid::new_v5(&namespace, normalized.as_bytes()).to_string())
}

#[tauri::command]
pub async fn self_hosted_atomic_write(
    app_handle: AppHandle,
    workspace_id: String,
    object_id: Option<String>,
    workspace_root: String,
    relative_path: String,
    contents: String,
    expected_hash: String,
) -> Result<(), String> {
    let normalized = validate_relative_path(&relative_path)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(contents)
        .map_err(|_| "File contents are not valid Base64URL".to_string())?;
    let actual_hash = URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes));
    if actual_hash != expected_hash {
        return Err("File content hash does not match".to_string());
    }
    let root = safe_workspace_root(&workspace_root)?;
    let target = safe_target(&root, &normalized)?;
    let database_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("note.db");
    let temp = target.with_file_name(format!(
        ".{}.notegen-sync-{}.tmp",
        target.file_name().and_then(|value| value.to_str()).unwrap_or("file"),
        Uuid::new_v4()
    ));
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection,
        &workspace_id,
        "write",
        object_id.as_deref(),
        None,
        Some(&target),
        Some(&temp),
        Some(&expected_hash),
    )
    .await?;

    let result = (|| -> Result<(), String> {
        let parent = target.parent().ok_or_else(|| "File target has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format!("Failed to create file directory: {error}"))?;
        reject_symlink_path(&root, parent)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("Failed to create temporary file: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Failed to persist temporary file: {error}"))?;
        atomic_replace(&temp, &target)?;
        if let Some(parent) = target.parent() {
            if let Ok(directory) = fs::File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => update_journal(&mut connection, journal_id, "committed", None).await,
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("file_write_failed")).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn self_hosted_delete_file(
    app_handle: AppHandle,
    workspace_id: String,
    object_id: Option<String>,
    workspace_root: String,
    relative_path: String,
    expected_hash: Option<String>,
) -> Result<bool, String> {
    let normalized = validate_relative_path(&relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let target = safe_target(&root, &normalized)?;
    reject_symlink_path(&root, &target)?;
    if !target.exists() {
        return Ok(false);
    }
    if !target.is_file() {
        return Err("Only regular files can be removed by synchronization".to_string());
    }
    if let Some(expected) = expected_hash.as_deref() {
        let bytes = fs::read(&target).map_err(|error| format!("Failed to read file before removal: {error}"))?;
        let actual = URL_SAFE_NO_PAD.encode(Sha256::digest(bytes));
        if actual != expected {
            return Err("File changed locally before remote removal".to_string());
        }
    }
    let database_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("note.db");
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection,
        &workspace_id,
        "delete",
        object_id.as_deref(),
        Some(&target),
        None,
        None,
        expected_hash.as_deref(),
    )
    .await?;
    match remove_synchronized_file(&target) {
        Ok(()) => {
            update_journal(&mut connection, journal_id, "committed", None).await?;
            Ok(true)
        }
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("file_delete_failed")).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn self_hosted_create_directory(
    app_handle: AppHandle,
    workspace_id: String,
    object_id: Option<String>,
    workspace_root: String,
    relative_path: String,
) -> Result<(), String> {
    let normalized = validate_relative_path(&relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let target = safe_target(&root, &normalized)?;
    reject_symlink_path(&root, &target)?;
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection, &workspace_id, "mkdir", object_id.as_deref(),
        None, Some(&target), None, None,
    ).await?;
    match fs::create_dir_all(&target) {
        Ok(()) => update_journal(&mut connection, journal_id, "committed", None).await,
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("directory_create_failed")).await;
            Err(format!("Failed to create synchronized directory: {error}"))
        }
    }
}

#[tauri::command]
pub async fn self_hosted_delete_directory(
    app_handle: AppHandle,
    workspace_id: String,
    object_id: Option<String>,
    workspace_root: String,
    relative_path: String,
    allow_non_empty: Option<bool>,
) -> Result<bool, String> {
    let normalized = validate_relative_path(&relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let target = safe_target(&root, &normalized)?;
    reject_symlink_path(&root, &target)?;
    if !target.exists() { return Ok(false); }
    if !target.is_dir() { return Err("Synchronized directory path is not a directory".to_string()); }
    if allow_non_empty != Some(true)
        && fs::read_dir(&target).map_err(|error| format!("Failed to inspect directory: {error}"))?.next().is_some() {
        return Err("Remote directory removal conflicts with local contents".to_string());
    }
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection, &workspace_id, "rmdir", object_id.as_deref(),
        Some(&target), None, None, None,
    ).await?;
    match remove_synchronized_directory(&target) {
        Ok(()) => {
            update_journal(&mut connection, journal_id, "committed", None).await?;
            Ok(true)
        }
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("directory_delete_failed")).await;
            Err(error)
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn remove_synchronized_file(path: &Path) -> Result<(), String> {
    trash::delete(path)
        .map_err(|error| format!("Failed to move synchronized file to trash: {error}"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn remove_synchronized_file(path: &Path) -> Result<(), String> {
    fs::remove_file(path)
        .map_err(|error| format!("Failed to remove synchronized file: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn remove_synchronized_directory(path: &Path) -> Result<(), String> {
    trash::delete(path)
        .map_err(|error| format!("Failed to move synchronized directory to trash: {error}"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn remove_synchronized_directory(path: &Path) -> Result<(), String> {
    fs::remove_dir_all(path)
        .map_err(|error| format!("Failed to remove synchronized directory: {error}"))
}

#[tauri::command]
pub async fn self_hosted_move_path(
    app_handle: AppHandle,
    workspace_id: String,
    workspace_root: String,
    source_relative_path: String,
    target_relative_path: String,
) -> Result<(), String> {
    let source_relative_path = validate_relative_path(&source_relative_path)?;
    let target_relative_path = validate_relative_path(&target_relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let source = safe_target(&root, &source_relative_path)?;
    let target = safe_target(&root, &target_relative_path)?;
    reject_symlink_path(&root, &source)?;
    reject_symlink_path(&root, &target)?;
    if !source.exists() { return Err("Move source does not exist".to_string()); }
    if target.exists() { return Err("Move target already exists".to_string()); }
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection, &workspace_id, "move", None,
        Some(&source), Some(&target), None, None,
    ).await?;
    let result = (|| -> Result<(), String> {
        let parent = target.parent().ok_or_else(|| "Move target has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format!("Failed to create move target directory: {error}"))?;
        reject_symlink_path(&root, parent)?;
        fs::rename(&source, &target).map_err(|error| format!("Failed to atomically move path: {error}"))
    })();
    match result {
        Ok(()) => update_journal(&mut connection, journal_id, "committed", None).await,
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("path_move_failed")).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn self_hosted_pending_file_journal(app_handle: AppHandle) -> Result<Vec<i64>, String> {
    let database_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("note.db");
    let mut connection = open_database(&database_path).await?;
    let rows = sqlx::query(
        "select id from self_hosted_file_journal where state not in ('committed', 'rolled-back') order by id",
    )
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("Failed to read file journal: {error}"))?;
    Ok(rows.into_iter().map(|row| row.get::<i64, _>(0)).collect())
}

#[tauri::command]
pub async fn self_hosted_recover_file_journal(app_handle: AppHandle) -> Result<usize, String> {
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let rows = sqlx::query(
        "select id, operation, source_path, target_path, temp_path, expected_hash from self_hosted_file_journal where state not in ('committed', 'rolled-back') order by id",
    ).fetch_all(&mut connection).await
        .map_err(|error| format!("Failed to read file journal: {error}"))?;
    let mut recovered = 0usize;
    for row in rows {
        let id = row.get::<i64, _>(0);
        let operation = row.get::<String, _>(1);
        let source = row.get::<Option<String>, _>(2).map(PathBuf::from);
        let target = row.get::<Option<String>, _>(3).map(PathBuf::from);
        let temp = row.get::<Option<String>, _>(4).map(PathBuf::from);
        let expected_hash = row.get::<Option<String>, _>(5);
        let completed = match operation.as_str() {
            "write" => recover_write(temp.as_deref(), target.as_deref(), expected_hash.as_deref()),
            "mkdir" => Ok(target.as_deref().is_some_and(Path::is_dir)),
            "delete" | "rmdir" => Ok(source.as_deref().map_or(true, |path| !path.exists())),
            "move" => Ok(source.as_deref().is_some_and(|path| !path.exists())
                && target.as_deref().is_some_and(Path::exists)),
            _ => Ok(false),
        }?;
        if completed {
            update_journal(&mut connection, id, "committed", None).await?;
            recovered += 1;
        } else {
            update_journal(&mut connection, id, "failed", Some("recovery_required")).await?;
        }
    }
    Ok(recovered)
}

fn recover_write(temp: Option<&Path>, target: Option<&Path>, expected_hash: Option<&str>) -> Result<bool, String> {
    let Some(target) = target else { return Ok(false); };
    let Some(expected_hash) = expected_hash else { return Ok(false); };
    if target.is_file() && file_hash(target)? == expected_hash { return Ok(true); }
    let Some(temp) = temp else { return Ok(false); };
    if !temp.is_file() || file_hash(temp)? != expected_hash { return Ok(false); }
    atomic_replace(temp, target)?;
    Ok(true)
}

fn file_hash(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Failed to hash journal file: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(bytes)))
}

async fn open_database(path: &Path) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(path).create_if_missing(false),
    )
    .await
    .map_err(|error| format!("Failed to open sync journal database: {error}"))
}

#[allow(clippy::too_many_arguments)]
async fn insert_journal(
    connection: &mut SqliteConnection,
    workspace_id: &str,
    operation: &str,
    object_id: Option<&str>,
    source: Option<&Path>,
    target: Option<&Path>,
    temp: Option<&Path>,
    expected_hash: Option<&str>,
) -> Result<i64, String> {
    let now = epoch_millis();
    let result = sqlx::query(
        "insert into self_hosted_file_journal(workspace_id, operation, object_id, source_path, target_path, temp_path, expected_hash, state, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)",
    )
    .bind(workspace_id)
    .bind(operation)
    .bind(object_id)
    .bind(source.map(path_string))
    .bind(target.map(path_string))
    .bind(temp.map(path_string))
    .bind(expected_hash)
    .bind(now)
    .bind(now)
    .execute(connection)
    .await
    .map_err(|error| format!("Failed to prepare file journal: {error}"))?;
    Ok(result.last_insert_rowid())
}

async fn update_journal(
    connection: &mut SqliteConnection,
    id: i64,
    state: &str,
    error_code: Option<&str>,
) -> Result<(), String> {
    sqlx::query("update self_hosted_file_journal set state = ?, error_code = ?, updated_at = ? where id = ?")
        .bind(state)
        .bind(error_code)
        .bind(epoch_millis())
        .bind(id)
        .execute(connection)
        .await
        .map_err(|error| format!("Failed to update file journal: {error}"))?;
    Ok(())
}

fn safe_workspace_root(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Workspace directory is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Symbolic-link workspace roots are not synchronized".to_string());
    }
    let root = path
        .canonicalize()
        .map_err(|error| format!("Workspace directory is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace root is not a directory".to_string());
    }
    reject_symlink_path(&root, &root)?;
    Ok(root)
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|error| format!("Failed to atomically replace file: {error}"))
}

#[cfg(target_os = "windows")]
fn atomic_replace(source: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return fs::rename(source, target)
            .map_err(|error| format!("Failed to atomically install file: {error}"));
    }
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS}};

    let source_wide = source.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let target_wide = target.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        ReplaceFileW(
            PCWSTR(target_wide.as_ptr()),
            PCWSTR(source_wide.as_ptr()),
            PCWSTR::null(),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| format!("Failed to atomically replace file: {error}"))
}

fn safe_target(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let target = root.join(relative_path);
    if !target.starts_with(root) {
        return Err("File target escapes the workspace".to_string());
    }
    Ok(target)
}

fn reject_symlink_path(root: &Path, target: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    let relative = target.strip_prefix(root).map_err(|_| "File target escapes the workspace".to_string())?;
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("Symbolic links are not synchronized: {}", current.display()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to inspect workspace path: {error}")),
        }
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<String, String> {
    let nfc = value.nfc().collect::<String>().replace('\\', "/");
    let path = Path::new(&nfc);
    if nfc.is_empty() || path.is_absolute() {
        return Err("Workspace path must be relative".to_string());
    }
    let mut normalized = Vec::new();
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err("Workspace path contains an unsafe component".to_string());
        };
        let name = name.to_str().ok_or_else(|| "Workspace path is not valid UTF-8".to_string())?;
        validate_portable_name(name)?;
        normalized.push(name);
    }
    Ok(normalized.join("/"))
}

fn validate_portable_name(name: &str) -> Result<(), String> {
    let upper = name
        .trim_end_matches(|character| character == '.' || character == ' ')
        .to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    let reserved = matches!(stem, "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    if name.is_empty()
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|value| value < ' ' || "<>:\"/\\|?*".contains(value))
        || reserved
    {
        return Err(format!("File name is not portable across platforms: {name}"));
    }
    Ok(())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
