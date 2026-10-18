use tauri::Emitter;
use tauri_plugin_store::StoreExt;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub const TRAY_ID: &str = "main";
pub const ID_SHOW_MAIN: &str = "show-main";
pub const ID_NEW_NOTE: &str = "new-note";
pub const ID_NEW_FOLDER: &str = "new-folder";
pub const ID_RECORD_TEXT: &str = "record-text";
pub const ID_RECORD_AUDIO: &str = "record-audio";
pub const ID_RECORD_SCREENSHOT: &str = "record-screenshot";
pub const ID_RECORD_IMAGE: &str = "record-image";
pub const ID_RECORD_LINK: &str = "record-link";
pub const ID_RECORD_FILE: &str = "record-file";
pub const ID_RECORD_TODO: &str = "record-todo";
pub const ID_PIN_WINDOW: &str = "pin-window";
pub const ID_HIDE_WINDOW: &str = "hide-window";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT: &str = "quit";

const DEFAULT_RECORD_TOOL_ORDER: &[&str] =
    &["text", "recording", "scan", "image", "link", "file", "todo"];
const QUICK_RECORD_VISIBLE_LIMIT: usize = 4;
static SCREENSHOT_SHORTCUT_RECORDING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, serde::Deserialize)]
pub struct RecordToolbarItem {
    id: String,
    enabled: bool,
    order: i32,
    label: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuLabels {
    quick_record: String,
    more_record: String,
    open: String,
    show_main: String,
    new_note: String,
    new_folder: String,
    settings: String,
    window: String,
    pin_toggle: String,
    hide_window: String,
    quit: String,
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<tauri::tray::TrayIcon> {
    let screenshot_shortcut = saved_screenshot_shortcut(app);
    let menu = build_tray_menu(app, None, None, screenshot_shortcut.as_deref())?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("NoteGen")
        // Opening the tray menu must leave the current application in front.
        // The explicit menu item remains the way to reveal the main window.
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id.0.as_str());
        })
        .build(app)?;

    Ok(tray)
}

#[tauri::command]
pub fn update_tray_record_toolbar_config(
    app: AppHandle,
    config: Vec<RecordToolbarItem>,
    labels: TrayMenuLabels,
    screenshot_shortcut: Option<String>,
    shortcut_recording: Option<bool>,
) -> Result<(), String> {
    let shortcut_recording = shortcut_recording.unwrap_or(false);
    SCREENSHOT_SHORTCUT_RECORDING.store(shortcut_recording, Ordering::Release);
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not found".to_string())?;
    let screenshot_shortcut = screenshot_shortcut.or_else(|| saved_screenshot_shortcut(&app));
    let menu = build_tray_menu(
        &app,
        Some(&labels),
        Some(&config),
        screenshot_shortcut
            .as_deref()
            .filter(|value| !value.is_empty() && !shortcut_recording),
    )
    .map_err(|error| error.to_string())?;

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: Option<&TrayMenuLabels>,
    record_toolbar_config: Option<&[RecordToolbarItem]>,
    screenshot_shortcut: Option<&str>,
) -> tauri::Result<Menu<R>> {
    let default_labels = default_tray_menu_labels();
    let labels = labels.unwrap_or(&default_labels);

    let quick_section = MenuItem::with_id(
        app,
        "section-quick",
        &labels.quick_record,
        false,
        None::<&str>,
    )?;
    let quick_record_items = build_quick_record_items(app, record_toolbar_config, screenshot_shortcut)?;
    let (primary_record_items, more_record_items) =
        quick_record_items.split_at(quick_record_items.len().min(QUICK_RECORD_VISIBLE_LIMIT));
    let more_record_submenu = if more_record_items.is_empty() {
        None
    } else {
        let more_items = more_record_items
            .iter()
            .map(|item| item as &dyn IsMenuItem<R>)
            .collect::<Vec<_>>();

        Some(Submenu::with_items(
            app,
            &labels.more_record,
            true,
            &more_items,
        )?)
    };

    let open_section = MenuItem::with_id(app, "section-open", &labels.open, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, &labels.settings, true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, ID_SHOW_MAIN, &labels.show_main, true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, ID_NEW_NOTE, &labels.new_note, true, None::<&str>)?;
    let new_folder = MenuItem::with_id(app, ID_NEW_FOLDER, &labels.new_folder, true, None::<&str>)?;

    let window_section =
        MenuItem::with_id(app, "section-window", &labels.window, false, None::<&str>)?;
    let pin_window = MenuItem::with_id(app, ID_PIN_WINDOW, &labels.pin_toggle, true, None::<&str>)?;
    let hide_window =
        MenuItem::with_id(app, ID_HIDE_WINDOW, &labels.hide_window, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, &labels.quit, true, None::<&str>)?;
    let separator_1 = PredefinedMenuItem::separator(app)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let separator_3 = PredefinedMenuItem::separator(app)?;

    let mut menu_items: Vec<&dyn IsMenuItem<R>> = Vec::new();

    if !quick_record_items.is_empty() {
        menu_items.push(&quick_section);
        for item in primary_record_items {
            menu_items.push(item);
        }
        if let Some(submenu) = &more_record_submenu {
            menu_items.push(submenu);
        }
        menu_items.push(&separator_1);
    }

    menu_items.extend([
        &open_section as &dyn IsMenuItem<R>,
        &show_main,
        &new_note,
        &new_folder,
        &settings,
        &separator_2,
        &window_section,
        &pin_window,
        &hide_window,
        &separator_3,
        &quit,
    ]);

    Menu::with_items(app, &menu_items)
}

fn saved_screenshot_shortcut<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.store("store.json")
        .ok()
        .and_then(|store| store.get("shortcuts"))
        .and_then(|shortcuts| {
            shortcuts.as_array()?.iter().find_map(|shortcut| {
                (shortcut.get("key")?.as_str()? == "screenshotRecord")
                    .then(|| shortcut.get("value")?.as_str().map(str::to_string))
                    .flatten()
            })
        })
        .or_else(|| Some("CommandOrControl+Shift+S".to_string()))
        .filter(|value| !value.is_empty())
}

fn default_tray_menu_labels() -> TrayMenuLabels {
    TrayMenuLabels {
        quick_record: "Quick Record".to_string(),
        more_record: "More Records".to_string(),
        open: "Open".to_string(),
        show_main: "Show Main Window".to_string(),
        new_note: "New Note".to_string(),
        new_folder: "New Folder".to_string(),
        settings: "Settings".to_string(),
        window: "Window".to_string(),
        pin_toggle: "Pin/Unpin".to_string(),
        hide_window: "Hide to Tray".to_string(),
        quit: "Quit NoteGen".to_string(),
    }
}

fn build_quick_record_items<R: Runtime>(
    app: &AppHandle<R>,
    record_toolbar_config: Option<&[RecordToolbarItem]>,
    screenshot_shortcut: Option<&str>,
) -> tauri::Result<Vec<MenuItem<R>>> {
    let mut items = Vec::new();

    for item in ordered_record_tools(record_toolbar_config) {
        if let Some(menu_id) = record_tool_menu_id(&item.id) {
            items.push(MenuItem::with_id(
                app,
                menu_id,
                item.label.as_str(),
                true,
                if menu_id == ID_RECORD_SCREENSHOT { screenshot_shortcut } else { None },
            )?);
        }
    }

    Ok(items)
}

struct RecordToolMenuItem {
    id: String,
    label: String,
}

fn ordered_record_tools(
    record_toolbar_config: Option<&[RecordToolbarItem]>,
) -> Vec<RecordToolMenuItem> {
    let mut tools: Vec<RecordToolMenuItem> = match record_toolbar_config {
        Some(config) => {
            let mut enabled_items = config
                .iter()
                .filter(|item| item.enabled && record_tool_menu_id(&item.id).is_some())
                .collect::<Vec<_>>();

            enabled_items.sort_by_key(|item| {
                (
                    item.order,
                    DEFAULT_RECORD_TOOL_ORDER
                        .iter()
                        .position(|id| id == &item.id)
                        .unwrap_or(DEFAULT_RECORD_TOOL_ORDER.len()),
                )
            });

            enabled_items
                .into_iter()
                .map(|item| RecordToolMenuItem {
                    id: item.id.clone(),
                    label: item.label.clone(),
                })
                .collect()
        }
        None => DEFAULT_RECORD_TOOL_ORDER
            .iter()
            .map(|id| RecordToolMenuItem {
                id: id.to_string(),
                label: default_record_tool_label(id).to_string(),
            })
            .collect(),
    };

    // Desktop capture stays directly reachable even when its toolbar button is disabled.
    let screenshot_label = record_toolbar_config
        .and_then(|config| config.iter().find(|item| item.id == "scan"))
        .map(|item| item.label.clone())
        .unwrap_or_else(|| default_record_tool_label("scan").to_string());
    tools.retain(|item| item.id != "scan");
    tools.insert(0, RecordToolMenuItem { id: "scan".to_string(), label: screenshot_label });
    let mut seen = std::collections::HashSet::new();
    tools.retain(|item| seen.insert(item.id.clone()));
    tools
}

fn record_tool_menu_id(id: &str) -> Option<&'static str> {
    match id {
        "text" => Some(ID_RECORD_TEXT),
        "recording" => Some(ID_RECORD_AUDIO),
        "scan" => Some(ID_RECORD_SCREENSHOT),
        "image" => Some(ID_RECORD_IMAGE),
        "link" => Some(ID_RECORD_LINK),
        "file" => Some(ID_RECORD_FILE),
        "todo" => Some(ID_RECORD_TODO),
        _ => None,
    }
}

fn default_record_tool_label(id: &str) -> &'static str {
    match id {
        "text" => "Text",
        "recording" => "Recording",
        "scan" => "Screenshot",
        "image" => "Image",
        "link" => "Link",
        "file" => "File",
        "todo" => "Todo",
        _ => "",
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        ID_SHOW_MAIN => focus_main_window(app),
        ID_SETTINGS => {
            focus_main_window(app);
            emit_to_main(app, "open-settings", "");
        }
        ID_RECORD_SCREENSHOT => {
            if SCREENSHOT_SHORTCUT_RECORDING.load(Ordering::Acquire) {
                return;
            }
            let screenshot_app = app.clone();
            tauri::async_runtime::spawn(async move {
                // Let the native context menu close before freezing the desktop.
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                if SCREENSHOT_SHORTCUT_RECORDING.load(Ordering::Acquire) {
                    return;
                }
                if let Err(error) = crate::screenshot::start_desktop_screenshot(screenshot_app.clone()).await {
                    emit_to_main(&screenshot_app, "desktop-screenshot-error", error);
                }
            });
        }
        ID_HIDE_WINDOW => {
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.hide();
            }
        }
        ID_QUIT => {
            app.exit(0);
        }
        _ => emit_tray_action(app, id),
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.show();
        let _ = webview.unminimize();
        let _ = webview.set_focus();
    }
}

fn emit_tray_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    focus_main_window(app);
    emit_to_main(app, "tray-action", action);
}

fn emit_to_main<R: Runtime, S: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.emit(event, payload);
    }
}
