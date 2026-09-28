use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, io::{Read, Write}, path::PathBuf, sync::{Arc, Mutex}};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::plugins::{plugin_list_installed, plugin_read_host_state, PluginManager, PluginPlatform, PluginSourceView};

struct TerminalSession {
    plugin_id: String,
    workspace_id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[derive(Default)]
pub struct PluginTerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl Drop for PluginTerminalManager {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalClosed {
    session_id: String,
}

fn workspace_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let store = app.store("store.json").map_err(|error| error.to_string())?;
    let directory = store.get("workspacePath")
        .and_then(|value| value.as_str().map(PathBuf::from))
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(app.path().app_data_dir().map_err(|error| error.to_string())?.join("article"));
    let directory = directory.canonicalize().map_err(|error| format!("Workspace directory is unavailable: {error}"))?;
    if !directory.is_dir() {
        return Err("Workspace path is not a directory".to_string());
    }
    Ok(directory)
}

async fn authorize(app: &AppHandle, plugin_id: &str, workspace_id: &str) -> Result<(), String> {
    let installed = plugin_list_installed(app.clone()).map_err(|error| format!("{error:?}"))?;
    let plugin = installed.iter().find(|plugin| plugin.manifest.id == plugin_id)
        .ok_or("Terminal plugin is no longer installed")?;
    if !plugin.manifest.platforms.contains(&PluginPlatform::Desktop)
        || !plugin.manifest.permissions.contains_key("terminal.open") {
        return Err("Plugin has not declared desktop terminal access".to_string());
    }
    let state = plugin_read_host_state(app.clone(), app.state::<PluginManager>())
        .await.map_err(|error| format!("{error:?}"))?
        .ok_or("Plugin authorization is unavailable")?;
    let workspace = state.get("workspaces").and_then(|value| value.get(workspace_id))
        .and_then(|value| value.get(plugin_id))
        .ok_or("Plugin is not enabled in this workspace")?;
    if !matches!(workspace.get("enablement").and_then(|value| value.as_str()), Some("workspace" | "all-workspaces")) {
        return Err("Plugin is disabled".to_string());
    }
    let fingerprint = workspace.get("enabledFingerprint").and_then(|value| value.as_str())
        .ok_or("Plugin approval is unavailable")?;
    let parts: Vec<Value> = serde_json::from_str(fingerprint)
        .map_err(|_| "Plugin approval is invalid")?;
    let source = match plugin.source {
        PluginSourceView::Marketplace => "marketplace",
        PluginSourceView::Development => "development",
    };
    let source_identity = match plugin.source {
        PluginSourceView::Marketplace => plugin.publisher_key_id.as_ref()
            .map(|key_id| serde_json::json!(["marketplace", key_id]).to_string()),
        PluginSourceView::Development => plugin.development_path.as_ref().map(|path| {
            let normalized = path.nfc().collect::<String>().replace('\\', "/");
            let bytes = normalized.as_bytes();
            let drive_root = bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
            let normalized = if normalized == "/" || drive_root {
                normalized
            } else {
                normalized.trim_end_matches('/').to_string()
            };
            serde_json::json!(["development", normalized]).to_string()
        }),
    }.unwrap_or_else(|| format!("@unknown-{source}-source"));
    if parts.len() != 6
        || parts[0].as_u64() != Some(1)
        || parts[1].as_str() != Some(plugin_id)
        || parts[2].as_str() != Some(plugin.manifest.version.as_str())
        || parts[3].as_str() != Some(plugin.content_hash.as_str())
        || parts[4].as_str() != Some(source)
        || parts[5].as_str() != Some(source_identity.as_str()) {
        return Err("Plugin package changed after terminal approval".to_string());
    }
    let grant = workspace.get("permissions").and_then(|value| value.get("terminal.open"))
        .ok_or("Terminal permission has not been granted")?;
    if grant.get("granted").and_then(|value| value.as_bool()) != Some(true)
        || grant.get("manifestFingerprint").and_then(|value| value.as_str()) != Some(fingerprint) {
        return Err("Terminal permission has been revoked".to_string());
    }
    Ok(())
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=200).contains(&rows) {
        return Err("Terminal dimensions are out of range".to_string());
    }
    Ok(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
}

#[tauri::command]
pub async fn plugin_terminal_open(
    app: AppHandle,
    state: State<'_, PluginTerminalManager>,
    plugin_id: String,
    workspace_id: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    authorize(&app, &plugin_id, &workspace_id).await?;
    let cwd = workspace_directory(&app)?;
    let initial_size = size(cols, rows)?;
    {
        let sessions = state.sessions.lock().map_err(|_| "Terminal sessions are unavailable")?;
        if sessions.len() >= 4 {
            return Err("Too many terminal sessions are open".to_string());
        }
    }
    let shell = if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    };
    let pair = native_pty_system().openpty(initial_size).map_err(|error| error.to_string())?;
    let mut command = CommandBuilder::new(shell);
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|error| {
        let _ = child.kill();
        error.to_string()
    })?;
    let writer = pair.master.take_writer().map_err(|error| {
        let _ = child.kill();
        error.to_string()
    })?;
    let session_id = Uuid::new_v4().to_string();
    {
        let mut sessions = state.sessions.lock().map_err(|_| "Terminal sessions are unavailable")?;
        if sessions.len() >= 4 {
            let _ = child.kill();
            return Err("Too many terminal sessions are open".to_string());
        }
        sessions.insert(session_id.clone(), TerminalSession {
            plugin_id,
            workspace_id,
            master: pair.master,
            writer,
            child,
        });
    }
    let sessions = Arc::clone(&state.sessions);
    let output_id = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let _ = app.emit("plugin-terminal-output", TerminalOutput {
                        session_id: output_id.clone(),
                        data: STANDARD.encode(&buffer[..count]),
                    });
                }
            }
        }
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&output_id);
        }
        let _ = app.emit("plugin-terminal-closed", TerminalClosed { session_id: output_id });
    });
    Ok(session_id)
}

#[tauri::command]
pub fn plugin_terminal_write(
    state: State<'_, PluginTerminalManager>,
    plugin_id: String,
    workspace_id: String,
    session_id: String,
    data: String,
) -> Result<(), String> {
    if data.len() > 65_536 { return Err("Terminal input is too large".to_string()); }
    let mut sessions = state.sessions.lock().map_err(|_| "Terminal sessions are unavailable")?;
    let session = sessions.get_mut(&session_id).ok_or("Terminal session has ended")?;
    if session.plugin_id != plugin_id || session.workspace_id != workspace_id {
        return Err("Terminal session belongs to another plugin or workspace".to_string());
    }
    session.writer.write_all(data.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn plugin_terminal_resize(
    state: State<'_, PluginTerminalManager>,
    plugin_id: String,
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let new_size = size(cols, rows)?;
    let mut sessions = state.sessions.lock().map_err(|_| "Terminal sessions are unavailable")?;
    let session = sessions.get_mut(&session_id).ok_or("Terminal session has ended")?;
    if session.plugin_id != plugin_id || session.workspace_id != workspace_id {
        return Err("Terminal session belongs to another plugin or workspace".to_string());
    }
    session.master.resize(new_size).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn plugin_terminal_close(
    state: State<'_, PluginTerminalManager>,
    plugin_id: String,
    workspace_id: String,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Terminal sessions are unavailable")?;
    let session = sessions.get(&session_id).ok_or("Terminal session has ended")?;
    if session.plugin_id != plugin_id || session.workspace_id != workspace_id {
        return Err("Terminal session belongs to another plugin or workspace".to_string());
    }
    sessions.remove(&session_id);
    Ok(())
}
