use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const APTABASE_EVENTS_URL: &str = "https://analytics.notegen.top/api/v0/events";
const APTABASE_APP_KEY: &str = "A-SH-6953049261";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSystemProps {
    is_debug: bool,
    os_name: String,
    os_version: String,
    locale: String,
    engine_name: String,
    engine_version: String,
    app_version: String,
    sdk_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    timestamp: String,
    session_id: String,
    event_name: String,
    system_props: AnalyticsSystemProps,
    props: BTreeMap<String, Value>,
}

#[tauri::command]
pub async fn track_analytics_event(event: AnalyticsEvent) -> Result<String, String> {
    if event.session_id.chars().count() > 36 {
        return Err(format!(
            "Aptabase session_id must be <= 36 characters, got {}",
            event.session_id.chars().count()
        ));
    }

    let response = reqwest::Client::new()
        .post(APTABASE_EVENTS_URL)
        .header("Content-Type", "application/json")
        .header("App-Key", APTABASE_APP_KEY)
        .json(&[event])
        .send()
        .await
        .map_err(|error| format!("Failed to send analytics event: {error}"))?;

    let status = response.status();
    if status.is_success() {
        Ok(response.text().await.unwrap_or_default())
    } else {
        Err(format!("Analytics service responded with HTTP {status}"))
    }
}
