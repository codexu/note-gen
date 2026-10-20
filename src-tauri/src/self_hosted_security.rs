use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const STORE_FILE: &str = "self-hosted-secrets.json";
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn self_hosted_secure_set(
    app_handle: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let key = namespaced_key(&key)?;
    secure_set(app_handle, key, value).await
}

#[tauri::command]
pub async fn self_hosted_secure_get(
    app_handle: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let key = namespaced_key(&key)?;
    secure_get(app_handle, key).await
}

#[tauri::command]
pub async fn self_hosted_secure_delete(app_handle: AppHandle, key: String) -> Result<(), String> {
    let key = namespaced_key(&key)?;
    secure_delete(app_handle, key).await
}

fn namespaced_key(key: &str) -> Result<String, String> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-'))
    {
        return Err("Secure storage key is invalid".to_string());
    }
    Ok(format!("self-hosted-sync.{key}"))
}

async fn secure_set(app_handle: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = store_path(&app_handle)?;
    run_store_task(move || {
        let mut values = read_store(&path)?;
        values.insert(key, value);
        write_store(&path, &values)
    })
    .await
}

async fn secure_get(app_handle: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = store_path(&app_handle)?;
    run_store_task(move || Ok(read_store(&path)?.get(&key).cloned())).await
}

async fn secure_delete(app_handle: AppHandle, key: String) -> Result<(), String> {
    let path = store_path(&app_handle)?;
    run_store_task(move || {
        let mut values = read_store(&path)?;
        if values.remove(&key).is_some() {
            write_store(&path, &values)?;
        }
        Ok(())
    })
    .await
}

fn store_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(STORE_FILE))
        .map_err(|error| format!("Failed to locate private sync storage: {error}"))
}

async fn run_store_task<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Private sync storage lock is unavailable".to_string())?;
        task()
    })
    .await
    .map_err(|error| format!("Private sync storage task failed: {error}"))?
}

fn read_store(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let contents = fs::read(path)
        .map_err(|error| format!("Failed to read private sync storage: {error}"))?;
    serde_json::from_slice(&contents)
        .map_err(|error| format!("Private sync storage is invalid: {error}"))
}

fn write_store(path: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Private sync storage has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to prepare private sync storage: {error}"))?;
    let temporary = parent.join(format!(".{STORE_FILE}.tmp"));
    let contents = serde_json::to_vec(values)
        .map_err(|error| format!("Failed to encode private sync storage: {error}"))?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Failed to stage private sync storage: {error}"))?;
    file.write_all(&contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist private sync storage: {error}"))?;
    drop(file);
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to replace private sync storage: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Failed to publish private sync storage: {error}"))
}
