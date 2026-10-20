use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

const PLUGIN_INSTALL_EVENT: &str = "plugin-install-request";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallRequest {
    pub plugin_id: String,
}

#[derive(Default)]
pub struct PendingPluginInstallRequests(pub Mutex<Vec<PluginInstallRequest>>);

#[tauri::command]
pub fn drain_pending_plugin_install_requests(
    state: tauri::State<'_, PendingPluginInstallRequests>,
) -> Vec<PluginInstallRequest> {
    match state.0.lock() {
        Ok(mut pending) => pending.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}

pub fn listen(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_url(&handle, url);
        }
    });
}

pub fn handle_initial_urls(app: &AppHandle) {
    let Ok(Some(urls)) = app.deep_link().get_current() else {
        return;
    };
    for url in urls {
        handle_url(app, url);
    }
}

fn handle_url(app: &AppHandle, url: Url) {
    let Some(request) = parse_plugin_install_url(&url) else {
        return;
    };

    if let Ok(mut pending) = app.state::<PendingPluginInstallRequests>().0.lock() {
        pending.push(request.clone());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", PLUGIN_INSTALL_EVENT, request);
}

fn parse_plugin_install_url(url: &Url) -> Option<PluginInstallRequest> {
    if url.scheme() != "notegen" || url.host_str() != Some("plugins") || url.path() != "/install" {
        return None;
    }
    let plugin_id = url.query_pairs().find_map(|(key, value)| {
        (key == "id").then(|| value.into_owned())
    })?;
    is_valid_plugin_id(&plugin_id).then_some(PluginInstallRequest { plugin_id })
}

fn is_valid_plugin_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}
