use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
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

#[derive(Default)]
pub struct SkillProcessManager {
    processes: Mutex<HashMap<String, RunningProcess>>,
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

    let runtime_dir =
        ensure_canonical_directory(&request.runtime_dir, "Skill runtime directory").await?;
    let output_dir =
        ensure_canonical_directory(&request.output_dir, "Skill output directory").await?;
    validate_runtime_directory(&runtime_dir, &skill_root, &request.skill_id)?;
    validate_output_directory(&output_dir, &request.skill_id)?;

    let program = resolve_interpreter(&request.script_type, Some(&runtime_dir)).await?;
    let command_args = build_command_args(
        &request.script_type,
        &script_path,
        &scripts_root,
        &request.args,
    );

    let stdout_log = runtime_dir.join(format!("{execution_id}.stdout.log"));
    let stderr_log = runtime_dir.join(format!("{execution_id}.stderr.log"));
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
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("SKILL_ROOT_DIR", &skill_root)
        .env("SKILL_RUNTIME_DIR", &runtime_dir)
        .env("SKILL_OUTPUT_DIR", &output_dir)
        .env("NOTEGEN_OUTPUT_DIR", &output_dir)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("TMPDIR", &runtime_dir)
        .env("TEMP", &runtime_dir)
        .env("TMP", &runtime_dir);
    configure_process_group(&mut command);

    let started_at = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start registered Skill script: {error}"))?;
    let pid = child.id().ok_or("Failed to determine Skill process ID")?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut processes = manager.processes.lock().await;
        if processes.contains_key(&execution_id) {
            return Err("Skill execution ID is already active".to_string());
        }
        processes.insert(
            execution_id.clone(),
            RunningProcess {
                pid,
                cancelled: cancelled.clone(),
            },
        );
    }

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
    let timeout_ms = request.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

    let (status, timed_out) =
        match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
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

    manager.processes.lock().await.remove(&execution_id);
    let stdout_capture = stdout_task
        .await
        .map_err(|error| format!("Skill stdout task failed: {error}"))??;
    let stderr_capture = stderr_task
        .await
        .map_err(|error| format!("Skill stderr task failed: {error}"))??;
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
    request: InstallSkillPythonDependenciesRequest,
) -> Result<InstallSkillPythonDependenciesResult, String> {
    if request.packages.is_empty() || request.packages.len() > 20 {
        return Err("Choose between 1 and 20 Python packages".to_string());
    }
    for package in &request.packages {
        validate_python_package_spec(package)?;
    }
    let base_request = SkillPythonRequest {
        skill_id: request.skill_id,
        skill_root: request.skill_root,
        runtime_dir: request.runtime_dir,
    };
    let (_, runtime_dir) = validate_python_request(&app_handle, &base_request)?;
    let managed = managed_python_path(&runtime_dir);
    if !managed.is_file() {
        let (base, _) = resolve_python_interpreter().await?;
        let env_dir = runtime_dir.join("python-env");
        let output = tokio::time::timeout(
            Duration::from_secs(120),
            Command::new(base)
                .args(["-I", "-m", "venv"])
                .arg(&env_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "Timed out while creating the isolated Python environment".to_string())?
        .map_err(|error| format!("Failed to create the isolated Python environment: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Failed to create the isolated Python environment: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

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
    let output = tokio::time::timeout(
        Duration::from_secs(300),
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .env("PYTHONNOUSERSITE", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Python dependency installation timed out after 300 seconds".to_string())?
    .map_err(|error| format!("Failed to install Python dependencies: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
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
}

#[tauri::command]
pub async fn cancel_skill_script(
    manager: State<'_, SkillProcessManager>,
    execution_id: String,
) -> Result<bool, String> {
    let process = manager.processes.lock().await.get(&execution_id).cloned();
    let Some(process) = process else {
        return Ok(false);
    };
    process.cancelled.store(true, Ordering::SeqCst);
    terminate_process_tree(process.pid, false).await?;
    Ok(true)
}

fn validate_request(request: &RunSkillScriptRequest) -> Result<(), String> {
    if !is_safe_identifier(&request.skill_id, 64) {
        return Err("Invalid Skill ID".to_string());
    }
    if request.args.len() > MAX_ARGUMENTS {
        return Err(format!(
            "Skill scripts accept at most {MAX_ARGUMENTS} arguments"
        ));
    }
    if request.script_hash.len() != 64
        || !request
            .script_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid Skill script hash".to_string());
    }
    validate_relative_script_id(&request.script_id)?;
    if request
        .args
        .iter()
        .any(|argument| argument.as_bytes().len() > MAX_ARGUMENT_BYTES || argument.contains('\0'))
    {
        return Err("Invalid Skill script argument".to_string());
    }
    Ok(())
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
    if output_dir.ends_with(Path::new("outputs").join(skill_id)) {
        Ok(())
    } else {
        Err("Skill output directory must end with outputs/<skill-id>".to_string())
    }
}

fn validate_runtime_directory(
    runtime_dir: &Path,
    skill_root: &Path,
    skill_id: &str,
) -> Result<(), String> {
    let allowed = runtime_dir.starts_with(skill_root.join("runtime"))
        || runtime_dir.ends_with(Path::new("skill-runtimes").join(skill_id));
    if allowed {
        Ok(())
    } else {
        Err("Skill runtime directory is outside the allowed Skill runtime roots".to_string())
    }
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
    let skill_root = canonical_directory(&request.skill_root, "Skill root")?;
    validate_skill_root(app_handle, &skill_root, &request.skill_id)?;
    let runtime_dir = std::fs::create_dir_all(&request.runtime_dir)
        .map(|_| ())
        .and_then(|_| std::fs::canonicalize(&request.runtime_dir))
        .map_err(|error| format!("Failed to resolve Skill runtime directory: {error}"))?;
    validate_runtime_directory(&runtime_dir, &skill_root, &request.skill_id)?;
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
    let output = Command::new(candidate)
        .args([
            "-I",
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3])))",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
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
    let candidates: &[&str] = match script_type {
        "bash" | "shell" => &["bash"],
        "javascript" | "node" => &["node"],
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
