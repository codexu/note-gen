use percent_encoding::percent_decode_str;
use reqwest_dav::{list_cmd::ListEntity, Auth, Client, ClientBuilder, Depth};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn create_client(url: &str, username: &str, password: &str) -> Result<Client, String> {
    let host_url = if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{}/", url)
    };

    ClientBuilder::new()
        .set_host(host_url)
        .set_auth(Auth::Basic(username.to_owned(), password.to_owned()))
        .build()
        .map_err(|e| format!("Failed to create WebDAV client: {}", e))
}

#[tauri::command]
pub async fn webdav_test(
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<bool, String> {
    let client = match create_client(&url, &username, &password) {
        Ok(client) => client,
        Err(e) => return Err(e),
    };

    let test_path = if path.starts_with('/') {
        path[1..].to_string()
    } else {
        path
    };

    match client.list(&test_path, Depth::Infinity).await {
        Ok(_) => Ok(true),
        Err(e) => {
            // 如果不存在目录则创建
            if let Err(create_err) = client.mkcol(&test_path).await {
                return Err(format!(
                    "Connection failed: {}, couldn't create directory: {}",
                    e, create_err
                ));
            }

            match client.list(&test_path, Depth::Infinity).await {
                Ok(_) => Ok(true),
                Err(e) => Err(format!("Connection failed: {}", e)),
            }
        }
    }
}

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

// 获取工作区路径信息
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

    let workspace_path = if store_workspace_path.is_empty() {
        ("article".to_string(), false)
    } else {
        (store_workspace_path.to_string(), true)
    };

    Ok(workspace_path)
}

// 获取本地文件路径
fn get_local_file_path(
    relative_path: &str,
    workspace_path: &str,
    is_custom_workspace: bool,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    if is_custom_workspace {
        Ok(PathBuf::from(workspace_path).join(relative_path))
    } else {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        Ok(app_data_dir.join(workspace_path).join(relative_path))
    }
}

// 确保目录存在
fn ensure_directory_exists(dir_path: &Path) -> Result<(), String> {
    if !dir_path.exists() {
        fs::create_dir_all(dir_path)
            .map_err(|e| format!("Failed to create directory {}: {}", dir_path.display(), e))?
    }
    Ok(())
}

#[tauri::command]
pub async fn webdav_backup(
    url: String,
    username: String,
    password: String,
    path: String,
    app: AppHandle,
) -> Result<String, String> {
    let client = match create_client(&url, &username, &password) {
        Ok(client) => client,
        Err(e) => return Err(e),
    };

    let webdav_path = if path.starts_with('/') {
        path[1..].to_string()
    } else {
        path.clone()
    };

    if let Err(_) = client.list(&webdav_path, Depth::Infinity).await {
        if let Err(e) = client.mkcol(&webdav_path).await {
            return Err(format!(
                "Failed to create directory on WebDAV server: {}",
                e
            ));
        }
    }

    let workspace_path = get_workspace_info(&app).await?;
    let markdown_files = get_markdown_files(&workspace_path.0, workspace_path.1, &app).await?;

    let mut success_count = 0;
    let total_files = markdown_files.len();

    for (relative_path, content) in markdown_files {
        let remote_path = format!("{}/{}", webdav_path.trim_end_matches('/'), relative_path);

        if let Some(parent) = Path::new(&remote_path).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            if !parent_str.is_empty() && parent_str != "." {
                if let Err(_) = client.list(&parent_str, Depth::Infinity).await {
                    if let Err(e) = client.mkcol(&parent_str).await {
                        return Err(format!(
                            "Failed to create directory {} on WebDAV server: {}",
                            parent_str, e
                        ));
                    }
                }
            }
        }

        let content_bytes = content.as_bytes().to_vec();
        if let Err(e) = client.put(&remote_path, content_bytes).await {
            return Err(format!(
                "Failed to upload file {} to WebDAV server: {}",
                relative_path, e
            ));
        }

        success_count += 1;
    }

    Ok(format!("{}/{}", success_count, total_files))
}

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

async fn get_webdav_markdown_files(
    entries: Vec<ListEntity>,
    webdav_path: &str,
    client: &Client,
) -> Result<Vec<(String, String)>, String> {
    let mut markdown_files: Vec<(String, String)> = Vec::new();

    // 遍历所有条目并提取Markdown文件路径
    for entry in entries {
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
                // 去除 WebDAV 基础路径 extract_prefix
                let prefix = extract_prefix(&folder_path, webdav_path);
                let path_for_request = folder_path.trim_start_matches(&prefix);
                // 递归获取子目录中的Markdown文件
                let entries = match client.list(&path_for_request, Depth::Infinity).await {
                    Ok(entries) => entries,
                    Err(e) => return Err(format!("Failed to list WebDAV directory: {}", e)),
                };

                // 如果 folder_path == prefix + webdav_path，说明是根目录，不进入循环

                if folder_path == prefix.clone() + webdav_path {
                    continue;
                }

                // Use Box::pin to handle recursive async call
                let sub_markdown_files = Box::pin(get_webdav_markdown_files(
                    entries,
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

#[tauri::command]
pub async fn webdav_sync(
    url: String,
    username: String,
    password: String,
    path: String,
    app: AppHandle,
) -> Result<String, String> {
    // 创建WebDAV客户端
    let client = match create_client(&url, &username, &password) {
        Ok(client) => client,
        Err(e) => return Err(e),
    };

    // 处理WebDAV路径
    let webdav_path = if path.starts_with('/') {
        path[1..].to_string()
    } else {
        path.clone()
    };

    // 检查WebDAV路径是否存在
    let entries = match client.list(&webdav_path, Depth::Infinity).await {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Failed to list WebDAV directory: {}", e)),
    };

    // 获取工作区路径信息
    let (workspace_dir, is_custom_workspace) = get_workspace_info(&app).await?;

    let mut success_count = 0;
    let markdown_files = get_webdav_markdown_files(entries, &webdav_path, &client).await?;

    let total_files = markdown_files.len();

    // 下载并保存文件
    for (remote_path, relative_path) in markdown_files {
        // 从完整路径中提取相对路径，去除URL前缀
        // 通过 remote_path 获取到 webdav_path 前的字符串
        let prefix = extract_prefix(&remote_path, &webdav_path);
        // 移除 remote_path 的 prefix 部分
        let path_for_request = remote_path.trim_start_matches(&prefix);

        // 获取文件内容 - 使用 path_for_request 而不是完整的URL路径
        let response = match client.get(path_for_request).await {
            Ok(response) => response,
            Err(e) => {
                eprintln!("Failed to download file {}: {}", remote_path, e);
                continue;
            }
        };

        // 获取响应体内容
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes.to_vec(),
            Err(e) => {
                eprintln!("Failed to read response body for {}: {}", remote_path, e);
                continue;
            }
        };

        let output_path = relative_path
            .trim_start_matches(&prefix.trim_start_matches('/'))
            .trim_start_matches(&webdav_path);

        // URL解码路径，确保中文字符正确处理
        let decoded_path = percent_decode_str(output_path)
            .decode_utf8()
            .unwrap_or_else(|_| output_path.into())
            .to_string();

        // 确定本地文件路径
        let local_file_path =
            get_local_file_path(&decoded_path, &workspace_dir, is_custom_workspace, &app)?;

        // 确保父目录存在
        if let Some(parent) = local_file_path.parent() {
            ensure_directory_exists(parent)?;
        }

        // 写入文件
        match fs::write(&local_file_path, &bytes) {
            Ok(_) => success_count += 1,
            Err(e) => eprintln!("Failed to write file {}: {}", local_file_path.display(), e),
        };
    }

    Ok(format!("{}/{}", success_count, total_files))
}
