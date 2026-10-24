use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_store::StoreExt;

pub const AUTOSTART_ARG: &str = "--autostart";

#[cfg(target_os = "macos")]
fn forward_editor_history(window: &tauri::Window, redo: bool) {
    let command = if redo { "redo" } else { "undo" };
    // With multiwebview enabled, Wry sends these Command shortcuts to the
    // native menu instead of JavaScript. Re-enter the focused view's keymap so
    // editor history, custom bindings and disabled defaults keep their meaning.
    let script = format!(
        r#"(() => {{
            if (!document.hasFocus()) return;
            const target = document.activeElement || document.body;
            if (!target) return;
            const event = new KeyboardEvent('keydown', {{
                key: {redo} ? 'Z' : 'z', code: 'KeyZ', keyCode: 90, which: 90,
                metaKey: true, shiftKey: {redo},
                bubbles: true, cancelable: true, composed: true
            }});
            if (!target.dispatchEvent(event)) return;
            // An empty or disabled editor history must not fall through to
            // WebKit's separate DOM history. Inputs inside node views still
            // need their own native history.
            if (!target.matches('input, textarea')
                && target.closest('.ProseMirror, .cm-content')) return;
            document.execCommand({command:?});
        }})();"#
    );

    for webview in window.webviews() {
        let _ = webview.eval(script.clone());
    }
}

#[cfg(target_os = "macos")]
pub fn setup_editor_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let menu = Menu::default(app)?;
    let native_close_text = PredefinedMenuItem::close_window(app, None)?.text()?;
    let native_undo_text = PredefinedMenuItem::undo(app, None)?.text()?;
    let native_redo_text = PredefinedMenuItem::redo(app, None)?.text()?;
    let undo = MenuItem::with_id(
        app,
        "editor-undo",
        &native_undo_text,
        true,
        Some("CommandOrControl+Z"),
    )?;
    let redo = MenuItem::with_id(
        app,
        "editor-redo",
        &native_redo_text,
        true,
        Some("CommandOrControl+Shift+Z"),
    )?;
    let close_tab = MenuItem::with_id(
        app,
        "close-editor-tab",
        "Close",
        true,
        Some("CommandOrControl+W"),
    )?;
    let mut inserted_close_tab = false;

    // The default macOS menu includes native Close items in both File and Window.
    // Remove both so neither can hide the main window before the webview handles Cmd+W.
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        for (index, child) in submenu.items()?.iter().enumerate().rev() {
            let Some(predefined) = child.as_predefined_menuitem() else {
                continue;
            };
            let text = predefined.text()?;
            if text == native_undo_text {
                submenu.remove(predefined)?;
                submenu.insert(&undo, index)?;
                continue;
            }
            if text == native_redo_text {
                submenu.remove(predefined)?;
                submenu.insert(&redo, index)?;
                continue;
            }
            if text != native_close_text {
                continue;
            }
            submenu.remove(predefined)?;
            if !inserted_close_tab {
                submenu.insert(&close_tab, index)?;
                inserted_close_tab = true;
            }
        }
    }

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if !matches!(id, "close-editor-tab" | "editor-undo" | "editor-redo") {
            return;
        }
        if let Some(window) = app.windows().values().find(|window| window.is_focused().unwrap_or(false)) {
            if id == "editor-undo" || id == "editor-redo" {
                forward_editor_history(window, id == "editor-redo");
                return;
            }
            if window.label() == "main" {
                let _ = window.emit_to("main", "editor-close-tab-requested", ());
            } else {
                let _ = window.close();
            }
        }
    });
    Ok(())
}

pub fn setup_window_events(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            handle_window_event(event, &window_clone, &app_handle);
        });
    }
    Ok(())
}

fn handle_window_event(
    event: &WindowEvent,
    window: &tauri::WebviewWindow,
    app_handle: &AppHandle,
) {
    #[cfg(target_os = "windows")]
    if matches!(event, WindowEvent::Focused(true)) {
        restore_windows_webview_focus(window);
    }

    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    match get_close_behavior(app_handle).as_str() {
        "quit" => {
            api.prevent_close();
            app_handle.exit(0);
        }
        "ask" => {
            api.prevent_close();
            let _ = window.emit("close-behavior-requested", ());
        }
        _ => {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[cfg(target_os = "windows")]
fn restore_windows_webview_focus(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC;
    use windows61::{core::BOOL, Win32::UI::Input::KeyboardAndMouse::GetFocus};

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let parent_hwnd = hwnd.0 as usize;
    let mut webviews = window.as_ref().window().webviews();
    // A visible browser tab sits above the main UI. Try it first, then fall
    // back to the main webview when all browser tabs are hidden.
    webviews.sort_by_key(|webview| webview.label() == window.label());

    for webview in webviews {
        let _ = webview.with_webview(move |platform_webview| unsafe {
            // Multiwebview mode does not forward parent HWND focus to WebView2.
            // Ditto can activate that HWND before sending Ctrl+V. Only restore
            // focus if it is still on the parent; never override a focused child.
            // Check here on the UI thread, including after queued callbacks.
            if GetFocus().0 as usize != parent_hwnd {
                return;
            }
            let controller = platform_webview.controller();
            let mut visible = BOOL::default();
            if controller.IsVisible(&mut visible).is_ok() && visible.as_bool() {
                let _ = controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
        });
    }
}

fn get_close_behavior(app_handle: &AppHandle) -> String {
    app_handle
        .store("store.json")
        .ok()
        .and_then(|store| store.get("closeBehavior"))
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "minimize".to_string())
}

fn get_autostart_minimized(app_handle: &AppHandle) -> bool {
    app_handle
        .store("store.json")
        .ok()
        .and_then(|store| store.get("autostartMinimized"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn is_autostart_launch(args: &[String]) -> bool {
    args.iter().any(|arg| arg == AUTOSTART_ARG)
}

pub fn apply_startup_visibility(app_handle: &AppHandle) {
    let args = std::env::args().collect::<Vec<_>>();
    if !is_autostart_launch(&args) || !get_autostart_minimized(app_handle) {
        return;
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub fn handle_single_instance(app: &AppHandle, argv: Vec<String>, _cwd: String) {
    if is_autostart_launch(&argv) && get_autostart_minimized(app) {
        crate::file_open::handle_single_instance_open_files(app, argv);
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);

        if !is_visible {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        } else if is_minimized {
            let _ = window.unminimize();
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        } else {
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }
    }

    crate::file_open::handle_single_instance_open_files(app, argv);
}

#[cfg(target_os = "macos")]
pub fn handle_macos_reopen(app_handle: &AppHandle, has_visible_windows: bool) {
    // Screenshot windows load hidden and can briefly be the only windows being
    // replaced. Their activation must not reopen the normal application UI.
    if crate::screenshot::desktop_screenshot_active() {
        return;
    }
    if !has_visible_windows {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = app_handle.show();
        }
    }
}
