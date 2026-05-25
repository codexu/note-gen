use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PendingOpenFiles(pub Mutex<Vec<String>>);

#[tauri::command]
pub fn drain_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut pending) => pending.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}

pub fn handle_initial_open_files(app: &AppHandle) {
    let paths = collect_openable_markdown_paths(std::env::args().skip(1));
    queue_open_files(app, paths);
}

pub fn handle_single_instance_open_files(app: &AppHandle, argv: Vec<String>) {
    let paths = collect_openable_markdown_paths(argv);
    if paths.is_empty() {
        return;
    }

    queue_open_files(app, paths.clone());
    emit_open_files(app, paths);
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn handle_opened_urls(app: &AppHandle, urls: Vec<url::Url>) {
    let paths = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(is_markdown_file)
        .filter_map(path_to_string)
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return;
    }

    queue_open_files(app, paths.clone());
    emit_open_files(app, paths);
}

fn queue_open_files(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let state = app.state::<PendingOpenFiles>();
    if let Ok(mut pending) = state.0.lock() {
        pending.extend(paths);
    };
}

fn emit_open_files(app: &AppHandle, paths: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    let _ = app.emit_to("main", "open-files", paths);
}

fn collect_openable_markdown_paths<I>(values: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    values
        .into_iter()
        .filter_map(argument_to_path)
        .filter(is_markdown_file)
        .filter_map(path_to_string)
        .collect()
}

fn argument_to_path(value: String) -> Option<PathBuf> {
    let value = value.trim().trim_matches('"');

    if value.starts_with('-') {
        return None;
    }

    if let Ok(url) = url::Url::parse(value) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
    }

    Some(PathBuf::from(value))
}

fn is_markdown_file(path: &PathBuf) -> bool {
    if !path.is_file() {
        return false;
    }

    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn path_to_string(path: PathBuf) -> Option<String> {
    path.to_str().map(|path| path.to_string())
}
