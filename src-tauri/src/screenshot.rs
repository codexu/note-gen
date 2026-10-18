use tauri::{path::BaseDirectory, AppHandle, Manager};
use base64::Engine;
use std::{collections::HashSet, io::Cursor, path::PathBuf, sync::Mutex};
use tauri::{Emitter, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow};
#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;
use crate::screenshot_cleanup::{self as cleanup, Sweep};

const OVERLAY_PREFIX: &str = "desktop-screenshot-";
const PIN_PREFIX: &str = "screenshot-pin-";
const MAX_RESULT_BYTES: usize = 128 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ScreenshotImage {
    capture_id: String,
    name: String,
    path: String,
    source: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    z: i32,
}

fn normalized(s: &str) -> String {
    s.replace(" ", "-")
        .replace("/", "-")
        .replace("\\", "-")
        .replace("*", "-")
        .replace("?", "-")
        .replace(":", "-")
        .replace("<", "-")
        .replace(">", "-")
        .replace("|", "-")
}

// The in-app picker captures individual windows. Its cache stays separate from
// the monitor images and pending results used by the desktop screenshot editor.
#[tauri::command]
pub fn screenshot(app: AppHandle) -> Result<Vec<ScreenshotImage>, String> {
    check_capture_permission().map_err(|error| {
        if error.code == "permission-denied" {
            "SCREEN_CAPTURE_PERMISSION_REQUIRED".to_string()
        } else {
            error.message
        }
    })?;

    let temp_screenshot_folder = app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve screenshot cache directory: {error}"))?;
    let capture_id = uuid::Uuid::new_v4().to_string();
    let temp_screenshot_folder = temp_screenshot_folder.join(&capture_id);
    cleanup::protect(&app, &temp_screenshot_folder);
    std::fs::create_dir_all(&temp_screenshot_folder)
        .map_err(|error| {
            cleanup::remove(&app, temp_screenshot_folder.clone());
            format!("Failed to create screenshot cache directory: {error}")
        })?;

    let mut files: Vec<ScreenshotImage> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    let windows = match xcap::Window::all() {
        Ok(windows) => windows,
        Err(error) => {
            errors.push(format!("Failed to list windows: {error}"));
            Vec::new()
        }
    };
    let mut i = 0;
    for window in windows {
        if window.is_minimized().unwrap_or(true) {
            continue;
        }

        let title = window.title().unwrap_or_default();
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        let x = window.x().unwrap_or(0);
        let y = window.y().unwrap_or(0);
        let z = window.z().unwrap_or(0);
        let system_titles = [
            "Dock",
            "Menu Bar",
            "MenuBar",
            "Status",
            "Notification Center",
            "",
            "Desktop",
            "NoteGen",
        ];

        if system_titles.contains(&title.as_str()) || title.len() < 2 || width < 150 || height < 150 {
            continue;
        }

        let image = match window.capture_image() {
            Ok(image) => image,
            Err(error) => {
                println!("窗口截图失败: {:?}: {:?}", title, error);
                continue;
            }
        };
        let path = format!(
            "{}/window-{}-{}.png",
            temp_screenshot_folder.display(),
            i,
            normalized(&title)
        );
        if let Err(error) = image.save(&path) {
            errors.push(format!("Failed to save window screenshot {title}: {error}"));
            continue;
        }
        files.push(ScreenshotImage {
            capture_id: capture_id.clone(),
            name: title,
            path,
            source: "window".to_string(),
            width,
            height,
            x,
            y,
            z,
        });
        i += 1;
    }

    if files.is_empty() {
        cleanup::remove(&app, temp_screenshot_folder);
        if !errors.is_empty() { return Err(errors.join("; ")); }
    }

    Ok(files)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScreenshotError {
    pub code: String,
    pub message: String,
}

impl ScreenshotError {
    fn new(code: &str, message: impl ToString) -> Self {
        Self { code: code.into(), message: message.to_string() }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopScreenshotContext {
    session_id: String,
    monitor_id: String,
    image_path: String,
    image_width: u32,
    image_height: u32,
    scale_factor: f64,
    platform: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopScreenshotResult {
    session_id: String,
    path: String,
    width: u32,
    height: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedScreenshotContext {
    pin_id: String,
    image_path: String,
    image_width: u32,
    image_height: u32,
    scale_factor: f64,
    platform: String,
    record_state: PinnedScreenshotRecordState,
}

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PinnedScreenshotRecordState { Unsaved, Pending, Saved }

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PinnedScreenshotRecordUpdate {
    pin_id: String,
    record_state: PinnedScreenshotRecordState,
}

struct PinnedScreenshot {
    context: PinnedScreenshotContext,
    ready: bool,
    record_saving: bool,
    source_session_id: Option<String>,
}

// Pins have their own lifetime and cache. Starting or ending a new desktop
// capture must never remove an image that is still visible in a pin window.
static PINNED_SCREENSHOTS: Mutex<Vec<PinnedScreenshot>> = Mutex::new(Vec::new());

#[derive(Clone)]
struct CapturedScreen {
    context: DesktopScreenshotContext,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    primary: bool,
}

struct DesktopScreenshotSession {
    id: String,
    screens: Vec<CapturedScreen>,
    ready: HashSet<String>,
    shown: bool,
    finishing: bool,
    dialog_mode: bool,
    foreground: Option<ForegroundTarget>,
}

#[cfg(target_os = "macos")]
struct ForegroundTarget { application: objc2::rc::Retained<objc2_app_kit::NSRunningApplication> }
#[cfg(target_os = "windows")]
struct ForegroundTarget { handle: isize, process_id: u32 }
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct ForegroundTarget;

impl ForegroundTarget {
    fn remember() -> Option<Self> {
        #[cfg(target_os = "macos")]
        unsafe {
            let application = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication()?;
            let current = objc2_app_kit::NSRunningApplication::currentApplication();
            return (application != current).then_some(Self { application });
        }
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
            let handle = GetForegroundWindow();
            let mut process_id = 0;
            GetWindowThreadProcessId(handle, Some(&mut process_id));
            return (process_id != 0 && process_id != std::process::id()).then_some(Self { handle: handle.0 as isize, process_id });
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        None
    }

    #[allow(deprecated)]
    fn restore(self) {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2_app_kit::NSApplicationActivationOptions;
            // Retain the application identity, rather than looking up a PID
            // that could have been reused after the previous app quit.
            if !self.application.isTerminated() {
                let _ = self.application.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
            }
        }
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow}};
            let handle = HWND(self.handle as *mut std::ffi::c_void);
            let mut process_id = 0;
            GetWindowThreadProcessId(handle, Some(&mut process_id));
            // HWNDs may be reused after the original window is closed.
            if process_id == self.process_id && IsWindow(handle).as_bool() && IsWindowVisible(handle).as_bool() && !IsIconic(handle).as_bool() {
                let _ = SetForegroundWindow(handle);
            }
        }
    }
}

// Shared by the tray, global shortcut and every monitor's overlay. Reserving the
// session before capture also prevents repeated shortcuts capturing an overlay.
static DESKTOP_SESSION: Mutex<Option<DesktopScreenshotSession>> = Mutex::new(None);

#[cfg(target_os = "macos")]
pub fn desktop_screenshot_active() -> bool {
    DESKTOP_SESSION.lock().is_ok_and(|session| session.is_some())
}

fn desktop_cache(app: &AppHandle) -> Result<PathBuf, ScreenshotError> {
    app.path().resolve("desktop_screenshot", BaseDirectory::AppData)
        .map_err(|error| ScreenshotError::new("cache-failed", error))
}

fn require_main(window: &WebviewWindow) -> Result<(), ScreenshotError> {
    if window.label() == "main" { Ok(()) }
    else { Err(ScreenshotError::new("invalid-window", "Only the main window can access screenshot results")) }
}

fn checked_session_id(id: &str) -> Result<(), ScreenshotError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| ScreenshotError::new("invalid-session", "Invalid screenshot session"))
}

fn overlay_screen<'a>(session: &'a DesktopScreenshotSession, window: &WebviewWindow) -> Result<&'a CapturedScreen, ScreenshotError> {
    session.screens.iter().find(|screen| window.label() == format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id))
        .ok_or_else(|| ScreenshotError::new("invalid-window", "This window does not belong to the screenshot session"))
}

// macOS 10.13/10.14 do not export these permission APIs. Resolve them dynamically
// so the app retains its minimum OS version, while 10.15+ never silently captures
// a desktop stripped of other applications when permission was denied.
#[cfg(target_os = "macos")]
fn check_capture_permission() -> Result<(), ScreenshotError> {
    use std::ffi::{c_char, c_void};
    extern "C" { fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void; }
    unsafe {
        let default_handle = -2isize as *mut c_void;
        let preflight = dlsym(default_handle, b"CGPreflightScreenCaptureAccess\0".as_ptr().cast());
        if preflight.is_null() { return Ok(()); }
        let preflight: unsafe extern "C" fn() -> bool = std::mem::transmute(preflight);
        if preflight() { return Ok(()); }
        let request = dlsym(default_handle, b"CGRequestScreenCaptureAccess\0".as_ptr().cast());
        if !request.is_null() {
            let request: unsafe extern "C" fn() -> bool = std::mem::transmute(request);
            if request() { return Ok(()); }
        }
    }
    Err(ScreenshotError::new("permission-denied", "Allow NoteGen in System Settings > Privacy & Security > Screen & System Audio Recording, then restart NoteGen if macOS requests it"))
}

#[cfg(not(target_os = "macos"))]
fn check_capture_permission() -> Result<(), ScreenshotError> { Ok(()) }

fn capture_screens(app: &AppHandle, id: &str) -> Result<Vec<CapturedScreen>, ScreenshotError> {
    #[cfg(target_os = "linux")]
    if std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session.eq_ignore_ascii_case("wayland"))
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        // Wayland does not allow arbitrary global window positioning. A portal
        // capture alone cannot provide this editor's monitor-aligned overlays.
        return Err(ScreenshotError::new("unsupported-session", "Desktop screenshot editing requires an X11 session; on Wayland use the system screenshot tool and import the image"));
    }
    check_capture_permission()?;
    let directory = desktop_cache(app)?.join("captures").join(id);
    cleanup::protect(app, &directory);
    std::fs::create_dir_all(&directory).map_err(|error| ScreenshotError::new("cache-failed", error))?;
    let monitors = xcap::Monitor::all().map_err(|error| ScreenshotError::new("capture-failed", error))?;
    if monitors.is_empty() {
        return Err(ScreenshotError::new("capture-failed", "No active displays were found"));
    }
    let mut screens = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let monitor_id = monitor.id().map_err(|error| ScreenshotError::new("capture-failed", error))?.to_string();
        let x = monitor.x().map_err(|error| ScreenshotError::new("capture-failed", error))?;
        let y = monitor.y().map_err(|error| ScreenshotError::new("capture-failed", error))?;
        let width = monitor.width().map_err(|error| ScreenshotError::new("capture-failed", error))?;
        let height = monitor.height().map_err(|error| ScreenshotError::new("capture-failed", error))?;
        let scale = f64::from(monitor.scale_factor().map_err(|error| ScreenshotError::new("capture-failed", error))?);
        if !scale.is_finite() || scale <= 0.0 || width == 0 || height == 0 {
            return Err(ScreenshotError::new("capture-failed", "Invalid display dimensions or scale factor"));
        }
        // Capture every display before creating any overlay, including full
        // display bounds rather than work_area (menu bar, Dock and taskbar).
        let image = monitor.capture_image().map_err(|error| ScreenshotError::new("capture-failed", error))?;
        let image_path = directory.join(format!("{monitor_id}.png"));
        image.save(&image_path).map_err(|error| ScreenshotError::new("cache-failed", error))?;
        #[cfg(target_os = "windows")]
        let (position, size) = (PhysicalPosition::new(x, y), PhysicalSize::new(width, height));
        #[cfg(not(target_os = "windows"))]
        let (position, size) = (
            PhysicalPosition::new((f64::from(x) * scale).round() as i32, (f64::from(y) * scale).round() as i32),
            PhysicalSize::new(image.width(), image.height()),
        );
        screens.push(CapturedScreen {
            context: DesktopScreenshotContext {
                session_id: id.into(), monitor_id, image_path: image_path.to_string_lossy().into_owned(),
                image_width: image.width(), image_height: image.height(), scale_factor: scale,
                platform: std::env::consts::OS.into(),
            },
            position, size, primary: monitor.is_primary().unwrap_or(false),
        });
    }
    Ok(screens)
}

#[cfg(target_os = "macos")]
fn configure_macos_overlay(window: &tauri::Window, screen: &CapturedScreen) -> Result<(), ScreenshotError> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior};
    use objc2_foundation::{NSNumber, NSString};
    let marker = MainThreadMarker::new().ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot windows must be configured on the main thread"))?;
    let native_pointer = window.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
    let native = unsafe { &*(native_pointer as *mut NSWindow) };
    let monitor_id: u32 = screen.context.monitor_id.parse().map_err(|_| ScreenshotError::new("window-failed", "Invalid display identifier"))?;
    let mut frame = None;
    for display in NSScreen::screens(marker) {
        if let Some(number) = display.deviceDescription().objectForKey(&NSString::from_str("NSScreenNumber")) {
            if number.downcast::<NSNumber>().is_ok_and(|number| number.unsignedIntValue() == monitor_id) {
                frame = Some(display.frame());
                break;
            }
        }
    }
    let frame = frame.ok_or_else(|| ScreenshotError::new("display-changed", "A display was disconnected while preparing the screenshot"))?;
    // A borderless window avoids entering a separate fullscreen Space. Setting
    // the complete NSScreen frame avoids Cocoa's visibleFrame Dock/menu insets.
    native.setFrame_display(frame, true);
    native.setLevel(NSScreenSaverWindowLevel + 1);
    unsafe {
        native.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
    }
    Ok(())
}

// Build the native window first. Wry activates NSApplication when attaching a
// WebView, so the screenshot must already own the main/key roles at that point.
// The frozen image covers loading without hiding or moving the user's windows.
#[cfg(target_os = "macos")]
fn present_macos_image(window: &tauri::Window, path: &str, stretch: bool) -> Result<objc2::rc::Retained<objc2_app_kit::NSImageView>, ScreenshotError> {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSImage, NSImageScaling, NSImageView, NSWindow};
    use objc2_foundation::NSString;
    let marker = MainThreadMarker::new().ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot windows must be prepared on the main thread"))?;
    let pointer = window.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
    unsafe {
        let native = &*(pointer as *mut NSWindow);
        let content = native.contentView().ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot window has no content view"))?;
        let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(path))
            .ok_or_else(|| ScreenshotError::new("window-failed", "Unable to load the screenshot preview"))?;
        let preview = NSImageView::imageViewWithImage(&image, marker);
        preview.setFrame(content.bounds());
        preview.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        preview.setImageScaling(if stretch { NSImageScaling::ScaleAxesIndependently } else { NSImageScaling::ScaleProportionallyUpOrDown });
        content.addSubview(&preview);
        native.orderFrontRegardless();
        native.displayIfNeeded();
        Ok(preview)
    }
}

#[cfg(target_os = "macos")]
fn prepare_macos_editor_focus(window: &tauri::Window) -> Result<(), ScreenshotError> {
    let pointer = window.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
    unsafe {
        let native = &*(pointer as *mut objc2_app_kit::NSWindow);
        native.makeMainWindow();
        native.makeKeyWindow();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn attach_macos_editor(window: &tauri::Window, url: String, preview: &objc2_app_kit::NSImageView) -> Result<WebviewWindow, ScreenshotError> {
    use objc2_app_kit::{NSWindow, NSWindowOrderingMode};
    let builder = tauri::WebviewBuilder::new(window.label(), WebviewUrl::App(url.into()))
        .focused(false).accept_first_mouse(true).auto_resize().disable_drag_drop_handler();
    // Matching labels preserve Tauri's WebviewWindow API and existing IPC scopes.
    window.add_child(builder, PhysicalPosition::new(0, 0), window.inner_size()
        .map_err(|error| ScreenshotError::new("window-failed", error))?)
        .map_err(|error| ScreenshotError::new("window-failed", error))?;
    let pointer = window.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
    unsafe {
        let native = &*(pointer as *mut NSWindow);
        if let Some(content) = native.contentView() {
            // Keep the frozen preview above the loading editor until its canvas
            // is ready. A visible WebView can keep rendering behind this cover.
            content.addSubview_positioned_relativeTo(preview, NSWindowOrderingMode::Above, None);
        }
    }
    window.app_handle().get_webview_window(window.label())
        .ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot editor was not attached"))
}

fn reveal_screenshot_editor(window: &WebviewWindow) -> Result<(), ScreenshotError> {
    #[cfg(target_os = "macos")]
    window.with_webview(|webview| unsafe {
        use objc2_app_kit::{NSImageView, NSWindow};
        let native = &*(webview.ns_window() as *mut NSWindow);
        native.makeFirstResponder(Some(&*(webview.inner() as *mut objc2_app_kit::NSView)));
        if let Some(content) = native.contentView() {
            for view in content.subviews() {
                if let Ok(preview) = view.downcast::<NSImageView>() {
                    preview.removeFromSuperview();
                }
            }
        }
    }).map_err(|error| ScreenshotError::new("window-failed", error))?;
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

async fn focus_screenshot_window(window: WebviewWindow, ready_pin_id: Option<String>) -> Result<(), ScreenshotError> {
    let app = window.app_handle().clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let focus = || -> Result<(), ScreenshotError> {
            if ready_pin_id.is_some() {
                reveal_screenshot_editor(&window)?;
                window.show().map_err(|error| ScreenshotError::new("pin-failed", error))?;
            }
            #[cfg(target_os = "macos")]
            unsafe {
                use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWindow};
                let pointer = window.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
                let native = &*(pointer as *mut NSWindow);
                // App activation brings both the main and key windows forward.
                // Give those roles to this auxiliary window before activating,
                // so a background NoteGen main window stays in the background.
                native.makeMainWindow();
                native.makeKeyAndOrderFront(None);
                #[allow(deprecated)]
                let _ = NSRunningApplication::currentApplication()
                    .activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
            }
            #[cfg(not(target_os = "macos"))]
            window.set_focus().map_err(|error| ScreenshotError::new("window-failed", error))?;
            if let Some(pin_id) = ready_pin_id {
                let source_session_id = {
                    let mut pins = PINNED_SCREENSHOTS.lock().map_err(|error| ScreenshotError::new("pin-failed", error))?;
                    pins.iter_mut().find(|pin| pin.context.pin_id == pin_id).and_then(|pin| {
                        pin.ready = true;
                        pin.source_session_id.take()
                    })
                };
                // Complete the handoff in this same UI callback, before a
                // newly visible pin can receive an immediate close event.
                if let Some(id) = source_session_id { end_desktop_session_with_focus(window.app_handle(), &id, false); }
            }
            Ok(())
        };
        let _ = sender.send(focus());
    }).map_err(|error| ScreenshotError::new("window-failed", error))?;
    receiver.await.map_err(|error| ScreenshotError::new("window-failed", error))?
}

async fn show_ready_overlays(app: &AppHandle, id: &str) -> Result<(), ScreenshotError> {
    let screens = {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let session = guard.as_mut().filter(|session| session.id == id).ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
        if session.shown || session.ready.len() != session.screens.len() { return Ok(()); }
        session.shown = true;
        session.screens.clone()
    };
    let cursor = app.cursor_position().ok();
    // Tao reports the global macOS cursor using the primary display's scale,
    // while each monitor's physical position uses its own scale. Compare in
    // logical points to select the right display in mixed Retina setups.
    #[cfg(target_os = "macos")]
    let cursor = cursor.map(|cursor| cursor.to_logical::<f64>(app.primary_monitor().ok().flatten().map(|monitor| monitor.scale_factor()).unwrap_or(1.0)));
    let focus = screens.iter().find(|screen| cursor.is_some_and(|cursor| {
        #[cfg(target_os = "macos")]
        let coordinate_scale = screen.context.scale_factor;
        #[cfg(not(target_os = "macos"))]
        let coordinate_scale = 1.0;
        let x = f64::from(screen.position.x) / coordinate_scale;
        let y = f64::from(screen.position.y) / coordinate_scale;
        cursor.x >= x && cursor.y >= y
            && cursor.x < x + f64::from(screen.size.width) / coordinate_scale
            && cursor.y < y + f64::from(screen.size.height) / coordinate_scale
    })).or_else(|| screens.iter().find(|screen| screen.primary)).or_else(|| screens.first());
    for screen in &screens {
        let window = app.get_webview_window(&format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id))
            .ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot window disappeared"))?;
        reveal_screenshot_editor(&window)?;
        window.show().map_err(|error| ScreenshotError::new("window-failed", error))?;
    }
    if let Some(screen) = focus {
        if let Some(window) = app.get_webview_window(&format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id)) {
            focus_screenshot_window(window, None).await?;
        }
    }
    Ok(())
}

fn end_desktop_session(app: &AppHandle, id: &str) {
    end_desktop_session_with_focus(app, id, true);
}

fn end_desktop_session_with_focus(app: &AppHandle, id: &str, restore_focus: bool) {
    end_desktop_session_restoring_pin(app, id, restore_focus, None);
}

fn end_desktop_session_restoring_pin(app: &AppHandle, id: &str, restore_focus: bool, closing_pin: Option<&str>) {
    let active = DESKTOP_SESSION.lock().ok().and_then(|mut session| {
        if session.as_ref().is_some_and(|session| session.id == id) { session.take() }
        else { None }
    });
    if let Some(active) = active {
        let restore = restore_focus && (active.screens.iter().any(|screen| app.get_window(&format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id))
            .is_some_and(|window| window.is_focused().unwrap_or(false)))
            || closing_pin.and_then(|label| app.get_window(label)).is_some_and(|window| window.is_focused().unwrap_or(false)));
        let close_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            // Return to the external app before removing its last cover. This
            // avoids briefly falling back to NoteGen's background main window.
            // Leave the user's focus alone if they already switched away.
            if restore {
                if let Some(foreground) = active.foreground { foreground.restore(); }
            }
            for screen in active.screens {
                if let Some(window) = close_app.get_window(&format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id)) { let _ = window.destroy(); }
            }
        });
        match desktop_cache(app) {
            Ok(cache) => cleanup::remove(app, cache.join("captures").join(id)),
            Err(error) => cleanup::report_error(app, "resolve ended capture cache", error.message),
        }
    }
}

pub async fn start_desktop_screenshot(app: AppHandle) -> Result<String, ScreenshotError> {
    let (id, existing) = {
        let mut session = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        if let Some(active) = session.as_ref() { (active.id.clone(), true) }
        else {
            let id = uuid::Uuid::new_v4().to_string();
            *session = Some(DesktopScreenshotSession { id: id.clone(), screens: Vec::new(), ready: HashSet::new(), shown: false, finishing: false, dialog_mode: false, foreground: ForegroundTarget::remember() });
            (id, false)
        }
    };
    if existing {
        // Do not show an overlay before its frozen background has loaded.
        let window = DESKTOP_SESSION.lock().ok().and_then(|session| session.as_ref().filter(|session| session.shown && !session.dialog_mode && !session.finishing)
            .and_then(|session| session.screens.first().map(|screen| format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id))))
            .and_then(|label| app.get_webview_window(&label));
        if let Some(window) = window { let _ = focus_screenshot_window(window, None).await; }
        return Ok(id);
    }
    let capture_app = app.clone();
    let capture_id = id.clone();
    let captured = tauri::async_runtime::spawn_blocking(move || capture_screens(&capture_app, &capture_id)).await
        .map_err(|error| ScreenshotError::new("capture-failed", error)).and_then(|result| result);
    let screens = match captured {
        Ok(screens) => screens,
        Err(error) => { end_desktop_session(&app, &id); return Err(error); }
    };
    {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let session = guard.as_mut().filter(|session| session.id == id).ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
        session.screens = screens.clone();
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let window_app = app.clone();
    let window_id = id.clone();
    let dispatched = app.run_on_main_thread(move || {
        let build = || -> Result<(), ScreenshotError> {
            #[cfg(not(target_os = "macos"))]
            let active_monitors = window_app.available_monitors().map_err(|error| ScreenshotError::new("window-failed", error))?;
            #[cfg(target_os = "macos")]
            let native_screens = {
                let mut windows = Vec::new();
                for screen in &screens {
                    let label = format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id);
                    let window = tauri::window::WindowBuilder::new(&window_app, &label)
                        .title("NoteGen Screenshot").decorations(false).resizable(false).maximizable(false).minimizable(false)
                        .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true).shadow(false)
                        .focused(false).visible(false)
                        .build().map_err(|error| ScreenshotError::new("window-failed", error))?;
                    configure_macos_overlay(&window, screen)?;
                    let preview = present_macos_image(&window, &screen.context.image_path, true)?;
                    windows.push((window, preview));
                }
                if let Some((window, _)) = windows.first() { prepare_macos_editor_focus(window)?; }
                windows
            };
            for screen in &screens {
                #[cfg(not(target_os = "macos"))]
                let current_monitor = active_monitors.iter().find(|monitor| {
                    // xcap's X11 logical coordinates truncate before we convert
                    // back to pixels; allow that rounding, then use the window
                    // system's exact physical bounds for positioning.
                    let tolerance = screen.context.scale_factor.ceil() as i64 + 1;
                    (i64::from(monitor.position().x) - i64::from(screen.position.x)).abs() <= tolerance
                        && (i64::from(monitor.position().y) - i64::from(screen.position.y)).abs() <= tolerance
                        && *monitor.size() == screen.size
                }).ok_or_else(|| ScreenshotError::new("display-changed", "The display layout changed while preparing the screenshot"))?;
                let label = format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id);
                let url = format!("screenshot?sessionId={window_id}&monitorId={}", screen.context.monitor_id);
                #[cfg(not(target_os = "macos"))]
                let builder = WebviewWindowBuilder::new(&window_app, &label, WebviewUrl::App(url.into()))
                    .title("NoteGen Screenshot").decorations(false).resizable(false).maximizable(false).minimizable(false)
                    .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true).shadow(false)
                    .focused(false).visible(false).disable_drag_drop_handler();
                #[cfg(not(target_os = "macos"))]
                let window = builder.build().map_err(|error| ScreenshotError::new("window-failed", error))?;
                #[cfg(target_os = "macos")]
                let window = {
                    let (native, preview) = native_screens.iter().find(|(window, _)| window.label() == label)
                        .ok_or_else(|| ScreenshotError::new("window-failed", "Screenshot preview disappeared"))?;
                    attach_macos_editor(native, url, preview)?
                };
                #[cfg(not(target_os = "macos"))]
                {
                    window.set_position(*current_monitor.position()).map_err(|error| ScreenshotError::new("window-failed", error))?;
                    window.set_size(*current_monitor.size()).map_err(|error| ScreenshotError::new("window-failed", error))?;
                    window.set_fullscreen(true).map_err(|error| ScreenshotError::new("window-failed", error))?;
                }
                let event_app = window_app.clone();
                let event_id = window_id.clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            let busy = DESKTOP_SESSION.lock().ok().is_some_and(|session| session.as_ref()
                                .is_some_and(|session| session.id == event_id && (session.finishing || session.dialog_mode)));
                            if busy { api.prevent_close(); }
                            else { end_desktop_session(&event_app, &event_id); }
                        }
                        tauri::WindowEvent::Destroyed => end_desktop_session(&event_app, &event_id),
                        _ => {}
                    }
                });
            }
            Ok(())
        };
        let _ = sender.send(build());
    });
    let built = match dispatched {
        Ok(()) => receiver.await.map_err(|error| ScreenshotError::new("window-failed", error)).and_then(|result| result),
        Err(error) => Err(ScreenshotError::new("window-failed", error)),
    };
    if let Err(error) = built { end_desktop_session(&app, &id); return Err(error); }
    let timeout_app = app.clone();
    let timeout_id = id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let pending = DESKTOP_SESSION.lock().ok().is_some_and(|session| session.as_ref().is_some_and(|session| session.id == timeout_id && !session.shown));
        if pending {
            end_desktop_session(&timeout_app, &timeout_id);
            let _ = timeout_app.emit_to("main", "desktop-screenshot-error", ScreenshotError::new("window-failed", "The screenshot editor did not finish loading"));
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn begin_desktop_screenshot(window: WebviewWindow) -> Result<String, ScreenshotError> {
    require_main(&window)?;
    start_desktop_screenshot(window.app_handle().clone()).await
}

#[tauri::command]
pub fn get_desktop_screenshot(window: WebviewWindow) -> Result<DesktopScreenshotContext, ScreenshotError> {
    let session = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
    let session = session.as_ref().ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
    Ok(overlay_screen(session, &window)?.context.clone())
}

#[tauri::command]
pub async fn ready_desktop_screenshot(window: WebviewWindow, session_id: String) -> Result<(), ScreenshotError> {
    {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let session = guard.as_mut().filter(|session| session.id == session_id).ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
        let monitor_id = overlay_screen(session, &window)?.context.monitor_id.clone();
        session.ready.insert(monitor_id);
    }
    if let Err(error) = show_ready_overlays(window.app_handle(), &session_id).await {
        end_desktop_session(window.app_handle(), &session_id);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_desktop_screenshot_dialog_mode(window: WebviewWindow, session_id: String, active: bool) -> Result<(), ScreenshotError> {
    let screens = {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let Some(session) = guard.as_mut().filter(|session| session.id == session_id) else {
            return if active { Err(ScreenshotError::new("invalid-session", "Screenshot session has ended")) } else { Ok(()) };
        };
        overlay_screen(session, &window)?;
        session.dialog_mode = active;
        session.screens.clone()
    };
    let app = window.app_handle().clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || {
        let configure = || -> Result<(), ScreenshotError> {
            for screen in screens {
                let Some(overlay) = app.get_webview_window(&format!("{OVERLAY_PREFIX}{}", screen.context.monitor_id)) else { continue; };
                #[cfg(target_os = "macos")]
                {
                    use objc2_app_kit::{NSScreenSaverWindowLevel, NSStatusWindowLevel, NSWindow};
                    let pointer = overlay.ns_window().map_err(|error| ScreenshotError::new("window-failed", error))?;
                    let native = unsafe { &*(pointer as *mut NSWindow) };
                    // rfd's save panel is at the shielding level (1000). Lower
                    // all displays while it is open, including when moved to
                    // another screen, then restore editor coverage on cancel.
                    native.setLevel(if active { NSStatusWindowLevel + 1 } else { NSScreenSaverWindowLevel + 1 });
                }
                #[cfg(not(target_os = "macos"))]
                overlay.set_always_on_top(!active).map_err(|error| ScreenshotError::new("window-failed", error))?;
            }
            Ok(())
        };
        let _ = sender.send(configure());
    }).map_err(|error| ScreenshotError::new("window-failed", error))?;
    receiver.await.map_err(|error| ScreenshotError::new("window-failed", error))?
}

#[tauri::command]
pub fn fail_desktop_screenshot(window: WebviewWindow, session_id: String) -> Result<(), ScreenshotError> {
    {
        let guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let Some(session) = guard.as_ref().filter(|session| session.id == session_id) else { return Ok(()); };
        overlay_screen(session, &window)?;
    }
    end_desktop_session(window.app_handle(), &session_id);
    let _ = window.app_handle().emit_to("main", "desktop-screenshot-error", ScreenshotError::new("window-failed", "The screenshot editor could not load"));
    Ok(())
}

#[tauri::command]
pub fn cancel_desktop_screenshot(window: WebviewWindow, session_id: String) -> Result<(), ScreenshotError> {
    {
        let guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        if let Some(session) = guard.as_ref().filter(|session| session.id == session_id) {
            overlay_screen(session, &window)?;
            if session.finishing || session.dialog_mode { return Err(ScreenshotError::new("session-busy", "The screenshot is being saved")); }
        } else { return Ok(()); }
    }
    end_desktop_session(window.app_handle(), &session_id);
    Ok(())
}

#[tauri::command]
pub async fn complete_desktop_screenshot(window: WebviewWindow, session_id: String, png_base64: String) -> Result<DesktopScreenshotResult, ScreenshotError> {
    let (max_width, max_height) = {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let session = guard.as_mut().filter(|session| session.id == session_id).ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
        let screen = overlay_screen(session, &window)?;
        let dimensions = (screen.context.image_width, screen.context.image_height);
        if session.finishing || session.dialog_mode { return Err(ScreenshotError::new("session-busy", "The screenshot is being saved")); }
        session.finishing = true;
        dimensions
    };
    let app = window.app_handle().clone();
    let save_app = app.clone();
    let save_id = session_id.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<DesktopScreenshotResult, ScreenshotError> {
        if png_base64.len() > MAX_RESULT_BYTES * 4 / 3 + 4 {
            return Err(ScreenshotError::new("save-failed", "The screenshot is too large"));
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64)
            .map_err(|error| ScreenshotError::new("save-failed", error))?;
        let (width, height) = xcap::image::ImageReader::with_format(Cursor::new(&bytes), xcap::image::ImageFormat::Png)
            .into_dimensions().map_err(|error| ScreenshotError::new("save-failed", error))?;
        if width == 0 || height == 0 || width > max_width || height > max_height {
            return Err(ScreenshotError::new("save-failed", "Screenshot dimensions exceed the captured display"));
        }
        let directory = desktop_cache(&save_app)?.join("results");
        std::fs::create_dir_all(&directory).map_err(|error| ScreenshotError::new("save-failed", error))?;
        let path = directory.join(format!("{save_id}.png"));
        let temporary = directory.join(format!("{save_id}-{}.tmp", uuid::Uuid::new_v4()));
        cleanup::protect(&save_app, &temporary);
        if let Err(error) = std::fs::write(&temporary, bytes) {
            cleanup::remove(&save_app, temporary);
            return Err(ScreenshotError::new("save-failed", error));
        }
        if let Err(error) = std::fs::rename(&temporary, &path) {
            cleanup::remove(&save_app, temporary);
            return Err(ScreenshotError::new("save-failed", error));
        }
        cleanup::release(&save_app, &temporary);
        Ok(DesktopScreenshotResult { session_id: save_id, path: path.to_string_lossy().into_owned(), width, height })
    }).await.map_err(|error| ScreenshotError::new("save-failed", error)).and_then(|result| result);
    match saved {
        Ok(result) => {
            // The result survives a missing listener, restart or failed record
            // save. The main window drains it and explicitly acknowledges it.
            end_desktop_session(&app, &session_id);
            let _ = app.emit_to("main", "desktop-screenshot-completed", &result);
            Ok(result)
        }
        Err(error) => {
            if let Ok(mut guard) = DESKTOP_SESSION.lock() {
                if let Some(session) = guard.as_mut().filter(|session| session.id == session_id) { session.finishing = false; }
            }
            Err(error)
        }
    }
}

fn pinned_context(window: &WebviewWindow) -> Result<PinnedScreenshotContext, ScreenshotError> {
    let pins = PINNED_SCREENSHOTS.lock().map_err(|error| ScreenshotError::new("pin-failed", error))?;
    pins.iter().find(|pin| window.label() == format!("{PIN_PREFIX}{}", pin.context.pin_id))
        .map(|pin| pin.context.clone())
        .ok_or_else(|| ScreenshotError::new("invalid-window", "This window does not own a pinned screenshot"))
}

fn remove_pin_image(app: &AppHandle, label: &str) {
    let removed = PINNED_SCREENSHOTS.lock().ok().and_then(|mut pins| {
        let index = pins.iter().position(|pin| label == format!("{PIN_PREFIX}{}", pin.context.pin_id))?;
        Some(pins.remove(index))
    });
    if let Some(pin) = removed {
        if !pin.record_saving { cleanup::remove(app, PathBuf::from(pin.context.image_path)); }
        // A failed or prematurely closed loading pin must not leave the
        // originating screenshot editor waiting forever for the handoff.
        if let Some(id) = pin.source_session_id {
            end_desktop_session_restoring_pin(app, &id, true, Some(label));
            let _ = app.emit_to("main", "desktop-screenshot-error", ScreenshotError::new("pin-failed", "The pinned screenshot could not finish loading"));
        }
    }
}

fn cleanup_pin_window(app: &AppHandle, label: &str) {
    remove_pin_image(app, label);
    if let Some(window) = app.get_window(label) { let _ = window.destroy(); }
}

async fn create_pinned_screenshot(window: &WebviewWindow, png_base64: String, max_dimensions: Option<(u32, u32)>, source_session_id: Option<String>) -> Result<String, ScreenshotError> {
    let app = window.app_handle().clone();
    let monitor = window.current_monitor().map_err(|error| ScreenshotError::new("pin-failed", error))?
        .or(app.primary_monitor().map_err(|error| ScreenshotError::new("pin-failed", error))?)
        .ok_or_else(|| ScreenshotError::new("pin-failed", "No display is available for the pinned image"))?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    if !scale.is_finite() || scale <= 0.0 || work_area.size.width == 0 || work_area.size.height == 0 {
        return Err(ScreenshotError::new("pin-failed", "Invalid display work area or scale factor"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let directory = desktop_cache(&app)?.join("pins");
    let save_id = id.clone();
    let save_app = app.clone();
    let (path, image_width, image_height) = tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, u32, u32), ScreenshotError> {
        if png_base64.len() > MAX_RESULT_BYTES * 4 / 3 + 4 {
            return Err(ScreenshotError::new("pin-failed", "The screenshot is too large"));
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64)
            .map_err(|error| ScreenshotError::new("pin-failed", error))?;
        let (width, height) = xcap::image::ImageReader::with_format(Cursor::new(&bytes), xcap::image::ImageFormat::Png)
            .into_dimensions().map_err(|error| ScreenshotError::new("pin-failed", error))?;
        if width == 0 || height == 0 || width > 32768 || height > 32768
            || u64::from(width) * u64::from(height) > (MAX_RESULT_BYTES / 4) as u64
            || max_dimensions.is_some_and(|(max_width, max_height)| width > max_width || height > max_height)
        {
            return Err(ScreenshotError::new("pin-failed", "Invalid or oversized screenshot dimensions"));
        }
        std::fs::create_dir_all(&directory).map_err(|error| ScreenshotError::new("pin-failed", error))?;
        let path = directory.join(format!("{save_id}.png"));
        let temporary = directory.join(format!("{save_id}-{}.tmp", uuid::Uuid::new_v4()));
        cleanup::protect(&save_app, &path);
        cleanup::protect(&save_app, &temporary);
        if let Err(error) = std::fs::write(&temporary, bytes).and_then(|()| std::fs::rename(&temporary, &path)) {
            cleanup::remove(&save_app, temporary);
            cleanup::remove(&save_app, path);
            return Err(ScreenshotError::new("pin-failed", error));
        }
        cleanup::release(&save_app, &temporary);
        Ok((path, width, height))
    }).await.map_err(|error| ScreenshotError::new("pin-failed", error))??;
    let preview_path = path.to_string_lossy().into_owned();
    let context = PinnedScreenshotContext {
        pin_id: id.clone(), image_path: preview_path.clone(), image_width, image_height,
        scale_factor: scale, platform: std::env::consts::OS.into(), record_state: PinnedScreenshotRecordState::Unsaved,
    };
    match PINNED_SCREENSHOTS.lock() {
        Ok(mut pins) => pins.push(PinnedScreenshot { context, ready: false, record_saving: false, source_session_id }),
        Err(error) => {
            cleanup::remove(&app, path);
            return Err(ScreenshotError::new("pin-failed", error));
        }
    }

    // Tauri work_area excludes the macOS menu bar/Dock and the Windows/Linux
    // taskbar. The hover toolbar overlays the image, so the initial size needs
    // no extra title-bar space. Small images retain room to drag or resize.
    let max_width = (f64::from(work_area.size.width) * 0.8).min((f64::from(work_area.size.width) - 48.0 * scale).max(1.0));
    let max_height = (f64::from(work_area.size.height) * 0.8).min((f64::from(work_area.size.height) - 48.0 * scale).max(1.0));
    let border = 2.0 * scale;
    let fit = ((max_width - border).max(1.0) / f64::from(image_width))
        .min((max_height - border).max(1.0) / f64::from(image_height)).min(1.0);
    let min_width = (280.0 * scale).min(max_width);
    let min_height = (120.0 * scale).min(max_height);
    let size = PhysicalSize::new(
        (f64::from(image_width) * fit + border).max(min_width).min(max_width).round() as u32,
        (f64::from(image_height) * fit + border).max(min_height).min(max_height).round() as u32,
    );
    let position = PhysicalPosition::new(
        work_area.position.x + ((work_area.size.width - size.width) / 2) as i32,
        work_area.position.y + ((work_area.size.height - size.height) / 2) as i32,
    );
    let label = format!("{PIN_PREFIX}{id}");
    let build_label = label.clone();
    let window_app = app.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let dispatched = app.run_on_main_thread(move || {
        let build = || -> Result<(), ScreenshotError> {
            let url = format!("screenshot-pin?pinId={id}");
            #[cfg(not(target_os = "macos"))]
            let builder = WebviewWindowBuilder::new(&window_app, &build_label, WebviewUrl::App(url.into()))
                .title("NoteGen Pinned Screenshot").decorations(false).resizable(true).maximizable(false).minimizable(false)
                .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true).shadow(true)
                .min_inner_size(min_width / scale, min_height / scale)
                .inner_size(f64::from(size.width) / scale, f64::from(size.height) / scale)
                .focused(false).visible(false).disable_drag_drop_handler();
            #[cfg(target_os = "macos")]
            let builder = tauri::window::WindowBuilder::new(&window_app, &build_label)
                .title("NoteGen Pinned Screenshot").decorations(false).resizable(true).maximizable(false).minimizable(false)
                .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true).shadow(true)
                .min_inner_size(min_width / scale, min_height / scale)
                .inner_size(f64::from(size.width) / scale, f64::from(size.height) / scale)
                .focused(false).visible(false);
            let pin = builder.build().map_err(|error| ScreenshotError::new("pin-failed", error))?;
            // Position first so the destination display determines the DPI.
            pin.set_position(position).map_err(|error| ScreenshotError::new("pin-failed", error))?;
            pin.set_size(size).map_err(|error| ScreenshotError::new("pin-failed", error))?;
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::{NSFloatingWindowLevel, NSWindow, NSWindowCollectionBehavior};
                let pointer = pin.ns_window().map_err(|error| ScreenshotError::new("pin-failed", error))?;
                let native = unsafe { &*(pointer as *mut NSWindow) };
                native.setLevel(NSFloatingWindowLevel);
                unsafe {
                    native.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
                }
            }
            #[cfg(target_os = "macos")]
            let pin = {
                let preview = present_macos_image(&pin, &preview_path, false)?;
                prepare_macos_editor_focus(&pin)?;
                attach_macos_editor(&pin, url, &preview)?
            };
            let event_label = build_label.clone();
            let event_app = window_app.clone();
            pin.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let loading = PINNED_SCREENSHOTS.lock().ok().is_some_and(|pins| pins.iter()
                            .any(|pin| format!("{PIN_PREFIX}{}", pin.context.pin_id) == event_label && !pin.ready));
                        if loading {
                            // A visible native preview can be closed before JS
                            // loads. Restore the external app before destroying it.
                            api.prevent_close();
                            cleanup_pin_window(&event_app, &event_label);
                        }
                    }
                    tauri::WindowEvent::Destroyed => remove_pin_image(&event_app, &event_label),
                    _ => {}
                }
            });
            Ok(())
        };
        let _ = sender.send(build());
    });
    let built = match dispatched {
        Ok(()) => receiver.await.map_err(|error| ScreenshotError::new("pin-failed", error)).and_then(|result| result),
        Err(error) => Err(ScreenshotError::new("pin-failed", error)),
    };
    if let Err(error) = built {
        // Restore the source editor before destroying a partially built pin.
        let _ = focus_screenshot_window(window.clone(), None).await;
        cleanup_pin_window(&app, &label);
        return Err(error);
    }
    let timeout_app = app.clone();
    let timeout_label = label.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let pending = PINNED_SCREENSHOTS.lock().ok().is_some_and(|pins| pins.iter()
            .any(|pin| format!("{PIN_PREFIX}{}", pin.context.pin_id) == timeout_label && !pin.ready));
        if pending { cleanup_pin_window(&timeout_app, &timeout_label); }
    });
    Ok(label)
}

#[tauri::command]
pub async fn pin_screenshot(window: WebviewWindow, png_base64: String, session_id: Option<String>) -> Result<String, ScreenshotError> {
    let max_dimensions = if let Some(id) = session_id.as_ref() {
        let mut guard = DESKTOP_SESSION.lock().map_err(|error| ScreenshotError::new("session-failed", error))?;
        let session = guard.as_mut().filter(|session| session.id == *id)
            .ok_or_else(|| ScreenshotError::new("invalid-session", "Screenshot session has ended"))?;
        let screen = overlay_screen(session, &window)?;
        let dimensions = (screen.context.image_width, screen.context.image_height);
        if session.finishing || session.dialog_mode { return Err(ScreenshotError::new("session-busy", "The screenshot is being saved")); }
        session.finishing = true;
        Some(dimensions)
    } else {
        require_main(&window)?;
        None
    };
    match create_pinned_screenshot(&window, png_base64, max_dimensions, session_id.clone()).await {
        Ok(label) => {
            if let Some(id) = session_id {
                // Keep the overlay until the pin's editor is ready and focused;
                // displaying its native preview is not the completed handoff.
                let ready = PINNED_SCREENSHOTS.lock().ok().and_then(|mut pins| {
                    let pin = pins.iter_mut().find(|pin| label == format!("{PIN_PREFIX}{}", pin.context.pin_id))?;
                    if !pin.ready { pin.source_session_id = Some(id.clone()); }
                    Some(pin.ready)
                });
                match ready {
                    Some(true) => end_desktop_session_with_focus(window.app_handle(), &id, false),
                    Some(false) => {}
                    None => end_desktop_session(window.app_handle(), &id),
                }
            }
            Ok(label)
        }
        Err(error) => {
            if let Some(id) = session_id {
                if let Ok(mut guard) = DESKTOP_SESSION.lock() {
                    if let Some(session) = guard.as_mut().filter(|session| session.id == id) { session.finishing = false; }
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn get_pinned_screenshot(window: WebviewWindow) -> Result<PinnedScreenshotContext, ScreenshotError> {
    pinned_context(&window)
}

#[tauri::command]
pub async fn read_pinned_screenshot(window: WebviewWindow) -> Result<tauri::ipc::Response, ScreenshotError> {
    let context = pinned_context(&window)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(context.image_path))
        .await.map_err(|error| ScreenshotError::new("pin-failed", error))?
        .map_err(|error| ScreenshotError::new("pin-failed", error))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn emit_pinned_record_state(app: &AppHandle, update: PinnedScreenshotRecordUpdate) {
    let label = format!("{PIN_PREFIX}{}", update.pin_id);
    let _ = app.emit_to(label, "pinned-screenshot-record-state", update);
}

#[tauri::command]
pub async fn save_pinned_screenshot(window: WebviewWindow) -> Result<PinnedScreenshotRecordState, ScreenshotError> {
    let context = {
        let mut pins = PINNED_SCREENSHOTS.lock().map_err(|error| ScreenshotError::new("pin-failed", error))?;
        let pin = pins.iter_mut().find(|pin| window.label() == format!("{PIN_PREFIX}{}", pin.context.pin_id))
            .ok_or_else(|| ScreenshotError::new("invalid-window", "This window does not own a pinned screenshot"))?;
        if pin.context.record_state == PinnedScreenshotRecordState::Saved { return Ok(PinnedScreenshotRecordState::Saved); }
        if pin.record_saving { return Ok(PinnedScreenshotRecordState::Pending); }
        pin.record_saving = true;
        pin.context.record_state = PinnedScreenshotRecordState::Pending;
        pin.context.clone()
    };
    let app = window.app_handle().clone();
    let save_app = app.clone();
    let save_context = context.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<DesktopScreenshotResult, ScreenshotError> {
        let directory = desktop_cache(&save_app)?.join("results");
        std::fs::create_dir_all(&directory).map_err(|error| ScreenshotError::new("save-failed", error))?;
        let path = directory.join(format!("{}.png", save_context.pin_id));
        let temporary = directory.join(format!("{}-{}.tmp", save_context.pin_id, uuid::Uuid::new_v4()));
        // A pin keeps one result ID throughout its lifetime. Retries may replay
        // this PNG, but the record bridge's sourceId always deduplicates it.
        // The queued file is immutable. Reuse it on retry rather than replacing
        // an existing destination, which Windows rename does not support.
        if !path.is_file() {
            cleanup::protect(&save_app, &temporary);
            if let Err(error) = std::fs::copy(&save_context.image_path, &temporary)
                .and_then(|_| std::fs::rename(&temporary, &path))
            {
                cleanup::remove(&save_app, temporary);
                return Err(ScreenshotError::new("save-failed", error));
            }
            cleanup::release(&save_app, &temporary);
        }
        Ok(DesktopScreenshotResult {
            session_id: save_context.pin_id, path: path.to_string_lossy().into_owned(),
            width: save_context.image_width, height: save_context.image_height,
        })
    }).await.map_err(|error| ScreenshotError::new("save-failed", error)).and_then(|result| result);
    let mut record_state = if saved.is_ok() { PinnedScreenshotRecordState::Pending } else { PinnedScreenshotRecordState::Unsaved };
    let mut pin_open = false;
    if let Ok(mut pins) = PINNED_SCREENSHOTS.lock() {
        if let Some(pin) = pins.iter_mut().find(|pin| pin.context.pin_id == context.pin_id) {
            pin_open = true;
            pin.record_saving = false;
            // A previous attempt can be acknowledged while a retry is copying.
            // Saving the same pin never moves its durable state backwards.
            if pin.context.record_state == PinnedScreenshotRecordState::Saved {
                record_state = PinnedScreenshotRecordState::Saved;
            } else {
                pin.context.record_state = record_state;
            }
        }
    }
    if !pin_open { cleanup::remove(&app, PathBuf::from(&context.image_path)); }
    if record_state == PinnedScreenshotRecordState::Saved {
        // Main may acknowledge the previous attempt while this worker runs.
        // Do not leave a second queued result after that durable success.
        if let Ok(result) = saved.as_ref() { cleanup::acknowledge_result(&app, PathBuf::from(&result.path)); }
        return Ok(record_state);
    }
    match saved {
        Ok(result) => {
            // Closing the pin only removes its display image. The queued PNG
            // remains available while main is hidden, locked or reloading.
            let _ = app.emit_to("main", "desktop-screenshot-completed", &result);
            Ok(record_state)
        }
        Err(error) => {
            if pin_open {
                emit_pinned_record_state(&app, PinnedScreenshotRecordUpdate {
                    pin_id: context.pin_id, record_state: PinnedScreenshotRecordState::Unsaved,
                });
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn fail_pinned_screenshot_record(window: WebviewWindow, session_id: String) -> Result<(), ScreenshotError> {
    require_main(&window)?;
    checked_session_id(&session_id)?;
    let update = {
        let mut pins = PINNED_SCREENSHOTS.lock().map_err(|error| ScreenshotError::new("pin-failed", error))?;
        pins.iter_mut().find(|pin| pin.context.pin_id == session_id)
            .filter(|pin| pin.context.record_state == PinnedScreenshotRecordState::Pending && !pin.record_saving)
            .map(|pin| {
                pin.context.record_state = PinnedScreenshotRecordState::Unsaved;
                PinnedScreenshotRecordUpdate { pin_id: session_id, record_state: PinnedScreenshotRecordState::Unsaved }
            })
    };
    if let Some(update) = update { emit_pinned_record_state(window.app_handle(), update); }
    Ok(())
}

#[tauri::command]
pub async fn ready_pinned_screenshot(window: WebviewWindow) -> Result<(), ScreenshotError> {
    let context = pinned_context(&window)?;
    focus_screenshot_window(window, Some(context.pin_id)).await
}

// Called only at application setup/exit. Ordinary screenshot cleanup leaves
// the pin directory intact so multiple independent images can stay on screen.
pub fn cleanup_pinned_screenshot_cache(app: &AppHandle) {
    if let Ok(mut pins) = PINNED_SCREENSHOTS.lock() { pins.clear(); }
    match desktop_cache(app) {
        Ok(cache) => cleanup::sweep(app, cache.join("pins"), Sweep::Images),
        Err(error) => cleanup::report_error(app, "resolve pin cache", error.message),
    }
}

#[tauri::command]
pub fn drain_desktop_screenshot_results(window: WebviewWindow) -> Result<Vec<DesktopScreenshotResult>, ScreenshotError> {
    require_main(&window)?;
    let directory = desktop_cache(window.app_handle())?.join("results");
    if !directory.exists() { return Ok(Vec::new()); }
    let mut results = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error| ScreenshotError::new("cache-failed", error))? {
        let entry = entry.map_err(|error| ScreenshotError::new("cache-failed", error))?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("png") || !entry.file_type().is_ok_and(|kind| kind.is_file()) { continue; }
        let Some(id) = path.file_stem().and_then(|id| id.to_str()) else { continue; };
        if checked_session_id(id).is_err() { continue; }
        if cleanup::result_acknowledged(&path).map_err(|error| ScreenshotError::new("cache-failed", error))? { continue; }
        match xcap::image::image_dimensions(&path) {
            Ok((width, height)) => results.push(DesktopScreenshotResult { session_id: id.into(), path: path.to_string_lossy().into_owned(), width, height }),
            Err(error) => cleanup::report_error(window.app_handle(), &format!("pending result retained, unable to read {}", path.display()), error),
        }
    }
    results.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    Ok(results)
}

#[tauri::command]
pub fn remove_desktop_screenshot_result(window: WebviewWindow, session_id: String) -> Result<(), ScreenshotError> {
    require_main(&window)?;
    checked_session_id(&session_id)?;
    let path = desktop_cache(window.app_handle())?.join("results").join(format!("{session_id}.png"));
    cleanup::acknowledge_result(window.app_handle(), path);
    let update = {
        let mut pins = PINNED_SCREENSHOTS.lock().map_err(|error| ScreenshotError::new("pin-failed", error))?;
        pins.iter_mut().find(|pin| pin.context.pin_id == session_id).map(|pin| {
            pin.context.record_state = PinnedScreenshotRecordState::Saved;
            PinnedScreenshotRecordUpdate { pin_id: session_id, record_state: PinnedScreenshotRecordState::Saved }
        })
    };
    if let Some(update) = update { emit_pinned_record_state(window.app_handle(), update); }
    Ok(())
}

pub fn cleanup_desktop_screenshot_captures(app: &AppHandle) {
    match desktop_cache(app) {
        Ok(cache) => {
            cleanup::sweep(app, cache.join("captures"), Sweep::Images);
            cleanup::sweep(app, cache.join("results"), Sweep::Results);
        }
        Err(error) => cleanup::report_error(app, "resolve desktop cache", error.message),
    }
}

// Remove temporary window captures from the in-app screenshot picker.
pub fn cleanup_temp_screenshot_dir(app: &AppHandle) {
    match app
        .path()
        .resolve("temp_screenshot", BaseDirectory::AppData)
    {
        Ok(directory) => cleanup::sweep(app, directory, Sweep::Images),
        Err(error) => cleanup::report_error(app, "resolve in-app screenshot cache", error),
    }
}

#[tauri::command]
pub fn cleanup_screenshot_cache(window: WebviewWindow, generation_ids: Vec<String>) -> Result<(), ScreenshotError> {
    require_main(&window)?;
    let directory = window.app_handle().path().resolve("temp_screenshot", BaseDirectory::AppData)
        .map_err(|error| ScreenshotError::new("cache-failed", error))?;
    for id in generation_ids {
        checked_session_id(&id)?;
        cleanup::remove(window.app_handle(), directory.join(id));
    }
    Ok(())
}

