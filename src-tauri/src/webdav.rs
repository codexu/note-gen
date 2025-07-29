use percent_encoding::percent_decode_str;
use reqwest_dav::{list_cmd::ListEntity, Auth, Client, ClientBuilder, Depth};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use std::net::SocketAddr;
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use tokio::net::lookup_host;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use url::Url;

//全局变量
static WEBDAV_DEPTH_STRATEGY: AtomicU32 = AtomicU32::new(1);

//超时控制
async fn test_depth_with_timeout(
    client: &Client,
    path: &str,
    depth: Depth,
    timeout_secs: u64,
) -> bool {
    timeout(Duration::from_secs(timeout_secs), client.list(path, depth))
        .await
        .map(|result| result.is_ok())
        .unwrap_or(false)
}


// WebDAV客户端创建：建立连接并验证服务器可达性
pub async fn create_client(url: &str, username: &str, password: &str) -> Result<Client, String> {
    
    // 超时时间
    const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);

    // URL解析
    let parsed_url = Url::parse(url).map_err(|e| format!("URL 解析失败: {}", e))?;

    // 核心逻辑：根据 Scheme 决定连接策略
    if parsed_url.scheme() == "https" {
      
        // 1. 创建带超时的 reqwest 客户端
        let http_client = reqwest_dav::re_exports::reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(Duration::from_secs(30)) // 为整个请求设置一个更长的超时
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        // 2. 将原始 URL 和配置好的客户端传递给 ClientBuilder
        ClientBuilder::new()
            .set_host(url.to_string()) // 直接使用原始 URL
            .set_auth(Auth::Basic(username.to_owned(), password.to_owned()))
            .set_agent(http_client) // 使用 set_agent 注入配置
            .build()
            .map_err(|e| format!("创建 WebDAV 客户端失败: {}", e))

    } else {
        // --- HTTP 策略继续使用 IP 直连可以避免一些 DNS 问题

        let host = parsed_url
            .host_str()
            .ok_or_else(|| "URL 中未找到主机名".to_string())?;
        let port = parsed_url
            .port_or_known_default()
            .ok_or_else(|| "URL 中缺少有效的端口".to_string())?;

        // DNS解析获取IP地址
        let dns_lookup_future = lookup_host(format!("{}:{}", host, port));
        let addrs: Vec<SocketAddr> = match timeout(CONNECT_TIMEOUT, dns_lookup_future).await {
            Ok(Ok(addrs)) => addrs.collect(),
            Ok(Err(e)) => return Err(format!("DNS 解析失败: {}", e)),
            Err(_) => return Err(format!("DNS 解析超时 ({} 秒)", CONNECT_TIMEOUT.as_secs())),
        };

        if addrs.is_empty() {
            return Err(format!("DNS 解析未返回任何 IP 地址 for {}", host));
        }
        let final_ip_addr = addrs
            .iter()
            .find(|addr| addr.is_ipv6())
            .unwrap_or(&addrs[0]);

        // TCP连接测试
        let preflight_future = TcpStream::connect(final_ip_addr);
        match timeout(CONNECT_TIMEOUT, preflight_future).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => return Err(format!("服务器连接被拒绝: {}", e)),
            Err(_) => return Err(format!("服务器连接超时 ({} 秒)", CONNECT_TIMEOUT.as_secs())),
        }

        // WebDAV客户端构建
        let host_url = format!("{}://{}/", parsed_url.scheme(), final_ip_addr);
    ClientBuilder::new()
        .set_host(host_url)
        .set_auth(Auth::Basic(username.to_owned(), password.to_owned()))
        .build()
            .map_err(|e| format!("创建 WebDAV 客户端失败: {}", e))
    }
}



// WebDAV连接测试：验证连接并检测服务器深度支持
#[tauri::command]
pub async fn webdav_test(
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<bool, String> {
    let client = create_client(&url, &username, &password).await?;
    let test_path = normalize_path(&path, true);

    // 优先尝试 Depth::Infinity
    if test_depth_with_timeout(&client, &test_path, Depth::Infinity, 2).await {
        println!("Server supports Depth::Infinity. Setting global strategy to 0.");
        WEBDAV_DEPTH_STRATEGY.store(0, Ordering::SeqCst);
        return Ok(true);
    }

    // 降级尝试 Depth::Number(1)
    if test_depth_with_timeout(&client, &test_path, Depth::Number(1), 2).await {
        println!("Server supports Depth::1. Setting global strategy to 1.");
        WEBDAV_DEPTH_STRATEGY.store(1, Ordering::SeqCst);
        return Ok(true);
    }

    // 深度检测失败返回连接错误
    Err(format!(
        "[ERR_PATH_NOT_FOUND] Path may not exist or credentials are wrong"
    ))
}

//WebDAV 备份命令
#[tauri::command]
pub async fn webdav_backup(
    url: String,
    username: String,
    password: String,
    path: String,
    app: AppHandle,
) -> Result<String, String> {
    // 客户端初始化
    let client = create_client(&url, &username, &password).await?; 
    let webdav_path = normalize_path(&path, true);

    // 在准备上传文件前，确保根备份目录存在
   if !webdav_path.is_empty() {
        if let Err(e) = ensure_path_exists_recursively(&client, &webdav_path).await {
            return Err(format!("创建远程根目录失败: {}", e));
        }
    }

    // 获取本地工作区信息和文件列表
    let (workspace_dir, is_custom_workspace) = get_workspace_info(&app).await?;
    let markdown_files = get_markdown_files(&workspace_dir, is_custom_workspace, &app).await?;
    let total_files = markdown_files.len();
    let mut success_count = 0;
    
    // 批量上传文件到远程服务器
   for (relative_path, content) in markdown_files {
        let remote_path = build_remote_path(&webdav_path, &relative_path);


        // 确保文件自身的父目录存在
        if let Some(parent) = get_parent_path(&remote_path) {
            
            if let Err(e) = ensure_path_exists_recursively(&client, &parent).await {
                return Err(format!("为文件 {} 创建父目录失败: {}", remote_path, e));
            }
        }

        // 上传文件
        let content_bytes = content.as_bytes().to_vec();
        match client.put(&remote_path, content_bytes).await {
            Ok(_) => success_count += 1,
            Err(e) => return Err(format!("上传文件 {} 失败: {}", relative_path, e)),
        }
    }


    Ok(format!("{}/{}", success_count, total_files))
}

// WebDAV 同步命令
#[tauri::command]
pub async fn webdav_sync(
    url: String,
    username: String,
    password: String,
    path: String,
    app: AppHandle,
) -> Result<String, String> {
    // 客户端初始化
    let client = create_client(&url, &username, &password).await?; 
    let webdav_path = normalize_path(&path, true);

    // 远程路径存在性检查
    let entries = match client.list(&webdav_path, Depth::Number(1)).await {
        Ok(entries) => entries,
        Err(e) => {
            let error_string = e.to_string();
            if error_string.contains("NotFound") {
                return Err(format!("[ERR_PATH_NOT_FOUND] {}", path));
            } else {
                return Err(format!("Failed to list WebDAV directory: {}", error_string));
            }
        }
    };

    // 本地工作区信息获取
    let (workspace_dir, _is_custom_workspace) = get_workspace_info(&app).await?;
    let base_workspace_path = PathBuf::from(workspace_dir);

    // 远程文件列表获取
    let markdown_files = get_webdav_markdown_files(entries, &webdav_path, &client).await?;
    let total_files = markdown_files.len();

    if total_files == 0 {
        return Ok("0/0".to_string());
    }

    //批量下载并保存文件
    let mut success_count = 0;
    
    for (remote_path, relative_path) in markdown_files {
        // 下载路径处理
        let prefix = extract_prefix(&remote_path, &webdav_path);
        let path_for_request = remote_path.trim_start_matches(&prefix);

        // 文件内容下载
        let bytes = match client.get(path_for_request).await {
            Ok(response) => {
                match response.bytes().await {
                    Ok(bytes) => bytes.to_vec(),
                    Err(e) => {
                        eprintln!("读取响应体失败 {}: {}", remote_path, e);
                        continue;
                    }
                }
            }
            Err(e) => {
                eprintln!("下载文件失败 {}: {}", remote_path, e);
                continue;
            }
        };

        // 本地保存路径处理
        let local_file_path = match process_local_path(&relative_path, &base_workspace_path) {
            Ok(path) => path,
        Err(e) => {
                eprintln!("路径处理失败 {}: {}", relative_path, e);
                continue;
            }
        };

        // 文件写入本地磁盘
        if save_file_to_disk(&local_file_path, &bytes).is_ok() {
            success_count += 1;
        }
    }

    Ok(format!("{}/{}", success_count, total_files))
}

//处理本地保存路径
fn process_local_path(
    relative_path: &str,
    base_workspace_path: &PathBuf,
) -> Result<PathBuf, String> {
    // URL 解码
    let decoded_relative_path = percent_decode_str(relative_path)
        .decode_utf8()
        .unwrap_or_else(|_| relative_path.into())
        .to_string();

    let relative_path_obj = Path::new(&decoded_relative_path);

    // 安全检查：拒绝绝对路径
    if relative_path_obj.is_absolute() {
        return Err(format!("安全警告：检测到绝对路径 '{}' 已跳过", decoded_relative_path));
    }

    // 规范化路径
    let sanitized_path: PathBuf = relative_path_obj.components().collect();
    let local_file_path = base_workspace_path.join(sanitized_path);

    // 防止路径逃逸
    if !local_file_path.starts_with(base_workspace_path) {
        return Err(format!("安全警告：路径逃逸 '{}' 已跳过", local_file_path.display()));
    }

    Ok(local_file_path)
}

// 保存文件到磁盘
fn save_file_to_disk(local_file_path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    // 确保父目录存在
    if let Some(parent) = local_file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建本地目录失败: {}", e))?;
        }
    }

    // 写入文件
    fs::write(local_file_path, bytes)
        .map_err(|e| {
            eprintln!("写入文件失败 {}: {}", local_file_path.display(), e);
            format!("写入文件失败: {}", e)
        })
}


// WebDAV 创建目录
#[tauri::command]
pub async fn webdav_create_dir(
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<(), String> {
    let client = create_client(&url, &username, &password).await?;
    let parts: Vec<&str> = path.trim().split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Ok(());
    }
    let mut current_path = String::new();

    //逐个创建路径中的目录
    for part in parts {
        current_path.push_str(part);
        let path_for_request = format!("{}/", current_path);

        match client.list(&path_for_request, Depth::Number(0)).await {
            Ok(_) => {
                // 目录已存在，在 current_path 后加上斜杠，为下一轮循环做准备
                current_path.push('/');
                continue;
            }
            Err(_) => {
                // 目录不存在尝试创建
                if let Err(e) = client.mkcol(&path_for_request).await {
                    return Err(format!("创建目录 '{}' 失败: {}", path_for_request, e));
                }
                current_path.push('/');
        }
    }
}

    Ok(())
}


//辅助函数：获取本地 Markdown文件
async fn get_markdown_files(
    dir_path: &str,
    is_custom_workspace: bool,
    app_handle: &AppHandle,
) -> Result<Vec<(String, String)>, String> {
    Box::pin(_get_markdown_files(
        dir_path,
        is_custom_workspace,
        app_handle,
    ))
    .await
}
async fn _get_markdown_files(
    dir_path: &str,
    is_custom_workspace: bool,
    app_handle: &AppHandle,
) -> Result<Vec<(String, String)>, String> {
    let mut markdown_files = Vec::new();

    let entries = if is_custom_workspace {
        fs::read_dir(dir_path)
            .map_err(|e| format!("Failed to read directory {}: {}", dir_path, e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect directory entries: {}", e))?
    } else {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        let full_path = app_data_dir.join(dir_path);
        fs::read_dir(full_path)
            .map_err(|e| format!("Failed to read directory {}: {}", dir_path, e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect directory entries: {}", e))?
    };

    for entry in entries {
        let path = entry.path();
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();

        if path.is_dir() && !file_name.starts_with(".") {
            let sub_dir_path = path.to_string_lossy().to_string();
            let sub_files = Box::pin(_get_markdown_files(
                &sub_dir_path,
                is_custom_workspace,
                app_handle,
            ))
            .await?;
            markdown_files.extend(sub_files);
        } else if path.is_file() && file_name.ends_with(".md") && !file_name.starts_with(".") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))?;

            let relative_path = if is_custom_workspace {
                let workspace_path = dir_path.trim_end_matches('/');
                path.to_string_lossy()
                    .trim_start_matches(workspace_path)
                    .trim_start_matches('/')
                    .to_string()
            } else {
                let app_data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("Failed to get app data dir: {}", e))?;
                let article_dir = app_data_dir.join("article");
                path.strip_prefix(&article_dir)
                    .map_err(|e| format!("Failed to get relative path: {}", e))?
                    .to_string_lossy()
                    .to_string()
            };

            markdown_files.push((relative_path, content));
        }
    }

    Ok(markdown_files)
}

//辅助函数：获取远程 Markdown文件
async fn get_webdav_markdown_files(
    entries: Vec<ListEntity>,
    webdav_path: &str,
    client: &Client,
) -> Result<Vec<(String, String)>, String> {
    let mut markdown_files: Vec<(String, String)> = Vec::new();

    // 遍历所有条目并提取Markdown文件路径
    for entry in &entries.clone() {
        // 使用序列化格式提取路径
        let entry_json = serde_json::to_value(entry).unwrap_or(serde_json::Value::Null);

        // 处理嵌套结构，提取href字段
        // 处理文件
        if let Some(file) = entry_json.get("File") {
            // 从 File 对象中提取 href
            if let Some(href) = file.get("href").and_then(|v| v.as_str()) {
                let path_str = href.to_string();

                // 只处理Markdown文件
                if path_str.ends_with(".md") {
                    // 解码URL并提取文件名
                    let decoded_path = percent_decode_str(&path_str).decode_utf8_lossy();
                    let file_name = decoded_path.split('/').last().unwrap_or("");
                    
                    // 过滤以"."开头的文件
                    if file_name.starts_with(".") {
                        continue;
                    }
                    
                    // 计算相对路径，去除WebDAV基础路径
                    let relative_path = if path_str.starts_with(webdav_path) {
                        path_str[webdav_path.len()..].trim_start_matches('/')
                    } else {
                        path_str.trim_start_matches('/')
                    }
                    .to_string();

                    if !relative_path.is_empty() {
                        markdown_files.push((path_str, relative_path));
                    }
                }
            }
        }
        // 处理文件夹
        else if let Some(folder) = entry_json.get("Folder") {
            // 从 Folder 对象中提取 href
            if let Some(href) = folder.get("href").and_then(|v| v.as_str()) {
                let folder_path = href.to_string();
                
                // 解码URL并提取文件夹名称
                let decoded_path = percent_decode_str(&folder_path).decode_utf8_lossy();
                let folder_name = decoded_path.split('/').last().unwrap_or("");
                
                // 过滤以"."开头的文件夹
                if folder_name.starts_with(".") {
                    continue;
                }
                
                // 去除 WebDAV 基础路径 extract_prefix
                let prefix = extract_prefix(&folder_path, webdav_path);
                let path_for_request = folder_path.trim_start_matches(&prefix);
                // 递归获取子目录中的Markdown文件
                let strategy_value = WEBDAV_DEPTH_STRATEGY.load(Ordering::SeqCst);
                let sub_entries = if strategy_value == 0 {
                    match client.list(&path_for_request, Depth::Infinity).await {
                    Ok(entries) => entries,
                        Err(e) => {
                            eprintln!("Failed to list directory {}: {}", path_for_request, e);
                            continue; // 跳过这个目录，不中断整个过程
                        }
                    }
                } else {
                    match client.list(&path_for_request, Depth::Number(1)).await {
                        Ok(entries) => entries,
                        Err(e) => {
                            eprintln!("Failed to list directory {}: {}", path_for_request, e);
                            continue;
                        }
                    }
                };

                // 如果 folder_path == prefix + webdav_path，说明是根目录，不进入循环

                if folder_path == prefix.clone() + webdav_path {
                    continue;
                }

                // Use Box::pin to handle recursive async call
                let sub_markdown_files = Box::pin(get_webdav_markdown_files(
                    sub_entries,
                    &path_for_request,
                    client,
                ))
                .await?;

                // 将子目录中的Markdown文件添加到结果中
                markdown_files.extend(sub_markdown_files);
            }
        }

        // 已经在各自的分支中处理了文件和文件夹
    }

    Ok(markdown_files)
}

// 辅助函数：获取工作区路径信息
async fn get_workspace_info(app: &AppHandle) -> Result<(String, bool), String> {
   let store_path = app
       .path()
       .app_config_dir()
       .map_err(|e| format!("Failed to get config dir: {}", e))?
       .join("store.json");

   let store_contents =
       fs::read_to_string(&store_path).map_err(|e| format!("Failed to read store file: {}", e))?;

   let store_json: serde_json::Value = serde_json::from_str(&store_contents)
       .map_err(|e| format!("Failed to parse store JSON: {}", e))?;

   let store_workspace_path = store_json
       .get("workspacePath")
       .and_then(|v| v.as_str())
       .unwrap_or("article");

   let workspace_path = if store_workspace_path.is_empty() || store_workspace_path == "article" {
       // 默认工作区：使用应用数据目录
       let app_data_dir = app
           .path()
           .app_data_dir()
           .map_err(|e| format!("Failed to get app data dir: {}", e))?;
       let default_path = app_data_dir.join("article");
       (default_path.to_string_lossy().to_string(), false)
    } else {
       // 自定义工作区：使用用户指定路径
       (store_workspace_path.to_string(), true)
    };

   Ok(workspace_path)
}

// 辅助函数：确保远程目录存在
async fn ensure_path_exists_recursively(client: &Client, path: &str) -> Result<(), String> {
    // 处理空路径情况
    if path.trim().is_empty() {
        // 空路径检查根目录是否可访问
        return match client.list("", Depth::Number(0)).await {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("根目录不可访问: {}", e)),
    };
    }

    // 处理非空路径
    let parts: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    let mut current_path = String::new();

    for part in parts {
        if !current_path.is_empty() {
            current_path.push('/');
        }
        current_path.push_str(part);

        // 检查目录是否存在
        match client.list(&current_path, Depth::Number(0)).await {
            Ok(_) => continue,
            Err(_) => {
                // 创建目录
                if let Err(e) = client.mkcol(&format!("{}/", current_path)).await {
                    return Err(format!("创建目录 '{}' 失败: {}", current_path, e));
                }
            }
        }
    }
    Ok(())
}

// 辅助函数：规范化文件路径
fn normalize_path(path: &str, remove_leading_slash: bool) -> String {
    if path.trim().is_empty() {
        return String::new();
            }

    let mut normalized = path.trim().replace('\\', "/");
    if remove_leading_slash {
        normalized = normalized.trim_start_matches('/').to_string();
    }
    normalized
}

// 辅助函数：获取父路径
fn get_parent_path(path: &str) -> Option<String> {
    let normalized = normalize_path(path,false);
    if let Some(last_slash) = normalized.rfind('/') {
        if last_slash == 0 {
            return None; // 根目录
        }
        Some(normalized[..last_slash].to_string())
    } else {
        None
    }
}

// 辅助函数：远程路径构建
fn build_remote_path(base_path: &str, relative_path: &str) -> String {
    if base_path.is_empty() {
        normalize_path(relative_path, false)
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), normalize_path(relative_path, false))
    }
        }

// 辅助函数：提取前缀
fn extract_prefix(remote_path: &str, webdav_path: &str) -> String {
    // 确保 webdav_path 不以 '/' 开头，因为我们想匹配中间部分
    let webdav_path_trimmed = webdav_path.trim_start_matches('/');

    // 查找 webdav_path 在 remote_path 中的位置
    if let Some(pos) = remote_path.find(webdav_path_trimmed) {
        // 提取前缀部分
        remote_path[..pos].to_string()
    } else {
        "".to_string()
    }
}
