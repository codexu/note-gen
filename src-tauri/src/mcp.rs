use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use tauri::State;

/// MCP 服务器进程管理器
pub struct McpServerManager {
    processes: Mutex<HashMap<String, Child>>,
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
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
        
        for path in path_var.split(separator) {
            let npx_path = PathBuf::from(path).join("npx");
            if npx_path.exists() {
                let found = npx_path.to_string_lossy().to_string();
                println!("Found npx in PATH: {}", found);
                return Some(found);
            }
            // Windows 版本
            let npx_cmd = PathBuf::from(path).join("npx.cmd");
            if npx_cmd.exists() {
                let found = npx_cmd.to_string_lossy().to_string();
                println!("Found npx.cmd in PATH: {}", found);
                return Some(found);
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
    println!("Starting MCP stdio server: {} with command: {}", server_id, command);
    
    // 检查是否已经启动，如果已启动则先停止
    {
        let mut processes = manager.processes.lock().unwrap();
        if let Some(mut old_child) = processes.remove(&server_id) {
            // 尝试停止旧进程
            let _ = old_child.kill();
            println!("Stopped existing MCP server: {}", server_id);
        }
    }
    
    // 处理 npx 命令 - 需要找到正确的 npx 路径
    let mut cmd = if command == "npx" || command.ends_with("/npx") {
        // 尝试找到 npx 的完整路径
        let npx_path = find_npx_path();
        
        if let Some(npx) = npx_path {
            println!("Using npx at: {}", npx);
            println!("Executing: {} {:?}", npx, args);
            let mut cmd = Command::new(&npx);
            cmd.args(&args);
            cmd
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
    
    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;
    
    // 存储进程
    {
        let mut processes = manager.processes.lock().unwrap();
        processes.insert(server_id.clone(), child);
    }
    
    Ok(format!("Server {} started", server_id))
}

/// 停止 MCP 服务器
#[tauri::command]
pub async fn stop_mcp_server(
    server_id: String,
    manager: State<'_, McpServerManager>,
) -> Result<(), String> {
    
    let mut processes = manager.processes.lock().unwrap();
    
    if let Some(mut child) = processes.remove(&server_id) {
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
    
    let mut processes = manager.processes.lock().unwrap();
    
    if let Some(child) = processes.get_mut(&server_id) {
        // 获取 stdin 和 stdout
        let stdin = child.stdin.as_mut()
            .ok_or("Failed to get stdin")?;
        let stdout = child.stdout.as_mut()
            .ok_or("Failed to get stdout")?;
        
        // 发送消息（JSON-RPC 通过换行符分隔）
        writeln!(stdin, "{}", message)
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        
        stdin.flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        
        // 读取响应 - 支持 SSE 格式和标准 JSON-RPC 格式
        let mut reader = BufReader::new(stdout);
        let mut lines = Vec::new();
        
        // 读取直到遇到空行（SSE 消息结束标志）或有效的 JSON
        loop {
            let mut line = String::new();
            reader.read_line(&mut line)
                .map_err(|e| format!("Failed to read from stdout: {}", e))?;
            
            let trimmed = line.trim();
            
            // 如果是空行，表示 SSE 消息结束
            if trimmed.is_empty() {
                break;
            }
            
            // 如果第一行就是有效的 JSON，直接返回（标准 JSON-RPC）
            if lines.is_empty() && trimmed.starts_with('{') {
                return Ok(trimmed.to_string());
            }
            
            lines.push(line);
        }
        
        // 解析 SSE 格式：查找 data: 开头的行
        for line in &lines {
            let trimmed = line.trim();
            if trimmed.starts_with("data: ") {
                let json_data = trimmed.strip_prefix("data: ").unwrap_or("");
                return Ok(json_data.to_string());
            }
        }
        
        // 如果没有找到 data: 行，返回所有行的组合
        Ok(lines.join("\n").trim().to_string())
    } else {
        Err(format!("Server {} not found", server_id))
    }
}
