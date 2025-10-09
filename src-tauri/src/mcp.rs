use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::io::{BufRead, BufReader, Write};
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
    
    // 检查是否已经启动
    {
        let processes = manager.processes.lock().unwrap();
        if processes.contains_key(&server_id) {
            return Err(format!("Server {} is already running", server_id));
        }
    }
    
    // 启动进程
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .stdin(Stdio::piped())
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
    
    println!("MCP server {} started successfully", server_id);
    Ok(format!("Server {} started", server_id))
}

/// 停止 MCP 服务器
#[tauri::command]
pub async fn stop_mcp_server(
    server_id: String,
    manager: State<'_, McpServerManager>,
) -> Result<(), String> {
    println!("Stopping MCP server: {}", server_id);
    
    let mut processes = manager.processes.lock().unwrap();
    
    if let Some(mut child) = processes.remove(&server_id) {
        child.kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
        
        println!("MCP server {} stopped", server_id);
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
    println!("Sending message to MCP server {}: {}", server_id, message);
    
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
        
        // 读取响应
        let mut reader = BufReader::new(stdout);
        let mut response = String::new();
        reader.read_line(&mut response)
            .map_err(|e| format!("Failed to read from stdout: {}", e))?;
        
        println!("Received response from MCP server {}: {}", server_id, response);
        Ok(response.trim().to_string())
    } else {
        Err(format!("Server {} not found", server_id))
    }
}
