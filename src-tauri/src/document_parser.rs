use anydoc::{ConvertError, Format};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

const MAX_DOCUMENT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    markdown: String,
    format: String,
    character_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentParseError {
    code: &'static str,
    message: String,
}

impl DocumentParseError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

fn format_name(format: Format) -> &'static str {
    match format {
        Format::Doc => "doc",
        Format::Docx => "docx",
        Format::Odt => "odt",
        Format::Pdf => "pdf",
        Format::Ppt => "ppt",
        Format::Pptx => "pptx",
        Format::Rtf => "rtf",
        Format::Epub => "epub",
        Format::Excel => "excel",
        Format::Ods => "ods",
        Format::Odp => "odp",
        Format::Csv => "csv",
    }
}

fn map_convert_error(error: ConvertError, format: Format) -> DocumentParseError {
    let code = match &error {
        ConvertError::Unsupported(message)
            if format == Format::Pdf && message.contains("OCR is required") =>
        {
            "SCANNED_PDF"
        }
        ConvertError::Unsupported(_) => "UNSUPPORTED",
        ConvertError::Malformed { .. } => "MALFORMED",
        ConvertError::Encrypted => "ENCRYPTED",
        ConvertError::ResourceLimit { .. } => "RESOURCE_LIMIT",
        ConvertError::MissingPart { .. } => "MISSING_PART",
        ConvertError::Io(_) => "READ_FAILED",
        _ => "PARSE_FAILED",
    };
    DocumentParseError::new(code, error.to_string())
}

fn read_document_bytes(app: &AppHandle, source: &str) -> Result<Vec<u8>, DocumentParseError> {
    let file_path = FilePath::from_str(source)
        .map_err(|error| DocumentParseError::new("READ_FAILED", error.to_string()))?;
    let mut options = OpenOptions::new();
    options.read(true);
    let file = app
        .fs()
        .open(file_path, options)
        .map_err(|error| DocumentParseError::new("READ_FAILED", error.to_string()))?;
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| DocumentParseError::new("READ_FAILED", error.to_string()))?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(DocumentParseError::new(
            "FILE_TOO_LARGE",
            format!("Document exceeds the {} MB limit", MAX_DOCUMENT_BYTES / 1024 / 1024),
        ));
    }
    Ok(bytes)
}

fn looks_like_csv(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let mut lines = text.lines().filter(|line| !line.trim().is_empty()).take(3);
    let Some(first) = lines.next() else {
        return false;
    };
    let first_columns = first.matches(',').count();
    first_columns > 0
        && lines
            .next()
            .is_some_and(|line| line.matches(',').count() == first_columns)
}

fn parse_document_inner(
    app: &AppHandle,
    source: &str,
    extension: Option<&str>,
) -> Result<ParsedDocument, DocumentParseError> {
    let bytes = read_document_bytes(app, source)?;
    let format = Format::from_bytes(&bytes)
        .or_else(|| extension.and_then(Format::from_extension))
        .or_else(|| Format::from_path(Path::new(source)))
        .or_else(|| looks_like_csv(&bytes).then_some(Format::Csv))
        .ok_or_else(|| DocumentParseError::new("UNSUPPORTED", "Unrecognized document format"))?;
    let markdown = anydoc::to_markdown_bytes(&bytes, format)
        .map_err(|error| map_convert_error(error, format))?;
    let character_count = markdown.chars().count();

    Ok(ParsedDocument {
        markdown,
        format: format_name(format).to_string(),
        character_count,
    })
}

#[tauri::command]
pub async fn parse_document(
    app: AppHandle,
    path: String,
    extension: Option<String>,
) -> Result<ParsedDocument, DocumentParseError> {
    tauri::async_runtime::spawn_blocking(move || {
        parse_document_inner(&app, &path, extension.as_deref())
    })
        .await
        .map_err(|error| DocumentParseError::new("PARSE_FAILED", error.to_string()))?
}
