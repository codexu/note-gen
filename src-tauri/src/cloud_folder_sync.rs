use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFolderFile {
    key: String,
    size: u64,
    modified_at: u64,
    etag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFolderContent {
    content_base64: String,
    size: u64,
    modified_at: u64,
    etag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMigrationResult {
    source_path: String,
    target_path: String,
    copied_files: u64,
    skipped_files: u64,
}

#[cfg(target_os = "ios")]
fn resolve_icloud_sync_folder() -> Result<String, String> {
    use objc2_foundation::NSFileManager;

    // Apple recommends resolving an ubiquity container away from the main thread.
    // The command below runs this function through Tauri's blocking task pool.
    let manager = unsafe { NSFileManager::defaultManager() };
    if unsafe { manager.ubiquityIdentityToken() }.is_none() {
        return Err("iCloud Drive is unavailable. Sign in to iCloud and enable iCloud Drive.".into());
    }

    let container = unsafe { manager.URLForUbiquityContainerIdentifier(None) }
        .ok_or_else(|| "NoteGen could not access its iCloud container.".to_string())?;
    let container_path = unsafe { container.path() }
        .ok_or_else(|| "NoteGen could not resolve its iCloud container path.".to_string())?
        .to_string();
    let documents = PathBuf::from(container_path).join("Documents");
    fs::create_dir_all(&documents)
        .map_err(|error| format!("Failed to create the iCloud Documents directory: {error}"))?;
    ensure_real_directory(&documents)?;
    Ok(documents.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_icloud_sync_folder() -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        return tauri::async_runtime::spawn_blocking(resolve_icloud_sync_folder)
            .await
            .map_err(|error| format!("Failed to resolve the iCloud container: {error}"))?;
    }

    #[cfg(not(target_os = "ios"))]
    Err("Native iCloud sync is only available on iOS.".to_string())
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn ensure_real_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Failed to inspect cloud folder: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!("Unsafe cloud folder path: {}", path.display()));
        }
        return Ok(());
    }

    fs::create_dir(path)
        .map_err(|error| format!("Failed to create cloud folder directory: {error}"))?;
    Ok(())
}

fn sync_root(root: &str, create: bool) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_absolute() {
        return Err("Cloud folder must be an absolute path".to_string());
    }
    if !root_path.exists() {
        return Err("Cloud folder does not exist".to_string());
    }
    ensure_real_directory(&root_path)?;

    let mut current = root_path;
    for segment in [".notegen", "sync-v1"] {
        current.push(segment);
        if current.exists() {
            ensure_real_directory(&current)?;
        } else if create {
            ensure_real_directory(&current)?;
        }
    }
    Ok(current)
}

fn resolve_prefix(root: &str, prefix: &str) -> Result<(PathBuf, PathBuf), String> {
    let base = sync_root(root, false)?;
    let relative = normalized_key(prefix)?;
    let mut current = base.clone();
    let component_count = relative.components().count();
    for (index, component) in relative.components().enumerate() {
        let Component::Normal(segment) = component else {
            return Err("Cloud sync prefix contains an unsafe component".to_string());
        };
        current.push(segment);
        if !current.exists() {
            continue;
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Failed to inspect cloud sync prefix: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Cloud sync prefix is unsafe".to_string());
        }
        if index + 1 < component_count && !metadata.is_dir() {
            return Err("Cloud sync prefix parent must be a directory".to_string());
        }
    }
    Ok((base, current))
}

fn normalized_key(key: &str) -> Result<PathBuf, String> {
    let key_path = Path::new(key);
    if key_path.is_absolute() || key.trim().is_empty() {
        return Err("Cloud sync key must be a non-empty relative path".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in key_path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            _ => return Err("Cloud sync key contains an unsafe path component".to_string()),
        }
    }
    Ok(normalized)
}

fn resolve_file(root: &str, key: &str, create_parents: bool) -> Result<PathBuf, String> {
    let base = sync_root(root, create_parents)?;
    let relative = normalized_key(key)?;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let mut current = base.clone();
    for component in parent.components() {
        let Component::Normal(segment) = component else {
            return Err("Cloud sync key contains an unsafe parent".to_string());
        };
        current.push(segment);
        if current.exists() {
            ensure_real_directory(&current)?;
        } else if create_parents {
            ensure_real_directory(&current)?;
        }
    }

    let destination = base.join(relative);
    if destination.exists() {
        let metadata = fs::symlink_metadata(&destination)
            .map_err(|error| format!("Failed to inspect cloud sync file: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Cloud sync target must be a real file".to_string());
        }
    }
    Ok(destination)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Failed to open workspace file: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read workspace file: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_workspace_copy_plan(
    source_root: &Path,
    source: &Path,
    target: &Path,
    files: &mut Vec<(PathBuf, PathBuf)>,
    skipped_files: &mut u64,
) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read current workspace: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read workspace entry: {error}"))?;
        let source_path = entry.path();
        let relative = source_path
            .strip_prefix(source_root)
            .map_err(|error| format!("Failed to resolve workspace entry: {error}"))?;
        if relative.components().count() == 1 && entry.file_name() == ".notegen" {
            continue;
        }

        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Failed to inspect workspace entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Workspace contains an unsupported symbolic link: {}",
                relative.display()
            ));
        }
        let target_path = target.join(relative);

        if metadata.is_dir() {
            if target_path.exists() {
                ensure_real_directory(&target_path)?;
            }
            collect_workspace_copy_plan(source_root, &source_path, target, files, skipped_files)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }

        if target_path.exists() {
            let target_metadata = fs::symlink_metadata(&target_path)
                .map_err(|error| format!("Failed to inspect cloud workspace file: {error}"))?;
            if target_metadata.file_type().is_symlink() || !target_metadata.is_file() {
                return Err(format!(
                    "Cloud workspace has a conflicting entry: {}",
                    relative.display()
                ));
            }
            if metadata.len() == target_metadata.len()
                && sha256_file(&source_path)? == sha256_file(&target_path)?
            {
                *skipped_files += 1;
                continue;
            }
            return Err(format!(
                "Cloud workspace already contains a different file: {}",
                relative.display()
            ));
        }
        files.push((source_path, target_path));
    }
    Ok(())
}

fn copy_workspace_file(source: &Path, target_root: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Cloud workspace file has no parent directory".to_string())?;
    let relative_parent = parent
        .strip_prefix(target_root)
        .map_err(|error| format!("Failed to resolve cloud workspace directory: {error}"))?;
    let mut current = target_root.to_path_buf();
    for component in relative_parent.components() {
        let Component::Normal(segment) = component else {
            return Err("Cloud workspace contains an unsafe directory".to_string());
        };
        current.push(segment);
        ensure_real_directory(&current)?;
    }
    let mut created_target = false;
    let result = (|| {
        let mut source_file = fs::File::open(source)
            .map_err(|error| format!("Failed to open workspace file: {error}"))?;
        let mut target_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|error| format!("Failed to create cloud workspace file: {error}"))?;
        created_target = true;
        io::copy(&mut source_file, &mut target_file)
            .map_err(|error| format!("Failed to copy workspace file: {error}"))?;
        target_file
            .sync_all()
            .map_err(|error| format!("Failed to flush copied workspace file: {error}"))?;
        Ok(())
    })();
    if result.is_err() && created_target && target.exists() {
        let _ = fs::remove_file(target);
    }
    result
}

fn migrate_workspace(source: &Path, target: &Path) -> Result<(u64, u64), String> {
    if source == target {
        return Ok((0, 0));
    }
    if target.starts_with(source) {
        return Err("Cloud workspace cannot be inside the current workspace".to_string());
    }
    if source.starts_with(target) {
        return Err("Current workspace is already inside the cloud folder".to_string());
    }

    let mut files = Vec::new();
    let mut skipped_files = 0;
    collect_workspace_copy_plan(source, source, target, &mut files, &mut skipped_files)?;
    for (source_file, target_file) in &files {
        copy_workspace_file(source_file, target, target_file)?;
    }
    Ok((files.len() as u64, skipped_files))
}

fn read_content(path: &Path) -> Result<CloudFolderContent, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect cloud sync file: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Cloud sync target must be a real file".to_string());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Failed to read cloud sync file: {error}"))?;
    Ok(CloudFolderContent {
        content_base64: BASE64.encode(&bytes),
        size: bytes.len() as u64,
        modified_at: modified_millis(&metadata),
        etag: sha256(&bytes),
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Cloud sync target has no parent directory".to_string())?;
    let temporary = parent.join(format!(".notegen-write-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Failed to create temporary cloud sync file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("Failed to write cloud sync file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to flush cloud sync file: {error}"))?;

        #[cfg(target_os = "windows")]
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Failed to replace cloud sync file: {error}"))?;
        }
        fs::rename(&temporary, path)
            .map_err(|error| format!("Failed to publish cloud sync file: {error}"))?;
        Ok(())
    })();

    if temporary.exists() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn collect_files(
    base: &Path,
    current: &Path,
    files: &mut Vec<CloudFolderFile>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current)
        .map_err(|error| format!("Failed to list cloud sync directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read cloud sync entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect cloud sync entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_files(base, &path, files)?;
        } else if metadata.is_file() {
            let mut file = fs::File::open(&path)
                .map_err(|error| format!("Failed to open cloud sync entry: {error}"))?;
            let mut hasher = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file
                    .read(&mut buffer)
                    .map_err(|error| format!("Failed to hash cloud sync entry: {error}"))?;
                if count == 0 {
                    break;
                }
                hasher.update(&buffer[..count]);
            }
            let key = path
                .strip_prefix(base)
                .map_err(|error| format!("Failed to resolve cloud sync entry: {error}"))?
                .to_string_lossy()
                .replace('\\', "/");
            files.push(CloudFolderFile {
                key,
                size: metadata.len(),
                modified_at: modified_millis(&metadata),
                etag: format!("{:x}", hasher.finalize()),
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn test_cloud_folder_sync(root: String) -> Result<bool, String> {
    let manifest = resolve_file(&root, "provider.json", true)?;
    if !manifest.exists() {
        atomic_write(
            &manifest,
            b"{\n  \"format\": \"notegen-cloud-folder-sync\",\n  \"version\": 1\n}\n",
        )?;
    }

    let probe_key = format!(".notegen-probe-{}.tmp", Uuid::new_v4());
    let probe = resolve_file(&root, &probe_key, true)?;
    let content = Uuid::new_v4().to_string();
    let result = (|| {
        atomic_write(&probe, content.as_bytes())?;
        Ok(read_content(&probe)?.content_base64 == BASE64.encode(content.as_bytes()))
    })();
    if probe.exists() {
        fs::remove_file(&probe)
            .map_err(|error| format!("Failed to clean cloud sync probe: {error}"))?;
    }
    result
}

#[tauri::command]
pub fn write_cloud_folder_sync_file(
    root: String,
    key: String,
    content_base64: String,
) -> Result<CloudFolderFile, String> {
    let path = resolve_file(&root, &key, true)?;
    let bytes = BASE64
        .decode(content_base64)
        .map_err(|error| format!("Cloud sync content is not valid Base64: {error}"))?;
    atomic_write(&path, &bytes)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Failed to inspect written cloud sync file: {error}"))?;
    Ok(CloudFolderFile {
        key: normalized_key(&key)?.to_string_lossy().replace('\\', "/"),
        size: metadata.len(),
        modified_at: modified_millis(&metadata),
        etag: sha256(&bytes),
    })
}

#[tauri::command]
pub fn read_cloud_folder_sync_file(
    root: String,
    key: String,
) -> Result<Option<CloudFolderContent>, String> {
    let path = resolve_file(&root, &key, false)?;
    if !path.exists() {
        return Ok(None);
    }
    read_content(&path).map(Some)
}

#[tauri::command]
pub fn delete_cloud_folder_sync_file(root: String, key: String) -> Result<bool, String> {
    let path = resolve_file(&root, &key, false)?;
    if !path.exists() {
        return Ok(true);
    }
    fs::remove_file(path).map_err(|error| format!("Failed to delete cloud sync file: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn list_cloud_folder_sync_files(
    root: String,
    prefix: Option<String>,
) -> Result<Vec<CloudFolderFile>, String> {
    let base = sync_root(&root, false)?;
    if !base.exists() {
        return Ok(Vec::new());
    }
    let current = if let Some(prefix) = prefix.filter(|value| !value.trim().is_empty()) {
        let (resolved_base, path) = resolve_prefix(&root, &prefix)?;
        debug_assert_eq!(base, resolved_base);
        if path.exists() {
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("Failed to inspect cloud sync prefix: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err("Cloud sync prefix is unsafe".to_string());
            }
            if metadata.is_file() {
                return read_content(&path).map(|content| {
                    vec![CloudFolderFile {
                        key: path
                            .strip_prefix(&base)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .replace('\\', "/"),
                        size: content.size,
                        modified_at: content.modified_at,
                        etag: content.etag,
                    }]
                });
            }
        }
        path
    } else {
        base.clone()
    };

    let mut files = Vec::new();
    collect_files(&base, &current, &mut files)?;
    files.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(files)
}

#[tauri::command]
pub fn migrate_workspace_to_cloud_folder(
    app: tauri::AppHandle,
    root: String,
    source_path: Option<String>,
) -> Result<WorkspaceMigrationResult, String> {
    let target = PathBuf::from(&root);
    if !target.is_absolute() || !target.exists() {
        return Err("Cloud workspace must be an existing absolute directory".to_string());
    }
    ensure_real_directory(&target)?;
    let target = target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve cloud workspace: {error}"))?;

    let source = match source_path.filter(|value| !value.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
            .join("article"),
    };
    if !source.is_absolute() || !source.exists() {
        return Err("Current workspace directory does not exist".to_string());
    }
    ensure_real_directory(&source)?;
    let source = source
        .canonicalize()
        .map_err(|error| format!("Failed to resolve current workspace: {error}"))?;

    let (copied_files, skipped_files) = migrate_workspace(&source, &target)?;

    Ok(WorkspaceMigrationResult {
        source_path: source.to_string_lossy().to_string(),
        target_path: target.to_string_lossy().to_string(),
        copied_files,
        skipped_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_migration_copies_skips_and_rejects_conflicts() {
        let root = std::env::temp_dir().join(format!("notegen-cloud-migration-{}", Uuid::new_v4()));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(source.join("folder")).unwrap();
        fs::create_dir_all(target.join(".notegen/sync-v1")).unwrap();
        fs::write(source.join("folder/note.md"), "original note").unwrap();
        fs::write(source.join("same.md"), "same").unwrap();
        fs::write(target.join("same.md"), "same").unwrap();
        fs::write(target.join(".notegen/sync-v1/provider.json"), "{}").unwrap();

        let result = migrate_workspace(&source, &target).unwrap();
        assert_eq!(result, (1, 1));
        assert_eq!(
            fs::read_to_string(source.join("folder/note.md")).unwrap(),
            "original note"
        );
        assert_eq!(
            fs::read_to_string(target.join("folder/note.md")).unwrap(),
            "original note"
        );
        assert!(target.join(".notegen/sync-v1/provider.json").exists());

        let second = migrate_workspace(&source, &target).unwrap();
        assert_eq!(second, (0, 2));
        fs::write(source.join("same.md"), "changed locally").unwrap();
        let conflict = migrate_workspace(&source, &target).unwrap_err();
        assert!(conflict.contains("different file"));
        assert_eq!(fs::read_to_string(target.join("same.md")).unwrap(), "same");

        fs::remove_dir_all(root).unwrap();
    }
}
