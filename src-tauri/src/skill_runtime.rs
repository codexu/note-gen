use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_ARGUMENTS: usize = 20;
const MAX_ARGUMENT_BYTES: usize = 4096;
const MAX_CAPTURE_BYTES: usize = 50 * 1024;
const MAX_CAPTURE_LINES: usize = 2000;
const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const MAX_CODE_BYTES: usize = 200 * 1024;

#[derive(Default)]
pub struct SkillProcessManager {
    processes: Mutex<HashMap<String, RunningProcess>>,
    pending: Mutex<HashMap<String, Arc<AtomicBool>>>,
    runtime_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

#[derive(Clone)]
struct RunningProcess {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSkillScriptRequest {
    execution_id: String,
    skill_id: String,
    skill_root: String,
    runtime_dir: String,
    output_dir: String,
    script_id: String,
    script_hash: String,
    script_type: String,
    #[serde(default)]
    args: Vec<String>,
    timeout_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSkillCodeRequest {
    execution_id: String,
    skill_id: String,
    skill_root: String,
    runtime_dir: String,
    output_dir: String,
    language: String,
    code: String,
    code_hash: String,
    #[serde(default)]
    args: Vec<String>,
    timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSkillScriptResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    output_truncated: bool,
    timed_out: bool,
    cancelled: bool,
    execution_time_ms: u128,
    stdout_log: String,
    stderr_log: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPythonRequest {
    skill_id: String,
    skill_root: String,
    runtime_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillPythonDependenciesRequest {
    skill_id: String,
    skill_root: String,
    runtime_dir: String,
    packages: Vec<String>,
    #[serde(default)]
    execution_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillNodeDependenciesRequest {
    skill_id: String,
    skill_root: String,
    runtime_dir: String,
    packages: Vec<String>,
    #[serde(default)]
    execution_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPythonStatus {
    available: bool,
    managed: bool,
    interpreter: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillPythonDependenciesResult {
    interpreter: String,
    version: String,
    packages: Vec<String>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillNodeDependenciesResult {
    interpreter: String,
    version: String,
    packages: Vec<String>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCommandStatus {
    name: String,
    available: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEnvironmentStatus {
    python: SkillPythonStatus,
    node: SkillCommandStatus,
    npm: SkillCommandStatus,
    commands: Vec<SkillCommandStatus>,
}

struct CaptureResult {
    tail: String,
    truncated: bool,
}

#[tauri::command]
pub async fn run_skill_script(
    app_handle: AppHandle,
    manager: State<'_, SkillProcessManager>,
    request: RunSkillScriptRequest,
) -> Result<RunSkillScriptResult, String> {
    validate_request(&request)?;
    let execution_id = Uuid::parse_str(&request.execution_id)
        .map_err(|_| "Invalid Skill execution ID".to_string())?
        .to_string();
    let pending = register_pending_execution(&manager, &execution_id).await?;
    let result = async {
        let skill_root = canonical_directory(&request.skill_root, "Skill root")?;
        validate_skill_root(&app_handle, &skill_root, &request.skill_id)?;
        let scripts_root = canonical_directory(
            &skill_root.join("scripts").to_string_lossy(),
            "Skill scripts directory",
        )?;
        let script_path = tokio::fs::canonicalize(skill_root.join("scripts").join(&request.script_id))
            .await
            .map_err(|error| format!("Failed to resolve registered Skill script: {error}"))?;
        if !script_path.starts_with(&scripts_root) || !script_path.is_file() {
            return Err("Skill script must be a regular file below scripts/".to_string());
        }
        verify_hash(&script_path, &request.script_hash).await?;

        validate_absolute_path(&request.runtime_dir, "Skill runtime directory")?;
        validate_absolute_path(&request.output_dir, "Skill output directory")?;
        let runtime_dir =
            ensure_canonical_directory(&request.runtime_dir, "Skill runtime directory").await?;
        let output_dir =
            ensure_canonical_directory(&request.output_dir, "Skill output directory").await?;
        validate_managed_runtime_directory(&app_handle, &runtime_dir, &request.runtime_dir, &skill_root, &request.skill_id)?;
        validate_requested_output_directory(&request.output_dir, &output_dir, &request.skill_id)?;
        let runtime_lock = lock_for_runtime(&manager, &runtime_dir).await;
        let _runtime_guard = acquire_runtime_lock(runtime_lock, &pending).await?;
        ensure_not_cancelled(&pending)?;

        let program = resolve_interpreter(&request.script_type, Some(&runtime_dir)).await?;
        let command_args = build_command_args(
            &request.script_type,
            &script_path,
            &scripts_root,
            &request.args,
        );

        execute_skill_process(
            &manager, execution_id.clone(), &skill_root, &runtime_dir, &output_dir,
            program, command_args, request.timeout_ms,
        ).await
    }.await;
    manager.pending.lock().await.remove(&execution_id);
    result
}

#[tauri::command]
pub async fn run_skill_code(
    app_handle: AppHandle,
    manager: State<'_, SkillProcessManager>,
    request: RunSkillCodeRequest,
) -> Result<RunSkillScriptResult, String> {
    if !is_safe_identifier(&request.skill_id, 64) {
        return Err("Invalid Skill ID".to_string());
    }
    validate_arguments(&request.args)?;
    if request.code.is_empty() || request.code.len() > MAX_CODE_BYTES {
        return Err(format!("Skill code must contain between 1 and {MAX_CODE_BYTES} UTF-8 bytes"));
    }
    validate_hash(&request.code_hash)?;
    let code_hash = format!("{:x}", Sha256::digest(request.code.as_bytes()));
    if !code_hash.eq_ignore_ascii_case(&request.code_hash) {
        return Err("Skill code changed after approval".to_string());
    }
    let extension = match request.language.as_str() {
        "python" => "py",
        "javascript" => "cjs",
        "bash" => "sh",
        _ => return Err("Skill code language must be python, javascript, or bash".to_string()),
    };
    let execution_id = Uuid::parse_str(&request.execution_id)
        .map_err(|_| "Invalid Skill execution ID".to_string())?
        .to_string();
    let pending = register_pending_execution(&manager, &execution_id).await?;
    let result = async {
        validate_absolute_path(&request.runtime_dir, "Skill runtime directory")?;
        validate_absolute_path(&request.output_dir, "Skill output directory")?;
        let skill_root = canonical_directory(&request.skill_root, "Skill root")?;
        validate_skill_root(&app_handle, &skill_root, &request.skill_id)?;
        let runtime_dir = ensure_canonical_directory(&request.runtime_dir, "Skill runtime directory").await?;
        validate_managed_runtime_directory(&app_handle, &runtime_dir, &request.runtime_dir, &skill_root, &request.skill_id)?;
        let output_dir = ensure_canonical_directory(&request.output_dir, "Skill output directory").await?;
        validate_requested_output_directory(&request.output_dir, &output_dir, &request.skill_id)?;
        if !output_dir.ends_with(Path::new("runs").join(&execution_id)) {
            return Err("Generated Skill code must use its own runs/<execution-id> output directory".to_string());
        }
        let runtime_lock = lock_for_runtime(&manager, &runtime_dir).await;
        let _runtime_guard = acquire_runtime_lock(runtime_lock, &pending).await?;
        ensure_not_cancelled(&pending)?;
        let generated_dir = ensure_canonical_directory(
            &runtime_dir.join("generated").to_string_lossy(), "Generated Skill code directory",
        ).await?;
        if !generated_dir.starts_with(&runtime_dir) || generated_dir.starts_with(&skill_root) {
            return Err("Generated Skill code must remain in its managed runtime directory".to_string());
        }
        let script_path = generated_dir.join(format!("{code_hash}.{extension}"));
        let temporary_path = generated_dir.join(format!("{execution_id}.tmp"));
        let mut temporary = tokio::fs::OpenOptions::new()
            .write(true).create_new(true).open(&temporary_path).await
            .map_err(|error| format!("Failed to create approved Skill code: {error}"))?;
        let write_result = async {
            temporary.write_all(request.code.as_bytes()).await?;
            temporary.flush().await
        }.await;
        drop(temporary);
        if let Err(error) = write_result {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(format!("Failed to write approved Skill code: {error}"));
        }
        if script_path.exists() {
            let metadata = tokio::fs::symlink_metadata(&script_path).await
                .map_err(|error| format!("Failed to inspect generated Skill code: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                let _ = tokio::fs::remove_file(&temporary_path).await;
                return Err("Generated Skill code path must be a regular file".to_string());
            }
            let result = verify_hash(&script_path, &code_hash).await;
            let _ = tokio::fs::remove_file(&temporary_path).await;
            result?;
        } else if let Err(error) = tokio::fs::rename(&temporary_path, &script_path).await {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(format!("Failed to prepare approved Skill code: {error}"));
        }
        verify_hash(&script_path, &code_hash).await?;
        let program = if request.language == "python" {
            ensure_managed_python(&manager, &execution_id, &runtime_dir).await?.to_string_lossy().to_string()
        } else {
            resolve_interpreter(&request.language, Some(&runtime_dir)).await?
        };
        let command_args = build_command_args(
            &request.language, &script_path, &skill_root.join("scripts"), &request.args,
        );
        execute_skill_process(
            &manager, execution_id.clone(), &skill_root, &runtime_dir, &output_dir,
            program, command_args, request.timeout_ms,
        ).await
    }.await;
    manager.pending.lock().await.remove(&execution_id);
    result
}

async fn execute_skill_process(
    manager: &SkillProcessManager,
    execution_id: String,
    skill_root: &Path,
    runtime_dir: &Path,
    output_dir: &Path,
    program: String,
    command_args: Vec<String>,
    timeout_ms: u64,
) -> Result<RunSkillScriptResult, String> {
    let mut command = Command::new(program);
    command
        .args(command_args)
        // Relative paths produced by third-party Skill scripts must land in
        // the user-visible output directory, never inside the installed Skill
        // package. Scripts that need package resources receive SKILL_ROOT_DIR
        // and should resolve bundled files from their own script location.
        .current_dir(&output_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env_clear()
        .env("PATH", skill_execution_path(runtime_dir))
        .env("SKILL_ROOT_DIR", &skill_root)
        .env("SKILL_RUNTIME_DIR", &runtime_dir)
        .env("SKILL_OUTPUT_DIR", &output_dir)
        .env("NOTEGEN_OUTPUT_DIR", &output_dir)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("VIRTUAL_ENV", runtime_dir.join("python-env"))
        .env("NODE_PATH", runtime_dir.join("node").join("node_modules"))
        .env("TMPDIR", &runtime_dir)
        .env("TEMP", &runtime_dir)
        .env("TMP", &runtime_dir);
    inherit_platform_environment(&mut command);
    execute_prepared_skill_process(manager, execution_id, runtime_dir, command, timeout_ms).await
}

async fn execute_prepared_skill_process(
    manager: &SkillProcessManager,
    execution_id: String,
    runtime_dir: &Path,
    mut command: Command,
    timeout_ms: u64,
) -> Result<RunSkillScriptResult, String> {
    let stdout_log = runtime_dir.join(format!("{execution_id}.stdout.log"));
    let stderr_log = runtime_dir.join(format!("{execution_id}.stderr.log"));
    configure_process_group(&mut command);

    let started_at = Instant::now();
    let mut processes = manager.processes.lock().await;
    if processes.contains_key(&execution_id) {
        return Err("Skill execution ID is already active".to_string());
    }
    let cancelled = manager.pending.lock().await.get(&execution_id).cloned()
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    ensure_not_cancelled(&cancelled)?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start registered Skill script: {error}"))?;
    let pid = child.id().ok_or("Failed to determine Skill process ID")?;
    processes.insert(
            execution_id.clone(),
            RunningProcess {
                pid,
                cancelled: cancelled.clone(),
            },
    );
    drop(processes);

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture Skill stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture Skill stderr")?;
    let stdout_task = tokio::spawn(capture_stream(stdout, stdout_log.clone()));
    let stderr_task = tokio::spawn(capture_stream(stderr, stderr_log.clone()));
    let timeout_ms = timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

    let wait_result: Result<(std::process::ExitStatus, bool), String> = async {
        let result = match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
            Ok(status) => (
                status
                    .map_err(|error| format!("Failed while waiting for Skill script: {error}"))?,
                false,
            ),
            Err(_) => {
                terminate_process_tree(pid, false).await?;
                let status = match tokio::time::timeout(Duration::from_secs(3), child.wait()).await
                {
                    Ok(status) => status
                        .map_err(|error| format!("Failed while stopping Skill script: {error}"))?,
                    Err(_) => {
                        terminate_process_tree(pid, true).await?;
                        child.wait().await.map_err(|error| {
                            format!("Failed while force-stopping Skill script: {error}")
                        })?
                    }
                };
                (status, true)
            }
        };
        Ok(result)
    }.await;

    manager.processes.lock().await.remove(&execution_id);
    if wait_result.is_err() {
        let _ = terminate_process_tree(pid, true).await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    // Do not leave descendants holding pipes or changing the environment after
    // the Skill's main process has exited and its runtime lock is released.
    #[cfg(unix)]
    let _ = terminate_process_tree(pid, true).await;
    let (stdout_capture, stderr_capture) = tokio::join!(
        finish_capture(stdout_task, &stdout_log),
        finish_capture(stderr_task, &stderr_log),
    );
    let (status, timed_out) = wait_result?;
    let stdout_capture = stdout_capture?;
    let stderr_capture = stderr_capture?;
    Ok(RunSkillScriptResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout_capture.tail,
        stderr: stderr_capture.tail,
        output_truncated: stdout_capture.truncated || stderr_capture.truncated,
        timed_out,
        cancelled: cancelled.load(Ordering::SeqCst),
        execution_time_ms: started_at.elapsed().as_millis(),
        stdout_log: stdout_log.to_string_lossy().to_string(),
        stderr_log: stderr_log.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn inspect_skill_python(
    app_handle: AppHandle,
    request: SkillPythonRequest,
) -> Result<SkillPythonStatus, String> {
    let (_, runtime_dir) = validate_python_request(&app_handle, &request)?;
    let managed = managed_python_path(&runtime_dir);
    if managed.is_file() {
        let version = python_version(&managed).await;
        return Ok(SkillPythonStatus {
            available: version.is_some(),
            managed: true,
            interpreter: Some(managed.to_string_lossy().to_string()),
            version,
        });
    }
    match resolve_python_interpreter().await {
        Ok((interpreter, version)) => Ok(SkillPythonStatus {
            available: true,
            managed: false,
            interpreter: Some(interpreter),
            version: Some(version),
        }),
        Err(_) => Ok(SkillPythonStatus {
            available: false,
            managed: false,
            interpreter: None,
            version: None,
        }),
    }
}

#[tauri::command]
pub async fn install_skill_python_dependencies(
    app_handle: AppHandle,
    manager: State<'_, SkillProcessManager>,
    request: InstallSkillPythonDependenciesRequest,
) -> Result<InstallSkillPythonDependenciesResult, String> {
    if request.packages.is_empty() || request.packages.len() > 20 {
        return Err("Choose between 1 and 20 Python packages".to_string());
    }
    for package in &request.packages {
        validate_python_package_spec(package)?;
    }
    let execution_id = dependency_execution_id(request.execution_id.as_deref())?;
    let pending = register_pending_execution(&manager, &execution_id).await?;
    let result = async {
        let base_request = SkillPythonRequest {
            skill_id: request.skill_id,
            skill_root: request.skill_root,
            runtime_dir: request.runtime_dir,
        };
        let (_, runtime_dir) = validate_python_request(&app_handle, &base_request)?;
        let runtime_lock = lock_for_runtime(&manager, &runtime_dir).await;
        let _runtime_guard = acquire_runtime_lock(runtime_lock, &pending).await?;
        ensure_not_cancelled(&pending)?;
        let managed = ensure_managed_python(&manager, &execution_id, &runtime_dir).await?;

        let mut command = Command::new(&managed);
        command.args([
            "-I",
            "-m",
            "pip",
            "install",
            "--no-input",
            "--disable-pip-version-check",
            "--only-binary=:all:",
        ]);
        command.args(&request.packages);
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .env_clear().env("PATH", skill_execution_path(&runtime_dir))
            .env("PYTHONNOUSERSITE", "1").kill_on_drop(true);
        inherit_platform_environment(&mut command);
        let output = execute_prepared_skill_process(
            &manager, execution_id.clone(), &runtime_dir, command, MAX_TIMEOUT_MS,
        ).await?;
        let stdout = output.stdout;
        let stderr = output.stderr;
        if output.cancelled {
            return Err("Python dependency installation was cancelled".to_string());
        }
        if output.timed_out {
            return Err("Python dependency installation timed out after 300 seconds".to_string());
        }
        if output.exit_code != 0 {
            return Err(format!("Python dependency installation failed: {stderr}"));
        }
        let version = python_version(&managed)
            .await
            .ok_or("The managed Python environment is not usable")?;
        Ok(InstallSkillPythonDependenciesResult {
            interpreter: managed.to_string_lossy().to_string(),
            version,
            packages: request.packages,
            stdout,
            stderr,
        })
    }.await;
    manager.pending.lock().await.remove(&execution_id);
    result
}

#[tauri::command]
pub async fn install_skill_node_dependencies(
    app_handle: AppHandle,
    manager: State<'_, SkillProcessManager>,
    request: InstallSkillNodeDependenciesRequest,
) -> Result<InstallSkillNodeDependenciesResult, String> {
    if request.packages.is_empty() || request.packages.len() > 20 {
        return Err("Choose between 1 and 20 Node.js packages".to_string());
    }
    for package in &request.packages {
        validate_node_package_spec(package)?;
    }
    let execution_id = dependency_execution_id(request.execution_id.as_deref())?;
    let pending = register_pending_execution(&manager, &execution_id).await?;
    let result = async {
        let base_request = SkillPythonRequest {
            skill_id: request.skill_id,
            skill_root: request.skill_root,
            runtime_dir: request.runtime_dir,
        };
        let (_, runtime_dir) = validate_python_request(&app_handle, &base_request)?;
        let runtime_lock = lock_for_runtime(&manager, &runtime_dir).await;
        let _runtime_guard = acquire_runtime_lock(runtime_lock, &pending).await?;
        ensure_not_cancelled(&pending)?;
        let node = inspect_command("node").await;
        let npm = inspect_command("npm").await;
        if !node.available || !npm.available {
            return Err("Node.js and npm must be installed before adding Skill packages".to_string());
        }
        let interpreter = node.path
            .ok_or("Node.js is unavailable; install Node.js before adding Skill packages")?;
        let version = node.version.ok_or("Failed to determine the Node.js version")?;
        let npm_path = npm.path
            .ok_or("npm is unavailable; install npm before adding Skill packages")?;
        let node_dir = ensure_canonical_directory(
            &runtime_dir.join("node").to_string_lossy(), "Skill Node.js environment",
        ).await?;
        if !node_dir.starts_with(&runtime_dir) {
            return Err("Skill Node.js environment escaped its managed runtime".to_string());
        }
        let mut arguments = vec![
            "--prefix".to_string(), node_dir.to_string_lossy().to_string(),
            "install".to_string(), "--ignore-scripts".to_string(),
            "--no-audit".to_string(), "--no-fund".to_string(), "--save-exact".to_string(),
            "--registry=https://registry.npmjs.org".to_string(),
        ];
        arguments.extend(request.packages.iter().cloned());
        let mut command = npm_command(Path::new(&npm_path), &arguments)?;
        command.current_dir(&node_dir)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .env_clear().env("PATH", skill_execution_path(&runtime_dir))
            .env("npm_config_cache", node_dir.join("cache"))
            .env("npm_config_userconfig", node_dir.join(".npmrc"))
            .env("npm_config_ignore_scripts", "true")
            .env("TMPDIR", &runtime_dir).env("TEMP", &runtime_dir).env("TMP", &runtime_dir)
            .kill_on_drop(true);
        inherit_platform_environment(&mut command);
        let output = execute_prepared_skill_process(
            &manager, execution_id.clone(), &runtime_dir, command, MAX_TIMEOUT_MS,
        ).await?;
        let stdout = output.stdout;
        let stderr = output.stderr;
        if output.cancelled {
            return Err("Node.js dependency installation was cancelled".to_string());
        }
        if output.timed_out {
            return Err("Node.js dependency installation timed out after 300 seconds".to_string());
        }
        if output.exit_code != 0 {
            return Err(format!("Node.js dependency installation failed: {stderr}"));
        }
        Ok(InstallSkillNodeDependenciesResult {
            interpreter, version, packages: request.packages, stdout, stderr,
        })
    }.await;
    manager.pending.lock().await.remove(&execution_id);
    result
}

#[tauri::command]
pub async fn inspect_skill_environment(
    app_handle: AppHandle,
    request: SkillPythonRequest,
) -> Result<SkillEnvironmentStatus, String> {
    // The caller chooses a Skill, never an executable or a version command.
    let python = inspect_skill_python(app_handle, request).await?;
    let (node, npm, pandoc, soffice, pdftoppm, pdftotext, qpdf, tesseract) = tokio::join!(
        inspect_command("node"), inspect_command("npm"), inspect_command("pandoc"),
        inspect_command("soffice"), inspect_command("pdftoppm"), inspect_command("pdftotext"),
        inspect_command("qpdf"), inspect_command("tesseract"),
    );
    Ok(SkillEnvironmentStatus {
        python, node, npm, commands: vec![pandoc, soffice, pdftoppm, pdftotext, qpdf, tesseract],
    })
}

#[tauri::command]
pub async fn cancel_skill_script(
    manager: State<'_, SkillProcessManager>,
    execution_id: String,
) -> Result<bool, String> {
    let execution_id = Uuid::parse_str(&execution_id)
        .map_err(|_| "Invalid Skill execution ID".to_string())?.to_string();
    let processes = manager.processes.lock().await;
    let process = processes.get(&execution_id).cloned();
    let pending = manager.pending.lock().await.get(&execution_id).cloned();
    if let Some(pending) = &pending {
        pending.store(true, Ordering::SeqCst);
    }
    if let Some(process) = &process {
        process.cancelled.store(true, Ordering::SeqCst);
    }
    drop(processes);
    let Some(process) = process else { return Ok(pending.is_some()); };
    terminate_process_tree(process.pid, false).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let still_active = manager.processes.lock().await.get(&execution_id)
        .map(|active| active.pid == process.pid).unwrap_or(false);
    if still_active {
        let _ = terminate_process_tree(process.pid, true).await;
    }
    Ok(true)
}

fn validate_request(request: &RunSkillScriptRequest) -> Result<(), String> {
    if !is_safe_identifier(&request.skill_id, 64) {
        return Err("Invalid Skill ID".to_string());
    }
    validate_arguments(&request.args)?;
    validate_hash(&request.script_hash)?;
    validate_relative_script_id(&request.script_id)?;
    Ok(())
}

fn validate_arguments(args: &[String]) -> Result<(), String> {
    if args.len() > MAX_ARGUMENTS {
        return Err(format!(
            "Skill scripts accept at most {MAX_ARGUMENTS} arguments"
        ));
    }
    if args
        .iter()
        .any(|argument| argument.as_bytes().len() > MAX_ARGUMENT_BYTES || argument.contains('\0'))
    {
        return Err("Invalid Skill script argument".to_string());
    }
    Ok(())
}

fn validate_hash(hash: &str) -> Result<(), String> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid Skill code or script hash".to_string());
    }
    Ok(())
}

async fn lock_for_runtime(manager: &SkillProcessManager, runtime_dir: &Path) -> Arc<Mutex<()>> {
    manager.runtime_locks.lock().await
        .entry(runtime_dir.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
}

async fn acquire_runtime_lock(
    runtime_lock: Arc<Mutex<()>>,
    cancelled: &AtomicBool,
) -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
    let waiting = runtime_lock.lock_owned();
    tokio::pin!(waiting);
    loop {
        ensure_not_cancelled(cancelled)?;
        tokio::select! {
            guard = &mut waiting => {
                ensure_not_cancelled(cancelled)?;
                return Ok(guard);
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}

fn dependency_execution_id(value: Option<&str>) -> Result<String, String> {
    match value {
        Some(value) => Uuid::parse_str(value).map(|value| value.to_string())
            .map_err(|_| "Invalid Skill dependency execution ID".to_string()),
        None => Ok(Uuid::new_v4().to_string()),
    }
}

async fn register_pending_execution(manager: &SkillProcessManager, execution_id: &str) -> Result<Arc<AtomicBool>, String> {
    let processes = manager.processes.lock().await;
    let mut pending = manager.pending.lock().await;
    if processes.contains_key(execution_id) || pending.contains_key(execution_id) {
        return Err("Skill execution ID is already active".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    pending.insert(execution_id.to_string(), cancelled.clone());
    Ok(cancelled)
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err("Skill execution was cancelled before it started".to_string())
    } else {
        Ok(())
    }
}

fn validate_relative_script_id(script_id: &str) -> Result<(), String> {
    let path = Path::new(script_id);
    if script_id.is_empty()
        || path.is_absolute()
        || script_id.contains('\\')
        || script_id
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("Skill script ID must be relative to scripts/".to_string());
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Skill script ID contains an unsafe path component".to_string());
    }
    Ok(())
}

fn validate_skill_root(
    app_handle: &AppHandle,
    skill_root: &Path,
    skill_id: &str,
) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let known_roots = [
        app_data.join("skills").join(skill_id),
        app_data.join("article").join("skills").join(skill_id),
    ];
    if known_roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .map(|root| root == skill_root)
            .unwrap_or(false)
    }) {
        return Ok(());
    }
    if skill_root.ends_with(Path::new("skills").join(skill_id)) {
        return Ok(());
    }
    Err("Skill root does not match the requested Skill ID".to_string())
}

fn validate_output_directory(output_dir: &Path, skill_id: &str) -> Result<(), String> {
    let base = Path::new("outputs").join(skill_id);
    let run_directory = output_dir.file_name().and_then(|name| name.to_str())
        .and_then(|name| Uuid::parse_str(name).ok()).is_some()
        && output_dir.parent().and_then(|path| path.file_name()).map(|name| name == "runs").unwrap_or(false)
        && output_dir.parent().and_then(Path::parent).map(|path| path.ends_with(&base)).unwrap_or(false);
    if output_dir.ends_with(&base) || run_directory {
        Ok(())
    } else {
        Err("Skill output directory must be outputs/<skill-id> or its runs/<execution-id> directory".to_string())
    }
}

fn validate_requested_output_directory(requested: &str, output_dir: &Path, skill_id: &str) -> Result<(), String> {
    validate_absolute_path(requested, "Skill output directory")?;
    let requested = Path::new(requested);
    validate_output_directory(requested, skill_id)?;
    validate_output_directory(output_dir, skill_id)?;
    if requested.ends_with(Path::new("outputs").join(skill_id)) {
        return Ok(());
    }
    let base = requested.parent().and_then(Path::parent)
        .ok_or("Invalid Skill run output directory")?;
    let canonical_base = canonical_directory(&base.to_string_lossy(), "Skill output root")?;
    let run_id = requested.file_name().ok_or("Missing Skill run output ID")?;
    if output_dir != canonical_base.join("runs").join(run_id) {
        return Err("Skill run outputs escaped the Skill output directory".to_string());
    }
    Ok(())
}

fn validate_runtime_directory(
    runtime_dir: &Path,
    skill_root: &Path,
    skill_id: &str,
) -> Result<(), String> {
    let scoped_runtime = runtime_dir.file_name().map(|name| name == skill_id).unwrap_or(false)
        && runtime_dir.parent().and_then(Path::parent)
            .and_then(Path::file_name).map(|name| name == "skill-runtimes").unwrap_or(false);
    let allowed = runtime_dir.starts_with(skill_root.join("runtime"))
        || runtime_dir.ends_with(Path::new("skill-runtimes").join(skill_id))
        || scoped_runtime;
    if allowed {
        Ok(())
    } else {
        Err("Skill runtime directory is outside the allowed Skill runtime roots".to_string())
    }
}

fn validate_managed_runtime_directory(
    app_handle: &AppHandle,
    runtime_dir: &Path,
    requested: &str,
    skill_root: &Path,
    skill_id: &str,
) -> Result<(), String> {
    validate_runtime_directory(runtime_dir, skill_root, skill_id)?;
    let requested_app_data = app_handle.path().app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let app_data = std::fs::canonicalize(&requested_app_data)
        .map_err(|error| format!("Failed to resolve managed Skill runtime root: {error}"))?;
    let requested_relative = Path::new(requested).strip_prefix(&requested_app_data)
        .or_else(|_| Path::new(requested).strip_prefix(&app_data))
        .map_err(|_| "Skill runtime must be inside app data".to_string())?;
    if runtime_dir != app_data.join(requested_relative) {
        return Err("Skill runtime directory must not redirect into another scope or outside app data".to_string());
    }
    let managed_root = app_data.join("skill-runtimes");
    let relative = runtime_dir.strip_prefix(&managed_root)
        .map_err(|_| "Skill runtime directory must remain below app data/skill-runtimes".to_string())?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2 || runtime_dir.starts_with(skill_root) {
        return Err("Skill runtime must use an isolated scope directory outside the installed package".to_string());
    }
    let scope = parts[0].as_os_str().to_str().ok_or("Invalid Skill runtime scope")?;
    let project_scope = scope.strip_prefix("project-")
        .map(|hash| hash.len() == 16 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .unwrap_or(false);
    if scope != "global" && !project_scope {
        return Err("Skill runtime scope must be global or project-<workspace-hash>".to_string());
    }
    let global_skill = std::fs::canonicalize(app_data.join("skills").join(skill_id))
        .map(|root| root == skill_root).unwrap_or(false);
    if (scope == "global") != global_skill {
        return Err("Skill runtime scope does not match the installed Skill scope".to_string());
    }
    if parts[1].as_os_str() != std::ffi::OsStr::new(skill_id) {
        return Err("Managed Skill runtime does not match the requested Skill".to_string());
    }
    Ok(())
}

fn validate_absolute_path(path: &str, label: &str) -> Result<(), String> {
    let parsed = Path::new(path);
    if !parsed.is_absolute() || path.contains('\0')
        || parsed.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err(format!("{label} must be an absolute path without traversal"));
    }
    Ok(())
}

fn canonical_directory(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    if !path.is_dir() {
        return Err(format!("{label} is not a directory"));
    }
    Ok(path)
}

async fn ensure_canonical_directory(path: &str, label: &str) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|error| format!("Failed to create {label}: {error}"))?;
    canonical_directory(path, label)
}

async fn verify_hash(path: &Path, expected: &str) -> Result<(), String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Failed to read Skill script: {error}"))?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err("Skill script hash changed after approval".to_string())
    }
}

fn validate_python_request(
    app_handle: &AppHandle,
    request: &SkillPythonRequest,
) -> Result<(PathBuf, PathBuf), String> {
    if !is_safe_identifier(&request.skill_id, 64) {
        return Err("Invalid Skill ID".to_string());
    }
    validate_absolute_path(&request.runtime_dir, "Skill runtime directory")?;
    let skill_root = canonical_directory(&request.skill_root, "Skill root")?;
    validate_skill_root(app_handle, &skill_root, &request.skill_id)?;
    let runtime_dir = std::fs::create_dir_all(&request.runtime_dir)
        .map(|_| ())
        .and_then(|_| std::fs::canonicalize(&request.runtime_dir))
        .map_err(|error| format!("Failed to resolve Skill runtime directory: {error}"))?;
    validate_managed_runtime_directory(app_handle, &runtime_dir, &request.runtime_dir, &skill_root, &request.skill_id)?;
    Ok((skill_root, runtime_dir))
}

fn managed_python_path(runtime_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        runtime_dir
            .join("python-env")
            .join("Scripts")
            .join("python.exe")
    } else {
        runtime_dir.join("python-env").join("bin").join("python")
    }
}

async fn ensure_managed_python(
    manager: &SkillProcessManager,
    execution_id: &str,
    runtime_dir: &Path,
) -> Result<PathBuf, String> {
    let managed = managed_python_path(runtime_dir);
    let env_dir = runtime_dir.join("python-env");
    if let Ok(metadata) = std::fs::symlink_metadata(&env_dir) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("The Skill Python environment must be a managed directory".to_string());
        }
    }
    if python_version(&managed).await.is_some() {
        return Ok(managed);
    }
    let (base, _) = resolve_python_interpreter().await?;
    let mut command = Command::new(base);
    command.args(["-I", "-m", "venv"]).arg(&env_dir)
        .current_dir(runtime_dir)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = execute_prepared_skill_process(
        manager, execution_id.to_string(), runtime_dir, command, 120_000,
    ).await?;
    if output.cancelled {
        return Err("Python environment initialization was cancelled".to_string());
    }
    if output.timed_out {
        return Err("Timed out while creating the isolated Python environment".to_string());
    }
    if output.exit_code != 0 {
        return Err(format!("Failed to create the isolated Python environment: {}", output.stderr));
    }
    if python_version(&managed).await.is_none() {
        return Err("The managed Python environment is not usable".to_string());
    }
    Ok(managed)
}

fn validate_node_package_spec(package: &str) -> Result<(), String> {
    let pattern = Regex::new(concat!(
        r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*",
        r"(?:@(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)",
        r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)?$"
    )).expect("valid Node.js registry package regex");
    if package.len() > 256 || !pattern.is_match(package) {
        return Err(format!("Unsafe Node.js package specification: {package}. Use a registry package name with an optional exact semantic version; URLs, paths, tags, ranges, aliases, and flags are not allowed."));
    }
    Ok(())
}

fn command_candidates(name: &str) -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    directories.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
        .into_iter().map(PathBuf::from));
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        directories.push(PathBuf::from(&home).join(".local/bin"));
        directories.push(PathBuf::from(&home).join(".volta/bin"));
        directories.push(PathBuf::from(&home).join(".local/share/mise/shims"));
        directories.push(PathBuf::from(&home).join(".asdf/shims"));
        directories.push(PathBuf::from(home).join("Applications/LibreOffice.app/Contents/MacOS"));
    }
    directories.push(PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS"));
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            directories.extend([root.join("nodejs"), root.join("LibreOffice/program"),
                root.join("Tesseract-OCR")]);
        }
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let local_app_data = PathBuf::from(local_app_data);
        directories.extend([local_app_data.join("Volta/bin"), local_app_data.join("mise/shims"),
            local_app_data.join("Programs/nodejs")]);
    }
    let filenames = if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()]
    } else { vec![name.to_string()] };
    let mut seen = HashSet::new();
    directories.into_iter().filter(|path| path.is_absolute())
        .flat_map(|directory| filenames.iter().map(move |file| directory.join(file)))
        .filter(|path| path.is_file() && seen.insert(path.clone())).collect()
}

async fn inspect_command(name: &str) -> SkillCommandStatus {
    let arguments: Vec<String> = match name {
        "node" | "npm" | "pandoc" | "qpdf" | "tesseract" => vec!["--version".to_string()],
        "soffice" => vec!["--headless".to_string(), "--version".to_string()],
        "pdftoppm" | "pdftotext" => vec!["-v".to_string()],
        _ => return SkillCommandStatus { name: name.to_string(), available: false, path: None, version: None },
    };
    for path in command_candidates(name) {
        let mut command = if name == "npm" {
            match npm_command(&path, &arguments) { Ok(command) => command, Err(_) => continue }
        } else {
            let mut command = Command::new(&path);
            command.args(&arguments);
            command
        };
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .env("PATH", discovery_path()).kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(5), command.output()).await;
        if let Ok(Ok(output)) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let version = stdout.lines().chain(stderr.lines()).find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().chars().take(200).collect::<String>());
                return SkillCommandStatus {
                    name: name.to_string(), available: true,
                    path: Some(path.to_string_lossy().to_string()), version,
                };
            }
        }
    }
    SkillCommandStatus { name: name.to_string(), available: false, path: None, version: None }
}

fn discovery_path() -> std::ffi::OsString {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect()).unwrap_or_default();
    for name in ["node", "npm", "soffice", "pandoc", "pdftoppm", "pdftotext", "qpdf", "tesseract"] {
        for candidate in command_candidates(name) {
            if let Some(parent) = candidate.parent() {
                paths.push(parent.to_path_buf());
            }
        }
    }
    std::env::join_paths(paths).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

fn skill_execution_path(runtime_dir: &Path) -> std::ffi::OsString {
    let mut paths = vec![
        managed_python_path(runtime_dir).parent().unwrap_or(runtime_dir).to_path_buf(),
        runtime_dir.join("node/node_modules/.bin"),
    ];
    paths.extend(std::env::split_paths(&discovery_path()));
    std::env::join_paths(paths).unwrap_or_else(|_| discovery_path())
}

fn inherit_platform_environment(command: &mut Command) {
    for name in ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "WINDIR", "COMSPEC", "LANG", "LC_ALL"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}

#[cfg(not(windows))]
fn npm_command(path: &Path, args: &[String]) -> Result<Command, String> {
    let mut command = Command::new(path);
    command.args(args);
    Ok(command)
}

#[cfg(windows)]
fn npm_command(path: &Path, args: &[String]) -> Result<Command, String> {
    use std::os::windows::process::CommandExt;
    if path.extension().and_then(|value| value.to_str()) != Some("cmd") {
        let mut command = Command::new(path);
        command.args(args);
        return Ok(command);
    }
    let quote = |value: &str| -> Result<String, String> {
        if value.chars().any(|character| matches!(character, '"' | '%' | '\r' | '\n')) {
            return Err("npm paths or arguments contain unsupported Windows command characters".to_string());
        }
        Ok(format!("\"{value}\""))
    };
    let mut parts = vec![quote(&path.to_string_lossy())?];
    for argument in args { parts.push(quote(argument)?); }
    let comspec = std::env::var_os("COMSPEC").unwrap_or_else(|| "cmd.exe".into());
    let mut command = Command::new(comspec);
    command.args(["/d", "/s", "/v:off", "/c"]);
    command.as_std_mut().raw_arg(format!("\"{}\"", parts.join(" ")));
    Ok(command)
}

fn validate_python_package_spec(package: &str) -> Result<(), String> {
    let pattern = Regex::new(
        r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:(?:==|!=|~=|>=|<=|>|<)[A-Za-z0-9][A-Za-z0-9.*+!_-]*)?(?:,(?:==|!=|~=|>=|<=|>|<)[A-Za-z0-9][A-Za-z0-9.*+!_-]*)*$",
    )
    .expect("valid Python package regex");
    if package.len() > 160
        || !pattern.is_match(package)
        || package.contains('@')
        || package.starts_with('-')
    {
        Err(format!(
            "Unsafe Python package specification: {package}. URLs, paths, flags, and environment markers are not allowed."
        ))
    } else {
        Ok(())
    }
}

fn parse_python_version(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.trim().split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

async fn python_version(candidate: &Path) -> Option<String> {
    let output = tokio::time::timeout(Duration::from_secs(5), Command::new(candidate)
        .args([
            "-I",
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3])))",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output())
        .await
        .ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8(output.stdout).ok()?.trim().to_string();
    parse_python_version(&version).map(|_| version)
}

fn python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for name in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        candidates.push(PathBuf::from(name));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for root in [
            home.join(".local/share/uv/python"),
            home.join(".pyenv/versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    for name in [
                        "python3.13",
                        "python3.12",
                        "python3.11",
                        "python3.10",
                        "python3",
                    ] {
                        let candidate = bin.join(name);
                        if candidate.is_file() {
                            candidates.push(candidate);
                        }
                    }
                }
            }
        }
    }
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin"] {
        for name in [
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
        ] {
            let candidate = Path::new(prefix).join(name);
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

async fn resolve_python_interpreter() -> Result<(String, String), String> {
    let mut available = Vec::new();
    for candidate in python_candidates() {
        if let Some(version) = python_version(&candidate).await {
            if let Some(parsed) = parse_python_version(&version) {
                available.push((parsed, candidate.to_string_lossy().to_string(), version));
            }
        }
    }
    available.sort_by(|left, right| right.0.cmp(&left.0));
    available
        .into_iter()
        .next()
        .map(|(_, interpreter, version)| (interpreter, version))
        .ok_or_else(|| "Required interpreter is unavailable for python".to_string())
}

async fn resolve_interpreter(
    script_type: &str,
    runtime_dir: Option<&Path>,
) -> Result<String, String> {
    if script_type == "python" {
        if let Some(runtime_dir) = runtime_dir {
            let managed = managed_python_path(runtime_dir);
            if python_version(&managed).await.is_some() {
                return Ok(managed.to_string_lossy().to_string());
            }
        }
        return resolve_python_interpreter()
            .await
            .map(|(interpreter, _)| interpreter);
    }
    if matches!(script_type, "javascript" | "node") {
        let node = inspect_command("node").await;
        return if node.available {
            node.path.ok_or_else(|| "Required interpreter is unavailable for javascript".to_string())
        } else {
            Err("Required interpreter is unavailable for javascript".to_string())
        };
    }
    let candidates: &[&str] = match script_type {
        "bash" | "shell" => &["bash"],
        _ => return Err(format!("Unsupported Skill script type: {script_type}")),
    };
    for candidate in candidates {
        if Command::new(candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return Ok(candidate.to_string());
        }
    }
    Err(format!(
        "Required interpreter is unavailable for {script_type}"
    ))
}

fn build_command_args(
    script_type: &str,
    script_path: &Path,
    scripts_root: &Path,
    args: &[String],
) -> Vec<String> {
    let script = script_path.to_string_lossy().to_string();
    let mut command_args = match script_type {
        "python" => vec![
            "-I".to_string(),
            "-B".to_string(),
            "-c".to_string(),
            concat!(
                "import os,runpy,sys;",
                "root=sys.argv.pop(1);script=sys.argv.pop(1);",
                "sys.path[:0]=[os.path.dirname(script),root];",
                "sys.argv[0]=script;runpy.run_path(script,run_name='__main__')"
            )
            .to_string(),
            scripts_root.to_string_lossy().to_string(),
            script,
        ],
        "bash" | "shell" => vec!["--noprofile".to_string(), "--norc".to_string(), script],
        _ => vec![script],
    };
    command_args.extend(args.iter().cloned());
    command_args
}

async fn capture_stream<R>(mut reader: R, log_path: PathBuf) -> Result<CaptureResult, String>
where
    R: AsyncRead + Unpin,
{
    let mut log = tokio::fs::File::create(&log_path)
        .await
        .map_err(|error| format!("Failed to create Skill execution log: {error}"))?;
    let mut buffer = [0_u8; 8192];
    let mut tail = Vec::new();
    let mut logged = 0_usize;
    let mut truncated = false;
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Failed to read Skill process output: {error}"))?;
        if read == 0 {
            break;
        }
        if logged < MAX_LOG_BYTES {
            let writable = read.min(MAX_LOG_BYTES - logged);
            log.write_all(&buffer[..writable])
                .await
                .map_err(|error| format!("Failed to write Skill execution log: {error}"))?;
            logged += writable;
            truncated |= writable < read;
        } else {
            truncated = true
        }
        tail.extend_from_slice(&buffer[..read]);
        if tail.len() > MAX_CAPTURE_BYTES {
            tail.drain(..tail.len() - MAX_CAPTURE_BYTES);
            truncated = true;
        }
    }
    log.flush()
        .await
        .map_err(|error| format!("Failed to flush Skill execution log: {error}"))?;
    let text = String::from_utf8_lossy(&tail).to_string();
    let lines: Vec<&str> = text.lines().collect();
    let tail = if lines.len() > MAX_CAPTURE_LINES {
        truncated = true;
        lines[lines.len() - MAX_CAPTURE_LINES..].join("\n")
    } else {
        text
    };
    Ok(CaptureResult { tail, truncated })
}

async fn finish_capture(
    mut task: tokio::task::JoinHandle<Result<CaptureResult, String>>,
    log_path: &Path,
) -> Result<CaptureResult, String> {
    match tokio::time::timeout(Duration::from_secs(3), &mut task).await {
        Ok(result) => result.map_err(|error| format!("Skill output task failed: {error}"))?,
        Err(_) => {
            task.abort();
            let _ = task.await;
            let mut log = tokio::fs::File::open(log_path).await
                .map_err(|error| format!("Failed to read captured Skill output: {error}"))?;
            let length = log.metadata().await.map(|metadata| metadata.len()).unwrap_or(0);
            if length > MAX_CAPTURE_BYTES as u64 {
                log.seek(SeekFrom::End(-(MAX_CAPTURE_BYTES as i64))).await
                    .map_err(|error| format!("Failed to read Skill output tail: {error}"))?;
            }
            let mut bytes = Vec::new();
            log.take(MAX_CAPTURE_BYTES as u64).read_to_end(&mut bytes).await
                .map_err(|error| format!("Failed to read Skill output tail: {error}"))?;
            let text = String::from_utf8_lossy(&bytes).to_string();
            let lines: Vec<_> = text.lines().collect();
            Ok(CaptureResult {
                tail: lines[lines.len().saturating_sub(MAX_CAPTURE_LINES)..].join("\n"),
                truncated: true,
            })
        }
    }
}

fn is_safe_identifier(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    command.process_group(0);
}
#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
async fn terminate_process_tree(pid: u32, force: bool) -> Result<(), String> {
    let signal = if force { "-KILL" } else { "-TERM" };
    let status = Command::new("kill")
        .args([signal, &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| format!("Failed to stop Skill process group: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Failed to stop Skill process group".to_string())
    }
}

#[cfg(windows)]
async fn terminate_process_tree(pid: u32, _force: bool) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| format!("Failed to stop Skill process tree: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Failed to stop Skill process tree".to_string())
    }
}

#[cfg(not(any(unix, windows)))]
async fn terminate_process_tree(_pid: u32, _force: bool) -> Result<(), String> {
    Err("Skill process cancellation is unavailable on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_script_identifiers() {
        assert!(validate_relative_script_id("convert.py").is_ok());
        assert!(validate_relative_script_id("office/unpack.py").is_ok());
        assert!(validate_relative_script_id("../escape.py").is_err());
        assert!(validate_relative_script_id("/tmp/escape.py").is_err());
        assert!(validate_relative_script_id("office//unpack.py").is_err());
    }

    #[test]
    fn validates_skill_identifiers() {
        assert!(is_safe_identifier("pdf-tools", 64));
        assert!(!is_safe_identifier("PDF-Tools", 64));
        assert!(!is_safe_identifier("-pdf", 64));
        assert!(!is_safe_identifier("pdf_unsafe", 64));
    }

    #[test]
    fn validates_output_suffix() {
        assert!(validate_output_directory(Path::new("/tmp/article/outputs/pdf"), "pdf").is_ok());
        assert!(validate_output_directory(Path::new("/tmp/article/outputs/other"), "pdf").is_err());
    }

    #[test]
    fn validates_runtime_roots() {
        let skill = Path::new("/tmp/skills/pdf");
        assert!(
            validate_runtime_directory(Path::new("/tmp/skills/pdf/runtime/run"), skill, "pdf")
                .is_ok()
        );
        assert!(
            validate_runtime_directory(Path::new("/tmp/skill-runtimes/pdf"), skill, "pdf").is_ok()
        );
        assert!(validate_runtime_directory(Path::new("/tmp/private"), skill, "pdf").is_err());
    }

    #[test]
    fn python_launcher_keeps_isolation_and_allows_skill_local_imports() {
        let args = build_command_args(
            "python",
            Path::new("/tmp/skills/xlsx/scripts/recalc.py"),
            Path::new("/tmp/skills/xlsx/scripts"),
            &["book.xlsx".to_string()],
        );
        assert_eq!(&args[..3], ["-I", "-B", "-c"]);
        assert!(args[3].contains("sys.path[:0]"));
        assert_eq!(args[4], "/tmp/skills/xlsx/scripts");
        assert_eq!(args[5], "/tmp/skills/xlsx/scripts/recalc.py");
        assert_eq!(args[6], "book.xlsx");
    }

    #[test]
    fn validates_python_package_specs() {
        assert!(validate_python_package_spec("pypdf>=5").is_ok());
        assert!(validate_python_package_spec("Pillow").is_ok());
        assert!(validate_python_package_spec("openpyxl>=3.1,<4").is_ok());
        assert!(validate_python_package_spec("requests[socks]==2.32.4").is_ok());
        assert!(validate_python_package_spec("https://example.com/pkg.whl").is_err());
        assert!(validate_python_package_spec("../local-package").is_err());
        assert!(validate_python_package_spec("--index-url").is_err());
        assert!(validate_python_package_spec("package; os_name == 'posix'").is_err());
        assert!(validate_python_package_spec("owner/package@main").is_err());
    }

    #[test]
    fn parses_python_versions_for_ordering() {
        assert_eq!(parse_python_version("3.12.10\n"), Some((3, 12, 10)));
        assert_eq!(parse_python_version("3.9.6"), Some((3, 9, 6)));
        assert_eq!(parse_python_version("Python 3.12.1"), None);
    }

    #[test]
    fn managed_python_stays_below_the_skill_runtime() {
        let runtime = Path::new("/tmp/skill-runtimes/pdf");
        let interpreter = managed_python_path(runtime);
        assert!(interpreter.starts_with(runtime.join("python-env")));
    }

    #[tokio::test]
    async fn truncates_large_process_output_and_keeps_a_log() {
        let directory = std::env::temp_dir().join(format!("notegen-output-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let log_path = directory.join("stdout.log");
        let (mut writer, reader) = tokio::io::duplex(MAX_CAPTURE_BYTES * 2);
        let payload = vec![b'x'; MAX_CAPTURE_BYTES + 1024];
        let write_task = tokio::spawn(async move {
            writer.write_all(&payload).await.unwrap();
        });
        let captured = capture_stream(reader, log_path.clone()).await.unwrap();
        write_task.await.unwrap();
        assert!(captured.truncated);
        assert!(captured.tail.len() <= MAX_CAPTURE_BYTES);
        assert_eq!(
            tokio::fs::metadata(log_path).await.unwrap().len(),
            (MAX_CAPTURE_BYTES + 1024) as u64
        );
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
