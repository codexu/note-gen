use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::backup::PRIVATE_SYNC_CREDENTIALS_DIRECTORY;

const STORE_FILE: &str = "credentials.dat";
const STORE_HEADER: &[u8] = b"NoteGen credentials\0\x01";
// Hold the lock inside the blocking task so cancelling an IPC call cannot
// interrupt a read-modify-write or let a second writer use a stale snapshot.
static STORE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) async fn get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let key = key.to_owned();
    access_store(app, move |directory| Ok(read_store(directory)?.remove(&key))).await
}

pub(crate) async fn set(app: &AppHandle, key: &str, value: Option<String>) -> Result<(), String> {
    set_many(app, [(key.to_owned(), value)]).await
}

pub(crate) async fn set_many<const N: usize>(
    app: &AppHandle,
    changes: [(String, Option<String>); N],
) -> Result<(), String> {
    set_many_if(app, None, changes).await.map(|_| ())
}

pub(crate) async fn set_many_if<const N: usize>(
    app: &AppHandle,
    expected: Option<(String, String)>,
    changes: [(String, Option<String>); N],
) -> Result<bool, String> {
    access_store(app, move |directory| {
        let mut values = read_store(directory)?;
        if expected.as_ref().is_some_and(|(key, value)| values.get(key) != Some(value)) {
            return Ok(false);
        }
        let mut changed = false;
        for (key, value) in changes {
            if values.get(&key) == value.as_ref() {
                continue;
            }
            changed = true;
            match value {
                Some(value) => { values.insert(key, value); }
                None => { values.remove(&key); }
            }
        }
        if changed {
            write_store(directory, &values)?;
        }
        Ok(true)
    }).await
}

async fn access_store<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce(&Path) -> io::Result<T> + Send + 'static,
) -> Result<T, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let directory = root.join(PRIVATE_SYNC_CREDENTIALS_DIRECTORY);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|_| "Credential store is unavailable".to_owned())?;
        operation(&directory).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_store(directory: &Path) -> io::Result<BTreeMap<String, String>> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && metadata.permissions().mode() & 0o077 == 0 => {}
        Ok(_) => return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Credential directory is not private")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(error),
    }

    let path = directory.join(STORE_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && metadata.nlink() == 1
            && metadata.permissions().mode() & 0o077 == 0 => {}
        Ok(_) => return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Credential file is not private")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(error),
    }

    let bytes = fs::read(path)?;
    let payload = bytes.strip_prefix(STORE_HEADER)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid credential file format"))?;
    serde_json::from_slice(payload)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Invalid credential file contents"))
}

fn write_store(directory: &Path, values: &BTreeMap<String, String>) -> io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(directory)?;
    protect_store_path(directory, true)?;
    let temporary = directory.join(format!(".writing-{}", Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary)?;
    let result = (|| {
        protect_store_path(&temporary, false)?;
        file.write_all(STORE_HEADER)?;
        serde_json::to_writer(&mut file, values)?;
        file.sync_all()?;
        fs::rename(&temporary, directory.join(STORE_FILE))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    } else {
        let _ = File::open(directory).and_then(|parent| parent.sync_all());
    }
    result
}

fn protect_store_path(path: &Path, is_directory: bool) -> io::Result<()> {
    use objc2::rc::autoreleasepool;
    use objc2_foundation::{NSNumber, NSString, NSURL, NSURLIsExcludedFromBackupKey};

    let path = path.to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid credential path"))?;
    autoreleasepool(|_| {
        let path = NSString::from_str(path);
        let url = NSURL::fileURLWithPath_isDirectory(&path, is_directory);
        let excluded = NSNumber::numberWithBool(true);
        unsafe {
            url.setResourceValue_forKey_error(Some(&excluded), NSURLIsExcludedFromBackupKey)
                .map_err(|_| io::Error::other("Could not exclude credentials from backups"))?;
        }
        #[cfg(target_os = "ios")]
        if !is_directory {
            use objc2::runtime::AnyObject;
            use objc2_foundation::{
                NSDictionary, NSFileManager, NSFileProtectionCompleteUntilFirstUserAuthentication, NSFileProtectionKey,
            };
            unsafe {
                let protection: &AnyObject = NSFileProtectionCompleteUntilFirstUserAuthentication;
                let attributes = NSDictionary::from_slices(&[NSFileProtectionKey], &[protection]);
                NSFileManager::defaultManager().setAttributes_ofItemAtPath_error(&attributes, &path)
                    .map_err(|_| io::Error::other("Could not set iOS credential file protection"))?;
            }
        }
        Ok(())
    })
}
