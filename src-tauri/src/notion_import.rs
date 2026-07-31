use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const MAX_NESTED_DEPTH: u8 = 3;
const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
const NOTION_ID_LEN: usize = 32;

const URL_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'%')
    .add(b'?')
    .add(b'#')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'(')
    .add(b')');

fn is_markdown(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".md")
}

fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

/// Notion appends a 32-char hex block id to every exported page and folder,
/// e.g. "My Page 39d2b6745dc680a88669df442674befe".
fn strip_notion_id(name: &str) -> &str {
    if name.len() <= NOTION_ID_LEN + 1 {
        return name;
    }
    let split_index = name.len() - NOTION_ID_LEN;
    if !name.is_char_boundary(split_index) {
        return name;
    }
    let (head, tail) = name.split_at(split_index);
    if head.ends_with(' ') && tail.chars().all(|c| c.is_ascii_hexdigit()) {
        let cleaned = head.trim_end();
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    name
}

fn clean_segment(segment: &str, is_last: bool) -> String {
    if is_last {
        if let Some(dot_index) = segment.rfind('.') {
            if dot_index > 0 {
                let (stem, extension) = segment.split_at(dot_index);
                return format!("{}{}", strip_notion_id(stem), extension);
            }
        }
    }
    strip_notion_id(segment).to_string()
}

fn clean_relative_path(path: &Path) -> Option<PathBuf> {
    let segments: Vec<String> = path
        .iter()
        .map(|segment| segment.to_string_lossy().into_owned())
        .collect();
    if segments.is_empty() {
        return None;
    }
    let last_index = segments.len() - 1;
    let mut cleaned = PathBuf::new();
    for (index, segment) in segments.iter().enumerate() {
        cleaned.push(clean_segment(segment, index == last_index));
    }
    Some(cleaned)
}

fn rewrite_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.contains("://")
        || trimmed.starts_with("mailto:")
        || trimmed.starts_with("data:")
    {
        return url.to_string();
    }

    let segments: Vec<&str> = trimmed.split('/').collect();
    let last_index = segments.len() - 1;
    let rewritten: Vec<String> = segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let decoded = percent_decode_str(segment).decode_utf8_lossy();
            let cleaned = clean_segment(&decoded, index == last_index);
            utf8_percent_encode(&cleaned, URL_ENCODE_SET).to_string()
        })
        .collect();
    rewritten.join("/")
}

/// Rewrites `](path)` style links so they keep pointing at the renamed files.
fn rewrite_markdown_links(content: &str) -> String {
    let bytes = content.as_bytes();
    let mut out = String::with_capacity(content.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b']' && i + 1 < bytes.len() && bytes[i + 1] == b'(' {
            let start = i + 2;
            let mut depth = 1usize;
            let mut j = start;
            while j < bytes.len() {
                match bytes[j] {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    b'\n' => break,
                    _ => {}
                }
                j += 1;
            }
            if depth == 0 && j < bytes.len() && content.is_char_boundary(start) {
                out.push_str("](");
                out.push_str(&rewrite_url(&content[start..j]));
                out.push(')');
                i = j + 1;
                continue;
            }
        }
        let ch = content[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

struct ExtractedFile {
    relative_path: PathBuf,
    contents: Vec<u8>,
}

fn collect_entries<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    files: &mut Vec<ExtractedFile>,
    extracted_bytes: &mut u64,
    depth: u8,
) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read zip entry: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(entry_path) = entry.enclosed_name() else {
            continue;
        };
        let entry_path = entry_path.to_path_buf();
        let file_name = entry_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            continue;
        }

        let is_nested_zip = file_name.to_ascii_lowercase().ends_with(".zip");
        if !is_nested_zip && !is_markdown(&file_name) && !is_image(&file_name) {
            continue;
        }

        *extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if *extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err("Zip archive exceeds the 1 GB extraction limit".to_string());
        }

        let mut contents = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut contents)
            .map_err(|error| format!("Failed to extract zip entry: {error}"))?;

        if is_nested_zip {
            if depth + 1 < MAX_NESTED_DEPTH {
                let mut nested = ZipArchive::new(Cursor::new(contents))
                    .map_err(|error| format!("Failed to read nested zip archive: {error}"))?;
                collect_entries(&mut nested, files, extracted_bytes, depth + 1)?;
            }
            continue;
        }

        let Some(relative_path) = clean_relative_path(&entry_path) else {
            continue;
        };
        if is_markdown(&file_name) {
            let text = String::from_utf8_lossy(&contents);
            contents = rewrite_markdown_links(&text).into_bytes();
        }
        files.push(ExtractedFile {
            relative_path,
            contents,
        });
    }
    Ok(())
}

fn import_notion_zip_inner(zip_path: &str, target_dir: &str) -> Result<usize, String> {
    let file =
        fs::File::open(zip_path).map_err(|error| format!("Failed to open zip file: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Failed to read zip archive: {error}"))?;

    let mut files = Vec::new();
    let mut extracted_bytes = 0u64;
    collect_entries(&mut archive, &mut files, &mut extracted_bytes, 0)?;

    let target_root = Path::new(target_dir);
    let mut written_paths: HashSet<PathBuf> = HashSet::new();
    let mut imported_count = 0usize;

    for file in files {
        // Two different pages can clean to the same name; keep the first one.
        if !written_paths.insert(file.relative_path.clone()) {
            continue;
        }
        let target_path = target_root.join(&file.relative_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create directory: {error}"))?;
        }
        fs::write(&target_path, &file.contents)
            .map_err(|error| format!("Failed to write file: {error}"))?;
        imported_count += 1;
    }

    Ok(imported_count)
}

#[tauri::command]
pub async fn import_notion_zip(zip_path: String, target_dir: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || import_notion_zip_inner(&zip_path, &target_dir))
        .await
        .map_err(|error| format!("Notion import task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_notion_id_from_names() {
        assert_eq!(
            strip_notion_id("AI 2cc2b6745dc680849b5ef051ef87c612"),
            "AI"
        );
        assert_eq!(strip_notion_id("plain name"), "plain name");
        assert_eq!(
            clean_segment("RAG 39d2b6745dc68012930afe9bc14d27eb.md", true),
            "RAG.md"
        );
    }

    #[test]
    fn rewrites_encoded_links() {
        let input = "[RAG](AI/RAG%2039d2b6745dc68012930afe9bc14d27eb.md) and [web](https://example.com/a%20b)";
        let output = rewrite_markdown_links(input);
        assert_eq!(
            output,
            "[RAG](AI/RAG.md) and [web](https://example.com/a%20b)"
        );
    }

    #[test]
    fn keeps_balanced_parens_in_links() {
        let input = "[a](%E8%8F%9C%20(1)/img%202cd2b6745dc681d2b2dccf7e9d330c0e.png)";
        let output = rewrite_markdown_links(input);
        assert_eq!(output, "[a](%E8%8F%9C%20%281%29/img.png)");
    }
}

