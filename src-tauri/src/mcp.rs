use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// MCP 服务器进程管理器
pub struct McpServerManager {
    processes: Mutex<HashMap<String, Arc<McpProcess>>>,
}

struct McpProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>>,
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

fn encode_mcp_message(message: &str) -> Vec<u8> {
    format!("{}\n", message).into_bytes()
}

fn mcp_message_id(message: &str) -> Result<Option<String>, String> {
    let value = serde_json::from_str::<serde_json::Value>(message)
        .map_err(|e| format!("Invalid MCP JSON: {}", e))?;
    Ok(value.get("id").map(|id| {
        id.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| id.to_string())
    }))
}

fn read_mcp_message<R: BufRead>(reader: &mut R) -> Result<String, String> {
    let mut first_line = String::new();
    let bytes_read = reader
        .read_line(&mut first_line)
        .map_err(|e| format!("Failed to read MCP response: {}", e))?;

    if bytes_read == 0 {
        return Err("Unexpected EOF while reading MCP response".to_string());
    }

    let first_line_trimmed = first_line.trim();
    if first_line_trimmed.starts_with('{') {
        return Ok(first_line_trimmed.to_string());
    }

    let mut content_length: Option<usize> = None;
    if let Some((name, value)) = first_line_trimmed.split_once(':') {
        if name.eq_ignore_ascii_case("Content-Length") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|e| format!("Invalid Content-Length header: {}", e))?,
            );
        }
    }

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read MCP header: {}", e))?;

        if bytes_read == 0 {
            return Err("Unexpected EOF while reading MCP headers".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|e| format!("Invalid Content-Length header: {}", e))?,
                );
            }
        }
    }

    let content_length = content_length
        .ok_or_else(|| format!("Unsupported MCP response prelude: {}", first_line_trimmed))?;
    let mut body = vec![0; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|e| format!("Unexpected EOF while reading MCP body: {}", e))?;

    String::from_utf8(body).map_err(|e| format!("MCP body is not valid UTF-8: {}", e))
}

/// 查找 npx 的完整路径
fn find_npx_path() -> Option<String> {
    // 常见的 npx 安装路径
    let common_paths = vec![
        // macOS/Linux - Volta
        format!(
            "{}/.volta/bin/npx",
            std::env::var("HOME").unwrap_or_default()
        ),
        // macOS/Linux - Homebrew
        "/usr/local/bin/npx".to_string(),
        "/opt/homebrew/bin/npx".to_string(),
        // macOS/Linux - nvm
        format!(
            "{}/.nvm/versions/node/*/bin/npx",
            std::env::var("HOME").unwrap_or_default()
        ),
        // macOS/Linux - 用户本地
        format!(
            "{}/.local/bin/npx",
            std::env::var("HOME").unwrap_or_default()
        ),
        format!("{}/bin/npx", std::env::var("HOME").unwrap_or_default()),
        // Windows - Volta
        format!(
            "{}\\AppData\\Local\\Volta\\bin\\npx.cmd",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
        // Windows - Node.js
        "C:\\Program Files\\nodejs\\npx.cmd".to_string(),
        format!(
            "{}\\AppData\\Roaming\\npm\\npx.cmd",
            std::env::var("USERPROFILE").unwrap_or_default()
        ),
    ];

    // 首先尝试从 PATH 环境变量中查找
    if let Ok(path_var) = std::env::var("PATH") {
        // Windows 使用分号，Unix 使用冒号
        let separator = if cfg!(target_os = "windows") {
            ';'
        } else {
            ':'
        };

        // 在 Windows 上优先查找 npx.cmd
        if cfg!(target_os = "windows") {
            for path in path_var.split(separator) {
                let npx_cmd = PathBuf::from(path).join("npx.cmd");
                if npx_cmd.exists() {
                    return Some(npx_cmd.to_string_lossy().to_string());
                }
            }
            // 如果没找到 .cmd，再查找无扩展名的
            for path in path_var.split(separator) {
                let npx_path = PathBuf::from(path).join("npx");
                if npx_path.exists() {
                    return Some(npx_path.to_string_lossy().to_string());
                }
            }
        } else {
            // Unix 系统：先查找 npx，再查找 npx.cmd（如果存在）
            for path in path_var.split(separator) {
                let npx_path = PathBuf::from(path).join("npx");
                if npx_path.exists() {
                    return Some(npx_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // 检查常见路径
    for path in &common_paths {
        // 处理通配符路径（nvm）
        if path.contains('*') {
            if let Some(parent) = path.rsplit_once('/').map(|(p, _)| p) {
                if let Ok(entries) = std::fs::read_dir(parent.replace("/*", "")) {
                    for entry in entries.flatten() {
                        let npx_path = entry.path().join("bin/npx");
                        if npx_path.exists() {
                            let found = npx_path.to_string_lossy().to_string();
                            return Some(found);
                        }
                    }
                }
            }
        } else {
            let npx_path = PathBuf::from(&path);
            if npx_path.exists() {
                return Some(path.clone());
            }
        }
    }
    None
}

/// 启动 stdio 类型的 MCP 服务器
#[tauri::command]
pub async fn start_mcp_stdio_server(
    server_id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    app: tauri::AppHandle,
    manager: State<'_, McpServerManager>,
) -> Result<String, String> {
    // 检查是否已经启动，如果已启动则先停止
    {
        let mut processes = manager.processes.lock().unwrap();
        if let Some(old_process) = processes.remove(&server_id) {
            if let Ok(mut old_child) = old_process.child.lock() {
                let _ = old_child.kill();
            }
        }
    }

    // 处理 npx 命令 - 需要找到正确的 npx 路径
    let mut cmd = if command == "npx" || command.ends_with("/npx") || command.ends_with("\\npx") {
        // 尝试找到 npx 的完整路径
        let npx_path = find_npx_path();

        if let Some(npx) = npx_path {
            // 在 Windows 上，.cmd 和 .bat 文件需要通过 cmd.exe 执行
            #[cfg(target_os = "windows")]
            {
                if npx.ends_with(".cmd") || npx.ends_with(".bat") {
                    let mut cmd = Command::new("cmd");
                    cmd.args(&["/C", &npx]);
                    cmd.args(&args);
                    cmd
                } else {
                    let mut cmd = Command::new(&npx);
                    cmd.args(&args);
                    cmd
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                let mut cmd = Command::new(&npx);
                cmd.args(&args);
                cmd
            }
        } else {
            // 如果找不到 npx，尝试通过 shell 执行
            let full_command = if args.is_empty() {
                command.clone()
            } else {
                format!("{} {}", command, args.join(" "))
            };

            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(&["/C", &full_command]);
                cmd
            }

            #[cfg(not(target_os = "windows"))]
            {
                let mut cmd = Command::new("sh");
                cmd.args(&["-c", &full_command]);
                cmd
            }
        }
    } else {
        // 普通命令直接执行
        let mut cmd = Command::new(&command);
        cmd.args(&args);
        cmd
    };

    // 设置标准输入输出
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 设置环境变量
    for (key, value) in env {
        cmd.env(key, value);
    }

    // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止弹出控制台窗口
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::CREATE_NO_WINDOW;
        cmd.creation_flags(CREATE_NO_WINDOW.0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    let pending = Arc::new(Mutex::new(HashMap::<
        String,
        oneshot::Sender<Result<String, String>>,
    >::new()));
    let process = Arc::new(McpProcess {
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
        pending: pending.clone(),
    });

    let reader_server_id = server_id.clone();
    let reader_app = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_mcp_message(&mut reader) {
                Ok(message) => {
                    let parsed = serde_json::from_str::<serde_json::Value>(&message);
                    let request_id = mcp_message_id(&message).ok().flatten();
                    if let Some(request_id) = request_id {
                        if let Some(sender) = pending.lock().unwrap().remove(&request_id) {
                            let _ = sender.send(Ok(message));
                        }
                    } else {
                        let _ = reader_app.emit(
                            "mcp://notification",
                            serde_json::json!({ "serverId": &reader_server_id, "message": parsed.ok() }),
                        );
                    }
                }
                Err(error) => {
                    let mut waiting = pending.lock().unwrap();
                    for (_, sender) in waiting.drain() {
                        let _ = sender.send(Err(error.clone()));
                    }
                    let _ = reader_app.emit(
                        "mcp://closed",
                        serde_json::json!({ "serverId": &reader_server_id, "error": error }),
                    );
                    break;
                }
            }
        }
    });

    let stderr_server_id = server_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[MCP {}] {}", stderr_server_id, line);
        }
    });

    // 存储进程
    {
        let mut processes = manager.processes.lock().unwrap();
        processes.insert(server_id.clone(), process);
    }

    Ok(format!("Server {} started", server_id))
}

/// 停止 MCP 服务器
#[tauri::command]
pub async fn stop_mcp_server(
    server_id: String,
    manager: State<'_, McpServerManager>,
) -> Result<(), String> {
    let child = {
        let mut processes = manager.processes.lock().unwrap();
        processes.remove(&server_id)
    };

    if let Some(process) = child {
        let mut child = process.child.lock().unwrap();
        child
            .kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;

        Ok(())
    } else {
        Err(format!("Server {} not found", server_id))
    }
}

/// 发送 JSON-RPC 消息到 MCP 服务器
#[tauri::command]
pub async fn send_mcp_message(
    server_id: String,
    message: String,
    timeout_ms: Option<u64>,
    manager: State<'_, McpServerManager>,
) -> Result<String, String> {
    let child = {
        let processes = manager.processes.lock().unwrap();
        processes.get(&server_id).cloned()
    };

    if let Some(process) = child {
        let request_id = mcp_message_id(&message)?.ok_or("MCP request is missing an id")?;
        let (sender, receiver) = oneshot::channel();
        process
            .pending
            .lock()
            .unwrap()
            .insert(request_id.clone(), sender);
        let payload = encode_mcp_message(&message);
        {
            let mut stdin = process.stdin.lock().unwrap();
            stdin
                .write_all(&payload)
                .map_err(|e| format!("Failed to write framed MCP message: {}", e))?;

            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        }

        let timeout_ms = timeout_ms.unwrap_or(30_000);
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("MCP response channel closed".to_string()),
            Err(_) => {
                process.pending.lock().unwrap().remove(&request_id);
                Err(format!("MCP request timed out after {}ms", timeout_ms))
            }
        }
    } else {
        Err(format!("Server {} not found", server_id))
    }
}

/// 向 stdio MCP 服务器发送无需响应的 JSON-RPC notification。
#[tauri::command]
pub async fn send_mcp_notification(
    server_id: String,
    message: String,
    manager: State<'_, McpServerManager>,
) -> Result<(), String> {
    let child = {
        let processes = manager.processes.lock().unwrap();
        processes.get(&server_id).cloned()
    };

    if let Some(process) = child {
        let mut stdin = process.stdin.lock().unwrap();
        stdin
            .write_all(&encode_mcp_message(&message))
            .map_err(|e| format!("Failed to write MCP notification: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush MCP notification: {}", e))?;
        Ok(())
    } else {
        Err(format!("Server {} not found", server_id))
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_mcp_message, mcp_message_id, read_mcp_message};
    use std::io::Cursor;

    #[test]
    fn writes_newline_delimited_message() {
        let body = r#"{"jsonrpc":"2.0","id":1}"#;
        let encoded = encode_mcp_message(body);

        assert_eq!(encoded, format!("{}\n", body).into_bytes());
    }

    #[test]
    fn extracts_numeric_response_id() {
        let id = mcp_message_id(r#"{"jsonrpc":"2.0","id":42,"result":{}}"#).expect("valid JSON");
        assert_eq!(id.as_deref(), Some("42"));
    }

    #[test]
    fn leaves_notification_without_response_id() {
        let id = mcp_message_id(r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#)
            .expect("valid JSON");
        assert_eq!(id, None);
    }

    #[test]
    fn reads_single_json_line_message() {
        let body = r#"{"jsonrpc":"2.0","result":{"ok":true}}"#;
        let payload = format!("{}\n", body);
        let mut cursor = Cursor::new(payload.into_bytes());

        let read = read_mcp_message(&mut cursor).expect("should parse json line body");

        assert_eq!(read, body);
    }

    #[test]
    fn reads_single_framed_message() {
        let body = r#"{"jsonrpc":"2.0","result":{"ok":true}}"#;
        let payload = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut cursor = Cursor::new(payload.into_bytes());

        let read = read_mcp_message(&mut cursor).expect("should parse framed body");

        assert_eq!(read, body);
    }

    #[test]
    fn rejects_missing_content_length_header() {
        let payload = b"X-Test: 1\r\n\r\n{}".to_vec();
        let mut cursor = Cursor::new(payload);

        let error = read_mcp_message(&mut cursor).expect_err("should reject invalid frame");

        assert!(error.contains("Unsupported MCP response prelude"));
    }

    #[test]
    fn rejects_truncated_framed_message() {
        let payload = b"Content-Length: 10\r\n\r\n{}".to_vec();
        let mut cursor = Cursor::new(payload);

        let error = read_mcp_message(&mut cursor).expect_err("should reject short body");

        assert!(error.contains("Unexpected EOF"));
    }
}
