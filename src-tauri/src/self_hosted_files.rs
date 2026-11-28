use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
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

use crate::backup::is_sync_credential_path;

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
pub fn self_hosted_move_source_path(relative_path: String) -> Result<String, String> {
    normalize_relative_path(&relative_path, cfg!(target_os = "windows"))
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
pub fn self_hosted_structured_object_id(
    workspace_id: String,
    domain: String,
    local_key: String,
) -> Result<String, String> {
    let namespace = Uuid::parse_str(&workspace_id).map_err(|_| "Workspace ID is invalid".to_string())?;
    if !matches!(domain.as_str(), "tag" | "mark" | "conversation" | "message" | "memory" | "canvas" | "setting")
        || local_key.is_empty()
    {
        return Err("Structured object identity is invalid".to_string());
    }
    let identity = format!("{domain}/{local_key}").nfc().collect::<String>();
    // Preserve UUIDs produced by the original importer for portable keys.
    // Logical keys such as quick-record:<uuid> never become filesystem paths.
    let normalized = validate_relative_path(&identity).unwrap_or(identity);
    Ok(Uuid::new_v5(&namespace, normalized.as_bytes()).to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSnapshot {
    hash: Option<String>,
    #[serde(default)]
    accept_identical: bool,
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
    target_snapshot: Option<TargetSnapshot>,
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
    if let Some(snapshot) = target_snapshot.as_ref().filter(|snapshot| snapshot.accept_identical) {
        reject_symlink_path(&root, &target)?;
        if !guarded_editor_write_needed(&target, snapshot.hash.as_deref(), &expected_hash)? {
            return Ok(());
        }
    }
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
    let operation = if target_snapshot.is_some() { "guarded-write" } else { "write" };
    let journal_id = insert_journal(
        &mut connection,
        &workspace_id,
        operation,
        object_id.as_deref(),
        None,
        Some(&target),
        Some(&temp),
        Some(&expected_hash),
    )
    .await?;

    let result = (|| -> Result<bool, String> {
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
        drop(file);
        if let Some(snapshot) = &target_snapshot {
            if !target_matches_snapshot(&target, snapshot.hash.as_deref())? {
                fs::remove_file(&temp)
                    .map_err(|error| format!("Failed to remove interrupted sync temporary file: {error}"))?;
                return Ok(false);
            }
        }
        if target_snapshot.as_ref().is_some_and(|snapshot| snapshot.hash.is_none()) {
            match rename_without_overwriting(&temp, &target) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    fs::remove_file(&temp)
                        .map_err(|error| format!("Failed to remove interrupted sync temporary file: {error}"))?;
                    return Ok(false);
                }
                Err(error) => return Err(format!("Failed to atomically install file: {error}")),
            }
        } else {
            atomic_replace(&temp, &target)?;
        }
        if let Some(parent) = target.parent() {
            if let Ok(directory) = fs::File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(true)
    })();

    match result {
        Ok(true) => update_journal(&mut connection, journal_id, "committed", None).await,
        Ok(false) => {
            update_journal(&mut connection, journal_id, "rolled-back", None).await?;
            Err("remote_asset_local_activity".to_string())
        }
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("file_write_failed")).await;
            Err(error)
        }
    }
}

fn guarded_editor_write_needed(path: &Path, baseline: Option<&str>, desired: &str) -> Result<bool, String> {
    let current = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Some(file_hash(path)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Failed to inspect sync target: {error}")),
        Ok(_) => return Err("remote_asset_local_activity".to_string()),
    };
    let current = current.as_deref();
    if current == Some(desired) { return Ok(false); }
    if current != baseline { return Err("remote_asset_local_activity".to_string()); }
    Ok(true)
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
    previous_relative_path: Option<String>,
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
    let result = (|| -> Result<(), String> {
        if let Some(previous) = previous_relative_path {
            let source = safe_target(&root, &self_hosted_move_source_path(previous)?)?;
            reject_symlink_path(&root, &source)?;
            if source.is_dir() && case_only_move_state(&source, &target)? == Some(CaseOnlyMove::NeedsRename) {
                return rename_without_overwriting(&source, &target)
                    .map_err(|error| format!("Failed to rename synchronized directory: {error}"));
            }
        }
        fs::create_dir_all(&target).map_err(|error| format!("Failed to create synchronized directory: {error}"))
    })();
    match result {
        Ok(()) => update_journal(&mut connection, journal_id, "committed", None).await,
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("directory_create_failed")).await;
            Err(error)
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
    preserve_relative_path: Option<String>,
) -> Result<bool, String> {
    let normalized = validate_relative_path(&relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let target = safe_target(&root, &normalized)?;
    reject_symlink_path(&root, &target)?;
    let preserve = preserve_relative_path.as_deref()
        .map(|path| safe_target(&root, &validate_relative_path(path)?))
        .transpose()?;
    if let Some(preserve) = &preserve { reject_symlink_path(&root, preserve)?; }
    if directory_is_preserved(&target, preserve.as_deref())? { return Ok(false); }
    if !target.exists() { return Ok(false); }
    if !target.is_dir() { return Err("Synchronized directory path is not a directory".to_string()); }
    let recursive = allow_non_empty == Some(true);
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let journal_id = insert_journal(
        &mut connection, &workspace_id, if recursive { "rmdir" } else { "guarded-rmdir" }, object_id.as_deref(),
        Some(&target), None, None, None,
    ).await?;
    let result = reject_symlink_path(&root, &target).and_then(|()| {
        if recursive { remove_synchronized_directory(&target).map(|()| true) }
        else { remove_empty_synchronized_directory(&target, preserve.as_deref()) }
    });
    match result {
        Ok(removed) => {
            let state = if removed { "committed" } else { "rolled-back" };
            update_journal(&mut connection, journal_id, state, None).await?;
            Ok(removed)
        }
        Err(error) if !recursive => {
            // A later inbox pass can re-evaluate a guarded deletion. Retain
            // local contents and never leave a failed cleanup blocking recovery.
            update_journal(&mut connection, journal_id, "rolled-back", None).await?;
            Err(error)
        }
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("directory_delete_failed")).await;
            Err(error)
        }
    }
}

fn directory_is_preserved(target: &Path, preserve: Option<&Path>) -> Result<bool, String> {
    match preserve {
        Some(preserve) => Ok(target == preserve || case_only_move_state(target, preserve)?.is_some()),
        None => Ok(false),
    }
}

fn remove_empty_synchronized_directory(target: &Path, preserve: Option<&Path>) -> Result<bool, String> {
    if directory_is_preserved(target, preserve)? { return Ok(false); }
    match fs::remove_dir(target) {
        Ok(()) => Ok(true),
        Err(error) => match error.kind() {
            std::io::ErrorKind::NotFound => Ok(false),
            std::io::ErrorKind::DirectoryNotEmpty => Err("Remote directory removal conflicts with local contents".to_string()),
            _ => Err(format!("Failed to remove empty synchronized directory: {error}")),
        },
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
    remote_object_id: Option<String>,
) -> Result<bool, String> {
    // Existing macOS/Linux files may predate portable-name enforcement. Allow
    // renaming those sources into a portable target, while retaining traversal
    // and symlink protection. Windows sources still reject alternate streams.
    let source_relative_path = self_hosted_move_source_path(source_relative_path)?;
    let target_relative_path = validate_relative_path(&target_relative_path)?;
    let root = safe_workspace_root(&workspace_root)?;
    let source = safe_target(&root, &source_relative_path)?;
    let target = safe_target(&root, &target_relative_path)?;
    reject_symlink_path(&root, &source)?;
    reject_symlink_path(&root, &target)?;
    let database_path = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?.join("note.db");
    let mut connection = open_database(&database_path).await?;
    let operation = if let Some(object_id) = remote_object_id.as_deref() {
        // The inbox owns the mapping update. A committed journal row proves
        // this move already ran even if a user has since reused the old name.
        let previous = sqlx::query(
            "select id, state from self_hosted_file_journal
             where workspace_id = ? and object_id = ? and operation = 'received-move'
               and source_path = ? and target_path = ? and state in ('prepared', 'committed')
             order by id desc limit 1",
        )
        .bind(&workspace_id)
        .bind(object_id)
        .bind(path_string(&source))
        .bind(path_string(&target))
        .fetch_optional(&mut connection)
        .await
        .map_err(|error| format!("Failed to read move journal: {error}"))?;
        if let Some(previous) = previous {
            let state = previous.get::<String, _>("state");
            if state == "committed" { return Ok(true); }
            if path_move_completed(&source, &target)? && target.is_file() {
                update_journal(&mut connection, previous.get("id"), "committed", None).await?;
                return Ok(true);
            }
            update_journal(&mut connection, previous.get("id"), "rolled-back", None).await?;
        }
        if target.exists() && case_only_move_state(&source, &target)?.is_none() {
            return Err("remote_path_move_local_activity".to_string());
        }
        if source.exists() && !source.is_file() {
            return Err("remote_path_move_local_activity".to_string());
        }
        "received-move"
    } else {
        if !source.exists() { return Err("Move source does not exist".to_string()); }
        if target.exists() && case_only_move_state(&source, &target)?.is_none() {
            return Err("Move target already exists".to_string());
        }
        "move"
    };
    let journal_id = insert_journal(
        &mut connection, &workspace_id, operation, remote_object_id.as_deref(),
        Some(&source), Some(&target), None, None,
    ).await?;
    if remote_object_id.is_some() && !source.exists() {
        // The inbox will hydrate the missing source at the new path. Keep its
        // destination tied to this object until the mapping and snapshot land.
        update_journal(&mut connection, journal_id, "committed", None).await?;
        return Ok(false);
    }
    let result = (|| -> Result<(), String> {
        let parent = target.parent().ok_or_else(|| "Move target has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format!("Failed to create move target directory: {error}"))?;
        reject_symlink_path(&root, parent)?;
        let case_move = case_only_move_state(&source, &target)?;
        if remote_object_id.is_some() {
            reject_symlink_path(&root, &source)?;
            if !source.is_file() || (case_move.is_none() && !target_matches_snapshot(&target, None)?) {
                return Err("remote_path_move_local_activity".to_string());
            }
            if case_move == Some(CaseOnlyMove::AlreadyRenamed) { return Ok(()); }
            return rename_without_overwriting(&source, &target).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "remote_path_move_local_activity".to_string()
                } else {
                    format!("Failed to atomically move synchronized file: {error}")
                }
            });
        }
        if case_move == Some(CaseOnlyMove::AlreadyRenamed) { return Ok(()); }
        if case_move == Some(CaseOnlyMove::NeedsRename) {
            return rename_without_overwriting(&source, &target)
                .map_err(|error| format!("Failed to atomically move path: {error}"));
        }
        fs::rename(&source, &target).map_err(|error| format!("Failed to atomically move path: {error}"))
    })();
    match result {
        Ok(()) => {
            for directory in [source.parent(), target.parent()].into_iter().flatten() {
                if let Ok(directory) = fs::File::open(directory) {
                    let _ = directory.sync_all();
                }
            }
            update_journal(&mut connection, journal_id, "committed", None).await?;
            Ok(true)
        }
        Err(error) if remote_object_id.is_some() => {
            update_journal(&mut connection, journal_id, "rolled-back", None).await?;
            Err(error)
        }
        Err(error) => {
            let _ = update_journal(&mut connection, journal_id, "failed", Some("path_move_failed")).await;
            Err(error)
        }
    }
}

#[derive(PartialEq, Eq)]
enum CaseOnlyMove {
    NeedsRename,
    AlreadyRenamed,
}

fn case_only_move_state(source: &Path, target: &Path) -> Result<Option<CaseOnlyMove>, String> {
    if source == target || !source.exists() || !target.exists() {
        return Ok(None);
    }
    let (Some(source_parent), Some(target_parent), Some(source_name), Some(target_name)) = (
        source.parent(), target.parent(), source.file_name(), target.file_name(),
    ) else { return Ok(None); };
    let source_name = source_name.to_string_lossy().nfc().collect::<String>();
    let target_name = target_name.to_string_lossy().nfc().collect::<String>();
    if source_name.to_lowercase() != target_name.to_lowercase() {
        return Ok(None);
    }
    if source_parent != target_parent {
        let canonical_parent = |parent: &Path| parent.canonicalize()
            .map_err(|error| format!("Failed to resolve move parent: {error}"));
        if canonical_parent(source_parent)? != canonical_parent(target_parent)? {
            return Ok(None);
        }
    }
    // Filesystem lookups can resolve both spellings to one entry. Inspect the
    // actual directory entries to distinguish that from two existing paths.
    let mut has_source = false;
    let mut has_target = false;
    let entries = fs::read_dir(target_parent).map_err(|error| format!("Failed to inspect move parent: {error}"))?;
    for entry in entries {
        let name = entry.map_err(|error| format!("Failed to inspect move entry: {error}"))?
            .file_name().to_string_lossy().nfc().collect::<String>();
        has_source |= name == source_name;
        has_target |= name == target_name;
    }
    Ok(match (has_source, has_target) {
        (true, false) => Some(CaseOnlyMove::NeedsRename),
        (false, true) => Some(CaseOnlyMove::AlreadyRenamed),
        (true, true) if source_name == target_name => Some(CaseOnlyMove::AlreadyRenamed),
        _ => None,
    })
}

fn path_move_completed(source: &Path, target: &Path) -> Result<bool, String> {
    Ok(target.exists() && (!source.exists()
        || case_only_move_state(source, target)? == Some(CaseOnlyMove::AlreadyRenamed)))
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux", target_os = "android"))]
fn rename_without_overwriting(source: &Path, target: &Path) -> std::io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    Ok(renameat_with(CWD, source, CWD, target, RenameFlags::NOREPLACE)?)
}

#[cfg(target_os = "windows")]
fn rename_without_overwriting(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
    };
    let source = source.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let target = target.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr()), MOVEFILE_WRITE_THROUGH)
    }
    .map_err(|error| std::io::Error::from_raw_os_error(error.code().0 & 0xffff))
}

#[tauri::command]
pub async fn self_hosted_flush_switch_data(
    app_handle: AppHandle,
    relative_path: String,
) -> Result<(), String> {
    let directory = relative_path
        .strip_prefix("self-hosted-switch-backups/")
        .or_else(|| relative_path.strip_prefix("restored-workspaces/self-hosted-"))
        .ok_or_else(|| "Invalid self-hosted backup directory".to_string())?;
    let (timestamp, identity) = directory
        .split_once('-')
        .ok_or_else(|| "Invalid self-hosted backup identity".to_string())?;
    if timestamp.is_empty()
        || !timestamp.bytes().all(|value| value.is_ascii_digit())
        || Uuid::parse_str(identity).is_err()
    {
        return Err("Invalid self-hosted backup identity".to_string());
    }
    let root = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to locate self-hosted backup: {error}"))?;
    let target = root.join(&relative_path);
    reject_symlink_path(&root, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        fn flush(path: &Path) -> Result<(), String> {
            let metadata = fs::symlink_metadata(path)
                .map_err(|error| format!("Failed to inspect backup data: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err("Backup data must not contain symbolic links".to_string());
            }
            if metadata.is_dir() {
                for entry in fs::read_dir(path)
                    .map_err(|error| format!("Failed to read backup directory: {error}"))?
                {
                    flush(&entry.map_err(|error| error.to_string())?.path())?;
                }
                #[cfg(unix)]
                fs::File::open(path).and_then(|directory| directory.sync_all())
                    .map_err(|error| format!("Failed to persist backup directory: {error}"))?;
            } else if metadata.is_file() {
                OpenOptions::new().read(true).write(true).open(path)
                    .and_then(|file| file.sync_all())
                    .map_err(|error| format!("Failed to persist backup data: {error}"))?;
            } else {
                return Err("Backup contains an unsupported filesystem entry".to_string());
            }
            Ok(())
        }
        if relative_path.starts_with("self-hosted-switch-backups/") && !target.join("manifest.json").is_file() {
            return Err("Backup manifest is missing".to_string());
        }
        flush(&target)?;
        #[cfg(unix)]
        if let Some(parent) = target.parent() {
            fs::File::open(parent).and_then(|directory| directory.sync_all())
                .map_err(|error| format!("Failed to persist backup parent directory: {error}"))?;
        }
        #[cfg(unix)]
        fs::File::open(&root).and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Failed to persist application data directory: {error}"))?;
        Ok(())
    }).await.map_err(|error| format!("Backup durability task failed: {error}"))?
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
            "guarded-write" => recover_guarded_write(temp.as_deref(), target.as_deref(), expected_hash.as_deref()),
            "mkdir" => Ok(target.as_deref().is_some_and(Path::is_dir)),
            "delete" | "rmdir" | "guarded-rmdir" => Ok(source.as_deref().map_or(true, |path| !path.exists())),
            "move" | "received-move" => match (source.as_deref(), target.as_deref()) {
                (Some(source), Some(target)) => path_move_completed(source, target),
                _ => Ok(false),
            },
            _ => Ok(false),
        }?;
        if completed {
            update_journal(&mut connection, id, "committed", None).await?;
            recovered += 1;
        } else if matches!(operation.as_str(), "guarded-write" | "guarded-rmdir" | "received-move") {
            update_journal(&mut connection, id, "rolled-back", None).await?;
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

fn recover_guarded_write(temp: Option<&Path>, target: Option<&Path>, expected_hash: Option<&str>) -> Result<bool, String> {
    // Let the persistent inbox retry interrupted writes after inspecting the
    // current file. Installing a journal temp could overwrite a newer edit.
    let completed = match (target, expected_hash) {
        (Some(target), Some(expected_hash)) => target_matches_snapshot(target, Some(expected_hash))?,
        _ => false,
    };
    if let Some(temp) = temp {
        match fs::remove_file(temp) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to remove interrupted sync temporary file: {error}")),
        }
    }
    Ok(completed)
}

fn target_matches_snapshot(path: &Path, hash: Option<&str>) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => match hash {
            Some(expected_hash) => Ok(file_hash(path)? == expected_hash),
            None => Ok(false),
        },
        Ok(_) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(hash.is_none()),
        Err(error) => Err(format!("Failed to inspect sync target: {error}")),
    }
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
    if is_sync_credential_path(&root) {
        return Err("The private credential store cannot be used as a workspace".to_string());
    }
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
    if is_sync_credential_path(&target) {
        return Err("The private credential store cannot be used as a workspace target".to_string());
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
    normalize_relative_path(value, true)
}

fn normalize_relative_path(value: &str, require_portable: bool) -> Result<String, String> {
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
        if require_portable {
            validate_portable_name(name)?;
        }
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
