use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime, Wry,
};

const PLUGIN_NAME: &str = "ocr";
const ANDROID_PLUGIN_IDENTIFIER: &str = "com.codexu.NoteGen";
const ANDROID_PLUGIN_CLASS: &str = "OcrPlugin";

pub struct AndroidOcrPlugin<R: Runtime>(PluginHandle<R>);

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

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            match api.register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, ANDROID_PLUGIN_CLASS) {
                Ok(handle) => {
                    app.manage(AndroidOcrPlugin(handle));
                }
                Err(error) => {
                    eprintln!("Android OCR plugin unavailable: {}", error);
                }
            }

            Ok(())
        })
        .build()
}

pub fn is_available(app_handle: &AppHandle) -> bool {
    app_handle.try_state::<AndroidOcrPlugin<Wry>>().is_some()
}

pub fn recognize_image(
    app_handle: &AppHandle,
    absolute_image_path: &Path,
    languages: Vec<String>,
) -> Result<String, String> {
    let plugin = app_handle
        .try_state::<AndroidOcrPlugin<Wry>>()
        .ok_or("Android OCR plugin is not available in this package.".to_string())?;
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
        .map_err(|e| format!("Android OCR failed: {}", e))?;

    Ok(response.text)
}
