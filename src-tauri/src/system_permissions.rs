#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPermissions {
    microphone: Option<&'static str>,
    screen_capture: Option<bool>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[tauri::command]
pub fn get_system_media_permissions() -> MediaPermissions {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let microphone = {
        use objc2::{class, msg_send};
        use objc2_foundation::NSString;
        let media_type = NSString::from_str("soun");
        // This query does not start recording or trigger an authorization prompt.
        let status: isize = unsafe {
            msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media_type]
        };
        Some(match status {
            0 => "notGranted",
            1 => "restricted",
            2 => "denied",
            3 => "granted",
            _ => "unavailable",
        })
    };
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let microphone = None;

    #[cfg(target_os = "macos")]
    let screen_capture = Some(core_graphics::access::ScreenCaptureAccess.preflight());
    #[cfg(not(target_os = "macos"))]
    let screen_capture = None;

    MediaPermissions { microphone, screen_capture }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn request_screen_capture_permission() -> bool {
    core_graphics::access::ScreenCaptureAccess.request()
}
