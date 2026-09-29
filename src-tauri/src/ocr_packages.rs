use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

#[cfg(target_os = "macos")]
const MACOS_VISION_PROVIDER_ID: &str = "ocr-native-macos-vision";
#[cfg(target_os = "macos")]
const MACOS_VISION_PROVIDER_NAME: &str = "System OCR (macOS)";
#[cfg(target_os = "macos")]
const MACOS_VISION_PROVIDER_VERSION: &str = "1.0.0";
#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_ID: &str = "ocr-native-windows";
#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_NAME: &str = "System OCR (Windows)";
#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_VERSION: &str = "1.0.0";
#[cfg(target_os = "android")]
const ANDROID_MLKIT_PROVIDER_ID: &str = "ocr-native-android-mlkit";
#[cfg(target_os = "android")]
const ANDROID_MLKIT_PROVIDER_NAME: &str = "System OCR (Android)";
#[cfg(target_os = "android")]
const ANDROID_MLKIT_PROVIDER_VERSION: &str = "1.0.0";
#[cfg(target_os = "ios")]
const IOS_VISION_PROVIDER_ID: &str = "ocr-native-ios-vision";
#[cfg(target_os = "ios")]
const IOS_VISION_PROVIDER_NAME: &str = "System OCR (iOS)";
#[cfg(target_os = "ios")]
const IOS_VISION_PROVIDER_VERSION: &str = "1.0.0";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrProviderInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub platform: String,
    pub builtin: bool,
}

#[command]
pub async fn list_ocr_providers(_app_handle: AppHandle) -> Result<Vec<OcrProviderInfo>, String> {
    let mut providers = Vec::new();

    #[cfg(target_os = "macos")]
    if macos_builtin_provider_command(&_app_handle).is_ok() {
        providers.push(OcrProviderInfo {
            id: MACOS_VISION_PROVIDER_ID.to_string(),
            name: MACOS_VISION_PROVIDER_NAME.to_string(),
            version: MACOS_VISION_PROVIDER_VERSION.to_string(),
            platform: current_platform_tag(),
            builtin: true,
        });
    }

    #[cfg(target_os = "windows")]
    if windows_ocr_available().is_ok() {
        providers.push(OcrProviderInfo {
            id: WINDOWS_OCR_PROVIDER_ID.to_string(),
            name: WINDOWS_OCR_PROVIDER_NAME.to_string(),
            version: WINDOWS_OCR_PROVIDER_VERSION.to_string(),
            platform: current_platform_tag(),
            builtin: true,
        });
    }

    #[cfg(target_os = "android")]
    if crate::android_ocr::is_available(&_app_handle) {
        providers.push(OcrProviderInfo {
            id: ANDROID_MLKIT_PROVIDER_ID.to_string(),
            name: ANDROID_MLKIT_PROVIDER_NAME.to_string(),
            version: ANDROID_MLKIT_PROVIDER_VERSION.to_string(),
            platform: current_platform_tag(),
            builtin: true,
        });
    }

    #[cfg(target_os = "ios")]
    if crate::ios_ocr::is_available(&_app_handle) {
        providers.push(OcrProviderInfo {
            id: IOS_VISION_PROVIDER_ID.to_string(),
            name: IOS_VISION_PROVIDER_NAME.to_string(),
            version: IOS_VISION_PROVIDER_VERSION.to_string(),
            platform: current_platform_tag(),
            builtin: true,
        });
    }

    Ok(providers)
}

#[command]
pub async fn run_ocr_provider(
    app_handle: AppHandle,
    provider_id: String,
    image_path: String,
    languages: Vec<String>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        run_ocr_provider_sync(
            &app_handle,
            &app_data_dir,
            &provider_id,
            &image_path,
            languages,
        )
    })
    .await
    .map_err(|e| format!("Failed to join OCR provider task: {}", e))?
}

fn run_ocr_provider_sync(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    provider_id: &str,
    image_path: &str,
    languages: Vec<String>,
) -> Result<String, String> {
    let image_path = image_path.trim();
    let relative_image_path = image_path.trim_start_matches(&['/', '\\'][..]);
    let absolute_image_path = if Path::new(image_path).is_absolute() {
        PathBuf::from(image_path)
    } else {
        app_data_dir.join(relative_image_path)
    };

    #[cfg(target_os = "macos")]
    if provider_id == MACOS_VISION_PROVIDER_ID {
        return run_macos_ocr_provider_sync(app_handle, &absolute_image_path, languages);
    }

    #[cfg(target_os = "windows")]
    if provider_id == WINDOWS_OCR_PROVIDER_ID {
        let _ = app_handle;
        return run_windows_ocr_provider_sync(&absolute_image_path, languages);
    }

    #[cfg(target_os = "android")]
    if provider_id == ANDROID_MLKIT_PROVIDER_ID {
        return crate::android_ocr::recognize_image(app_handle, &absolute_image_path, languages);
    }

    #[cfg(target_os = "ios")]
    if provider_id == IOS_VISION_PROVIDER_ID {
        return crate::ios_ocr::recognize_image(app_handle, &absolute_image_path, languages);
    }

    Err(format!("Unknown OCR provider: {}", provider_id))
}

#[cfg(target_os = "macos")]
fn run_macos_ocr_provider_sync(
    app_handle: &AppHandle,
    absolute_image_path: &Path,
    languages: Vec<String>,
) -> Result<String, String> {
    use serde_json::json;
    use serde_json::Value;
    use std::io::Write;
    use std::process::{Command, Stdio};

    let command_path = macos_builtin_provider_command(app_handle)?;
    let payload = json!({
        "imagePath": absolute_image_path.to_string_lossy(),
        "languages": languages,
    });

    let mut child = Command::new(command_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start OCR provider: {}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| format!("Failed to write OCR provider input: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read OCR provider output: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "OCR provider exited with {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse OCR provider output: {}", e))?;

    parsed
        .get("text")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or("OCR provider output is missing text.".to_string())
}

#[cfg(target_os = "macos")]
fn macos_builtin_provider_command(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("ocr").join("notegen-ocr-vision"));
        candidates.push(
            resource_dir
                .join("resources")
                .join("ocr")
                .join("notegen-ocr-vision"),
        );
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ocr")
            .join("notegen-ocr-vision"),
    );

    for candidate in candidates {
        if candidate.is_file() {
            set_executable_permission(&candidate)?;
            return Ok(candidate);
        }
    }

    Err("Built-in macOS OCR provider is not available.".to_string())
}

#[cfg(target_os = "windows")]
fn run_windows_ocr_provider_sync(
    absolute_image_path: &Path,
    languages: Vec<String>,
) -> Result<String, String> {
    use windows::{
        core::HSTRING,
        Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
        Storage::{FileAccessMode, StorageFile},
    };

    let file_path = windows_ocr_image_path(absolute_image_path)?;
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(file_path))
        .map_err(|e| format!("Failed to open image file: {}", e))?
        .get()
        .map_err(|e| format!("Failed to read image file: {}", e))?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .map_err(|e| format!("Failed to open image stream: {}", e))?
        .get()
        .map_err(|e| format!("Failed to read image stream: {}", e))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| format!("Failed to decode image: {}", e))?
        .get()
        .map_err(|e| format!("Failed to create image decoder: {}", e))?;
    let decoded_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("Failed to read image bitmap: {}", e))?
        .get()
        .map_err(|e| format!("Failed to create image bitmap: {}", e))?;
    let bitmap = SoftwareBitmap::ConvertWithAlpha(
        &decoded_bitmap,
        BitmapPixelFormat::Bgra8,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(|e| format!("Failed to normalize image bitmap for OCR: {}", e))?;
    let engine = create_windows_ocr_engine(languages)?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("Windows OCR failed to start: {}", e))?
        .get()
        .map_err(|e| format!("Windows OCR failed: {}", e))?;
    let lines = result
        .Lines()
        .map_err(|e| format!("Failed to read OCR result lines: {}", e))?;
    let mut text_lines = Vec::new();

    for index in 0..lines
        .Size()
        .map_err(|e| format!("Failed to read OCR line count: {}", e))?
    {
        let line = lines
            .GetAt(index)
            .map_err(|e| format!("Failed to read OCR line: {}", e))?;
        let text = line
            .Text()
            .map_err(|e| format!("Failed to read OCR text: {}", e))?
            .to_string_lossy();
        if !text.trim().is_empty() {
            text_lines.push(text);
        }
    }

    Ok(text_lines.join("\n"))
}

#[cfg(target_os = "windows")]
fn windows_ocr_image_path(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("OCR image file does not exist: {}", path.display()));
    }

    path.to_str()
        .map(|value| value.replace('/', "\\"))
        .ok_or("OCR image path is not valid UTF-8.".to_string())
}

#[cfg(target_os = "windows")]
fn create_windows_ocr_engine(
    languages: Vec<String>,
) -> Result<windows::Media::Ocr::OcrEngine, String> {
    use windows::{core::HSTRING, Globalization::Language, Media::Ocr::OcrEngine};

    let available_tags = windows_available_ocr_language_tags()?;
    let candidate_tags = if languages.is_empty() {
        default_ocr_language_tags()
    } else {
        languages
            .into_iter()
            .filter_map(|language| normalize_ocr_language(&language))
            .collect()
    };

    for candidate in candidate_tags {
        if let Some(available_tag) = find_available_ocr_language(&available_tags, &candidate) {
            let language = Language::CreateLanguage(&HSTRING::from(available_tag.as_str()))
                .map_err(|e| format!("Failed to create OCR language {}: {}", available_tag, e))?;

            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                return Ok(engine);
            }
        }
    }

    OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| {
        format!(
            "Windows OCR language is unavailable. Install the Windows OCR language pack for Chinese or English. {}",
            e
        )
    })
}

#[cfg(target_os = "windows")]
fn windows_ocr_available() -> Result<(), String> {
    let languages = windows_available_ocr_language_tags()?;
    if languages.is_empty() {
        Err("No Windows OCR recognition languages are installed.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn windows_available_ocr_language_tags() -> Result<Vec<String>, String> {
    use windows::Media::Ocr::OcrEngine;

    let languages = OcrEngine::AvailableRecognizerLanguages()
        .map_err(|e| format!("Failed to list Windows OCR languages: {}", e))?;
    let mut tags = Vec::new();

    for index in 0..languages
        .Size()
        .map_err(|e| format!("Failed to read OCR language count: {}", e))?
    {
        let language = languages
            .GetAt(index)
            .map_err(|e| format!("Failed to read OCR language: {}", e))?;
        let tag = language
            .LanguageTag()
            .map_err(|e| format!("Failed to read OCR language tag: {}", e))?
            .to_string_lossy();
        tags.push(tag);
    }

    Ok(tags)
}

#[cfg(target_os = "windows")]
fn default_ocr_language_tags() -> Vec<String> {
    [
        "zh-Hans", "zh-CN", "zh-Hant", "zh-TW", "en-US", "en", "ja-JP", "ja", "ko-KR", "ko",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

#[cfg(target_os = "windows")]
fn normalize_ocr_language(language: &str) -> Option<String> {
    let normalized = language.trim().replace('_', "-").to_lowercase();

    if normalized.is_empty() {
        return None;
    }

    let tag = match normalized.as_str() {
        "eng" | "en" | "en-us" => "en-US",
        "chi-sim" | "zh" | "zh-cn" | "zh-hans" => "zh-Hans",
        "chi-tra" | "zh-tw" | "zh-hant" => "zh-Hant",
        "jpn" | "ja" | "ja-jp" => "ja-JP",
        "kor" | "ko" | "ko-kr" => "ko-KR",
        _ => language,
    };

    Some(tag.to_string())
}

#[cfg(target_os = "windows")]
fn find_available_ocr_language(available_tags: &[String], candidate: &str) -> Option<String> {
    let candidate = candidate.to_lowercase();
    let candidate_prefix = format!("{}-", candidate);
    available_tags
        .iter()
        .find(|tag| {
            let available = tag.to_lowercase();
            let available_prefix = format!("{}-", available);
            available == candidate
                || available.starts_with(&candidate_prefix)
                || candidate.starts_with(&available_prefix)
                || windows_ocr_language_alias_matches(&available, &candidate)
        })
        .cloned()
}

#[cfg(target_os = "windows")]
fn windows_ocr_language_alias_matches(available: &str, candidate: &str) -> bool {
    match candidate {
        "zh-hans" | "zh-cn" => {
            available == "zh"
                || available.starts_with("zh-hans")
                || available.starts_with("zh-cn")
                || available.starts_with("zh-sg")
        }
        "zh-hant" | "zh-tw" => {
            available.starts_with("zh-hant")
                || available.starts_with("zh-tw")
                || available.starts_with("zh-hk")
                || available.starts_with("zh-mo")
        }
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn set_executable_permission(path: &Path) -> Result<(), String> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|e| format!("Failed to read provider permissions: {}", e))?
        .permissions();
    if permissions.mode() & 0o111 != 0 {
        return Ok(());
    }

    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|e| format!("Failed to set provider executable permission: {}", e))
}

fn current_platform_tag() -> String {
    format!(
        "{}-{}",
        normalize_os(std::env::consts::OS),
        normalize_arch(std::env::consts::ARCH)
    )
}

fn normalize_os(os: &str) -> &str {
    match os {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    }
}

fn normalize_arch(arch: &str) -> &str {
    match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}
