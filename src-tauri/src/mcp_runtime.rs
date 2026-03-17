use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    Npx,
    Uvx,
    Python,
    Python3,
    Bunx,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeRequirement {
    pub launcher: String,
    pub kind: RuntimeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecipe {
    pub id: &'static str,
    pub title: &'static str,
    pub command_preview: &'static str,
    pub post_install_hint: Option<&'static str>,
    pub scope: &'static str,
    pub manual_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheckResult {
    pub command: String,
    pub installed: bool,
    pub resolved_path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInspection {
    pub launcher: String,
    pub kind: RuntimeKind,
    pub checks: Vec<RuntimeCheckResult>,
    pub install_recipe: Option<InstallRecipe>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallExecutionResult {
    pub recipe_id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Default)]
pub struct RuntimeInstallManager {
    active_installs: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_installs: Arc<Mutex<HashSet<String>>>,
}

impl RuntimeInstallManager {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallProgressStage {
    Preparing,
    Running,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub recipe_id: String,
    pub stage: InstallProgressStage,
    pub stream: Option<String>,
    pub line: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelInstallResult {
    pub recipe_id: String,
    pub cancelled: bool,
}

fn normalize_launcher(command: &str, args: &[String]) -> String {
    let trimmed = command.trim();
    let candidate = if trimmed.is_empty() {
        args.first().map(String::as_str).unwrap_or("")
    } else {
        trimmed.split_whitespace().next().unwrap_or("")
    };

    let basename = Path::new(candidate)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(candidate)
        .to_lowercase();

    basename
        .trim_end_matches(".cmd")
        .trim_end_matches(".exe")
        .trim_end_matches(".bat")
        .to_string()
}

pub fn classify_runtime_requirement(command: &str, args: &[String]) -> RuntimeRequirement {
    let launcher = normalize_launcher(command, args);
    let kind = match launcher.as_str() {
        "npx" => RuntimeKind::Npx,
        "uvx" => RuntimeKind::Uvx,
        "python" => RuntimeKind::Python,
        "python3" => RuntimeKind::Python3,
        "bunx" => RuntimeKind::Bunx,
        _ => RuntimeKind::Unknown,
    };

    RuntimeRequirement { launcher, kind }
}

pub fn install_recipe_for(kind: &RuntimeKind, platform: &str) -> Option<InstallRecipe> {
    match (kind, platform) {
        (RuntimeKind::Uvx, "macos") => Some(InstallRecipe {
            id: "install-uv-macos",
            title: "Install uv",
            command_preview: "curl -LsSf https://astral.sh/uv/install.sh | sh",
            post_install_hint: Some("If uv is still unavailable after installation, restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Uvx, "linux") => Some(InstallRecipe {
            id: "install-uv-linux",
            title: "Install uv",
            command_preview: "curl -LsSf https://astral.sh/uv/install.sh | sh",
            post_install_hint: Some("If uv is still unavailable after installation, restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Uvx, "windows") => Some(InstallRecipe {
            id: "install-uv-windows",
            title: "Install uv",
            command_preview: "powershell -ExecutionPolicy Bypass -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
            post_install_hint: Some("If uv is still unavailable after installation, restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Bunx, "macos") => Some(InstallRecipe {
            id: "install-bun-macos",
            title: "Install Bun",
            command_preview: "curl -fsSL https://bun.com/install | bash",
            post_install_hint: Some("Bun installs into ~/.bun/bin. If bun is still unavailable after installation, add that directory to PATH, then restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Bunx, "linux") => Some(InstallRecipe {
            id: "install-bun-linux",
            title: "Install Bun",
            command_preview: "curl -fsSL https://bun.com/install | bash",
            post_install_hint: Some("Bun installs into ~/.bun/bin and requires unzip on Linux. If bun is still unavailable after installation, add that directory to PATH, then restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Bunx, "windows") => Some(InstallRecipe {
            id: "install-bun-windows",
            title: "Install Bun",
            command_preview: "powershell -c \"irm bun.com/install.ps1 | iex\"",
            post_install_hint: Some("If bun is still unavailable after installation, restart NoteGen or open a new terminal session and re-check your PATH."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Npx, "macos") | (RuntimeKind::Npx, "linux") => Some(InstallRecipe {
            id: "install-node-volta-unix",
            title: "Install Node.js via Volta",
            command_preview: "curl https://get.volta.sh | bash && export VOLTA_HOME=\"$HOME/.volta\" && export PATH=\"$VOLTA_HOME/bin:$PATH\" && volta install node",
            post_install_hint: Some("Volta updates shell configuration for future sessions. If npx is still unavailable after installation, restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Npx, "windows") => Some(InstallRecipe {
            id: "install-node-volta-windows",
            title: "Install Node.js via Volta",
            command_preview: "winget install Volta.Volta && volta install node",
            post_install_hint: Some("Windows may not expose Volta in the current session immediately. If npx is still unavailable after installation, restart NoteGen or open a new terminal session and re-check."),
            scope: "current_user",
            manual_only: false,
        }),
        (RuntimeKind::Python, "macos")
        | (RuntimeKind::Python3, "macos")
        | (RuntimeKind::Python, "windows")
        | (RuntimeKind::Python3, "windows")
        | (RuntimeKind::Python, "linux")
        | (RuntimeKind::Python3, "linux") => Some(InstallRecipe {
            id: "install-python-manual",
            title: "Install Python",
            command_preview: "Install Python 3 in your user environment, then re-check in NoteGen.",
            post_install_hint: Some("Use the official Python installer for your platform, then restart NoteGen or open a new terminal session before re-checking."),
            scope: "current_user",
            manual_only: true,
        }),
        _ => None,
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn find_command_path(command: &str) -> Option<PathBuf> {
    let path_var = env::var("PATH").ok()?;
    let separator = if cfg!(target_os = "windows") { ';' } else { ':' };
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &[command, &format!("{command}.cmd"), &format!("{command}.exe"), &format!("{command}.bat")]
    } else {
        &[command]
    };

    for dir in path_var.split(separator) {
        for candidate in candidates {
            let path = PathBuf::from(dir).join(candidate);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

fn version_args_for(command: &str) -> &'static [&'static str] {
    match command {
        "python" | "python3" => &["--version"],
        _ => &["--version"],
    }
}

fn read_command_version(command: &str, path: &Path) -> Result<Option<String>, String> {
    let output = Command::new(path)
        .args(version_args_for(command))
        .output()
        .map_err(|error| format!("Failed to read version: {error}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Ok(Some(stdout));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Ok(Some(stderr));
    }

    Ok(None)
}

fn inspect_requirement(requirement: &RuntimeRequirement) -> RuntimeInspection {
    let resolved_path = find_command_path(&requirement.launcher);
    let version = resolved_path
        .as_ref()
        .and_then(|path| read_command_version(&requirement.launcher, path).ok().flatten());

    let check = RuntimeCheckResult {
        command: requirement.launcher.clone(),
        installed: resolved_path.is_some(),
        resolved_path: resolved_path.map(|path| path.to_string_lossy().to_string()),
        version,
        error: None,
    };

    RuntimeInspection {
        launcher: requirement.launcher.clone(),
        kind: requirement.kind.clone(),
        checks: vec![check],
        install_recipe: install_recipe_for(&requirement.kind, current_platform()),
    }
}

fn install_recipe_command(recipe_id: &str) -> Option<(&'static str, Vec<&'static str>)> {
    match recipe_id {
        "install-uv-macos" | "install-uv-linux" => Some((
            "sh",
            vec!["-lc", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
        )),
        "install-uv-windows" => Some((
            "powershell",
            vec!["-ExecutionPolicy", "Bypass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"],
        )),
        "install-bun-macos" | "install-bun-linux" => Some((
            "sh",
            vec!["-lc", "curl -fsSL https://bun.com/install | bash"],
        )),
        "install-bun-windows" => Some((
            "powershell",
            vec!["-c", "irm bun.com/install.ps1 | iex"],
        )),
        "install-node-volta-unix" => Some((
            "sh",
            vec![
                "-lc",
                "curl https://get.volta.sh | bash && export VOLTA_HOME=\"$HOME/.volta\" && export PATH=\"$VOLTA_HOME/bin:$PATH\" && volta install node",
            ],
        )),
        "install-node-volta-windows" => Some((
            "cmd",
            vec!["/C", "winget install Volta.Volta && volta install node"],
        )),
        _ => None,
    }
}

#[cfg(unix)]
fn configure_install_command(command: &mut TokioCommand) {
    command.process_group(0);
}

#[cfg(windows)]
fn configure_install_command(_command: &mut TokioCommand) {}

#[cfg(not(any(unix, windows)))]
fn configure_install_command(_command: &mut TokioCommand) {}

#[cfg(unix)]
async fn kill_install_process(pid: u32) -> Result<(), String> {
    let target = format!("-{pid}");
    TokioCommand::new("kill")
        .args(["-TERM", target.as_str()])
        .status()
        .await
        .map_err(|error| format!("Failed to send TERM to install process group: {error}"))?;
    Ok(())
}

#[cfg(windows)]
async fn kill_install_process(pid: u32) -> Result<(), String> {
    TokioCommand::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .await
        .map_err(|error| format!("Failed to stop install process tree: {error}"))?;
    Ok(())
}

#[cfg(not(any(unix, windows)))]
async fn kill_install_process(_pid: u32) -> Result<(), String> {
    Err("Install cancellation is not supported on this platform".to_string())
}

fn final_install_stage(success: bool, cancelled: bool) -> InstallProgressStage {
    if cancelled {
        InstallProgressStage::Cancelled
    } else if success {
        InstallProgressStage::Completed
    } else {
        InstallProgressStage::Failed
    }
}

fn emit_install_event<R: Runtime>(
    app: &AppHandle<R>,
    recipe_id: &str,
    stage: InstallProgressStage,
    stream: Option<&str>,
    line: Option<String>,
    exit_code: Option<i32>,
) -> Result<(), String> {
    app.emit(
        "mcp-runtime-install",
        InstallProgressEvent {
            recipe_id: recipe_id.to_string(),
            stage,
            stream: stream.map(str::to_string),
            line,
            exit_code,
        },
    )
    .map_err(|error| format!("Failed to emit install progress: {error}"))
}

async fn collect_process_output<R: Runtime>(
    app: AppHandle<R>,
    recipe_id: String,
    stream_name: &'static str,
    reader: impl tokio::io::AsyncRead + Unpin,
    buffer: Arc<Mutex<String>>,
) -> Result<(), String> {
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("Failed to read install output: {error}"))?
    {
        {
            let mut locked = buffer.lock().await;
            locked.push_str(&line);
            locked.push('\n');
        }

        emit_install_event(
            &app,
            &recipe_id,
            InstallProgressStage::Running,
            Some(stream_name),
            Some(line),
            None,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub async fn inspect_mcp_runtime(command: String, args: Vec<String>) -> Result<RuntimeInspection, String> {
    let requirement = classify_runtime_requirement(&command, &args);
    Ok(inspect_requirement(&requirement))
}

#[tauri::command]
pub async fn install_mcp_runtime(
    app: AppHandle,
    manager: State<'_, RuntimeInstallManager>,
    recipe_id: String,
) -> Result<InstallExecutionResult, String> {
    let (shell, args) = install_recipe_command(&recipe_id)
        .ok_or_else(|| format!("Unsupported install recipe: {recipe_id}"))?;

    emit_install_event(
        &app,
        &recipe_id,
        InstallProgressStage::Preparing,
        None,
        Some(format!("Starting install command: {shell} {}", args.join(" "))),
        None,
    )?;

    let mut command = TokioCommand::new(shell);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_install_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to execute install recipe: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to determine install process id".to_string())?;
    {
        let mut active_installs = manager.active_installs.lock().await;
        active_installs.insert(recipe_id.clone(), pid);
    }

    emit_install_event(
        &app,
        &recipe_id,
        InstallProgressStage::Running,
        None,
        Some("Install command is running...".to_string()),
        None,
    )?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture install stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture install stderr".to_string())?;

    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));

    let stdout_task = tokio::spawn(collect_process_output(
        app.clone(),
        recipe_id.clone(),
        "stdout",
        stdout,
        stdout_buffer.clone(),
    ));
    let stderr_task = tokio::spawn(collect_process_output(
        app.clone(),
        recipe_id.clone(),
        "stderr",
        stderr,
        stderr_buffer.clone(),
    ));

    let status = child
        .wait()
        .await
        .map_err(|error| format!("Failed to wait for install recipe: {error}"))?;

    stdout_task
        .await
        .map_err(|error| format!("Failed to collect stdout task: {error}"))??;
    stderr_task
        .await
        .map_err(|error| format!("Failed to collect stderr task: {error}"))??;

    {
        let mut active_installs = manager.active_installs.lock().await;
        active_installs.remove(&recipe_id);
    }

    let cancelled = {
        let mut cancelled_installs = manager.cancelled_installs.lock().await;
        cancelled_installs.remove(&recipe_id)
    };

    let success = status.success() && !cancelled;
    let exit_code = status.code();
    emit_install_event(
        &app,
        &recipe_id,
        final_install_stage(success, cancelled),
        None,
        Some(if cancelled {
            "Install command was cancelled.".to_string()
        } else if success {
            "Install command completed successfully.".to_string()
        } else {
            "Install command failed.".to_string()
        }),
        exit_code,
    )?;

    let stdout = stdout_buffer.lock().await.clone();
    let stderr = stderr_buffer.lock().await.clone();

    Ok(InstallExecutionResult {
        recipe_id,
        success,
        stdout,
        stderr,
        exit_code,
    })
}

#[tauri::command]
pub async fn cancel_mcp_runtime_install(
    app: AppHandle,
    manager: State<'_, RuntimeInstallManager>,
    recipe_id: String,
) -> Result<CancelInstallResult, String> {
    let pid = {
        let active_installs = manager.active_installs.lock().await;
        active_installs.get(&recipe_id).copied()
    };

    let Some(pid) = pid else {
        return Ok(CancelInstallResult {
            recipe_id,
            cancelled: false,
        });
    };

    {
        let mut cancelled_installs = manager.cancelled_installs.lock().await;
        cancelled_installs.insert(recipe_id.clone());
    }

    kill_install_process(pid).await?;

    emit_install_event(
        &app,
        &recipe_id,
        InstallProgressStage::Cancelled,
        None,
        Some("Cancellation requested by user.".to_string()),
        None,
    )?;

    Ok(CancelInstallResult {
        recipe_id,
        cancelled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_runtime_requirement, final_install_stage, install_recipe_for,
        InstallProgressStage, RuntimeInstallManager, RuntimeKind,
    };

    #[test]
    fn classifies_combined_npx_command() {
        let requirement = classify_runtime_requirement(
            "npx @modelcontextprotocol/server-filesystem",
            &[],
        );

        assert_eq!(requirement.launcher, "npx");
        assert_eq!(requirement.kind, RuntimeKind::Npx);
    }

    #[test]
    fn classifies_python_command_with_args() {
        let requirement = classify_runtime_requirement(
            "python3",
            &["-m".into(), "mcp_server".into()],
        );

        assert_eq!(requirement.launcher, "python3");
        assert_eq!(requirement.kind, RuntimeKind::Python3);
    }

    #[test]
    fn returns_macos_recipe_for_uvx() {
        let recipe = install_recipe_for(&RuntimeKind::Uvx, "macos")
            .expect("uvx should have a macOS install recipe");

        assert_eq!(recipe.id, "install-uv-macos");
    }

    #[test]
    fn uses_bun_dot_com_installer_for_bun() {
        let recipe = install_recipe_for(&RuntimeKind::Bunx, "macos")
            .expect("bunx should have a macOS install recipe");

        assert!(recipe.command_preview.contains("https://bun.com/install"));
    }

    #[test]
    fn returns_none_for_unknown_runtime() {
        let recipe = install_recipe_for(&RuntimeKind::Unknown, "macos");

        assert!(recipe.is_none());
    }

    #[test]
    fn final_install_stage_returns_completed_on_success() {
        assert_eq!(
            final_install_stage(true, false),
            InstallProgressStage::Completed
        );
    }

    #[test]
    fn final_install_stage_returns_failed_on_error() {
        assert_eq!(final_install_stage(false, false), InstallProgressStage::Failed);
    }

    #[test]
    fn final_install_stage_returns_cancelled_when_requested() {
        assert_eq!(final_install_stage(false, true), InstallProgressStage::Cancelled);
    }

    #[test]
    fn runtime_install_manager_starts_empty() {
        let manager = RuntimeInstallManager::new();

        assert!(manager.active_installs.try_lock().unwrap().is_empty());
        assert!(manager.cancelled_installs.try_lock().unwrap().is_empty());
    }
}
