use serde::Serialize;
use std::collections::HashMap;

const MICROSOFT_OAUTH_BASE_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0";

#[cfg(target_os = "ios")]
const IOS_ONEDRIVE_SESSION_KEY: &str = "one-drive-session";

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn get_ios_one_drive_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::apple_sync_credentials::get(&app, IOS_ONEDRIVE_SESSION_KEY).await
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn set_ios_one_drive_session(
    app: tauri::AppHandle,
    value: Option<String>,
) -> Result<(), String> {
    crate::apple_sync_credentials::set(&app, IOS_ONEDRIVE_SESSION_KEY, value).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftOAuthResponse {
    status: u16,
    body: String,
    retry_after: Option<String>,
}

#[tauri::command]
pub async fn microsoft_oauth_request(
    path: String,
    form: HashMap<String, String>,
) -> Result<MicrosoftOAuthResponse, String> {
    if path != "devicecode" && path != "token" {
        return Err("Unsupported Microsoft OAuth endpoint".to_string());
    }

    let response = reqwest::Client::new()
        .post(format!("{MICROSOFT_OAUTH_BASE_URL}/{path}"))
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Microsoft OAuth request failed: {error}"))?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read the Microsoft OAuth response: {error}"))?;

    Ok(MicrosoftOAuthResponse {
        status,
        body,
        retry_after,
    })
}
