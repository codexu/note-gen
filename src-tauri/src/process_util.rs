use tokio::process::Command as TokioCommand;

#[cfg(unix)]
pub fn configure_process_group(command: &mut TokioCommand) {
    command.process_group(0);
}

#[cfg(not(unix))]
pub fn configure_process_group(_command: &mut TokioCommand) {}

#[cfg(unix)]
pub async fn terminate_process_tree(pid: u32, force: bool) -> Result<(), String> {
    let signal = if force { "-KILL" } else { "-TERM" };
    let status = TokioCommand::new("kill")
        .args([signal, &format!("-{pid}")])
        .status()
        .await
        .map_err(|error| format!("Failed to stop process group: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to stop process group (pid {pid})"))
    }
}

#[cfg(windows)]
pub async fn terminate_process_tree(pid: u32, force: bool) -> Result<(), String> {
    let mut command = TokioCommand::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T"]);
    if force {
        command.arg("/F");
    }
    let status = command
        .status()
        .await
        .map_err(|error| format!("Failed to stop process tree: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to stop process tree (pid {pid})"))
    }
}

#[cfg(not(any(unix, windows)))]
pub async fn terminate_process_tree(_pid: u32, _force: bool) -> Result<(), String> {
    Err("Process cancellation is not supported on this platform".to_string())
}
