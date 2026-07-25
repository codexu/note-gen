use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use zip::ZipArchive;

pub fn ensure_zip_file_target_available(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err("ZIP file collides with an existing output path".to_string());
    }
    Ok(())
}

pub fn zip_path_dedup_key(enclosed_path: &Path, case_insensitive: bool) -> String {
    let normalized = if cfg!(windows) {
        enclosed_path.to_string_lossy().replace('\\', "/")
    } else {
        enclosed_path.to_string_lossy().into_owned()
    };
    if case_insensitive {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

pub fn zip_path_dedup_key_normalized(enclosed_path: &Path) -> String {
    enclosed_path.to_string_lossy().replace('\\', "/")
}

pub fn zip_entry_is_directory(raw_name: &str) -> bool {
    if raw_name.ends_with('/') {
        return true;
    }
    #[cfg(windows)]
    if raw_name.ends_with('\\') {
        return true;
    }
    false
}

#[derive(Clone, Copy, Debug)]
pub struct ZipExtractLimits {
    pub max_entries: Option<usize>,
    pub max_entry_bytes: Option<u64>,
    pub max_total_bytes: Option<u64>,
}

impl ZipExtractLimits {
    pub fn unlimited() -> Self {
        Self {
            max_entries: None,
            max_entry_bytes: None,
            max_total_bytes: None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ZipPathDedup {
    CaseSensitive,
    CaseInsensitive,
    NormalizedSlashes,
}

impl ZipPathDedup {
    fn key(self, enclosed_path: &Path) -> String {
        match self {
            Self::CaseSensitive => zip_path_dedup_key(enclosed_path, false),
            Self::CaseInsensitive => zip_path_dedup_key(enclosed_path, true),
            Self::NormalizedSlashes => zip_path_dedup_key_normalized(enclosed_path),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ZipDirectoryCheck {
    ZipMetadata,
    RawNameSuffix,
}

impl ZipDirectoryCheck {
    fn is_directory(self, raw_name: &str, zip_is_dir: bool) -> bool {
        match self {
            Self::ZipMetadata => zip_is_dir,
            Self::RawNameSuffix => zip_entry_is_directory(raw_name),
        }
    }
}

pub struct ZipExtractContext<'a> {
    pub dest_dir: &'a Path,
    pub path_dedup: ZipPathDedup,
    pub directory_check: ZipDirectoryCheck,
    pub limits: ZipExtractLimits,
    pub cancel: Option<&'a AtomicBool>,
}

struct ZipExtractBudget {
    entries: usize,
    total_uncompressed_size: u64,
    limits: ZipExtractLimits,
}

impl ZipExtractBudget {
    fn include_entry(&mut self, uncompressed_size: u64) -> Result<(), String> {
        self.entries = self
            .entries
            .checked_add(1)
            .ok_or_else(|| "ZIP entry count overflow".to_string())?;
        if let Some(max_entries) = self.limits.max_entries {
            if self.entries > max_entries {
                return Err(format!(
                    "ZIP contains too many entries (maximum {max_entries})"
                ));
            }
        }

        if let Some(max_entry_bytes) = self.limits.max_entry_bytes {
            if uncompressed_size > max_entry_bytes {
                return Err(format!(
                    "ZIP entry exceeds the {max_entry_bytes} byte limit"
                ));
            }
        }

        self.total_uncompressed_size = self
            .total_uncompressed_size
            .checked_add(uncompressed_size)
            .ok_or_else(|| "ZIP uncompressed size overflow".to_string())?;
        if let Some(max_total_bytes) = self.limits.max_total_bytes {
            if self.total_uncompressed_size > max_total_bytes {
                return Err(format!(
                    "ZIP exceeds the {max_total_bytes} byte extraction limit"
                ));
            }
        }

        Ok(())
    }
}

pub fn extract_zip_safely(zip_path: &Path, context: ZipExtractContext<'_>) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    if let Some(max_entries) = context.limits.max_entries {
        if archive.len() > max_entries {
            return Err(format!(
                "ZIP contains too many entries (maximum {max_entries})"
            ));
        }
    }

    let mut budget = ZipExtractBudget {
        entries: 0,
        total_uncompressed_size: 0,
        limits: context.limits,
    };
    let mut extracted_paths = HashSet::new();

    for index in 0..archive.len() {
        if context
            .cancel
            .is_some_and(|cancelled| cancelled.load(Ordering::SeqCst))
        {
            return Err("Import cancelled".to_string());
        }

        let file = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read file from zip: {}", e))?;
        let raw_name = file.name().to_string();
        let uncompressed_size = file.size();
        budget.include_entry(uncompressed_size)?;

        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP symbolic links are not supported".to_string());
        }

        let enclosed_path = match file.enclosed_name() {
            Some(path) => path,
            None => return Err("ZIP contains an unsafe path".to_string()),
        };
        let path_key = context.path_dedup.key(&enclosed_path);
        if !extracted_paths.insert(path_key) {
            return Err("ZIP contains duplicate output paths".to_string());
        }
        let outpath = context.dest_dir.join(&enclosed_path);
        let is_directory = context
            .directory_check
            .is_directory(&raw_name, file.is_dir());

        if is_directory {
            if outpath.exists() {
                let metadata = fs::symlink_metadata(&outpath)
                    .map_err(|e| format!("Failed to inspect directory: {}", e))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err("ZIP directory collides with an existing path".to_string());
                }
            } else {
                fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
        } else {
            ensure_zip_file_target_available(&outpath)?;
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&outpath)
                .map_err(|e| format!("Failed to create new ZIP output file: {}", e))?;
            let mut limited_reader = file.take(uncompressed_size.saturating_add(1));
            let copied = std::io::copy(&mut limited_reader, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
            if copied != uncompressed_size {
                return Err("ZIP entry size did not match its metadata".to_string());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;
    use zip::ZipWriter;

    fn write_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("create ZIP fixture");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            writer
                .start_file(*name, options)
                .expect("start ZIP fixture entry");
            writer.write_all(content).expect("write ZIP fixture entry");
        }
        writer.finish().expect("finish ZIP fixture");
    }

    #[test]
    fn extract_zip_safely_rejects_duplicate_paths() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-zip-extract-test-{}", Uuid::new_v4()));
        let output_dir = test_root.join("output");
        fs::create_dir_all(&output_dir).expect("create output");
        let zip_path = test_root.join("duplicate.zip");
        write_test_zip(
            &zip_path,
            &[("notes/a.txt", b"one"), ("notes\\a.txt", b"two")],
        );

        let result = extract_zip_safely(
            &zip_path,
            ZipExtractContext {
                dest_dir: &output_dir,
                path_dedup: ZipPathDedup::NormalizedSlashes,
                directory_check: ZipDirectoryCheck::ZipMetadata,
                limits: ZipExtractLimits::unlimited(),
                cancel: None,
            },
        );
        assert!(result.is_err());

        fs::remove_dir_all(&test_root).expect("cleanup");
    }

    #[test]
    fn zip_extract_budget_enforces_total_byte_limit() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-zip-budget-test-{}", Uuid::new_v4()));
        let output_dir = test_root.join("output");
        fs::create_dir_all(&output_dir).expect("create output");
        let zip_path = test_root.join("budget.zip");
        write_test_zip(
            &zip_path,
            &[("a.txt", &[0_u8; 100]), ("b.txt", &[0_u8; 100])],
        );

        let result = extract_zip_safely(
            &zip_path,
            ZipExtractContext {
                dest_dir: &output_dir,
                path_dedup: ZipPathDedup::CaseSensitive,
                directory_check: ZipDirectoryCheck::ZipMetadata,
                limits: ZipExtractLimits {
                    max_entries: None,
                    max_entry_bytes: None,
                    max_total_bytes: Some(128),
                },
                cancel: None,
            },
        );
        assert!(result.is_err());

        fs::remove_dir_all(&test_root).expect("cleanup");
    }
}
