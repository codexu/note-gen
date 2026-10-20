use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};

const PLUGIN_NAME: &str = "ocr";

tauri::ios_plugin_binding!(init_plugin_ocr);

pub struct IosOcrPlugin<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognizePayload {
    image_path: String,
    languages: Vec<String>,
}

#[derive(Deserialize)]
struct RecognizeResponse {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderBookmarkPayload {
    bookmark_base64: String,
}

#[derive(Serialize)]
struct EmptyPayload {}

#[derive(Serialize)]
struct SecureKeyPayload {
    key: String,
}

#[derive(Serialize)]
struct SecureValuePayload {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderPickerResponse {
    cancelled: bool,
    path: Option<String>,
    bookmark_base64: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosFolderAccess {
    path: String,
    bookmark_base64: String,
    display_name: String,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            match api.register_ios_plugin(init_plugin_ocr) {
                Ok(handle) => {
                    app.manage(IosOcrPlugin(handle));
                }
                Err(error) => {
                    eprintln!("iOS OCR plugin unavailable: {}", error);
                }
            }

            Ok(())
        })
        .build()
}

pub fn is_available(app_handle: &AppHandle) -> bool {
    app_handle.try_state::<IosOcrPlugin<Wry>>().is_some()
}

pub fn recognize_image(
    app_handle: &AppHandle,
    absolute_image_path: &Path,
    languages: Vec<String>,
) -> Result<String, String> {
    let plugin = app_handle
        .try_state::<IosOcrPlugin<Wry>>()
        .ok_or("iOS OCR plugin is not available.".to_string())?;
    let image_path = absolute_image_path
        .to_str()
        .ok_or("OCR image path is not valid UTF-8.")?
        .to_string();

    let response: RecognizeResponse = plugin
        .0
        .run_mobile_plugin(
            "recognize",
            RecognizePayload {
                image_path,
                languages,
            },
        )
        .map_err(|e| format!("iOS OCR failed: {}", e))?;

    Ok(response.text)
}

fn folder_access_from_response(
    response: FolderPickerResponse,
) -> Result<Option<IosFolderAccess>, String> {
    if response.cancelled {
        return Ok(None);
    }

    Ok(Some(IosFolderAccess {
        path: response
            .path
            .ok_or_else(|| "The selected folder has no local path.".to_string())?,
        bookmark_base64: response
            .bookmark_base64
            .ok_or_else(|| "The selected folder has no persistent authorization.".to_string())?,
        display_name: response
            .display_name
            .ok_or_else(|| "The selected folder has no display name.".to_string())?,
    }))
}

fn pick_ios_sync_folder_blocking(app_handle: AppHandle) -> Result<Option<IosFolderAccess>, String> {
    let plugin = app_handle
        .try_state::<IosOcrPlugin<Wry>>()
        .ok_or_else(|| "The iOS folder picker is unavailable.".to_string())?;
    let response: FolderPickerResponse = plugin
        .0
        .run_mobile_plugin("pickFolder", EmptyPayload {})
        .map_err(|error| format!("Failed to select a folder: {error}"))?;
    folder_access_from_response(response)
}

#[tauri::command]
pub async fn pick_ios_sync_folder(
    app_handle: AppHandle,
) -> Result<Option<IosFolderAccess>, String> {
    tauri::async_runtime::spawn_blocking(move || pick_ios_sync_folder_blocking(app_handle))
        .await
        .map_err(|error| format!("The iOS folder picker task failed: {error}"))?
}

fn restore_ios_sync_folder_blocking(
    app_handle: AppHandle,
    bookmark_base64: String,
) -> Result<IosFolderAccess, String> {
    let plugin = app_handle
        .try_state::<IosOcrPlugin<Wry>>()
        .ok_or_else(|| "The iOS folder picker is unavailable.".to_string())?;
    let response: FolderPickerResponse = plugin
        .0
        .run_mobile_plugin("restoreFolder", FolderBookmarkPayload { bookmark_base64 })
        .map_err(|error| format!("Failed to restore folder access: {error}"))?;
    folder_access_from_response(response)?
        .ok_or_else(|| "The saved folder authorization was cancelled.".to_string())
}

#[tauri::command]
pub async fn restore_ios_sync_folder(
    app_handle: AppHandle,
    bookmark_base64: String,
) -> Result<IosFolderAccess, String> {
    tauri::async_runtime::spawn_blocking(move || {
        restore_ios_sync_folder_blocking(app_handle, bookmark_base64)
    })
    .await
    .map_err(|error| format!("The folder authorization task failed: {error}"))?
}

fn release_ios_sync_folder_blocking(
    app_handle: AppHandle,
    bookmark_base64: String,
) -> Result<(), String> {
    let plugin = app_handle
        .try_state::<IosOcrPlugin<Wry>>()
        .ok_or_else(|| "The iOS folder picker is unavailable.".to_string())?;
    plugin
        .0
        .run_mobile_plugin::<()>("releaseFolder", FolderBookmarkPayload { bookmark_base64 })
        .map_err(|error| format!("Failed to release folder access: {error}"))
}

#[tauri::command]
pub async fn release_ios_sync_folder(
    app_handle: AppHandle,
    bookmark_base64: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        release_ios_sync_folder_blocking(app_handle, bookmark_base64)
    })
    .await
    .map_err(|error| format!("The folder release task failed: {error}"))?
}

fn ios_plugin(app_handle: &AppHandle) -> Result<tauri::State<'_, IosOcrPlugin<Wry>>, String> {
    app_handle
        .try_state::<IosOcrPlugin<Wry>>()
        .ok_or_else(|| "The iOS native plugin is unavailable.".to_string())
}

#[tauri::command]
pub async fn set_ios_secure_value(
    app_handle: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ios_plugin(&app_handle)?
            .0
            .run_mobile_plugin::<()>("setSecureValue", SecureValuePayload { key, value })
            .map_err(|error| format!("Failed to save the iOS secure value: {error}"))
    })
    .await
    .map_err(|error| format!("The iOS secure storage task failed: {error}"))?
}

#[tauri::command]
pub async fn get_ios_secure_value(
    app_handle: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ios_plugin(&app_handle)?
            .0
            .run_mobile_plugin("getSecureValue", SecureKeyPayload { key })
            .map_err(|error| format!("Failed to read the iOS secure value: {error}"))
    })
    .await
    .map_err(|error| format!("The iOS secure storage task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_ios_secure_value(app_handle: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ios_plugin(&app_handle)?
            .0
            .run_mobile_plugin::<()>("deleteSecureValue", SecureKeyPayload { key })
            .map_err(|error| format!("Failed to delete the iOS secure value: {error}"))
    })
    .await
    .map_err(|error| format!("The iOS secure storage task failed: {error}"))?
}
