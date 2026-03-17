use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use tauri::State;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// MCP 服务器进程管理器
pub struct McpServerManager {
    processes: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
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

fn read_mcp_message<R: Read>(reader: &mut R) -> Result<String, String> {
    let mut reader = BufReader::new(reader);
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

    let content_length =
        content_length.ok_or_else(|| format!("Unsupported MCP response prelude: {}", first_line_trimmed))?;
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
        format!("{}/.volta/bin/npx", std::env::var("HOME").unwrap_or_default()),
        // macOS/Linux - Homebrew
        "/usr/local/bin/npx".to_string(),
        "/opt/homebrew/bin/npx".to_string(),
        // macOS/Linux - nvm
        format!("{}/.nvm/versions/node/*/bin/npx", std::env::var("HOME").unwrap_or_default()),
        // macOS/Linux - 用户本地
        format!("{}/.local/bin/npx", std::env::var("HOME").unwrap_or_default()),
        format!("{}/bin/npx", std::env::var("HOME").unwrap_or_default()),
        // Windows - Volta
        format!("{}\\AppData\\Local\\Volta\\bin\\npx.cmd", std::env::var("USERPROFILE").unwrap_or_default()),
        // Windows - Node.js
        "C:\\Program Files\\nodejs\\npx.cmd".to_string(),
        format!("{}\\AppData\\Roaming\\npm\\npx.cmd", std::env::var("USERPROFILE").unwrap_or_default()),
    ];
    
    // 首先尝试从 PATH 环境变量中查找
    if let Ok(path_var) = std::env::var("PATH") {
        // Windows 使用分号，Unix 使用冒号
        let separator = if cfg!(target_os = "windows") { ';' } else { ':' };

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
    manager: State<'_, McpServerManager>,
) -> Result<String, String> {
    // 检查是否已经启动，如果已启动则先停止
    {
        let mut processes = manager.processes.lock().unwrap();
        if let Some(old_child) = processes.remove(&server_id) {
            if let Ok(mut old_child) = old_child.lock() {
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

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    let child = child;
    
    // 存储进程
    {
        let mut processes = manager.processes.lock().unwrap();
        processes.insert(server_id.clone(), Arc::new(Mutex::new(child)));
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

    if let Some(child) = child {
        let mut child = child.lock().unwrap();
        child.kill()
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
    manager: State<'_, McpServerManager>,
) -> Result<String, String> {
    let child = {
        let processes = manager.processes.lock().unwrap();
        processes.get(&server_id).cloned()
    };

    if let Some(child) = child {
        let mut child = child.lock().unwrap();
        // 获取 stdin 和 stdout
        let payload = encode_mcp_message(&message);
        {
            let stdin = child.stdin.as_mut()
                .ok_or("Failed to get stdin")?;
            stdin.write_all(&payload)
                .map_err(|e| format!("Failed to write framed MCP message: {}", e))?;
            
            stdin.flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        }

        let stdout = child.stdout.as_mut()
            .ok_or("Failed to get stdout")?;
        read_mcp_message(stdout)
    } else {
        Err(format!("Server {} not found", server_id))
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_mcp_message, read_mcp_message};
    use std::io::Cursor;

    #[test]
    fn writes_newline_delimited_message() {
        let body = r#"{"jsonrpc":"2.0","id":1}"#;
        let encoded = encode_mcp_message(body);

        assert_eq!(
            encoded,
            format!("{}\n", body).into_bytes()
        );
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
