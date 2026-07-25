use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command as TokioCommand};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use uuid::Uuid;

use crate::maintenance_lock::MaintenanceGuard;
use crate::process_util::{configure_process_group, terminate_process_tree};
use crate::zip_extract::{
    extract_zip_safely, ZipDirectoryCheck, ZipExtractContext, ZipExtractLimits, ZipPathDedup,
};

const SIYUAN_TEMP_PREFIX: &str = "siyuan-import-";
const MAX_ZIP_ENTRIES: usize = 100_000;
const MAX_ZIP_ENTRY_UNCOMPRESSED_SIZE: u64 = 1024 * 1024 * 1024;
const MAX_SIYUAN_ZIP_TOTAL_UNCOMPRESSED_SIZE: u64 = 3 * 1024 * 1024 * 1024;
const SIYUAN_IMPORT_PROGRESS_EVENT: &str = "siyuan-import-progress";
const MAX_WORKER_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES: usize = 64 * 1024;
const MAX_WORKER_ERROR_MESSAGE_BYTES: usize = 8 * 1024;
const MAX_PROGRESS_PAYLOAD_BYTES: usize = 16 * 1024;
const WORKER_CANCEL_GRACE: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct SiyuanImportManager {
    active: Mutex<Option<ActiveSiyuanImport>>,
}

struct ActiveSiyuanImport {
    cancelled: Arc<AtomicBool>,
    worker_pid: Option<u32>,
    temp_dir: PathBuf,
    worker_stdin: Arc<Mutex<Option<ChildStdin>>>,
}

#[derive(Debug, Deserialize)]
struct WorkerEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    payload: Option<Value>,
    message: Option<String>,
}

struct BundledWorker {
    node_executable: PathBuf,
    worker_script: PathBuf,
    assets_dir: PathBuf,
}

struct ReleaseMaintenanceOnDrop {
    _guard: MaintenanceGuard,
}

impl ReleaseMaintenanceOnDrop {
    fn new() -> Result<Self, String> {
        Ok(Self {
            _guard: MaintenanceGuard::acquire_siyuan_import()?,
        })
    }
}

fn is_siyuan_archive_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_lowercase().ends_with(".sy.zip"))
}

fn is_siyuan_temp_directory_name(name: &str) -> bool {
    let Some(uuid_part) = name.strip_prefix(SIYUAN_TEMP_PREFIX) else {
        return false;
    };
    if uuid_part.len() != 36 {
        return false;
    }

    Uuid::parse_str(uuid_part)
        .map(|uuid| uuid.hyphenated().to_string() == uuid_part.to_lowercase())
        .unwrap_or(false)
}

fn siyuan_zip_extract_limits() -> ZipExtractLimits {
    ZipExtractLimits {
        max_entries: Some(MAX_ZIP_ENTRIES),
        max_entry_bytes: Some(MAX_ZIP_ENTRY_UNCOMPRESSED_SIZE),
        max_total_bytes: Some(MAX_SIYUAN_ZIP_TOTAL_UNCOMPRESSED_SIZE),
    }
}

fn extract_siyuan_zip(
    zip_path: &Path,
    dest_dir: &Path,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    extract_zip_safely(
        zip_path,
        ZipExtractContext {
            dest_dir,
            path_dedup: ZipPathDedup::NormalizedSlashes,
            directory_check: ZipDirectoryCheck::ZipMetadata,
            limits: siyuan_zip_extract_limits(),
            cancel: Some(cancelled),
        },
    )
}

fn validate_siyuan_temp_directory(cache_dir: &Path, target: &Path) -> Result<(), String> {
    if !target.is_absolute() || target.parent() != Some(cache_dir) {
        return Err("Refusing to remove a directory outside the cache directory".to_string());
    }

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid temporary directory name".to_string())?;
    if !is_siyuan_temp_directory_name(file_name) {
        return Err("Refusing to remove a non-SiYuan temporary directory".to_string());
    }

    Ok(())
}

fn cleanup_siyuan_temp_directories_in(
    cache_dir: &Path,
    skip: &HashSet<PathBuf>,
) -> Result<(), String> {
    if !cache_dir.exists() {
        return Ok(());
    }

    for entry in
        fs::read_dir(cache_dir).map_err(|e| format!("Failed to read cache directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read cache entry: {}", e))?;
        let path = entry.path();
        if skip.contains(&path) {
            continue;
        }
        if validate_siyuan_temp_directory(cache_dir, &path).is_err() {
            continue;
        }

        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to inspect SiYuan temp directory: {}", e))?;
        if metadata.file_type().is_symlink() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove SiYuan temp symlink: {}", e))?;
        } else if metadata.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to remove stale SiYuan temp directory: {}", e))?;
        }
    }

    Ok(())
}

pub async fn cleanup_stale_siyuan_temp_directories(
    app_handle: &AppHandle,
    manager: &SiyuanImportManager,
) -> Result<(), String> {
    let skip = {
        let active = manager.active.lock().await;
        active
            .as_ref()
            .map(|import| HashSet::from([import.temp_dir.clone()]))
            .unwrap_or_default()
    };
    let cache_dir = app_handle
        .path()
        .cache_dir()
        .map_err(|e| format!("Failed to get cache_dir: {}", e))?;
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_siyuan_temp_directories_in(&cache_dir, &skip)
    })
    .await
    .map_err(|error| format!("SiYuan temp cleanup task failed: {error}"))??;
    Ok(())
}

pub fn spawn_stale_siyuan_temp_cleanup(app_handle: &AppHandle) {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let manager = handle.state::<SiyuanImportManager>();
        let _ = cleanup_stale_siyuan_temp_directories(&handle, &manager).await;
    });
}

fn resolve_siyuan_archive_root(extracted_dir: &Path) -> Result<PathBuf, String> {
    let mut root_dirs = Vec::new();

    for entry in fs::read_dir(extracted_dir)
        .map_err(|error| format!("Failed to read extracted archive directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to read extracted archive entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect extracted archive entry: {error}"))?;
        if file_type.is_symlink() {
            return Err(
                "Invalid SiYuan .sy.zip archive: root entry must be a directory.".to_string(),
            );
        }
        if file_type.is_dir() {
            root_dirs.push(entry.path());
        } else {
            return Err("Invalid SiYuan .sy.zip archive: expected one root directory.".to_string());
        }
    }

    if root_dirs.len() != 1 {
        return Err("Invalid SiYuan .sy.zip archive: expected one root directory.".to_string());
    }

    Ok(root_dirs.remove(0))
}

struct WorkerLaunch {
    program: PathBuf,
    args: Vec<String>,
    working_dir: Option<PathBuf>,
}

fn bundled_worker_assets_dir(resource_dir: &Path) -> PathBuf {
    let nested = resource_dir.join("resources");
    if nested.join("siyuan-import-worker.bundle.mjs").is_file() {
        nested
    } else {
        resource_dir.to_path_buf()
    }
}

fn bundled_node_executable(assets_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        assets_dir.join("node-runtime/node.exe")
    } else {
        assets_dir.join("node-runtime/node")
    }
}

fn resolve_bundled_worker<R: Runtime>(app_handle: &AppHandle<R>) -> Result<BundledWorker, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resource directory: {error}"))?;
    let assets_dir = bundled_worker_assets_dir(&resource_dir);
    let worker_script = assets_dir.join("siyuan-import-worker.bundle.mjs");
    if !worker_script.is_file() {
        return Err(
            "SiYuan import worker bundle is missing from the app resources. Rebuild the desktop app."
                .to_string(),
        );
    }

    let node_executable = bundled_node_executable(&assets_dir);
    if !node_executable.is_file() {
        return Err(
            "Bundled Node runtime is missing from the app resources. Rebuild the desktop app."
                .to_string(),
        );
    }

    Ok(BundledWorker {
        node_executable,
        worker_script,
        assets_dir,
    })
}

fn resolve_dev_worker_launch() -> Option<WorkerLaunch> {
    if !cfg!(debug_assertions) {
        return None;
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.join("..");
    let launch_script = project_root.join("scripts/siyuan-import-worker-launch.mjs");
    if !launch_script.is_file() {
        return None;
    }

    Some(WorkerLaunch {
        program: PathBuf::from("node"),
        args: vec![launch_script.to_string_lossy().into_owned()],
        working_dir: Some(project_root),
    })
}

fn resolve_worker_launch<R: Runtime>(
    app_handle: &AppHandle<R>,
    data_root: &Path,
    target_dir: &Path,
    assets_dir_name: &str,
) -> Result<WorkerLaunch, String> {
    let mut launch = if let Some(dev_launch) = resolve_dev_worker_launch() {
        dev_launch
    } else {
        let bundled = resolve_bundled_worker(app_handle)?;
        WorkerLaunch {
            program: bundled.node_executable,
            args: vec![bundled.worker_script.to_string_lossy().into_owned()],
            working_dir: Some(bundled.assets_dir),
        }
    };

    launch.args.push("--data-root".to_string());
    launch.args.push(data_root.to_string_lossy().into_owned());
    launch.args.push("--target-dir".to_string());
    launch.args.push(target_dir.to_string_lossy().into_owned());
    launch.args.push("--assets-dir-name".to_string());
    launch.args.push(assets_dir_name.to_string());

    Ok(launch)
}

async fn write_worker_cancel_command(worker_stdin: &Arc<Mutex<Option<ChildStdin>>>) {
    if let Some(stdin) = worker_stdin.lock().await.as_mut() {
        let _ = stdin.write_all(b"cancel\n").await;
        let _ = stdin.flush().await;
    }
}

async fn notify_worker_cancel(active: &ActiveSiyuanImport) {
    active.cancelled.store(true, Ordering::SeqCst);
    write_worker_cancel_command(&active.worker_stdin).await;
}

async fn await_worker_cancel_ack<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line_buffer: &mut Vec<u8>,
    grace: Duration,
) -> bool {
    let sleep_future = sleep(grace);
    tokio::pin!(sleep_future);

    loop {
        tokio::select! {
            _ = &mut sleep_future => return false,
            read_result = read_worker_line(reader, line_buffer, MAX_WORKER_LINE_BYTES) => {
                match read_result {
                    Ok(Some(line)) => {
                        if let Ok(envelope) = parse_worker_envelope(&line) {
                            if envelope.message_type == "cancelled" {
                                return envelope
                                    .payload
                                    .as_ref()
                                    .and_then(|payload| payload.get("rolledBack"))
                                    .and_then(Value::as_bool)
                                    .unwrap_or(true);
                            }
                        }
                    }
                    Ok(None) => return false,
                    Err(_) => return false,
                }
            }
        }
    }
}

async fn drain_worker_stderr(mut stderr: tokio::process::ChildStderr) {
    let mut buffer = [0_u8; 4096];
    let mut total = 0_usize;
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) => break,
            Ok(count) => {
                total = total.saturating_add(count);
                if total >= MAX_WORKER_STDERR_BYTES {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn truncate_worker_text(message: &str, max_bytes: usize) -> String {
    if message.len() <= max_bytes {
        return message.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &message[..end])
}

fn validate_progress_payload(payload: &Value) -> Result<(), String> {
    let serialized = serde_json::to_string(payload)
        .map_err(|error| format!("Invalid SiYuan import progress payload: {error}"))?;
    if serialized.len() > MAX_PROGRESS_PAYLOAD_BYTES {
        return Err("SiYuan import progress payload exceeds size limit".to_string());
    }
    Ok(())
}

fn parse_worker_envelope(line: &str) -> Result<WorkerEnvelope, String> {
    if line.len() > MAX_WORKER_LINE_BYTES {
        return Err("SiYuan import worker line exceeds size limit".to_string());
    }
    serde_json::from_str(line)
        .map_err(|error| format!("Invalid SiYuan import worker output: {error}"))
}

async fn wait_for_import_cancel(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::SeqCst) {
        sleep(Duration::from_millis(50)).await;
    }
}

async fn read_worker_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    buffer: &mut Vec<u8>,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    buffer.clear();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|error| format!("Failed to read SiYuan import worker output: {error}"))?;
        if available.is_empty() {
            if buffer.is_empty() {
                return Ok(None);
            }
            return String::from_utf8(buffer.clone())
                .map(Some)
                .map_err(|error| format!("Invalid SiYuan import worker UTF-8: {error}"));
        }

        let mut consumed = 0usize;
        for &byte in available {
            if byte == b'\n' {
                reader.consume(consumed + 1);
                while buffer.last() == Some(&b'\r') {
                    buffer.pop();
                }
                return String::from_utf8(buffer.clone())
                    .map(Some)
                    .map_err(|error| format!("Invalid SiYuan import worker UTF-8: {error}"));
            }
            if buffer.len() >= max_bytes {
                return Err("SiYuan import worker line exceeds size limit".to_string());
            }
            buffer.push(byte);
            consumed += 1;
        }
        reader.consume(consumed);
    }
}

async fn wait_for_worker_exit(child: &mut Child, grace: Duration) -> bool {
    timeout(grace, child.wait())
        .await
        .ok()
        .and_then(|result| result.ok())
        .is_some()
}

async fn shutdown_worker_process(pid: u32, child: &mut Child) {
    let _ = terminate_process_tree(pid, false).await;
    if wait_for_worker_exit(child, WORKER_CANCEL_GRACE).await {
        return;
    }
    let _ = terminate_process_tree(pid, true).await;
    let _ = child.kill().await;
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

async fn finalize_worker_process(
    pid: u32,
    child: &mut Child,
    force_shutdown: bool,
) -> Result<(), String> {
    if force_shutdown {
        shutdown_worker_process(pid, child).await;
        return Ok(());
    }

    match child.wait().await {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "SiYuan import worker exited with status {}",
            status.code().unwrap_or(-1)
        )),
        Err(error) => {
            shutdown_worker_process(pid, child).await;
            Err(format!("Failed to wait for SiYuan import worker: {error}"))
        }
    }
}

fn emit_import_progress<R: Runtime>(app: &AppHandle<R>, payload: Value) -> Result<(), String> {
    app.emit(SIYUAN_IMPORT_PROGRESS_EVENT, payload)
        .map_err(|error| format!("Failed to emit SiYuan import progress: {error}"))
}

fn validate_assets_dir_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok("assets".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.starts_with('.')
    {
        return Err("Invalid assets directory name".to_string());
    }
    Ok(trimmed.to_string())
}

async fn run_conversion_worker<R: Runtime>(
    app_handle: AppHandle<R>,
    manager: &SiyuanImportManager,
    data_root: PathBuf,
    target_dir: PathBuf,
    assets_dir_name: String,
    cancelled: Arc<AtomicBool>,
) -> Result<Value, String> {
    let launch = resolve_worker_launch(
        &app_handle,
        &data_root,
        &target_dir,
        &assets_dir_name,
    )?;

    let mut command = TokioCommand::new(launch.program);
    command
        .args(launch.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(working_dir) = launch.working_dir {
        command.current_dir(working_dir);
    }
    configure_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start SiYuan import worker: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to determine SiYuan import worker pid".to_string())?;

    {
        let mut active = manager.active.lock().await;
        if let Some(active_import) = active.as_mut() {
            active_import.worker_pid = Some(pid);
            if let Some(stdin) = child.stdin.take() {
                *active_import.worker_stdin.lock().await = Some(stdin);
            }
        }
    }

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture SiYuan import worker stderr".to_string())?;
    tokio::spawn(drain_worker_stderr(stderr));

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture SiYuan import worker stdout".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line_buffer = Vec::new();
    let mut result: Option<Value> = None;
    let mut worker_error: Option<String> = None;
    let mut cancelled_during_run = false;
    let mut loop_error: Option<String> = None;
    let mut stdout_finished = false;

    while !stdout_finished && loop_error.is_none() {
        tokio::select! {
            _ = wait_for_import_cancel(&cancelled) => {
                cancelled_during_run = true;
                break;
            }
            read_result = read_worker_line(&mut reader, &mut line_buffer, MAX_WORKER_LINE_BYTES) => {
                match read_result {
                    Ok(None) => stdout_finished = true,
                    Ok(Some(line)) => {
                        let envelope = match parse_worker_envelope(&line) {
                            Ok(parsed) => parsed,
                            Err(error) => {
                                loop_error = Some(error);
                                break;
                            }
                        };

                        match envelope.message_type.as_str() {
                            "progress" => {
                                if let Some(payload) = envelope.payload.as_ref() {
                                    if let Err(error) = validate_progress_payload(payload) {
                                        loop_error = Some(error);
                                        break;
                                    }
                                    if let Err(error) = emit_import_progress(&app_handle, payload.clone()) {
                                        loop_error = Some(error);
                                        break;
                                    }
                                }
                            }
                            "result" => {
                                result = envelope.payload;
                            }
                            "error" => {
                                worker_error = envelope.message.map(|message| {
                                    truncate_worker_text(&message, MAX_WORKER_ERROR_MESSAGE_BYTES)
                                });
                            }
                            "cancelled" => {
                                let _ = finalize_worker_process(pid, &mut child, false).await;
                                return Err("Import cancelled".to_string());
                            }
                            _ => {}
                        }
                    }
                    Err(error) => {
                        loop_error = Some(error);
                        break;
                    }
                }
            }
        }
    }

    let force_shutdown = cancelled.load(Ordering::SeqCst)
        || cancelled_during_run
        || loop_error.is_some()
        || worker_error.is_some();

    if cancelled.load(Ordering::SeqCst) || cancelled_during_run {
        let cancel_handles = {
            let guard = manager.active.lock().await;
            guard.as_ref().map(|active| {
                (
                    Arc::clone(&active.cancelled),
                    Arc::clone(&active.worker_stdin),
                )
            })
        };
        if let Some((cancel_flag, worker_stdin)) = cancel_handles {
            cancel_flag.store(true, Ordering::SeqCst);
            write_worker_cancel_command(&worker_stdin).await;
        }
        let _ = await_worker_cancel_ack(&mut reader, &mut line_buffer, WORKER_CANCEL_GRACE).await;
        let _ = finalize_worker_process(pid, &mut child, true).await;
        return Err("Import cancelled".to_string());
    }

    if let Some(error) = loop_error {
        let _ = finalize_worker_process(pid, &mut child, true).await;
        return Err(error);
    }

    if let Some(message) = worker_error {
        let _ = finalize_worker_process(pid, &mut child, true).await;
        return Err(message);
    }

    finalize_worker_process(pid, &mut child, force_shutdown).await?;

    result.ok_or_else(|| "SiYuan import worker did not return a result payload".to_string())
}

fn create_siyuan_temp_dir(cache_dir: &Path) -> Result<PathBuf, String> {
    let temp_dir = cache_dir.join(format!("{}{}", SIYUAN_TEMP_PREFIX, Uuid::new_v4()));
    fs::create_dir(&temp_dir)
        .map_err(|error| format!("Failed to create temp directory: {error}"))?;
    Ok(temp_dir)
}

fn read_workspace_path_from_store(app_data_dir: &Path) -> Option<PathBuf> {
    let store_path = app_data_dir.join("store.json");
    let content = fs::read_to_string(&store_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get("workspacePath")
        .and_then(|entry| entry.as_str())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn canonical_import_root(path: &Path, label: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(path).map_err(|error| format!("Failed to create {label}: {error}"))?;
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} is not a directory"));
    }
    Ok(canonical)
}

fn resolve_allowed_import_roots(app_handle: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app_data_dir: {error}"))?;
    let mut roots = vec![canonical_import_root(
        &app_data_dir.join("article"),
        "article workspace",
    )?];
    if let Some(workspace_path) = read_workspace_path_from_store(&app_data_dir) {
        if workspace_path.is_absolute() {
            roots.push(canonical_import_root(
                &workspace_path,
                "custom workspace",
            )?);
        }
    }
    Ok(roots)
}

fn path_within_allowed_root(path: &Path, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots
        .iter()
        .any(|root| path.starts_with(root))
}

fn validate_import_target_dir(app_handle: &AppHandle, target_dir: &str) -> Result<PathBuf, String> {
    let trimmed = target_dir.trim();
    if trimmed.is_empty() {
        return Err("Import target directory is required".to_string());
    }
    let requested = PathBuf::from(trimmed);
    if !requested.is_absolute() {
        return Err("Import target directory must be an absolute path".to_string());
    }
    let allowed_roots = resolve_allowed_import_roots(app_handle)?;
    let canonical = canonical_import_root(&requested, "import target directory")?;
    if !path_within_allowed_root(&canonical, &allowed_roots) {
        return Err("Import target directory is outside the allowed workspace roots".to_string());
    }
    Ok(canonical)
}

#[command]
pub async fn import_siyuan_archive(
    app_handle: AppHandle,
    manager: State<'_, SiyuanImportManager>,
    zip_path: String,
    target_dir: String,
    assets_dir_name: Option<String>,
) -> Result<Value, String> {
    let _maintenance = ReleaseMaintenanceOnDrop::new()?;

    let zip_path = PathBuf::from(zip_path);
    if !is_siyuan_archive_path(&zip_path) {
        return Err("Only SiYuan .sy.zip exports are supported".to_string());
    }

    let target_dir = validate_import_target_dir(&app_handle, &target_dir)?;
    let assets_dir_name = validate_assets_dir_name(assets_dir_name.as_deref().unwrap_or("assets"))?;
    let cache_dir = app_handle
        .path()
        .cache_dir()
        .map_err(|error| format!("Failed to get cache_dir: {error}"))?;
    let temp_dir = create_siyuan_temp_dir(&cache_dir)?;

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = manager.active.lock().await;
        *active = Some(ActiveSiyuanImport {
            cancelled: Arc::clone(&cancelled),
            worker_pid: None,
            temp_dir: temp_dir.clone(),
            worker_stdin: Arc::new(Mutex::new(None)),
        });
    }

    emit_import_progress(
        &app_handle,
        serde_json::json!({
            "phase": "extracting",
            "current": 0,
            "total": 1,
        }),
    )?;

    let zip_path_for_task = zip_path.clone();
    let extraction_dir = temp_dir.clone();
    let cancelled_for_extract = Arc::clone(&cancelled);
    let extraction_result = tauri::async_runtime::spawn_blocking(move || {
        extract_siyuan_zip(
            &zip_path_for_task,
            &extraction_dir,
            cancelled_for_extract.as_ref(),
        )
    })
    .await;

    match extraction_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let _ = fs::remove_dir_all(&temp_dir);
            {
                let mut active = manager.active.lock().await;
                *active = None;
            }
            return Err(error);
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&temp_dir);
            {
                let mut active = manager.active.lock().await;
                *active = None;
            }
            return Err(format!("ZIP extraction task failed: {error}"));
        }
    }

    emit_import_progress(
        &app_handle,
        serde_json::json!({
            "phase": "extracting",
            "current": 1,
            "total": 1,
        }),
    )?;

    let data_root = match resolve_siyuan_archive_root(&temp_dir) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_dir_all(&temp_dir);
            {
                let mut active = manager.active.lock().await;
                *active = None;
            }
            return Err(error);
        }
    };

    let conversion_result = run_conversion_worker(
        app_handle.clone(),
        &manager,
        data_root,
        target_dir,
        assets_dir_name,
        cancelled,
    )
    .await;

    if temp_dir.exists() {
        let cleanup_dir = temp_dir.clone();
        let _ =
            tauri::async_runtime::spawn_blocking(move || fs::remove_dir_all(&cleanup_dir)).await;
    }

    {
        let mut active = manager.active.lock().await;
        *active = None;
    }

    conversion_result
}

pub async fn shutdown_active_import(manager: &SiyuanImportManager) {
    let active = manager.active.lock().await.take();
    if let Some(active) = active {
        notify_worker_cancel(&active).await;
        if let Some(pid) = active.worker_pid {
            let _ = terminate_process_tree(pid, false).await;
            sleep(Duration::from_millis(500)).await;
            if active.cancelled.load(Ordering::SeqCst) {
                let _ = terminate_process_tree(pid, true).await;
            }
        }
    }
}

#[command]
pub async fn cancel_siyuan_import(manager: State<'_, SiyuanImportManager>) -> Result<bool, String> {
    let cancel_handles = {
        let guard = manager.active.lock().await;
        guard.as_ref().map(|active| {
            (
                Arc::clone(&active.cancelled),
                Arc::clone(&active.worker_stdin),
            )
        })
    };

    let Some((cancel_flag, worker_stdin)) = cancel_handles else {
        return Ok(false);
    };

    cancel_flag.store(true, Ordering::SeqCst);
    write_worker_cancel_command(&worker_stdin).await;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    #[test]
    fn only_siyuan_archive_names_are_accepted() {
        assert!(is_siyuan_archive_path(Path::new("notes.sy.zip")));
        assert!(!is_siyuan_archive_path(Path::new("notes.zip")));
    }

    #[test]
    fn siyuan_zip_extract_limits_match_import_policy() {
        let limits = siyuan_zip_extract_limits();
        assert_eq!(limits.max_entries, Some(MAX_ZIP_ENTRIES));
        assert_eq!(
            limits.max_entry_bytes,
            Some(MAX_ZIP_ENTRY_UNCOMPRESSED_SIZE)
        );
        assert_eq!(
            limits.max_total_bytes,
            Some(MAX_SIYUAN_ZIP_TOTAL_UNCOMPRESSED_SIZE)
        );
    }

    #[test]
    fn stale_siyuan_temp_directories_are_removed_without_touching_other_data() {
        let test_root =
            std::env::temp_dir().join(format!("note-gen-cleanup-test-{}", Uuid::new_v4()));
        let stale_dir = test_root.join(format!("{}{}", SIYUAN_TEMP_PREFIX, Uuid::new_v4()));
        let preserved_dir = test_root.join("preserved");
        fs::create_dir_all(&stale_dir).expect("create stale directory");
        fs::create_dir_all(&preserved_dir).expect("create preserved directory");

        cleanup_siyuan_temp_directories_in(&test_root, &HashSet::new())
            .expect("cleanup should succeed");

        assert!(!stale_dir.exists());
        assert!(preserved_dir.exists());
        fs::remove_dir_all(&test_root).expect("remove test root");
    }

    #[test]
    fn path_within_allowed_root_honors_directory_boundaries() {
        let root = PathBuf::from("/tmp/article");
        assert!(path_within_allowed_root(
            Path::new("/tmp/article/notes"),
            std::slice::from_ref(&root),
        ));
        assert!(!path_within_allowed_root(
            Path::new("/tmp/article-evil"),
            std::slice::from_ref(&root),
        ));
    }
}
