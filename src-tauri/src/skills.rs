use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};
use zip::ZipArchive;

pub(crate) const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const MAX_REMOTE_ZIP_BYTES: u64 = 500 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 200 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 1_000;
const MAX_PATH_DEPTH: usize = 20;
const MAX_REMOTE_ENTRY_BYTES: u64 = 500 * 1024 * 1024;
const MAX_REMOTE_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_REMOTE_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_REMOTE_PATH_DEPTH: usize = 50;
const MAX_GENERATED_FILES: usize = 100;
const MAX_GENERATED_FILE_BYTES: usize = 1024 * 1024;
const MAX_GENERATED_PACKAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(serde::Deserialize, serde::Serialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
}

pub(crate) struct RemoteSkillInspection {
    pub name: String,
    pub description: String,
    pub root: PathBuf,
    pub files: Vec<String>,
    pub total_bytes: u64,
    pub has_scripts: bool,
    pub skipped_symlinks: Vec<String>,
    pub warnings: Vec<RemoteSkillWarning>,
}

#[derive(Clone, Copy)]
enum ArchiveSymlinkPolicy {
    Reject,
    Skip,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSkillWarning {
    pub code: String,
    pub actual: u64,
    pub recommended: u64,
    pub paths: Vec<String>,
}

#[derive(Default)]
struct ArchiveExtractionReport {
    skipped_symlinks: Vec<String>,
    warnings: Vec<RemoteSkillWarning>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageFile {
    path: String,
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageRequest {
    name: String,
    description: String,
    instructions: String,
    #[serde(default)]
    files: Vec<SkillPackageFile>,
    #[serde(default)]
    remove_files: Vec<String>,
    scope: SkillImportScope,
    workspace_root: Option<String>,
    #[serde(default)]
    replace_existing: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageValidation {
    valid: bool,
    errors: Vec<String>,
    warnings: Vec<String>,
    file_count: usize,
    total_bytes: usize,
    has_scripts: bool,
    replacing: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageInstallResult {
    name: String,
    scope: String,
    replaced: bool,
    file_count: usize,
    has_scripts: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallSkillRequest {
    skill_id: String,
    scope: SkillImportScope,
    workspace_root: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallSkillResult {
    skill_id: String,
    scope: String,
    removed_receipt: bool,
    removed_runtime: bool,
    warnings: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillImportSourceKind {
    Zip,
    Directory,
}

#[derive(Debug, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SkillImportScope {
    Global,
    Project,
}

fn resolve_skills_dir(
    app_handle: &AppHandle,
    scope: SkillImportScope,
    workspace_root: Option<&str>,
) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;
    Ok(match scope {
        SkillImportScope::Global => app_data_dir.join("skills"),
        SkillImportScope::Project => match workspace_root {
            Some(root) if !root.trim().is_empty() => PathBuf::from(root).join("skills"),
            _ => app_data_dir.join("article").join("skills"),
        },
    })
}

fn remove_skill_directory(skills_dir: &Path, skill_id: &str) -> Result<(), String> {
    if !is_safe_skill_name(skill_id) {
        return Err(
            "INVALID_SKILL_ID: Skill ID must contain only lowercase letters, numbers, and hyphens"
                .to_string(),
        );
    }

    let target = skills_dir.join(skill_id);
    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        format!("SKILL_NOT_FOUND: Failed to find Skill \"{skill_id}\": {error}")
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("UNSAFE_SKILL_PATH: Skill target must be a regular directory".to_string());
    }

    let manifest = target.join("SKILL.md");
    let manifest_metadata = fs::symlink_metadata(&manifest)
        .map_err(|error| format!("INVALID_SKILL: SKILL.md is missing: {error}"))?;
    if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
        return Err("UNSAFE_SKILL_PATH: SKILL.md must be a regular file".to_string());
    }

    let canonical_parent = skills_dir
        .canonicalize()
        .map_err(|error| format!("Failed to verify Skills directory: {error}"))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Failed to verify Skill directory: {error}"))?;
    if canonical_target.parent() != Some(canonical_parent.as_path()) {
        return Err(
            "UNSAFE_SKILL_PATH: Skill directory escapes the configured Skills directory"
                .to_string(),
        );
    }

    let tombstone = skills_dir.join(format!(".delete-{skill_id}-{}", uuid::Uuid::new_v4()));
    fs::rename(&target, &tombstone)
        .map_err(|error| format!("Failed to prepare Skill removal: {error}"))?;
    if let Err(error) = fs::remove_dir_all(&tombstone) {
        if !target.exists() {
            let _ = fs::rename(&tombstone, &target);
        }
        return Err(format!("Failed to remove Skill: {error}"));
    }
    Ok(())
}

fn remove_remote_skill_receipt(
    app_data_dir: &Path,
    scope: &str,
    workspace_root: Option<&str>,
    skill_id: &str,
) -> Result<bool, String> {
    let key = Sha256::digest(
        format!("{scope}:{}:{skill_id}", workspace_root.unwrap_or_default()).as_bytes(),
    );
    let receipt = app_data_dir
        .join("remote-skill-receipts")
        .join(format!("{key:x}.json"));
    if !receipt.exists() {
        return Ok(false);
    }
    fs::remove_file(receipt).map_err(|error| {
        format!("Skill was removed, but its install receipt could not be removed: {error}")
    })?;
    Ok(true)
}

#[command]
pub async fn uninstall_skill(
    app_handle: AppHandle,
    request: UninstallSkillRequest,
) -> Result<UninstallSkillResult, String> {
    let scope_name = match request.scope {
        SkillImportScope::Global => "global",
        SkillImportScope::Project => "project",
    };
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;
    let skills_dir = resolve_skills_dir(
        &app_handle,
        request.scope,
        request.workspace_root.as_deref(),
    )?;

    remove_skill_directory(&skills_dir, &request.skill_id)?;
    let mut warnings = Vec::new();
    let removed_receipt = match remove_remote_skill_receipt(
        &app_data_dir,
        scope_name,
        request.workspace_root.as_deref(),
        &request.skill_id,
    ) {
        Ok(removed) => removed,
        Err(error) => {
            warnings.push(error);
            false
        }
    };
    let runtime_dir = app_data_dir.join("skill-runtimes").join(&request.skill_id);
    let removed_runtime = if runtime_dir.exists() {
        match fs::remove_dir_all(&runtime_dir) {
            Ok(()) => true,
            Err(error) => {
                warnings.push(format!(
                    "Skill was removed, but its runtime could not be removed: {error}"
                ));
                false
            }
        }
    } else {
        false
    };

    Ok(UninstallSkillResult {
        skill_id: request.skill_id,
        scope: scope_name.to_string(),
        removed_receipt,
        removed_runtime,
        warnings,
    })
}

#[command]
pub async fn import_skill(
    app_handle: AppHandle,
    source_path: String,
    source_kind: SkillImportSourceKind,
    scope: SkillImportScope,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;
    let skills_dir = resolve_skills_dir(&app_handle, scope, workspace_root.as_deref())?;

    import_skill_source(&app_data_dir, &skills_dir, &source_path, source_kind)
}

#[command]
pub async fn validate_skill_package(
    app_handle: AppHandle,
    request: SkillPackageRequest,
) -> Result<SkillPackageValidation, String> {
    let skills_dir = resolve_skills_dir(
        &app_handle,
        request.scope,
        request.workspace_root.as_deref(),
    )?;
    Ok(validate_generated_package(&request, &skills_dir))
}

#[command]
pub async fn install_skill_package(
    app_handle: AppHandle,
    request: SkillPackageRequest,
) -> Result<SkillPackageInstallResult, String> {
    let skills_dir = resolve_skills_dir(
        &app_handle,
        request.scope,
        request.workspace_root.as_deref(),
    )?;
    let validation = validate_generated_package(&request, &skills_dir);
    if !validation.valid {
        return Err(validation.errors.join("; "));
    }

    fs::create_dir_all(&skills_dir)
        .map_err(|error| format!("Failed to create skills directory: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_millis();
    let staged = skills_dir.join(format!(".create-{}-{nonce}", request.name));
    let destination = skills_dir.join(&request.name);
    let backup = skills_dir.join(format!(".backup-{}-{nonce}", request.name));

    if destination.exists() && request.replace_existing {
        copy_dir_recursive(&destination, &staged)
            .map_err(|error| format!("Failed to stage the existing Skill for update: {error}"))?;
    } else {
        fs::create_dir_all(&staged)
            .map_err(|error| format!("Failed to create Skill staging directory: {error}"))?;
    }
    let write_result = (|| -> Result<(), String> {
        fs::write(staged.join("SKILL.md"), render_skill_file(&request)?)
            .map_err(|error| format!("Failed to write SKILL.md: {error}"))?;
        for file in &request.files {
            let destination = staged.join(&file.path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create Skill resource directory: {error}")
                })?;
            }
            fs::write(&destination, &file.content).map_err(|error| {
                format!("Failed to write Skill resource {}: {error}", file.path)
            })?;
        }
        for relative_path in &request.remove_files {
            let target = staged.join(relative_path);
            if target.is_file() {
                fs::remove_file(&target).map_err(|error| {
                    format!("Failed to remove Skill resource {relative_path}: {error}")
                })?;
            }
        }
        validate_skill_directory(&staged, &request.name)
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&staged);
        return Err(error);
    }

    let replaced = destination.exists();
    activate_staged_skill(&staged, &destination, &backup, request.replace_existing)?;
    Ok(SkillPackageInstallResult {
        name: request.name,
        scope: match request.scope {
            SkillImportScope::Global => "global".to_string(),
            SkillImportScope::Project => "project".to_string(),
        },
        replaced,
        file_count: validation.file_count,
        has_scripts: validation.has_scripts,
    })
}

#[command]
pub async fn import_skill_zip(app_handle: AppHandle, zip_path: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;
    let skills_dir = app_data_dir.join("skills");
    import_skill_source(
        &app_data_dir,
        &skills_dir,
        &zip_path,
        SkillImportSourceKind::Zip,
    )
}

fn import_skill_source(
    app_data_dir: &Path,
    skills_dir: &Path,
    source_path: &str,
    source_kind: SkillImportSourceKind,
) -> Result<String, String> {
    fs::create_dir_all(&skills_dir)
        .map_err(|error| format!("Failed to create skills directory: {error}"))?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_millis();
    let temp_dir = app_data_dir.join(format!(
        "temp_skill_import_{}_{}",
        std::process::id(),
        nonce
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create temporary import directory: {error}"))?;

    let import_result = match source_kind {
        SkillImportSourceKind::Zip => {
            let archive_metadata = fs::metadata(source_path)
                .map_err(|error| format!("Failed to inspect zip file: {error}"))?;
            if archive_metadata.len() > MAX_ZIP_BYTES {
                Err(format!(
                    "Skill archive exceeds the {} MB limit",
                    MAX_ZIP_BYTES / 1024 / 1024
                ))
            } else {
                import_skill_zip_inner(source_path, &temp_dir, skills_dir, nonce)
            }
        }
        SkillImportSourceKind::Directory => {
            import_skill_directory_inner(source_path, skills_dir, nonce)
        }
    };
    if let Err(error) = fs::remove_dir_all(&temp_dir) {
        eprintln!("Failed to clean Skill import temporary directory: {error}");
    }
    import_result
}

fn import_skill_directory_inner(
    source_path: &str,
    skills_dir: &Path,
    nonce: u128,
) -> Result<String, String> {
    let source = Path::new(source_path);
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Failed to inspect Skill folder: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The selected Skill source must be a regular folder".to_string());
    }
    let mut entry_count = 0;
    let mut total_bytes = 0;
    validate_directory_tree(source, 0, &mut entry_count, &mut total_bytes)?;

    let mut roots = Vec::new();
    collect_skill_roots(source, 0, &mut roots)?;
    install_discovered_skill(roots, source, source_path, skills_dir, nonce, true)
}

fn import_skill_zip_inner(
    zip_path: &str,
    temp_dir: &Path,
    skills_dir: &Path,
    nonce: u128,
) -> Result<String, String> {
    extract_skill_archive(
        Path::new(zip_path),
        temp_dir,
        None,
        ArchiveSymlinkPolicy::Reject,
    )?;

    let mut roots = Vec::new();
    collect_skill_roots(temp_dir, 0, &mut roots)?;
    install_discovered_skill(roots, temp_dir, zip_path, skills_dir, nonce, true)
}

fn extract_skill_archive(
    zip_path: &Path,
    temp_dir: &Path,
    requested_path: Option<&Path>,
    symlink_policy: ArchiveSymlinkPolicy,
) -> Result<ArchiveExtractionReport, String> {
    let file =
        fs::File::open(zip_path).map_err(|error| format!("Failed to open zip file: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Failed to read zip archive: {error}"))?;

    if requested_path.is_none() {
        let archive_limit = match symlink_policy {
            ArchiveSymlinkPolicy::Reject => MAX_ARCHIVE_ENTRIES,
            ArchiveSymlinkPolicy::Skip => MAX_REMOTE_ARCHIVE_ENTRIES,
        };
        if archive.len() > archive_limit {
            return Err(format!(
                "Skill archive contains more than {archive_limit} entries"
            ));
        }
    }

    let mut selected_entries = 0_usize;
    let mut total_uncompressed = 0_u64;
    let mut skipped_symlinks = Vec::new();
    let mut oversized_entries = Vec::new();
    let mut maximum_depth = 0_usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read zip entry: {error}"))?;
        let relative_path = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe path in Skill archive: {}", entry.name()))?
            .to_path_buf();
        if requested_path
            .map(|requested| !archive_path_matches_requested(&relative_path, requested))
            .unwrap_or(false)
        {
            continue;
        }
        selected_entries += 1;
        let entry_limit = match symlink_policy {
            ArchiveSymlinkPolicy::Reject => MAX_ARCHIVE_ENTRIES,
            ArchiveSymlinkPolicy::Skip => MAX_REMOTE_ARCHIVE_ENTRIES,
        };
        if selected_entries > entry_limit {
            return Err(format!(
                "Selected Skill contains more than {entry_limit} entries"
            ));
        }

        let path_depth = relative_path.components().count();
        maximum_depth = maximum_depth.max(path_depth);
        let depth_limit = match symlink_policy {
            ArchiveSymlinkPolicy::Reject => MAX_PATH_DEPTH,
            ArchiveSymlinkPolicy::Skip => MAX_REMOTE_PATH_DEPTH,
        };
        if path_depth > depth_limit {
            return Err(format!(
                "Skill archive path is nested too deeply: {}",
                entry.name()
            ));
        }
        if is_symlink(&entry) {
            match symlink_policy {
                ArchiveSymlinkPolicy::Reject => {
                    return Err(format!(
                        "Symbolic links are not allowed in Skill archives: {}",
                        entry.name()
                    ));
                }
                ArchiveSymlinkPolicy::Skip => {
                    skipped_symlinks.push(relative_path.to_string_lossy().to_string());
                    continue;
                }
            }
        }
        let entry_size_limit = match symlink_policy {
            ArchiveSymlinkPolicy::Reject => MAX_ENTRY_BYTES,
            ArchiveSymlinkPolicy::Skip => MAX_REMOTE_ENTRY_BYTES,
        };
        if entry.size() > entry_size_limit {
            return Err(format!(
                "Skill archive entry exceeds the size limit: {}",
                entry.name()
            ));
        }
        if matches!(symlink_policy, ArchiveSymlinkPolicy::Skip) && entry.size() > MAX_ENTRY_BYTES {
            oversized_entries.push(relative_path.to_string_lossy().to_string());
        }

        total_uncompressed = total_uncompressed
            .checked_add(entry.size())
            .ok_or("Skill archive size overflow")?;
        let uncompressed_limit = match symlink_policy {
            ArchiveSymlinkPolicy::Reject => MAX_UNCOMPRESSED_BYTES,
            ArchiveSymlinkPolicy::Skip => MAX_REMOTE_UNCOMPRESSED_BYTES,
        };
        if total_uncompressed > uncompressed_limit {
            return Err(format!(
                "Uncompressed Skill archive exceeds the {} MB limit",
                uncompressed_limit / 1024 / 1024
            ));
        }

        let output_path = temp_dir.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed to create archive directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create archive parent directory: {error}"))?;
        }
        let mut output = fs::File::create(&output_path)
            .map_err(|error| format!("Failed to create extracted file: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Failed to extract archive file: {error}"))?;
    }

    let mut warnings = Vec::new();
    if matches!(symlink_policy, ArchiveSymlinkPolicy::Skip) {
        if selected_entries > MAX_ARCHIVE_ENTRIES {
            warnings.push(RemoteSkillWarning {
                code: "many-files".to_string(),
                actual: selected_entries as u64,
                recommended: MAX_ARCHIVE_ENTRIES as u64,
                paths: Vec::new(),
            });
        }
        if maximum_depth > MAX_PATH_DEPTH {
            warnings.push(RemoteSkillWarning {
                code: "deep-paths".to_string(),
                actual: maximum_depth as u64,
                recommended: MAX_PATH_DEPTH as u64,
                paths: Vec::new(),
            });
        }
        if !oversized_entries.is_empty() {
            warnings.push(RemoteSkillWarning {
                code: "large-files".to_string(),
                actual: oversized_entries.len() as u64,
                recommended: MAX_ENTRY_BYTES,
                paths: oversized_entries,
            });
        }
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES {
            warnings.push(RemoteSkillWarning {
                code: "large-uncompressed-size".to_string(),
                actual: total_uncompressed,
                recommended: MAX_UNCOMPRESSED_BYTES,
                paths: Vec::new(),
            });
        }
    }

    Ok(ArchiveExtractionReport {
        skipped_symlinks,
        warnings,
    })
}

fn archive_path_matches_requested(archive_path: &Path, requested_path: &Path) -> bool {
    if archive_path.starts_with(requested_path) {
        return true;
    }
    let without_archive_root = archive_path.iter().skip(1).collect::<PathBuf>();
    without_archive_root.starts_with(requested_path)
}

fn install_discovered_skill(
    mut roots: Vec<PathBuf>,
    discovery_root: &Path,
    source_path: &str,
    skills_dir: &Path,
    nonce: u128,
    replace_existing: bool,
) -> Result<String, String> {
    if roots.is_empty() {
        return Err(
            "No valid Skill found. The selected source must contain exactly one SKILL.md root."
                .to_string(),
        );
    }
    if roots.len() != 1 {
        return Err(
            "The selected source contains multiple SKILL.md roots; import each Skill separately."
                .to_string(),
        );
    }
    let skill_root = roots.remove(0);
    let skill_name = if skill_root == discovery_root {
        Path::new(source_path)
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or("Failed to determine Skill directory name")?
            .to_string()
    } else {
        skill_root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("Failed to determine Skill directory name")?
            .to_string()
    };
    if !is_safe_skill_name(&skill_name) {
        return Err(
            "Skill directory name must contain 1-64 lowercase letters, digits, or hyphens"
                .to_string(),
        );
    }
    validate_skill_directory(&skill_root, &skill_name)?;

    install_skill_root(
        &skill_root,
        &skill_name,
        skills_dir,
        nonce,
        replace_existing,
    )
}

fn install_skill_root(
    skill_root: &Path,
    skill_name: &str,
    skills_dir: &Path,
    nonce: u128,
    replace_existing: bool,
) -> Result<String, String> {
    let destination = skills_dir.join(skill_name);
    let staged = skills_dir.join(format!(".import-{skill_name}-{nonce}"));
    let backup = skills_dir.join(format!(".backup-{skill_name}-{nonce}"));
    if let Err(error) = copy_dir_recursive(skill_root, &staged) {
        let _ = fs::remove_dir_all(&staged);
        return Err(format!("Failed to stage Skill import: {error}"));
    }
    activate_staged_skill(&staged, &destination, &backup, replace_existing)?;
    Ok(skill_name.to_string())
}

pub(crate) fn inspect_remote_skill_archive(
    zip_path: &Path,
    temp_dir: &Path,
    requested_path: Option<&str>,
) -> Result<RemoteSkillInspection, String> {
    let archive_bytes = fs::metadata(zip_path)
        .map_err(|error| format!("Failed to inspect remote Skill archive: {error}"))?
        .len();
    if archive_bytes > MAX_REMOTE_ZIP_BYTES {
        return Err(format!(
            "Remote Skill archive exceeds the absolute {} MB limit",
            MAX_REMOTE_ZIP_BYTES / 1024 / 1024
        ));
    }
    fs::create_dir_all(temp_dir)
        .map_err(|error| format!("Failed to create Skill preview directory: {error}"))?;
    let requested_path = requested_path
        .filter(|value| !value.trim().is_empty())
        .map(|value| PathBuf::from(value.trim_matches('/')));
    if requested_path.as_ref().is_some_and(|requested| {
        requested
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    }) {
        return Err("Requested Skill path is unsafe".to_string());
    }
    let archive_report = extract_skill_archive(
        zip_path,
        temp_dir,
        requested_path.as_deref(),
        ArchiveSymlinkPolicy::Skip,
    )?;

    let mut roots = Vec::new();
    collect_skill_roots(temp_dir, 0, &mut roots)?;
    if let Some(requested) = requested_path.as_deref() {
        roots.retain(|root| {
            root.strip_prefix(temp_dir)
                .map(|relative| relative.ends_with(requested))
                .unwrap_or(false)
        });
    }

    if roots.is_empty() {
        return Err("No SKILL.md was found at the requested source path".to_string());
    }
    if roots.len() != 1 {
        let candidates = roots
            .iter()
            .filter_map(|root| root.strip_prefix(temp_dir).ok())
            .map(|root| root.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "The source contains multiple Skills. Provide a direct Skill path. Candidates: {candidates}"
        ));
    }

    let root = roots.remove(0);
    let root_relative = root.strip_prefix(temp_dir).unwrap_or(&root);
    let skipped_symlinks = archive_report
        .skipped_symlinks
        .into_iter()
        .map(|path| {
            let path = PathBuf::from(path);
            path.strip_prefix(root_relative)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string()
        })
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    let content = fs::read_to_string(root.join("SKILL.md"))
        .map_err(|error| format!("Failed to read remote SKILL.md: {error}"))?;
    let metadata = parse_skill_frontmatter(&content)?;
    validate_skill_directory(&root, &metadata.name)?;
    let mut entry_count = 0;
    let mut total_bytes = 0;
    validate_directory_tree_with_limits(
        &root,
        0,
        &mut entry_count,
        &mut total_bytes,
        MAX_REMOTE_PATH_DEPTH,
        MAX_REMOTE_ARCHIVE_ENTRIES,
        MAX_REMOTE_ENTRY_BYTES,
        MAX_REMOTE_UNCOMPRESSED_BYTES,
    )?;
    let mut files = Vec::new();
    collect_relative_files(&root, &root, &mut files)?;
    files.sort();
    let has_scripts = files
        .iter()
        .any(|path| path == "scripts" || path.starts_with("scripts/"));
    let mut warnings = archive_report.warnings;
    for warning in &mut warnings {
        warning.paths = warning
            .paths
            .iter()
            .map(|path| {
                let path = PathBuf::from(path);
                path.strip_prefix(root_relative)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string()
            })
            .filter(|path| !path.is_empty())
            .collect();
    }
    if archive_bytes > MAX_ZIP_BYTES {
        warnings.push(RemoteSkillWarning {
            code: "large-archive".to_string(),
            actual: archive_bytes,
            recommended: MAX_ZIP_BYTES,
            paths: Vec::new(),
        });
    }
    if !skipped_symlinks.is_empty() {
        warnings.push(RemoteSkillWarning {
            code: "symbolic-links".to_string(),
            actual: skipped_symlinks.len() as u64,
            recommended: 0,
            paths: skipped_symlinks.clone(),
        });
    }
    if has_scripts {
        warnings.push(RemoteSkillWarning {
            code: "executable-scripts".to_string(),
            actual: 1,
            recommended: 0,
            paths: files
                .iter()
                .filter(|path| *path == "scripts" || path.starts_with("scripts/"))
                .cloned()
                .collect(),
        });
    }

    Ok(RemoteSkillInspection {
        name: metadata.name,
        description: metadata.description,
        root,
        files,
        total_bytes,
        has_scripts,
        skipped_symlinks,
        warnings,
    })
}

pub(crate) fn install_remote_skill_directory(
    app_handle: &AppHandle,
    skill_root: &Path,
    skill_name: &str,
    scope: SkillImportScope,
    workspace_root: Option<&str>,
    replace_existing: bool,
) -> Result<(String, bool), String> {
    let skills_dir = resolve_skills_dir(app_handle, scope, workspace_root)?;
    fs::create_dir_all(&skills_dir)
        .map_err(|error| format!("Failed to create Skills directory: {error}"))?;
    validate_skill_directory(skill_root, skill_name)?;
    let replacing = skills_dir.join(skill_name).exists();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_millis();
    let installed =
        install_skill_root(skill_root, skill_name, &skills_dir, nonce, replace_existing)?;
    Ok((installed, replacing))
}

pub(crate) fn parse_remote_skill_metadata(content: &str) -> Result<(String, String), String> {
    let metadata = parse_skill_frontmatter(content)?;
    Ok((metadata.name, metadata.description))
}

fn collect_relative_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(current).map_err(|error| format!("Failed to read Skill directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read Skill entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect Skill entry: {error}"))?;
        if file_type.is_symlink() {
            return Err(format!(
                "Symbolic links are not allowed: {}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            collect_relative_files(root, &path, files)?;
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| format!("Failed to normalize Skill path: {error}"))?
                .to_string_lossy()
                .replace('\\', "/");
            files.push(relative);
        }
    }
    Ok(())
}

fn activate_staged_skill(
    staged: &Path,
    destination: &Path,
    backup: &Path,
    replace_existing: bool,
) -> Result<(), String> {
    let had_existing = destination.exists();
    if had_existing && !replace_existing {
        let _ = fs::remove_dir_all(staged);
        return Err("A Skill with this name already exists. Set replaceExisting only when the user explicitly asks to update it.".to_string());
    }
    if had_existing {
        fs::rename(destination, backup)
            .map_err(|error| format!("Failed to back up existing Skill: {error}"))?;
    }

    if let Err(error) = fs::rename(staged, destination) {
        let _ = fs::remove_dir_all(staged);
        if had_existing {
            let _ = fs::rename(backup, destination);
        }
        return Err(format!("Failed to activate Skill: {error}"));
    }
    if had_existing {
        if let Err(error) = fs::remove_dir_all(backup) {
            eprintln!("Failed to clean previous Skill version after install: {error}");
        }
    }
    Ok(())
}

fn validate_generated_package(
    request: &SkillPackageRequest,
    skills_dir: &Path,
) -> SkillPackageValidation {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut total_bytes = request.instructions.len() + request.description.len();
    let mut seen_paths = HashSet::new();

    if !is_safe_skill_name(&request.name) {
        errors.push("Skill name must contain 1-64 lowercase ASCII letters, digits, or hyphens, without leading, trailing, or consecutive hyphens".to_string());
    }
    if request.description.trim().is_empty() || request.description.chars().count() > 1024 {
        errors.push("Skill description must contain 1-1024 characters".to_string());
    }
    if request.instructions.trim().is_empty() {
        errors.push("Skill instructions cannot be empty".to_string());
    }
    if request.instructions.lines().count() > 500 {
        warnings.push(
            "SKILL.md exceeds 500 instruction lines; move detailed material into references/"
                .to_string(),
        );
    }
    if request.files.len() > MAX_GENERATED_FILES {
        errors.push(format!(
            "Skill package cannot contain more than {MAX_GENERATED_FILES} resource files"
        ));
    }

    for file in &request.files {
        let path = Path::new(&file.path);
        if !is_safe_generated_file_path(path) {
            errors.push(format!("Invalid Skill resource path: {}", file.path));
            continue;
        }
        let normalized = file.path.replace('\\', "/");
        if !seen_paths.insert(normalized.clone()) {
            errors.push(format!("Duplicate Skill resource path: {normalized}"));
        }
        if normalized.starts_with("scripts/") {
            let supported = matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("py" | "sh" | "bash" | "js" | "mjs")
            );
            if !supported {
                errors.push(format!(
                    "Unsupported Skill script type: {normalized}. Use Python, Bash, or JavaScript."
                ));
            }
        }
        let file_bytes = file.content.len();
        if file_bytes > MAX_GENERATED_FILE_BYTES {
            errors.push(format!(
                "Skill resource exceeds the 1 MB limit: {normalized}"
            ));
        }
        total_bytes = total_bytes.saturating_add(file_bytes);
    }
    for path in &request.remove_files {
        let resource_path = Path::new(path);
        if !is_safe_generated_file_path(resource_path) {
            errors.push(format!("Invalid removed Skill resource path: {path}"));
            continue;
        }
        let normalized = path.replace('\\', "/");
        if seen_paths.contains(&normalized) {
            errors.push(format!(
                "Skill resource cannot be written and removed in the same update: {normalized}"
            ));
        }
    }
    if !request.remove_files.is_empty() && !request.replace_existing {
        errors.push(
            "removeFiles can only be used while explicitly updating an existing Skill".to_string(),
        );
    }
    if total_bytes > MAX_GENERATED_PACKAGE_BYTES {
        errors.push("Generated Skill package exceeds the 10 MB limit".to_string());
    }

    let replacing = is_safe_skill_name(&request.name) && skills_dir.join(&request.name).exists();
    if replacing && !request.replace_existing {
        errors.push("A Skill with this name already exists; inspect it first and set replaceExisting only for an explicit update".to_string());
    }
    if replacing && request.replace_existing {
        warnings.push(
            "Installing this package will update the existing Skill through a staged atomic swap"
                .to_string(),
        );
    }
    let has_scripts = request
        .files
        .iter()
        .any(|file| file.path.replace('\\', "/").starts_with("scripts/"))
        || (replacing && skills_dir.join(&request.name).join("scripts").is_dir());
    if has_scripts {
        warnings.push("This Skill contains executable scripts. Script execution requires separate approval and is bound to the installed file hash.".to_string());
    }

    SkillPackageValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
        file_count: request.files.len() + 1,
        total_bytes,
        has_scripts,
        replacing,
    }
}

fn is_safe_generated_file_path(path: &Path) -> bool {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return false;
    }
    let components: Vec<_> = path.components().collect();
    if components.len() < 2 || components.len() > MAX_PATH_DEPTH {
        return false;
    }
    if components
        .iter()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return false;
    }
    let first = components.first().and_then(|component| match component {
        Component::Normal(value) => value.to_str(),
        _ => None,
    });
    if !matches!(first, Some("scripts" | "references" | "assets" | "agents")) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| !name.starts_with('.') && !name.contains('\0'))
        .unwrap_or(false)
}

fn render_skill_file(request: &SkillPackageRequest) -> Result<String, String> {
    let yaml = serde_yaml::to_string(&SkillFrontmatter {
        name: request.name.clone(),
        description: request.description.trim().to_string(),
    })
    .map_err(|error| format!("Failed to serialize Skill metadata: {error}"))?;
    Ok(format!(
        "---\n{yaml}---\n\n{}\n",
        request.instructions.trim()
    ))
}

fn validate_skill_directory(skill_root: &Path, expected_name: &str) -> Result<(), String> {
    let content = fs::read_to_string(skill_root.join("SKILL.md"))
        .map_err(|error| format!("Failed to read SKILL.md: {error}"))?;
    let metadata = parse_skill_frontmatter(&content)?;
    if metadata.name != expected_name {
        return Err(format!(
            "SKILL.md name \"{}\" must match its parent directory \"{expected_name}\"",
            metadata.name
        ));
    }
    if !is_safe_skill_name(&metadata.name) {
        return Err("SKILL.md name does not follow Agent Skills naming rules".to_string());
    }
    if metadata.description.trim().is_empty() || metadata.description.chars().count() > 1024 {
        return Err("SKILL.md description must contain 1-1024 characters".to_string());
    }
    Ok(())
}

fn parse_skill_frontmatter(content: &str) -> Result<SkillFrontmatter, String> {
    let normalized = content.trim_start_matches('\u{feff}');
    let body = normalized
        .strip_prefix("---\n")
        .or_else(|| normalized.strip_prefix("---\r\n"))
        .ok_or("SKILL.md must start with YAML frontmatter")?;
    let end = body
        .find("\n---")
        .ok_or("SKILL.md YAML frontmatter is not closed")?;
    serde_yaml::from_str(&body[..end])
        .map_err(|error| format!("Invalid SKILL.md YAML frontmatter: {error}"))
}

fn validate_directory_tree(
    root: &Path,
    depth: usize,
    entry_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    validate_directory_tree_with_limits(
        root,
        depth,
        entry_count,
        total_bytes,
        MAX_PATH_DEPTH,
        MAX_ARCHIVE_ENTRIES,
        MAX_ENTRY_BYTES,
        MAX_UNCOMPRESSED_BYTES,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_directory_tree_with_limits(
    root: &Path,
    depth: usize,
    entry_count: &mut usize,
    total_bytes: &mut u64,
    max_depth: usize,
    max_entries: usize,
    max_entry_bytes: u64,
    max_total_bytes: u64,
) -> Result<(), String> {
    if depth > max_depth {
        return Err("Skill folder nesting exceeds the allowed depth".to_string());
    }

    for entry in
        fs::read_dir(root).map_err(|error| format!("Failed to read Skill folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read Skill folder entry: {error}"))?;
        *entry_count += 1;
        if *entry_count > max_entries {
            return Err(format!(
                "Skill folder contains more than {max_entries} entries"
            ));
        }

        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("Failed to inspect Skill folder entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symbolic links are not allowed: {}",
                entry.path().display()
            ));
        }
        if metadata.is_file() {
            if metadata.len() > max_entry_bytes {
                return Err(format!(
                    "Skill file exceeds the size limit: {}",
                    entry.path().display()
                ));
            }
            *total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or("Skill folder size overflow")?;
            if *total_bytes > max_total_bytes {
                return Err(format!(
                    "Skill folder exceeds the {} MB limit",
                    max_total_bytes / 1024 / 1024
                ));
            }
        } else if metadata.is_dir() {
            validate_directory_tree_with_limits(
                &entry.path(),
                depth + 1,
                entry_count,
                total_bytes,
                max_depth,
                max_entries,
                max_entry_bytes,
                max_total_bytes,
            )?;
        }
    }
    Ok(())
}

fn is_symlink<R: std::io::Read>(entry: &zip::read::ZipFile<'_, R>) -> bool {
    entry
        .unix_mode()
        .map(|mode| mode & 0o170000 == 0o120000)
        .unwrap_or(false)
}

fn is_safe_skill_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes.first() != Some(&b'-')
        && bytes.last() != Some(&b'-')
        && !name.contains("--")
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn collect_skill_roots(root: &Path, depth: usize, roots: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > MAX_REMOTE_PATH_DEPTH {
        return Err("Skill archive directory nesting exceeds the allowed depth".to_string());
    }
    if root.join("SKILL.md").is_file() {
        roots.push(root.to_path_buf());
    }

    for entry in
        fs::read_dir(root).map_err(|error| format!("Failed to read archive directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read archive entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() && !is_ignored_zip_metadata_dir(&path) {
            collect_skill_roots(&path, depth + 1, roots)?;
        }
    }
    Ok(())
}

fn is_ignored_zip_metadata_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == "__MACOSX")
        .unwrap_or(false)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create directory: {error}"))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("Failed to read source directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect imported file: {error}"))?;
        if file_type.is_symlink() {
            return Err(format!(
                "Symbolic links are not allowed: {}",
                source_path.display()
            ));
        }
        if file_type.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Failed to copy file: {error}"))?;
        } else if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn test_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("notegen-{label}-{}", uuid::Uuid::new_v4()))
    }

    fn write_test_archive(path: &Path, entries: &[(&str, &str)]) {
        let file = fs::File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn validates_skill_directory_names() {
        assert!(is_safe_skill_name("secure-skill"));
        assert!(!is_safe_skill_name("Secure-Skill"));
        assert!(!is_safe_skill_name("../secure-skill"));
        assert!(!is_safe_skill_name("-secure"));
        assert!(!is_safe_skill_name("secure--skill"));
    }

    #[test]
    fn removes_only_the_requested_skill_directory() {
        let root = test_directory("skill-uninstall");
        let target = root.join("writing");
        let sibling = root.join("summarizing");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        fs::write(target.join("SKILL.md"), "# Writing").unwrap();
        fs::write(sibling.join("SKILL.md"), "# Summarizing").unwrap();

        remove_skill_directory(&root, "writing").unwrap();

        assert!(!target.exists());
        assert!(sibling.join("SKILL.md").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsafe_skill_uninstall_id() {
        let root = test_directory("unsafe-skill-uninstall");
        fs::create_dir_all(&root).unwrap();

        let error = remove_skill_directory(&root, "../outside").unwrap_err();

        assert!(error.contains("INVALID_SKILL_ID"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_skill_directory_during_uninstall() {
        use std::os::unix::fs::symlink;

        let root = test_directory("symlinked-skill-uninstall");
        let outside = test_directory("symlinked-skill-target");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("SKILL.md"), "# Outside").unwrap();
        symlink(&outside, root.join("writing")).unwrap();

        let error = remove_skill_directory(&root, "writing").unwrap_err();

        assert!(error.contains("UNSAFE_SKILL_PATH"));
        assert!(outside.join("SKILL.md").is_file());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    fn generated_request(name: &str, replace_existing: bool) -> SkillPackageRequest {
        SkillPackageRequest {
            name: name.to_string(),
            description: "Create concise weekly reports when the user asks for a weekly summary."
                .to_string(),
            instructions: "# Workflow\n\n1. Read this week's notes.\n2. Create the report."
                .to_string(),
            files: vec![SkillPackageFile {
                path: "references/format.md".to_string(),
                content: "# Format\n".to_string(),
            }],
            remove_files: Vec::new(),
            scope: SkillImportScope::Global,
            workspace_root: None,
            replace_existing,
        }
    }

    #[test]
    fn validates_generated_skill_packages() {
        let root = test_directory("generated-validation");
        let request = generated_request("create-weekly-report", false);
        let validation = validate_generated_package(&request, &root);
        assert!(validation.valid);
        assert_eq!(validation.file_count, 2);
        assert!(!validation.has_scripts);

        let mut invalid = generated_request("Unsafe Name", false);
        invalid.files[0].path = "../outside.md".to_string();
        let validation = validate_generated_package(&invalid, &root);
        assert!(!validation.valid);
        assert_eq!(validation.errors.len(), 2);
    }

    #[test]
    fn generated_skill_install_is_atomic_and_requires_explicit_replace() {
        let root = test_directory("generated-install");
        let skills_dir = root.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        let request = generated_request("create-weekly-report", false);
        let staged = skills_dir.join(".create-create-weekly-report-1");
        fs::create_dir_all(staged.join("references")).unwrap();
        fs::write(
            staged.join("SKILL.md"),
            render_skill_file(&request).unwrap(),
        )
        .unwrap();
        fs::write(staged.join("references/format.md"), "format").unwrap();
        let destination = skills_dir.join("create-weekly-report");
        let backup = skills_dir.join(".backup-create-weekly-report-1");
        activate_staged_skill(&staged, &destination, &backup, false).unwrap();
        assert!(destination.join("SKILL.md").is_file());

        let second_staged = skills_dir.join(".create-create-weekly-report-2");
        fs::create_dir_all(&second_staged).unwrap();
        fs::write(
            second_staged.join("SKILL.md"),
            render_skill_file(&request).unwrap(),
        )
        .unwrap();
        assert!(activate_staged_skill(&second_staged, &destination, &backup, false).is_err());
        assert!(destination.join("SKILL.md").is_file());

        let update_staged = skills_dir.join(".create-create-weekly-report-3");
        copy_dir_recursive(&destination, &update_staged).unwrap();
        fs::write(update_staged.join("SKILL.md"), "updated").unwrap();
        activate_staged_skill(&update_staged, &destination, &backup, true).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("SKILL.md")).unwrap(),
            "updated"
        );
        assert!(destination.join("references/format.md").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_multiple_skill_roots() {
        let root = test_directory("multiple-roots");
        fs::create_dir_all(root.join("one")).unwrap();
        fs::create_dir_all(root.join("two")).unwrap();
        fs::write(root.join("one/SKILL.md"), "---\nname: one\n---").unwrap();
        fs::write(root.join("two/SKILL.md"), "---\nname: two\n---").unwrap();
        let mut roots = Vec::new();
        collect_skill_roots(&root, 0, &mut roots).unwrap();
        assert_eq!(roots.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_zip_symbolic_links() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink("unsafe-link", "/tmp/private", SimpleFileOptions::default())
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let entry = archive.by_index(0).unwrap();
        assert!(is_symlink(&entry));
    }

    #[test]
    fn imports_through_staging_and_replaces_existing_skill() {
        let root = test_directory("atomic-import");
        let archive_path = root.join("secure-skill.zip");
        let extract_dir = root.join("extract");
        let skills_dir = root.join("skills");
        fs::create_dir_all(&extract_dir).unwrap();
        fs::create_dir_all(skills_dir.join("secure-skill")).unwrap();
        fs::write(skills_dir.join("secure-skill/old.txt"), "old").unwrap();
        write_test_archive(
            &archive_path,
            &[
                (
                    "secure-skill/SKILL.md",
                    "---\nname: secure-skill\ndescription: test\n---\n",
                ),
                ("secure-skill/scripts/ok.py", "print('ok')\n"),
            ],
        );

        let imported =
            import_skill_zip_inner(archive_path.to_str().unwrap(), &extract_dir, &skills_dir, 1)
                .unwrap();
        assert_eq!(imported, "secure-skill");
        assert!(skills_dir.join("secure-skill/scripts/ok.py").is_file());
        assert!(!skills_dir.join("secure-skill/old.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imports_skill_from_directory() {
        let root = test_directory("directory-import");
        let source = root.join("folder-skill");
        let skills_dir = root.join("skills");
        fs::create_dir_all(source.join("references")).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: folder-skill\ndescription: test\n---\n",
        )
        .unwrap();
        fs::write(source.join("references/guide.md"), "guide").unwrap();

        let imported =
            import_skill_directory_inner(source.to_str().unwrap(), &skills_dir, 1).unwrap();

        assert_eq!(imported, "folder-skill");
        assert!(skills_dir.join("folder-skill/SKILL.md").is_file());
        assert!(skills_dir
            .join("folder-skill/references/guide.md")
            .is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inspects_one_requested_skill_inside_repository_archive() {
        let root = test_directory("remote-preview");
        let archive_path = root.join("repository.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        write_test_archive(
            &archive_path,
            &[
                (
                    "repo-sha/skills/weekly-report/SKILL.md",
                    "---\nname: weekly-report\ndescription: Create weekly reports\n---\n",
                ),
                (
                    "repo-sha/skills/weekly-report/references/format.md",
                    "# Format\n",
                ),
                (
                    "repo-sha/skills/other/SKILL.md",
                    "---\nname: other\ndescription: Another Skill\n---\n",
                ),
            ],
        );

        let inspection =
            inspect_remote_skill_archive(&archive_path, &extract_dir, Some("skills/weekly-report"))
                .unwrap();

        assert_eq!(inspection.name, "weekly-report");
        assert_eq!(inspection.description, "Create weekly reports");
        assert_eq!(inspection.files, vec!["SKILL.md", "references/format.md"]);
        assert!(!inspection.has_scripts);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ignores_unrelated_repository_symlinks_for_requested_skill() {
        let root = test_directory("remote-filtered-symlink-preview");
        let archive_path = root.join("repository.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        let file = fs::File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("repo-sha/skills/writing/SKILL.md", options)
            .unwrap();
        writer
            .write_all(b"---\nname: writing\ndescription: Writing Skill\n---\n")
            .unwrap();
        writer
            .add_symlink(
                "repo-sha/AGENTS.md",
                "instructions/AGENTS.md",
                SimpleFileOptions::default(),
            )
            .unwrap();
        writer.finish().unwrap();

        let inspection =
            inspect_remote_skill_archive(&archive_path, &extract_dir, Some("skills/writing"))
                .unwrap();

        assert_eq!(inspection.name, "writing");
        assert_eq!(inspection.files, vec!["SKILL.md"]);
        assert!(inspection.skipped_symlinks.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_and_skips_symlinks_inside_remote_skill() {
        let root = test_directory("remote-selected-symlink-preview");
        let archive_path = root.join("repository.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        let file = fs::File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("repo-sha/skills/writing/SKILL.md", options)
            .unwrap();
        writer
            .write_all(b"---\nname: writing\ndescription: Writing Skill\n---\n")
            .unwrap();
        writer
            .add_symlink(
                "repo-sha/skills/writing/references/shared.md",
                "../../../shared.md",
                SimpleFileOptions::default(),
            )
            .unwrap();
        writer.finish().unwrap();

        let inspection =
            inspect_remote_skill_archive(&archive_path, &extract_dir, Some("skills/writing"))
                .unwrap();

        assert_eq!(inspection.name, "writing");
        assert_eq!(inspection.files, vec!["SKILL.md"]);
        assert_eq!(inspection.skipped_symlinks, vec!["references/shared.md"]);
        assert!(inspection
            .warnings
            .iter()
            .any(|warning| warning.code == "symbolic-links"));
        assert!(!extract_dir
            .join("repo-sha/skills/writing/references/shared.md")
            .exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_remote_archives_above_recommended_entry_count() {
        let root = test_directory("remote-many-files-preview");
        let archive_path = root.join("repository.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        let file = fs::File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer
            .start_file("repo-sha/skills/writing/SKILL.md", options)
            .unwrap();
        writer
            .write_all(b"---\nname: writing\ndescription: Writing Skill\n---\n")
            .unwrap();
        for index in 0..MAX_ARCHIVE_ENTRIES {
            writer
                .start_file(
                    format!("repo-sha/skills/writing/references/{index}.md"),
                    options,
                )
                .unwrap();
        }
        writer.finish().unwrap();

        let inspection =
            inspect_remote_skill_archive(&archive_path, &extract_dir, Some("skills/writing"))
                .unwrap();

        let warning = inspection
            .warnings
            .iter()
            .find(|warning| warning.code == "many-files")
            .unwrap();
        assert_eq!(warning.actual, (MAX_ARCHIVE_ENTRIES + 1) as u64);
        assert_eq!(warning.recommended, MAX_ARCHIVE_ENTRIES as u64);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inspects_direct_zip_with_skill_at_archive_root() {
        let root = test_directory("remote-root-preview");
        let archive_path = root.join("download.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        write_test_archive(
            &archive_path,
            &[
                (
                    "SKILL.md",
                    "---\nname: direct-skill\ndescription: Direct ZIP Skill\n---\n",
                ),
                ("references/guide.md", "# Guide\n"),
            ],
        );

        let inspection = inspect_remote_skill_archive(&archive_path, &extract_dir, None).unwrap();

        assert_eq!(inspection.name, "direct-skill");
        assert_eq!(inspection.description, "Direct ZIP Skill");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inspects_repository_root_skill_with_commit_archive_directory() {
        let root = test_directory("remote-repository-root-preview");
        let archive_path = root.join("repository.zip");
        let extract_dir = root.join("extract");
        fs::create_dir_all(&root).unwrap();
        write_test_archive(
            &archive_path,
            &[
                (
                    "web-access-7af34af/SKILL.md",
                    "---\nname: web-access\ndescription: Web access Skill\n---\n",
                ),
                ("web-access-7af34af/references/guide.md", "# Guide\n"),
            ],
        );

        let inspection = inspect_remote_skill_archive(&archive_path, &extract_dir, None).unwrap();

        assert_eq!(inspection.name, "web-access");
        assert_eq!(inspection.description, "Web access Skill");
        assert_eq!(inspection.files, vec!["SKILL.md", "references/guide.md"]);
        fs::remove_dir_all(root).unwrap();
    }
}
