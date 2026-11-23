use tauri::AppHandle;

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime, State, Wry,
};

#[cfg(target_os = "android")]
struct AndroidRecordFilePlugin<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("record-file")
        .setup(|app, api| {
            match api.register_android_plugin("com.codexu.NoteGen", "RecordFilePlugin") {
                Ok(handle) => {
                    app.manage(AndroidRecordFilePlugin(handle));
                }
                Err(error) => eprintln!("Android record file opener unavailable: {error}"),
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn android_plugin(app: &AppHandle) -> Result<State<'_, AndroidRecordFilePlugin<Wry>>, String> {
    app.try_state::<AndroidRecordFilePlugin<Wry>>()
        .ok_or_else(|| "The Android file opener is unavailable.".to_string())
}

#[cfg(target_os = "android")]
fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    android_plugin(&app)?
        .0
        .run_mobile_plugin::<()>("openRecordFile", serde_json::json!({ "path": path }))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize, serde::Serialize)]
pub struct PickedRecordFile {
    path: Option<String>,
    name: Option<String>,
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn pick_android_record_file(app: AppHandle) -> Result<PickedRecordFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        android_plugin(&app)?
            .0
            .run_mobile_plugin::<PickedRecordFile>("pickRecordFile", serde_json::json!({}))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Failed to select the record file: {error}"))?
}

#[cfg(target_os = "ios")]
use crate::ios_ocr::open_file;

#[tauri::command]
pub async fn open_record_file(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_file(app, path))
        .await
        .map_err(|error| format!("Failed to open the record file: {error}"))?
}
