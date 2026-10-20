use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};

const PLUGIN_NAME: &str = "android_cloud_folder";
const ANDROID_PLUGIN_IDENTIFIER: &str = "com.codexu.NoteGen";
const ANDROID_PLUGIN_CLASS: &str = "CloudFolderPlugin";

pub struct AndroidCloudFolderPlugin<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidFolderAccess {
    pub uri: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidCloudFolderFile {
    pub key: String,
    pub size: u64,
    pub modified_at: u64,
    pub etag: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidCloudFolderContent {
    pub content_base64: String,
    pub size: u64,
    pub modified_at: u64,
    pub etag: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootPayload {
    root_uri: String,
    scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePayload {
    root_uri: String,
    key: String,
    scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WritePayload {
    root_uri: String,
    key: String,
    content_base64: String,
    scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPayload {
    root_uri: String,
    prefix: Option<String>,
    scope: String,
}

#[derive(Serialize)]
struct SecureKeyPayload {
    key: String,
}

#[derive(Serialize)]
struct SecureValuePayload {
    key: String,
    value: String,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            match api.register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, ANDROID_PLUGIN_CLASS) {
                Ok(handle) => {
                    app.manage(AndroidCloudFolderPlugin(handle));
                }
                Err(error) => {
                    eprintln!("Android cloud folder plugin unavailable: {error}");
                }
            }
            Ok(())
        })
        .build()
}

fn plugin(
    app_handle: &AppHandle,
) -> Result<tauri::State<'_, AndroidCloudFolderPlugin<Wry>>, String> {
    app_handle
        .try_state::<AndroidCloudFolderPlugin<Wry>>()
        .ok_or_else(|| "Android cloud folder plugin is not available.".to_string())
}

#[tauri::command]
pub async fn set_android_secure_value(
    app_handle: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = plugin(&app_handle)?
            .0
            .run_mobile_plugin("setSecureValue", SecureValuePayload { key, value })
            .map_err(|error| format!("Failed to save the Android secure value: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Android secure storage task failed: {error}"))?
}

#[tauri::command]
pub async fn get_android_secure_value(
    app_handle: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin("getSecureValue", SecureKeyPayload { key })
            .map_err(|error| format!("Failed to read the Android secure value: {error}"))
    })
    .await
    .map_err(|error| format!("Android secure storage task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_android_secure_value(app_handle: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = plugin(&app_handle)?
            .0
            .run_mobile_plugin("deleteSecureValue", SecureKeyPayload { key })
            .map_err(|error| format!("Failed to delete the Android secure value: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Android secure storage task failed: {error}"))?
}

#[tauri::command]
pub async fn pick_android_sync_folder(
    app_handle: AppHandle,
) -> Result<Option<AndroidFolderAccess>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin("pickFolder", ())
            .map_err(|error| format!("Failed to select the Android cloud folder: {error}"))
    })
    .await
    .map_err(|error| format!("Android folder picker task failed: {error}"))?
}

#[tauri::command]
pub async fn release_android_sync_folder(
    app_handle: AppHandle,
    root_uri: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = plugin(&app_handle)?
            .0
            .run_mobile_plugin(
                "releaseFolder",
                RootPayload {
                    root_uri,
                    scope: "sync".to_string(),
                },
            )
            .map_err(|error| format!("Failed to release the Android cloud folder: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Android folder release task failed: {error}"))?
}

#[tauri::command]
pub async fn test_android_cloud_folder(
    app_handle: AppHandle,
    root_uri: String,
    scope: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin("testFolder", RootPayload { root_uri, scope })
            .map_err(|error| format!("Failed to test the Android cloud folder: {error}"))
    })
    .await
    .map_err(|error| format!("Android cloud folder test task failed: {error}"))?
}

#[tauri::command]
pub async fn write_android_cloud_folder_file(
    app_handle: AppHandle,
    root_uri: String,
    key: String,
    content_base64: String,
    scope: String,
) -> Result<AndroidCloudFolderFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin(
                "writeFile",
                WritePayload {
                    root_uri,
                    key,
                    content_base64,
                    scope,
                },
            )
            .map_err(|error| format!("Failed to write the Android cloud folder file: {error}"))
    })
    .await
    .map_err(|error| format!("Android cloud folder write task failed: {error}"))?
}

#[tauri::command]
pub async fn read_android_cloud_folder_file(
    app_handle: AppHandle,
    root_uri: String,
    key: String,
    scope: String,
) -> Result<Option<AndroidCloudFolderContent>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin(
                "readFile",
                FilePayload {
                    root_uri,
                    key,
                    scope,
                },
            )
            .map_err(|error| format!("Failed to read the Android cloud folder file: {error}"))
    })
    .await
    .map_err(|error| format!("Android cloud folder read task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_android_cloud_folder_file(
    app_handle: AppHandle,
    root_uri: String,
    key: String,
    scope: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin(
                "deleteFile",
                FilePayload {
                    root_uri,
                    key,
                    scope,
                },
            )
            .map_err(|error| format!("Failed to delete the Android cloud folder file: {error}"))
    })
    .await
    .map_err(|error| format!("Android cloud folder delete task failed: {error}"))?
}

#[tauri::command]
pub async fn list_android_cloud_folder_files(
    app_handle: AppHandle,
    root_uri: String,
    prefix: Option<String>,
    scope: String,
) -> Result<Vec<AndroidCloudFolderFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plugin(&app_handle)?
            .0
            .run_mobile_plugin(
                "listFiles",
                ListPayload {
                    root_uri,
                    prefix,
                    scope,
                },
            )
            .map_err(|error| format!("Failed to list Android cloud folder files: {error}"))
    })
    .await
    .map_err(|error| format!("Android cloud folder list task failed: {error}"))?
}
