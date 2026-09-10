use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const BACKUP_FORMAT: &str = "notegen-backup";
const BACKUP_VERSION: u32 = 1;
const BACKUP_EXTENSION: &str = "ngbackup";
const MANIFEST_FILE: &str = "manifest.json";
const APP_DATA_PREFIX: &str = "app-data";
const WORKSPACE_PREFIX: &str = "workspace";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedBackupManifest {
    format: String,
    version: u32,
    created_at: u64,
    app_version: String,
    reason: String,
    workspace_included: bool,
    workspace_was_custom: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedBackupInfo {
    path: String,
    name: String,
    created_at: u64,
    size: u64,
    app_version: String,
    reason: String,
    workspace_included: bool,
    valid: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedBackupRestoreResult {
    recovered_workspace_path: Option<String>,
}

fn now_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("System time is before UNIX epoch: {error}"))
}

fn ensure_absolute_directory(path: &str) -> Result<PathBuf, String> {
    let directory = PathBuf::from(path);
    if !directory.is_absolute() {
        return Err("Backup directory must be an absolute path".to_string());
    }
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create backup directory: {error}"))?;
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|error| format!("Failed to inspect backup directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Backup directory must be a real directory".to_string());
    }
    Ok(directory)
}

fn canonical_if_exists(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn is_plugin_local_state_entry(name: &str) -> bool {
    name == "plugins"
        || name == "plugins.json"
        || name == "plugin-data.json"
        || name.starts_with("plugins.json.")
        || name.starts_with("plugin-data.json.")
}

fn should_skip_app_data_entry(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(
            "note.db"
                | "note.db-wal"
                | "note.db-shm"
                | "temp_import.zip"
                | "self-hosted-secrets.json"
                | ".self-hosted-secrets.json.tmp"
        )
    ) || path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "temp_import" || is_plugin_local_state_entry(name))
}

fn path_is_within(path: &Path, parent: &Path) -> bool {
    canonical_if_exists(path).starts_with(canonical_if_exists(parent))
}

async fn create_database_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("Failed to replace database snapshot: {error}"))?;
    }

    let options = SqliteConnectOptions::new().filename(source).read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("Failed to open NoteGen database for backup: {error}"))?;
    let destination_sql = destination.to_string_lossy().replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{destination_sql}'"))
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Failed to create a consistent database snapshot: {error}"))?;
    connection
        .close()
        .await
        .map_err(|error| format!("Failed to close backup database connection: {error}"))?;
    Ok(())
}

fn zip_entry_name(prefix: &str, relative_path: &Path) -> String {
    let relative = relative_path.to_string_lossy().replace('\\', "/");
    if relative.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}/{relative}")
    }
}

fn add_directory_to_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    source_root: &Path,
    current: &Path,
    archive_prefix: &str,
    excluded_roots: &[PathBuf],
    skip_app_data_entries: bool,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(current)
        .map_err(|error| format!("Failed to read {}: {error}", current.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read backup entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink()
            || excluded_roots
                .iter()
                .any(|root| path_is_within(&path, root))
            || (skip_app_data_entries && should_skip_app_data_entry(&path))
        {
            continue;
        }

        let relative = path
            .strip_prefix(source_root)
            .map_err(|error| format!("Failed to build backup path: {error}"))?;
        let archive_name = zip_entry_name(archive_prefix, relative);
        if metadata.is_dir() {
            zip.add_directory(format!("{archive_name}/"), options)
                .map_err(|error| format!("Failed to add backup directory: {error}"))?;
            add_directory_to_zip(
                zip,
                source_root,
                &path,
                archive_prefix,
                excluded_roots,
                skip_app_data_entries,
                options,
            )?;
        } else if metadata.is_file() {
            zip.start_file(archive_name, options)
                .map_err(|error| format!("Failed to add backup file: {error}"))?;
            let mut file = fs::File::open(&path)
                .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
            std::io::copy(&mut file, zip)
                .map_err(|error| format!("Failed to archive {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

fn write_managed_archive(
    archive_path: &Path,
    app_data_dir: &Path,
    database_snapshot: Option<&Path>,
    workspace_dir: Option<&Path>,
    backup_dir: &Path,
    manifest: &ManagedBackupManifest,
    plugin_user_data: &[u8],
) -> Result<(), String> {
    let file = fs::File::create(archive_path)
        .map_err(|error| format!("Failed to create backup archive: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file(MANIFEST_FILE, options)
        .map_err(|error| format!("Failed to add backup manifest: {error}"))?;
    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))?;
    zip.write_all(&manifest_json)
        .map_err(|error| format!("Failed to write backup manifest: {error}"))?;

    zip.start_file("plugin-user-data.json", options)
        .map_err(|error| format!("Failed to add plugin data: {error}"))?;
    zip.write_all(plugin_user_data)
        .map_err(|error| format!("Failed to write plugin data: {error}"))?;

    add_directory_to_zip(
        &mut zip,
        app_data_dir,
        app_data_dir,
        APP_DATA_PREFIX,
        &[backup_dir.to_path_buf()],
        true,
        options,
    )?;

    if let Some(snapshot) = database_snapshot.filter(|path| path.exists()) {
        zip.start_file(format!("{APP_DATA_PREFIX}/note.db"), options)
            .map_err(|error| format!("Failed to add database snapshot: {error}"))?;
        let mut file = fs::File::open(snapshot)
            .map_err(|error| format!("Failed to open database snapshot: {error}"))?;
        std::io::copy(&mut file, &mut zip)
            .map_err(|error| format!("Failed to archive database snapshot: {error}"))?;
    }

    if let Some(workspace) = workspace_dir.filter(|path| path.exists()) {
        let mut workspace_exclusions = vec![backup_dir.to_path_buf()];
        workspace_exclusions.push(workspace.join(".notegen"));
        add_directory_to_zip(
            &mut zip,
            workspace,
            workspace,
            WORKSPACE_PREFIX,
            &workspace_exclusions,
            false,
            options,
        )?;
    }

    zip.finish()
        .map_err(|error| format!("Failed to finish backup archive: {error}"))?;
    Ok(())
}

fn read_manifest(path: &Path) -> Result<ManagedBackupManifest, String> {
    let file = fs::File::open(path).map_err(|error| format!("Failed to open backup: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Invalid backup archive: {error}"))?;
    let mut manifest_file = archive
        .by_name(MANIFEST_FILE)
        .map_err(|_| "Backup manifest is missing".to_string())?;
    let mut content = String::new();
    manifest_file
        .read_to_string(&mut content)
        .map_err(|error| format!("Failed to read backup manifest: {error}"))?;
    let manifest: ManagedBackupManifest = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid backup manifest: {error}"))?;
    if manifest.format != BACKUP_FORMAT || manifest.version != BACKUP_VERSION {
        return Err("Unsupported NoteGen backup format".to_string());
    }
    Ok(manifest)
}

fn backup_info(path: &Path) -> ManagedBackupInfo {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let size = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    match read_manifest(path) {
        Ok(manifest) => ManagedBackupInfo {
            path: path.to_string_lossy().to_string(),
            name,
            created_at: manifest.created_at,
            size,
            app_version: manifest.app_version,
            reason: manifest.reason,
            workspace_included: manifest.workspace_included,
            valid: true,
            error: None,
        },
        Err(error) => ManagedBackupInfo {
            path: path.to_string_lossy().to_string(),
            name,
            created_at: fs::metadata(path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default(),
            size,
            app_version: String::new(),
            reason: String::new(),
            workspace_included: false,
            valid: false,
            error: Some(error),
        },
    }
}

fn managed_backup_paths(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Failed to read backup directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read backup entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect backup entry: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) == Some(BACKUP_EXTENSION) {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn prune_backups(directory: &Path, retention: usize) -> Result<(), String> {
    let retention = retention.clamp(1, 100);
    let mut entries = managed_backup_paths(directory)?
        .into_iter()
        // Never delete an archive we cannot positively identify as a NoteGen backup.
        .filter_map(|path| {
            read_manifest(&path)
                .ok()
                .map(|manifest| (manifest.created_at, path))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in entries.into_iter().skip(retention) {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect old backup: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Refusing to remove unsafe backup path: {}",
                path.display()
            ));
        }
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove old backup {}: {error}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn create_managed_backup(
    app_handle: AppHandle,
    backup_dir: String,
    workspace_path: Option<String>,
    retention: usize,
    reason: Option<String>,
) -> Result<ManagedBackupInfo, String> {
    let backup_directory = ensure_absolute_directory(&backup_dir)?;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate NoteGen data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to prepare NoteGen data directory: {error}"))?;

    if path_is_within(&app_data_dir, &backup_directory) {
        return Err("Backup directory cannot contain NoteGen's live data directory".to_string());
    }

    let created_at = now_millis()?;
    let backup_name = format!("NoteGen-backup-{created_at}.ngbackup");
    let final_path = backup_directory.join(&backup_name);
    let temporary_path = backup_directory.join(format!(".{backup_name}.tmp"));
    let staging_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate backup staging directory: {error}"))?
        .join(format!("backup-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("Failed to create backup staging directory: {error}"))?;
    let database_snapshot = staging_dir.join("note.db");
    let database_source = app_data_dir.join("note.db");

    let result = async {
        create_database_snapshot(&database_source, &database_snapshot).await?;

        let custom_workspace = workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        let workspace_source = custom_workspace
            .clone()
            .unwrap_or_else(|| app_data_dir.join("article"));
        let workspace_is_already_in_app_data = path_is_within(&workspace_source, &app_data_dir);
        let workspace_for_separate_archive = if workspace_is_already_in_app_data {
            None
        } else {
            Some(workspace_source.as_path())
        };
        let backup_reason = reason.unwrap_or_else(|| "manual".to_string());
        let should_prune = backup_reason != "pre-restore";
        let manifest = ManagedBackupManifest {
            format: BACKUP_FORMAT.to_string(),
            version: BACKUP_VERSION,
            created_at,
            app_version: app_handle.package_info().version.to_string(),
            reason: backup_reason,
            workspace_included: workspace_source.exists(),
            workspace_was_custom: custom_workspace.is_some(),
        };

        let plugin_user_data = crate::plugins::snapshot_plugin_user_data(&app_handle, workspace_path.as_deref()).await?;
        write_managed_archive(
            &temporary_path,
            &app_data_dir,
            database_snapshot
                .exists()
                .then_some(database_snapshot.as_path()),
            workspace_for_separate_archive,
            &backup_directory,
            &manifest,
            &plugin_user_data,
        )?;
        fs::rename(&temporary_path, &final_path)
            .map_err(|error| format!("Failed to publish completed backup: {error}"))?;
        if should_prune {
            prune_backups(&backup_directory, retention)?;
        }
        Ok::<ManagedBackupInfo, String>(backup_info(&final_path))
    }
    .await;

    if temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    result
}

#[tauri::command]
pub fn list_managed_backups(backup_dir: String) -> Result<Vec<ManagedBackupInfo>, String> {
    let directory = ensure_absolute_directory(&backup_dir)?;
    let mut backups = managed_backup_paths(&directory)?
        .into_iter()
        .map(|path| backup_info(&path))
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn extract_archive(path: &Path, destination: &Path) -> Result<(), String> {
    let file =
        fs::File::open(path).map_err(|error| format!("Failed to open backup archive: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Invalid backup archive: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read backup entry: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "Backup contains an unsafe path".to_string())?;
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("Failed to create restore directory: {error}"))?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Failed to prepare restore directory: {error}"))?;
            }
            let mut file = fs::File::create(&output)
                .map_err(|error| format!("Failed to create restored file: {error}"))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|error| format!("Failed to restore backup entry: {error}"))?;
        }
    }
    Ok(())
}

fn copy_directory(
    source: &Path,
    destination: &Path,
    skip_app_local_state: bool,
) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create restore destination: {error}"))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("Failed to read restored data: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read restored entry: {error}"))?;
        let source_path = entry.path();
        let entry_name = source_path.file_name().and_then(|name| name.to_str());
        if skip_app_local_state
            && entry_name.is_some_and(|name| name == "article" || is_plugin_local_state_entry(name))
        {
            continue;
        }
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Failed to inspect restored entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let destination_path = destination.join(entry.file_name());
        if metadata.is_dir() {
            copy_directory(&source_path, &destination_path, false)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to restore {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn update_restored_workspace_setting(
    store_path: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    if !store_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(store_path)
        .map_err(|error| format!("Failed to read restored settings: {error}"))?;
    let mut value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse restored settings: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Restored settings are not a JSON object".to_string())?;
    object.insert(
        "workspacePath".to_string(),
        serde_json::Value::String(workspace_path.to_string()),
    );
    let updated = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("Failed to serialize restored settings: {error}"))?;
    fs::write(store_path, updated)
        .map_err(|error| format!("Failed to update restored workspace setting: {error}"))?;
    Ok(())
}

fn preserve_device_local_settings(
    restored_store_path: &Path,
    current_store: Option<&serde_json::Value>,
) -> Result<(), String> {
    let Some(current_object) = current_store.and_then(serde_json::Value::as_object) else {
        return Ok(());
    };
    if !restored_store_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(restored_store_path)
        .map_err(|error| format!("Failed to read restored settings: {error}"))?;
    let mut restored: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse restored settings: {error}"))?;
    let restored_object = restored
        .as_object_mut()
        .ok_or_else(|| "Restored settings are not a JSON object".to_string())?;
    let device_local_fields = [
        "managedBackupDirectory",
        "managedBackupSchedule",
        "managedBackupRetention",
        "managedBackupLastSuccessAt",
        "managedBackupLastError",
        "deviceId",
        "developerMode",
        "developerPerformanceInfo",
        "assetsPath",
        "workspaceHistory",
        "workspaceSyncRepos",
        "githubCustomSyncRepo",
        "giteeCustomSyncRepo",
        "gitlabCustomSyncRepo",
        "giteaCustomSyncRepo",
    ];
    for field in device_local_fields {
        if let Some(value) = current_object.get(field) {
            restored_object.insert(field.to_string(), value.clone());
        } else {
            restored_object.remove(field);
        }
    }
    let updated = serde_json::to_vec_pretty(&restored)
        .map_err(|error| format!("Failed to serialize restored settings: {error}"))?;
    fs::write(restored_store_path, updated)
        .map_err(|error| format!("Failed to preserve device-local settings: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn restore_managed_backup(
    app_handle: AppHandle,
    backup_path: String,
    current_workspace_path: Option<String>,
) -> Result<ManagedBackupRestoreResult, String> {
    let source = PathBuf::from(&backup_path);
    if !source.is_absolute() || !source.exists() {
        return Err("Backup file does not exist".to_string());
    }
    let source_metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("Failed to inspect backup file: {error}"))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        return Err("Backup path must be a real file".to_string());
    }
    let manifest = read_manifest(&source)?;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate NoteGen data directory: {error}"))?;
    let staging_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate restore staging directory: {error}"))?
        .join(format!("restore-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("Failed to create restore staging directory: {error}"))?;

    let result = (|| {
        extract_archive(&source, &staging_dir)?;
        let restored_app_data = staging_dir.join(APP_DATA_PREFIX);
        if !restored_app_data.exists() {
            return Err("Backup does not contain NoteGen application data".to_string());
        }

        let current_store = fs::read_to_string(app_data_dir.join("store.json"))
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok());
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("Failed to prepare NoteGen data directory: {error}"))?;
        for transient in ["note.db-wal", "note.db-shm"] {
            let path = app_data_dir.join(transient);
            if path.exists() {
                fs::remove_file(&path)
                    .map_err(|error| format!("Failed to remove stale database state: {error}"))?;
            }
        }
        copy_directory(&restored_app_data, &app_data_dir, true)?;
        preserve_device_local_settings(&app_data_dir.join("store.json"), current_store.as_ref())?;

        let archived_workspace = if staging_dir.join(WORKSPACE_PREFIX).exists() {
            Some(staging_dir.join(WORKSPACE_PREFIX))
        } else if restored_app_data.join("article").exists() {
            Some(restored_app_data.join("article"))
        } else {
            None
        };

        let recovered_workspace_path = if let Some(workspace) = archived_workspace {
            let recovered = app_data_dir
                .join("restored-workspaces")
                .join(manifest.created_at.to_string());
            copy_directory(&workspace, &recovered, false)?;
            update_restored_workspace_setting(
                &app_data_dir.join("store.json"),
                &recovered.to_string_lossy(),
            )?;
            Some(recovered.to_string_lossy().to_string())
        } else {
            if let Some(workspace) = current_workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
            {
                update_restored_workspace_setting(&app_data_dir.join("store.json"), workspace)?;
            }
            None
        };

        crate::plugins::restore_plugin_user_data(&app_handle, &staging_dir.join("plugin-user-data.json"), recovered_workspace_path.as_deref())?;
        Ok(ManagedBackupRestoreResult {
            recovered_workspace_path,
        })
    })();

    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    result
}
