use std::{collections::BTreeMap, fs, path::PathBuf};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const STORE_FILE: &str = "self-hosted-secrets.json";
const MIGRATION_KEY: &str = "self-hosted-sync.legacy-migration-v1";
const STORAGE_UNAVAILABLE: &str = "self-hosted-secure-storage-unavailable";
static STORE_STATE: tokio::sync::Mutex<SecureStoreState> = tokio::sync::Mutex::const_new(SecureStoreState {
    migration_complete: false,
    values: BTreeMap::new(),
    blocked_error: None,
});

struct SecureStoreState {
    migration_complete: bool,
    // Only successful native reads/writes are cached, including a missing entry.
    // Secrets stay in process memory and are never written to a plaintext store.
    values: BTreeMap<String, Option<String>>,
    blocked_error: Option<String>,
}

impl SecureStoreState {
    fn finish<T>(&mut self, result: Result<T, String>) -> Result<T, String> {
        result.map_err(|error| {
            let error = format!("{STORAGE_UNAVAILABLE}: {error}");
            self.values.clear();
            self.blocked_error = Some(error.clone());
            error
        })
    }
}

#[tauri::command]
pub async fn self_hosted_secure_set(app_handle: AppHandle, key: String, value: String) -> Result<(), String> {
    let key = namespaced_key(&key)?;
    let mut state = STORE_STATE.lock().await;
    prepare_store(&app_handle, &mut state).await?;
    let existing = cached_get(&app_handle, &mut state, &key).await?;
    if existing.as_deref() == Some(value.as_str()) {
        return Ok(());
    }
    let result = platform_set(&app_handle, &key, &value).await;
    state.finish(result)?;
    state.values.insert(key, Some(value));
    Ok(())
}

#[tauri::command]
pub async fn self_hosted_secure_get(app_handle: AppHandle, key: String) -> Result<Option<String>, String> {
    let key = namespaced_key(&key)?;
    let mut state = STORE_STATE.lock().await;
    prepare_store(&app_handle, &mut state).await?;
    cached_get(&app_handle, &mut state, &key).await
}

#[tauri::command]
pub async fn self_hosted_secure_delete(app_handle: AppHandle, key: String) -> Result<(), String> {
    let key = namespaced_key(&key)?;
    let mut state = STORE_STATE.lock().await;
    prepare_store(&app_handle, &mut state).await?;
    if matches!(state.values.get(&key), Some(None)) {
        return Ok(());
    }
    let result = platform_delete(&app_handle, &key).await;
    state.finish(result)?;
    state.values.insert(key, None);
    Ok(())
}

// Only an explicit user retry should reopen native credential access. All
// requests queued behind a failed operation otherwise fail without another UI.
#[tauri::command]
pub async fn self_hosted_secure_retry_access() {
    STORE_STATE.lock().await.blocked_error = None;
}

async fn prepare_store(app: &AppHandle, state: &mut SecureStoreState) -> Result<(), String> {
    if let Some(error) = &state.blocked_error {
        return Err(error.clone());
    }
    if !state.migration_complete {
        let result = migrate_legacy(app, &mut state.values).await;
        state.finish(result)?;
        state.migration_complete = true;
    }
    Ok(())
}

async fn cached_get(app: &AppHandle, state: &mut SecureStoreState, key: &str) -> Result<Option<String>, String> {
    if let Some(value) = state.values.get(key) {
        return Ok(value.clone());
    }
    let result = platform_get(app, key).await;
    let value = state.finish(result)?;
    state.values.insert(key.to_string(), value.clone());
    Ok(value)
}

fn namespaced_key(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 128
        || !key.bytes().all(|value| value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-'))
    {
        return Err("Secure storage key is invalid".to_string());
    }
    Ok(format!("self-hosted-sync.{key}"))
}

// A short, opaque account name also fits the existing Android native key API.
fn credential_account(key: &str) -> String {
    format!("shs.{}", URL_SAFE_NO_PAD.encode(Sha256::digest(key.as_bytes())))
}

fn legacy_paths(app: &AppHandle) -> Result<[PathBuf; 2], String> {
    let root = app.path().app_data_dir().map_err(|error| format!("Failed to locate private sync storage: {error}"))?;
    Ok([root.join(STORE_FILE), root.join(format!(".{STORE_FILE}.tmp"))])
}

/** Never rewrite the plaintext file. Copy every entry, verify every native
 * readback, then set a native completion marker before deleting legacy files.
 * A crash or unavailable/locked keychain leaves the original recoverable. The
 * marker prevents a leftover Windows staging file from resurrecting old keys. */
async fn migrate_legacy(app: &AppHandle, cache: &mut BTreeMap<String, Option<String>>) -> Result<(), String> {
    let paths = legacy_paths(app)?;
    if !paths.iter().any(|path| path.exists()) {
        return Ok(());
    }
    if platform_get(app, MIGRATION_KEY).await?.as_deref() != Some("complete") {
        let source = if paths[0].exists() { Some(&paths[0]) } else if paths[1].exists() { Some(&paths[1]) } else { None };
        if let Some(path) = source {
            let bytes = fs::read(path).map_err(|error| format!("Failed to read legacy sync secrets: {error}"))?;
            let values: BTreeMap<String, String> = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Legacy sync secrets are invalid: {error}"))?;
            for (key, value) in &values {
                match platform_get(app, key).await? {
                    Some(existing) if existing != *value => return Err("Legacy and system sync credentials disagree; original secrets have been retained for recovery".to_string()),
                    Some(_) => {},
                    None => platform_set(app, key, value).await?,
                }
                if platform_get(app, key).await?.as_deref() != Some(value.as_str()) {
                    return Err("System sync credential verification failed; original secrets have been retained".to_string());
                }
                cache.insert(key.clone(), Some(value.clone()));
            }
        }
        platform_set(app, MIGRATION_KEY, "complete").await?;
        if platform_get(app, MIGRATION_KEY).await?.as_deref() != Some("complete") {
            return Err("System sync credential migration could not be verified".to_string());
        }
    }
    for path in paths {
        match fs::remove_file(path) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(format!("Failed to remove migrated plaintext sync secrets: {error}")),
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
async fn native_task<T: Send + 'static>(app: &AppHandle, key: &str, action: impl FnOnce(keyring::Entry) -> Result<T, keyring::Error> + Send + 'static) -> Result<T, String> {
    let service = format!("{}.self-hosted-sync", app.config().identifier);
    let account = credential_account(key);
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new(&service, &account)?;
        action(entry)
    }).await.map_err(|error| format!("System sync credential task failed: {error}"))?
        .map_err(|error| format!("System sync credential storage is unavailable: {error}"))
}

async fn platform_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    { return crate::ios_ocr::set_ios_secure_value(app.clone(), credential_account(key), value.to_string()).await; }
    #[cfg(target_os = "android")]
    { return crate::android_cloud_folder::set_android_secure_value(app.clone(), credential_account(key), value.to_string()).await; }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        let value = value.to_string();
        return native_task(app, key, move |entry| entry.set_password(&value)).await;
    }
    #[allow(unreachable_code)]
    Err("This platform has no supported system sync credential store".to_string())
}

async fn platform_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    { return crate::ios_ocr::get_ios_secure_value(app.clone(), credential_account(key)).await; }
    #[cfg(target_os = "android")]
    { return crate::android_cloud_folder::get_android_secure_value(app.clone(), credential_account(key)).await; }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        return native_task(app, key, |entry| match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }).await;
    }
    #[allow(unreachable_code)]
    Err("This platform has no supported system sync credential store".to_string())
}

async fn platform_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    { return crate::ios_ocr::delete_ios_secure_value(app.clone(), credential_account(key)).await; }
    #[cfg(target_os = "android")]
    { return crate::android_cloud_folder::delete_android_secure_value(app.clone(), credential_account(key)).await; }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        return native_task(app, key, |entry| match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }).await;
    }
    #[allow(unreachable_code)]
    Err("This platform has no supported system sync credential store".to_string())
}
