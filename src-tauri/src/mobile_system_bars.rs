#[cfg(target_os = "android")]
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};

#[cfg(target_os = "android")]
const PLUGIN_NAME: &str = "system_bars";
#[cfg(target_os = "android")]
const ANDROID_PLUGIN_IDENTIFIER: &str = "com.codexu.NoteGen";
#[cfg(target_os = "android")]
const ANDROID_PLUGIN_CLASS: &str = "SystemBarsPlugin";

#[cfg(target_os = "android")]
pub struct AndroidSystemBarsPlugin<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemBarsPayload {
    status_bar_color: String,
    navigation_bar_color: String,
    light_status_bar: bool,
    light_navigation_bar: bool,
}

#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            match api.register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, ANDROID_PLUGIN_CLASS) {
                Ok(handle) => {
                    app.manage(AndroidSystemBarsPlugin(handle));
                }
                Err(error) => {
                    eprintln!("Android system bars plugin unavailable: {}", error);
                }
            }

            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn set_mobile_system_bars(
    app_handle: AppHandle,
    status_bar_color: String,
    navigation_bar_color: String,
    light_status_bar: bool,
    light_navigation_bar: bool,
) -> Result<(), String> {
    let plugin = app_handle
        .try_state::<AndroidSystemBarsPlugin<Wry>>()
        .ok_or("Android system bars plugin is not available.".to_string())?;

    let _: serde_json::Value = plugin
        .0
        .run_mobile_plugin(
            "setSystemBars",
            SystemBarsPayload {
                status_bar_color,
                navigation_bar_color,
                light_status_bar,
                light_navigation_bar,
            },
        )
        .map_err(|e| format!("Failed to update Android system bars: {}", e))?;

    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn set_mobile_system_bars(
    _status_bar_color: String,
    _navigation_bar_color: String,
    _light_status_bar: bool,
    _light_navigation_bar: bool,
) -> Result<(), String> {
    Ok(())
}
