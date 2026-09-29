use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder}, AppHandle, Emitter, LogicalPosition, LogicalSize,
    Manager, Webview, WebviewUrl,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(target_os = "windows")]
use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG};
#[cfg(target_os = "windows")]
use windows61::{
    core::BOOL,
    Win32::Foundation::HGLOBAL,
    Win32::System::Com::{StructuredStorage::CreateStreamOnHGlobal, STATFLAG_NONAME, STREAM_SEEK_SET},
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSDictionary, NSError};
#[cfg(target_os = "macos")]
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;

// Keep page scrollbars in step with src/app/globals.css. The window theme is
// already set from NoteGen, so this media query follows the app on navigation.
const BROWSER_SCROLLBAR_SCRIPT: &str = r#"
(() => {
  const css = `
    :root {
      --notegen-scrollbar-track-hover: hsl(240 4.8% 95.9% / 0.28);
      --notegen-scrollbar-thumb: hsl(240 3.8% 46.1% / 0.26);
      --notegen-scrollbar-thumb-hover: hsl(240 3.8% 46.1% / 0.48);
      --notegen-scrollbar-thumb-active: hsl(240 10% 3.9% / 0.62);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --notegen-scrollbar-track-hover: hsl(240 3.7% 15.9% / 0.28);
        --notegen-scrollbar-thumb: hsl(240 5% 64.9% / 0.26);
        --notegen-scrollbar-thumb-hover: hsl(240 5% 64.9% / 0.48);
        --notegen-scrollbar-thumb-active: hsl(0 0% 98% / 0.62);
      }
    }
    :not(table)::-webkit-scrollbar { width: 12px; height: 12px; }
    :not(table)::-webkit-scrollbar-track {
      background-color: transparent;
      transition: background-color 0.15s ease;
    }
    :not(table)::-webkit-scrollbar-thumb {
      border-radius: 9999px;
      background-color: var(--notegen-scrollbar-thumb);
      border: 4px solid transparent;
      background-clip: padding-box;
      transition: background-color 0.15s ease, border-width 0.15s ease;
    }
    :not(table)::-webkit-scrollbar-track:hover { background-color: var(--notegen-scrollbar-track-hover); }
    :not(table)::-webkit-scrollbar-thumb:hover {
      border-width: 2px;
      background-color: var(--notegen-scrollbar-thumb-hover);
    }
    :not(table)::-webkit-scrollbar-thumb:active {
      border-width: 1px;
      background-color: var(--notegen-scrollbar-thumb-active);
    }
    :not(table)::-webkit-scrollbar-corner { background-color: transparent; }
    :not(table) {
      scrollbar-width: thin;
      scrollbar-color: var(--notegen-scrollbar-thumb) transparent;
    }
  `;
  const install = () => {
    const root = document.head;
    if (!root) return;
    let style = document.getElementById('notegen-browser-scrollbars');
    if (!style) {
      style = document.createElement('style');
      style.id = 'notegen-browser-scrollbars';
      root.appendChild(style);
    }
    style.textContent = css;
  };
  if (document.head) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
"#;

// WKWebView does not consistently send target="_blank" link clicks through
// its new-window delegate. Route those user clicks through frame navigation.
#[cfg(target_os = "macos")]
const BROWSER_NEW_TAB_SCRIPT: &str = r#"
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0) return;
  const link = event.target instanceof Element ? event.target.closest('a[href][target="_blank"]') : null;
  if (!link) return;
  let destination;
  try {
    destination = new URL(link.href, document.baseURI);
  } catch {
    return;
  }
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const signal = document.createElement('iframe');
  signal.style.display = 'none';
  signal.src = `notegen-open://tab/?url=${encodeURIComponent(destination.href)}`;
  document.documentElement.appendChild(signal);
  setTimeout(() => signal.remove(), 1000);
}, true);
"#;

// WebView2's navigation handler observes top-level navigation, not iframe
// navigation. Use a reserved HTTPS destination and cancel it in Rust.
#[cfg(target_os = "windows")]
const BROWSER_NEW_TAB_SCRIPT_WINDOWS: &str = r#"
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0) return;
  const link = event.target instanceof Element ? event.target.closest('a[href][target="_blank"]') : null;
  if (!link) return;
  let destination;
  try {
    destination = new URL(link.href, document.baseURI);
  } catch {
    return;
  }
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(`https://notegen-browser.invalid/open?url=${encodeURIComponent(destination.href)}`);
}, true);
"#;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserLocation {
    tab_id: String,
    url: String,
    complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserNewWindow {
    source_tab_id: String,
    url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryState {
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageContent {
    title: String,
    url: String,
    text: String,
    truncated: bool,
}

// Read the rendered page in its existing webview. Remote pages never receive Tauri IPC access.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn browser_get_content(caller: Webview, app: AppHandle, tab_id: String) -> Result<BrowserPageContent, String> {
    main_webview(&caller)?;
    let browser = get_browser(&app, &tab_id)?;
    const SCRIPT: &str = r#"(()=>{const text=(document.body?.innerText||document.documentElement?.innerText||'').trim();return {title:document.title||'',url:location.href,text:text.slice(0,100000),truncated:text.length>100000}})()"#;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    browser.eval_with_callback(SCRIPT, move |json| {
        if let Some(sender) = sender.lock().unwrap().take() {
            let _ = sender.send(json);
        }
    }).map_err(|error| error.to_string())?;
    let raw = tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
        .await.map_err(|_| "Timed out reading browser page".to_string())?
        .map_err(|_| "Unable to read browser page".to_string())?;
    let page: BrowserPageContent = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    parse_web_url(&page.url)?;
    Ok(page)
}

fn main_webview(caller: &Webview) -> Result<(), String> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err("Browser commands are only available to the main webview".into())
    }
}

fn browser_label(tab_id: &str) -> Result<String, String> {
    let suffix = tab_id
        .strip_prefix("browser-")
        .ok_or_else(|| "Invalid browser tab".to_string())?;
    if suffix.is_empty() || !suffix.chars().all(|character| character.is_ascii_hexdigit() || character == '-') {
        return Err("Invalid browser tab".into());
    }
    Ok(format!("browser-{suffix}"))
}

fn parse_web_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|_| "Invalid URL".to_string())?;
    if (parsed.scheme() == "http" || parsed.scheme() == "https") && parsed.host_str().is_some() {
        Ok(parsed)
    } else {
        Err("Only HTTP and HTTPS websites are supported".into())
    }
}

fn get_browser(app: &AppHandle, tab_id: &str) -> Result<Webview, String> {
    let label = browser_label(tab_id)?;
    app.get_webview(&label)
        .ok_or_else(|| "Browser tab is not open".into())
}

fn browser_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width < 1.0 || height < 1.0 {
        return Err("Invalid browser bounds".into());
    }
    Ok((LogicalPosition::new(x, y), LogicalSize::new(width, height)))
}

fn browser_theme(value: &str) -> Result<tauri::Theme, String> {
    match value {
        "light" => Ok(tauri::Theme::Light),
        "dark" => Ok(tauri::Theme::Dark),
        _ => Err("Invalid browser theme".into()),
    }
}

#[tauri::command]
pub fn browser_set_theme(caller: Webview, app: AppHandle, theme: String) -> Result<(), String> {
    main_webview(&caller)?;
    let window = app.get_window("main").ok_or_else(|| "Main window is unavailable".to_string())?;
    window.set_theme(Some(browser_theme(&theme)?)).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_create(
    caller: Webview,
    app: AppHandle,
    tab_id: String,
    url: String,
    theme: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    main_webview(&caller)?;
    let label = browser_label(&tab_id)?;
    let url = parse_web_url(&url)?;
    let (position, size) = browser_bounds(x, y, width, height)?;
    let window = app.get_window("main").ok_or_else(|| "Main window is unavailable".to_string())?;
    window.set_theme(Some(browser_theme(&theme)?)).map_err(|error| error.to_string())?;
    if let Some(existing) = app.get_webview(&label) {
        existing.set_bounds(tauri::Rect { position: position.into(), size: size.into() }).map_err(|error| error.to_string())?;
        existing.show().map_err(|error| error.to_string())?;
        if let Ok(current_url) = existing.url() {
            let _ = app.emit_to("main", "browser:location", BrowserLocation {
                tab_id,
                url: current_url.to_string(),
                complete: false,
                title: None,
            });
        }
        return Ok(());
    }
    let navigation_app = app.clone();
    let navigation_tab_id = tab_id.clone();
    let load_app = app.clone();
    let load_tab_id = tab_id.clone();
    let title_app = app.clone();
    let title_tab_id = tab_id;
    let new_window_app = app.clone();
    let new_window_tab_id = navigation_tab_id.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .focused(false)
        .initialization_script(BROWSER_SCROLLBAR_SCRIPT);
    #[cfg(target_os = "macos")]
    let builder = builder.initialization_script(BROWSER_NEW_TAB_SCRIPT);
    #[cfg(target_os = "windows")]
    let builder = builder.initialization_script(BROWSER_NEW_TAB_SCRIPT_WINDOWS);
    let builder = builder
        .on_new_window(move |target, _features| {
            if parse_web_url(target.as_str()).is_ok() {
                let _ = new_window_app.emit_to("main", "browser:new-window", BrowserNewWindow {
                    source_tab_id: new_window_tab_id.clone(),
                    url: target.to_string(),
                });
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |target| {
            if target.scheme() == "https" && target.host_str() == Some("notegen-browser.invalid") && target.path() == "/open" {
                if let Some((_, destination)) = target.query_pairs().find(|(key, _)| key == "url") {
                    if parse_web_url(&destination).is_ok() {
                        let _ = navigation_app.emit_to("main", "browser:new-window", BrowserNewWindow {
                            source_tab_id: navigation_tab_id.clone(),
                            url: destination.into_owned(),
                        });
                    }
                }
                return false;
            }
            if target.scheme() == "notegen-open" && target.host_str() == Some("tab") {
                if let Some((_, destination)) = target.query_pairs().find(|(key, _)| key == "url") {
                    if parse_web_url(&destination).is_ok() {
                        let _ = navigation_app.emit_to("main", "browser:new-window", BrowserNewWindow {
                            source_tab_id: navigation_tab_id.clone(),
                            url: destination.into_owned(),
                        });
                    }
                }
                return false;
            }
            if target.scheme() != "http" && target.scheme() != "https" {
                return false;
            }
            let _ = navigation_app.emit_to("main", "browser:location", BrowserLocation {
                tab_id: navigation_tab_id.clone(),
                url: target.to_string(),
                complete: false,
                title: None,
            });
            true
        })
        .on_page_load(move |_webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = load_app.emit_to("main", "browser:location", BrowserLocation {
                    tab_id: load_tab_id.clone(),
                    url: payload.url().to_string(),
                    complete: true,
                    title: None,
                });
            }
        })
        .on_document_title_changed(move |webview, title| {
            if let Ok(url) = webview.url() {
                let _ = title_app.emit_to("main", "browser:location", BrowserLocation {
                    tab_id: title_tab_id.clone(),
                    url: url.to_string(),
                    complete: false,
                    title: Some(title),
                });
            }
        });
    window.add_child(builder, position, size).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_set_bounds(
    caller: Webview,
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    main_webview(&caller)?;
    let (position, size) = browser_bounds(x, y, width, height)?;
    let browser = get_browser(&app, &tab_id)?;
    browser.set_bounds(tauri::Rect { position: position.into(), size: size.into() }).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_set_visible(caller: Webview, app: AppHandle, tab_id: String, visible: bool) -> Result<(), String> {
    main_webview(&caller)?;
    let browser = get_browser(&app, &tab_id)?;
    if visible { browser.show() } else { browser.hide() }.map_err(|error| error.to_string())
}

// Keep the current page visible behind DOM menus while the native webview is hidden.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_snapshot(caller: Webview, app: AppHandle, tab_id: String) -> Result<String, String> {
    main_webview(&caller)?;
    let browser = get_browser(&app, &tab_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    browser.with_webview(move |webview| unsafe {
        let webview = &*(webview.inner() as *mut WKWebView);
        let completion = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
            let result = (|| {
                let image = image.as_ref().ok_or("Unable to capture browser page")?;
                let tiff = image.TIFFRepresentation().ok_or("Unable to encode browser page")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("Unable to encode browser page")?;
                let properties = NSDictionary::new();
                let png = bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
                    .ok_or("Unable to encode browser page")?;
                Ok::<_, &str>(format!("data:image/png;base64,{}", STANDARD.encode(png.to_vec())))
            })().map_err(str::to_string);
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(result);
            }
        });
        let main_thread = MainThreadMarker::new().expect("webview access must run on the main thread");
        let configuration = WKSnapshotConfiguration::new(main_thread);
        configuration.setAfterScreenUpdates(false);
        webview.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &completion);
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3), receiver)
        .await.map_err(|_| "Timed out capturing browser page".to_string())?
        .map_err(|_| "Unable to capture browser page".to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn browser_snapshot(caller: Webview, app: AppHandle, tab_id: String) -> Result<String, String> {
    main_webview(&caller)?;
    let browser = get_browser(&app, &tab_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
    browser.with_webview(move |webview| {
        let completion_sender = sender.clone();
        let result = (|| unsafe {
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
                .map_err(|error| error.to_string())?;
            let page = webview.controller().CoreWebView2().map_err(|error| error.to_string())?;
            let capture_stream = stream.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let image = (|| {
                    result.map_err(|error| error.to_string())?;
                    let mut stat = std::mem::zeroed();
                    capture_stream.Stat(&mut stat, STATFLAG_NONAME).map_err(|error| error.to_string())?;
                    let length = usize::try_from(stat.cbSize).map_err(|error| error.to_string())?;
                    if length == 0 || length > 32 * 1024 * 1024 {
                        return Err("Invalid browser snapshot size".to_string());
                    }
                    capture_stream.Seek(0, STREAM_SEEK_SET, None).map_err(|error| error.to_string())?;
                    let mut bytes = vec![0; length];
                    let mut read = 0;
                    capture_stream.Read(bytes.as_mut_ptr().cast(), length as u32, Some(&mut read))
                        .ok().map_err(|error| error.to_string())?;
                    if read as usize != length {
                        return Err("Incomplete browser snapshot".to_string());
                    }
                    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
                })();
                if let Some(sender) = completion_sender.lock().unwrap().take() {
                    let _ = sender.send(image);
                }
                Ok(())
            }));
            page.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
                .map_err(|error| error.to_string())
        })();
        if let Err(error) = result {
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(Err(error));
            }
        }
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3), receiver)
        .await.map_err(|_| "Timed out capturing browser page".to_string())?
        .map_err(|_| "Unable to capture browser page".to_string())?
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub fn browser_snapshot(caller: Webview) -> Result<String, String> {
    main_webview(&caller)?;
    Err("Browser snapshots are unavailable on this platform".into())
}

#[tauri::command]
pub fn browser_navigate(caller: Webview, app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    main_webview(&caller)?;
    get_browser(&app, &tab_id)?
        .navigate(parse_web_url(&url)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_history(caller: Webview, app: AppHandle, tab_id: String, direction: String) -> Result<bool, String> {
    main_webview(&caller)?;
    if direction != "back" && direction != "forward" {
        return Err("Invalid history direction".into());
    }
    let browser = get_browser(&app, &tab_id)?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        browser.with_webview(move |webview| unsafe {
            let webview = &*(webview.inner() as *mut WKWebView);
            let can_navigate = if direction == "back" { webview.canGoBack() } else { webview.canGoForward() };
            if direction == "back" && can_navigate {
                let _ = webview.goBack();
            } else if direction == "forward" && can_navigate {
                let _ = webview.goForward();
            }
            let _ = sender.send(can_navigate);
        }).map_err(|error| error.to_string())?;
        receiver.await.map_err(|_| "Browser history is unavailable".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        browser.with_webview(move |webview| {
            let result = (|| unsafe {
                let page = webview.controller().CoreWebView2().map_err(|error| error.to_string())?;
                let mut available = BOOL(0);
                if direction == "back" {
                    page.CanGoBack(&mut available).map_err(|error| error.to_string())?;
                    if available.as_bool() { page.GoBack().map_err(|error| error.to_string())?; }
                } else {
                    page.CanGoForward(&mut available).map_err(|error| error.to_string())?;
                    if available.as_bool() { page.GoForward().map_err(|error| error.to_string())?; }
                }
                Ok::<bool, String>(available.as_bool())
            })();
            let _ = sender.send(result);
        }).map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await.map_err(|_| "Timed out reading browser history".to_string())?
            .map_err(|_| "Browser history is unavailable".to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let script = if direction == "back" {
            "(()=>{const can=window.navigation?.canGoBack??history.length>1;if(can)history.back();return can})()"
        } else {
            "(()=>{const can=window.navigation?.canGoForward??true;if(can)history.forward();return can})()"
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = std::sync::Mutex::new(Some(sender));
        browser.eval_with_callback(script, move |json| {
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(json);
            }
        }).map_err(|error| error.to_string())?;
        let raw = tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await.map_err(|_| "Timed out reading browser history".to_string())?
            .map_err(|_| "Browser history is unavailable".to_string())?;
        serde_json::from_str(&raw).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn browser_history_state(caller: Webview, app: AppHandle, tab_id: String) -> Result<BrowserHistoryState, String> {
    main_webview(&caller)?;
    let browser = get_browser(&app, &tab_id)?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        browser.with_webview(move |webview| unsafe {
            let webview = &*(webview.inner() as *mut WKWebView);
            let _ = sender.send(BrowserHistoryState {
                can_go_back: webview.canGoBack(),
                can_go_forward: webview.canGoForward(),
            });
        }).map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await.map_err(|_| "Timed out reading browser history".to_string())?
            .map_err(|_| "Browser history is unavailable".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        browser.with_webview(move |webview| {
            let result = (|| unsafe {
                let page = webview.controller().CoreWebView2().map_err(|error| error.to_string())?;
                let mut back = BOOL(0);
                let mut forward = BOOL(0);
                page.CanGoBack(&mut back).map_err(|error| error.to_string())?;
                page.CanGoForward(&mut forward).map_err(|error| error.to_string())?;
                Ok::<BrowserHistoryState, String>(BrowserHistoryState {
                    can_go_back: back.as_bool(),
                    can_go_forward: forward.as_bool(),
                })
            })();
            let _ = sender.send(result);
        }).map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await.map_err(|_| "Timed out reading browser history".to_string())?
            .map_err(|_| "Browser history is unavailable".to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = std::sync::Mutex::new(Some(sender));
        browser.eval_with_callback(
            "(()=>({canGoBack:window.navigation?.canGoBack??history.length>1,canGoForward:window.navigation?.canGoForward??false}))()",
            move |json| {
                if let Some(sender) = sender.lock().unwrap().take() {
                    let _ = sender.send(json);
                }
            },
        ).map_err(|error| error.to_string())?;
        let raw = tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await.map_err(|_| "Timed out reading browser history".to_string())?
            .map_err(|_| "Browser history is unavailable".to_string())?;
        serde_json::from_str(&raw).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn browser_reload(caller: Webview, app: AppHandle, tab_id: String) -> Result<(), String> {
    main_webview(&caller)?;
    get_browser(&app, &tab_id)?.reload().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_get_url(caller: Webview, app: AppHandle, tab_id: String) -> Result<String, String> {
    main_webview(&caller)?;
    get_browser(&app, &tab_id)?.url().map(|url| url.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_close(caller: Webview, app: AppHandle, tab_id: String) -> Result<(), String> {
    main_webview(&caller)?;
    let label = browser_label(&tab_id)?;
    if let Some(browser) = app.get_webview(&label) {
        browser.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}
