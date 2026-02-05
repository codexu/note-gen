use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};
use tauri::Emitter;

pub const ID_SHOW_MAIN: &str = "show-main";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT: &str = "quit";

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::tray::TrayIcon<R>> {
    let show_main = MenuItem::with_id(app, ID_SHOW_MAIN, "显示主窗口", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "退出应用", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_main, &settings, &quit])?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("NoteGen")
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id.0.as_str());
        })
        .on_tray_icon_event(move |tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(webview) = app_handle.get_webview_window("main") {
                    let _ = webview.show();
                    let _ = webview.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(tray)
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ID_SHOW_MAIN => {
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.show();
                let _ = webview.set_focus();
            }
        }
        ID_SETTINGS => {
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.show();
                let _ = webview.set_focus();
                let _ = webview.emit("open-settings", "");
            }
        }
        ID_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
}
