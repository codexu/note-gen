use crate::skills::{
    inspect_remote_skill_archive, install_remote_skill_directory, parse_remote_skill_metadata,
    RemoteSkillWarning, SkillImportScope, MAX_REMOTE_ZIP_BYTES,
};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, CONTENT_LENGTH, RANGE, USER_AGENT};
use reqwest::{Client, Proxy, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const GITHUB_API_VERSION: &str = "2022-11-28";
const MAX_SEARCH_RESULTS: usize = 15;
const MAX_REMOTE_SKILL_FILES: usize = 10_000;
const PREVIEW_EVENT: &str = "remote-skill-download-progress";

#[derive(Default)]
pub struct RemoteSkillManager {
    previews: Mutex<HashMap<String, RemoteSkillPreviewReceipt>>,
    downloads: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRemoteSkillsRequest {
    query: String,
    limit: Option<usize>,
    github_token: Option<String>,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectRemoteSkillRequest {
    source: String,
    request_id: String,
    github_token: Option<String>,
    gitlab_token: Option<String>,
    gitee_token: Option<String>,
    proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRemoteSkillRequest {
    preview_id: String,
    scope: SkillImportScope,
    workspace_root: Option<String>,
    #[serde(default)]
    replace_existing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillSearchResult {
    name: String,
    description: String,
    repository: String,
    path: String,
    source_url: String,
    stars: u64,
    provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillPreview {
    preview_id: String,
    name: String,
    description: String,
    provider: String,
    source_url: String,
    repository: Option<String>,
    revision: String,
    skill_path: Option<String>,
    files: Vec<String>,
    total_bytes: u64,
    has_scripts: bool,
    skipped_symlinks: Vec<String>,
    warnings: Vec<RemoteSkillWarning>,
    archive_sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSkillInstallResult {
    name: String,
    scope: String,
    provider: String,
    source_url: String,
    revision: String,
    archive_sha256: String,
    replaced: bool,
    has_scripts: bool,
    skipped_symlinks: Vec<String>,
    warnings: Vec<RemoteSkillWarning>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteSkillProgress {
    request_id: String,
    phase: String,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

#[derive(Clone)]
struct RemoteSkillPreviewReceipt {
    name: String,
    provider: String,
    source_url: String,
    repository: Option<String>,
    revision: String,
    skill_path: Option<String>,
    archive_path: PathBuf,
    archive_sha256: String,
    preview_dir: PathBuf,
    skill_root: PathBuf,
    has_scripts: bool,
    skipped_symlinks: Vec<String>,
    warnings: Vec<RemoteSkillWarning>,
}

#[derive(Clone, Default)]
struct RemoteCredentials {
    github_token: Option<String>,
    gitlab_token: Option<String>,
    gitee_token: Option<String>,
    proxy_url: Option<String>,
}

#[derive(Clone)]
enum SourceProvider {
    Github,
    Gitlab,
    Gitee,
    Gitea,
    DirectZip,
}

impl SourceProvider {
    fn id(&self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitlab => "gitlab",
            Self::Gitee => "gitee",
            Self::Gitea => "gitea",
            Self::DirectZip => "direct-zip",
        }
    }
}

#[derive(Clone)]
struct ParsedRemoteSource {
    provider: SourceProvider,
    source_url: String,
    base_url: String,
    repository: Option<String>,
    reference: Option<String>,
    skill_path: Option<String>,
}

#[derive(Clone)]
struct ResolvedRemoteSource {
    parsed: ParsedRemoteSource,
    revision: String,
    archive_url: String,
    github_tree_sha: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallReceipt {
    name: String,
    provider: String,
    source_url: String,
    repository: Option<String>,
    revision: String,
    skill_path: Option<String>,
    archive_sha256: String,
    scope: String,
    workspace_root: Option<String>,
    has_scripts: bool,
    skipped_symlinks: Vec<String>,
    warnings: Vec<RemoteSkillWarning>,
}

#[command]
pub async fn search_remote_skills(
    request: SearchRemoteSkillsRequest,
) -> Result<Vec<RemoteSkillSearchResult>, String> {
    let query = request.query.trim();
    if query.chars().count() < 2 {
        return Err("Search query must contain at least two characters".to_string());
    }
    let token = request
        .github_token
        .filter(|value| !value.trim().is_empty())
        .ok_or("GITHUB_AUTH_REQUIRED: Connect GitHub before searching remote Skills")?;
    let client = build_client(request.proxy_url.as_deref())?;
    let mut url = Url::parse("https://api.github.com/search/code")
        .map_err(|error| format!("Failed to build GitHub search URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("q", &format!("{query} filename:SKILL.md"))
        .append_pair(
            "per_page",
            &request
                .limit
                .unwrap_or(8)
                .clamp(1, MAX_SEARCH_RESULTS)
                .to_string(),
        );
    let response = send_with_retry(github_request(&client, url, &token)).await?;
    ensure_api_success(response.status(), response.headers(), "GitHub Skill search")?;
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("GitHub search returned invalid JSON: {error}"))?;
    let items = payload
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut results = Vec::new();
    for item in items {
        let Some(api_url) = item.get("url").and_then(Value::as_str) else {
            continue;
        };
        let Some(repository) = item
            .get("repository")
            .and_then(|repo| repo.get("full_name"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let path = item
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("SKILL.md");
        let raw_url = match Url::parse(api_url) {
            Ok(url) => url,
            Err(_) => continue,
        };
        let raw_response = match send_with_retry(github_raw_request(&client, raw_url, &token)).await
        {
            Ok(response) if response.status().is_success() => response,
            _ => continue,
        };
        let content = match raw_response.text().await {
            Ok(content) => content,
            Err(_) => continue,
        };
        let (name, description) = match parse_remote_skill_metadata(&content) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let parent = Path::new(path)
            .parent()
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let source_url = item
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                if parent.is_empty() {
                    format!("https://github.com/{repository}")
                } else {
                    format!("https://github.com/{repository}/tree/HEAD/{parent}")
                }
            });
        let stars = item
            .get("repository")
            .and_then(|repo| repo.get("stargazers_count"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        results.push(RemoteSkillSearchResult {
            name,
            description,
            repository: repository.to_string(),
            path: parent,
            source_url,
            stars,
            provider: "github".to_string(),
        });
    }
    Ok(results)
}

#[command]
pub async fn inspect_remote_skill(
    app_handle: AppHandle,
    manager: State<'_, RemoteSkillManager>,
    request: InspectRemoteSkillRequest,
) -> Result<RemoteSkillPreview, String> {
    let cancellation = CancellationToken::new();
    manager
        .downloads
        .lock()
        .map_err(|_| "Remote Skill download state is unavailable")?
        .insert(request.request_id.clone(), cancellation.clone());
    emit_progress(&app_handle, &request.request_id, "resolving", None, None);

    let result = async {
        let credentials = RemoteCredentials {
            github_token: request.github_token,
            gitlab_token: request.gitlab_token,
            gitee_token: request.gitee_token,
            proxy_url: request.proxy_url,
        };
        let client = build_client(credentials.proxy_url.as_deref())?;
        let parsed = parse_remote_source(&request.source)?;
        let resolved = resolve_remote_source(&client, parsed, &credentials).await?;
        let app_data = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let cache_dir = app_data.join("remote-skill-cache");
        fs::create_dir_all(&cache_dir)
            .map_err(|error| format!("Failed to create remote Skill cache: {error}"))?;
        let cache_key = sha256_text(&format!(
            "{}:{}:{}",
            resolved.archive_url,
            resolved.revision,
            resolved.parsed.skill_path.as_deref().unwrap_or_default()
        ));
        let archive_path = cache_dir.join(format!("{cache_key}.zip"));
        download_archive(
            &app_handle,
            &client,
            &resolved,
            &credentials,
            &archive_path,
            &request.request_id,
            &cancellation,
        )
        .await?;
        if cancellation.is_cancelled() {
            return Err("REMOTE_SKILL_DOWNLOAD_CANCELLED".to_string());
        }
        emit_progress(&app_handle, &request.request_id, "verifying", None, None);
        let archive_sha256 = sha256_file(&archive_path)?;
        let preview_id = Uuid::new_v4().to_string();
        let preview_dir = app_data.join("remote-skill-previews").join(&preview_id);
        if preview_dir.exists() {
            fs::remove_dir_all(&preview_dir)
                .map_err(|error| format!("Failed to reset Skill preview directory: {error}"))?;
        }
        let inspection = inspect_remote_skill_archive(
            &archive_path,
            &preview_dir,
            resolved.parsed.skill_path.as_deref(),
        )?;
        let receipt = RemoteSkillPreviewReceipt {
            name: inspection.name.clone(),
            provider: resolved.parsed.provider.id().to_string(),
            source_url: resolved.parsed.source_url.clone(),
            repository: resolved.parsed.repository.clone(),
            revision: resolved.revision.clone(),
            skill_path: resolved.parsed.skill_path.clone(),
            archive_path,
            archive_sha256: archive_sha256.clone(),
            preview_dir,
            skill_root: inspection.root,
            has_scripts: inspection.has_scripts,
            skipped_symlinks: inspection.skipped_symlinks.clone(),
            warnings: inspection.warnings.clone(),
        };
        manager
            .previews
            .lock()
            .map_err(|_| "Remote Skill preview state is unavailable")?
            .insert(preview_id.clone(), receipt);
        emit_progress(&app_handle, &request.request_id, "ready", None, None);
        Ok(RemoteSkillPreview {
            preview_id,
            name: inspection.name,
            description: inspection.description,
            provider: resolved.parsed.provider.id().to_string(),
            source_url: resolved.parsed.source_url,
            repository: resolved.parsed.repository,
            revision: resolved.revision,
            skill_path: resolved.parsed.skill_path,
            files: inspection.files,
            total_bytes: inspection.total_bytes,
            has_scripts: inspection.has_scripts,
            skipped_symlinks: inspection.skipped_symlinks,
            warnings: inspection.warnings,
            archive_sha256,
        })
    }
    .await;

    if let Ok(mut downloads) = manager.downloads.lock() {
        downloads.remove(&request.request_id);
    }
    result
}

#[command]
pub async fn install_remote_skill(
    app_handle: AppHandle,
    manager: State<'_, RemoteSkillManager>,
    request: InstallRemoteSkillRequest,
) -> Result<RemoteSkillInstallResult, String> {
    let receipt = manager
        .previews
        .lock()
        .map_err(|_| "Remote Skill preview state is unavailable")?
        .get(&request.preview_id)
        .cloned()
        .ok_or("REMOTE_SKILL_PREVIEW_EXPIRED: Inspect the Skill again before installing")?;
    if !receipt.archive_path.is_file()
        || sha256_file(&receipt.archive_path)? != receipt.archive_sha256
    {
        return Err("REMOTE_SKILL_CACHE_CHANGED: Inspect and download the Skill again".to_string());
    }

    let scope_name = match request.scope {
        SkillImportScope::Global => "global",
        SkillImportScope::Project => "project",
    };
    let (skill_name, replaced) = install_remote_skill_directory(
        &app_handle,
        &receipt.skill_root,
        &receipt.name,
        request.scope,
        request.workspace_root.as_deref(),
        request.replace_existing,
    )?;
    write_install_receipt(
        &app_handle,
        &InstallReceipt {
            name: skill_name.clone(),
            provider: receipt.provider.clone(),
            source_url: receipt.source_url.clone(),
            repository: receipt.repository.clone(),
            revision: receipt.revision.clone(),
            skill_path: receipt.skill_path.clone(),
            archive_sha256: receipt.archive_sha256.clone(),
            scope: scope_name.to_string(),
            workspace_root: request.workspace_root,
            has_scripts: receipt.has_scripts,
            skipped_symlinks: receipt.skipped_symlinks.clone(),
            warnings: receipt.warnings.clone(),
        },
    )?;
    if let Ok(mut previews) = manager.previews.lock() {
        previews.remove(&request.preview_id);
    }
    let _ = fs::remove_dir_all(&receipt.preview_dir);

    Ok(RemoteSkillInstallResult {
        name: skill_name,
        scope: scope_name.to_string(),
        provider: receipt.provider,
        source_url: receipt.source_url,
        revision: receipt.revision,
        archive_sha256: receipt.archive_sha256,
        replaced,
        has_scripts: receipt.has_scripts,
        skipped_symlinks: receipt.skipped_symlinks,
        warnings: receipt.warnings,
    })
}

#[command]
pub async fn cancel_remote_skill_download(
    manager: State<'_, RemoteSkillManager>,
    request_id: String,
) -> Result<(), String> {
    if let Some(token) = manager
        .downloads
        .lock()
        .map_err(|_| "Remote Skill download state is unavailable")?
        .get(&request_id)
    {
        token.cancel();
    }
    Ok(())
}

fn build_client(proxy_url: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(5));
    if let Some(proxy_url) = proxy_url.filter(|value| !value.trim().is_empty()) {
        builder = builder
            .proxy(Proxy::all(proxy_url).map_err(|error| format!("Invalid proxy URL: {error}"))?);
    }
    builder
        .build()
        .map_err(|error| format!("Failed to create remote Skill HTTP client: {error}"))
}

fn github_request(client: &Client, url: Url, token: &str) -> reqwest::RequestBuilder {
    github_request_optional(client, url, Some(token))
}

fn github_raw_request(client: &Client, url: Url, token: &str) -> reqwest::RequestBuilder {
    github_raw_request_optional(client, url, Some(token))
}

fn github_raw_request_optional(
    client: &Client,
    url: Url,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client
        .get(url)
        .header(USER_AGENT, "NoteGen")
        .header(ACCEPT, "application/vnd.github.raw+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION);
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

fn github_request_optional(
    client: &Client,
    url: Url,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client
        .get(url)
        .header(USER_AGENT, "NoteGen")
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION);
    if let Some(token) = token.filter(|value| !value.trim().is_empty()) {
        request.bearer_auth(token)
    } else {
        request
    }
}

fn ensure_api_success(status: StatusCode, headers: &HeaderMap, action: &str) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    if status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && headers
                .get("x-ratelimit-remaining")
                .and_then(|value| value.to_str().ok())
                == Some("0"))
    {
        let retry = headers
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .or_else(|| {
                headers
                    .get("x-ratelimit-reset")
                    .and_then(|value| value.to_str().ok())
            })
            .unwrap_or("later");
        return Err(format!("REMOTE_SKILL_RATE_LIMITED: Retry after {retry}"));
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err("GITHUB_AUTH_REQUIRED: The configured GitHub token was rejected".to_string());
    }
    Err(format!("{action} failed with HTTP {status}"))
}

fn parse_remote_source(source: &str) -> Result<ParsedRemoteSource, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Remote Skill source cannot be empty".to_string());
    }
    let normalized = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.split('/').count() >= 2 {
        format!("https://github.com/{trimmed}")
    } else {
        return Err("Provide a GitHub, GitLab, Gitee, Codeberg, Gitea, or ZIP URL".to_string());
    };
    let url =
        Url::parse(&normalized).map_err(|error| format!("Invalid Skill source URL: {error}"))?;
    validate_remote_url(&url)?;
    let host = url
        .host_str()
        .ok_or("Remote Skill URL must include a host")?
        .to_ascii_lowercase();
    if url.path().to_ascii_lowercase().ends_with(".zip") {
        return Ok(ParsedRemoteSource {
            provider: SourceProvider::DirectZip,
            source_url: normalized,
            base_url: format!("{}://{}", url.scheme(), host),
            repository: None,
            reference: None,
            skill_path: None,
        });
    }
    let segments = url
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .map(|segment| {
                    percent_encoding::percent_decode_str(segment)
                        .decode_utf8_lossy()
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if host == "github.com" {
        return parse_github_source(normalized, segments);
    }
    if host == "gitlab.com" {
        return parse_gitlab_source(normalized, segments);
    }
    if host == "gitee.com" {
        return parse_gitee_source(normalized, segments);
    }
    parse_gitea_source(normalized, host, segments)
}

fn parse_github_source(
    source_url: String,
    segments: Vec<String>,
) -> Result<ParsedRemoteSource, String> {
    if segments.len() < 2 {
        return Err("GitHub Skill URL must include owner and repository".to_string());
    }
    let repository = format!("{}/{}", segments[0], trim_git_suffix(&segments[1]));
    let (reference, skill_path) = parse_ref_and_path(&segments, 2, &["tree", "blob"]);
    Ok(ParsedRemoteSource {
        provider: SourceProvider::Github,
        source_url,
        base_url: "https://github.com".to_string(),
        repository: Some(repository),
        reference,
        skill_path: normalize_skill_path(skill_path),
    })
}

fn parse_gitlab_source(
    source_url: String,
    segments: Vec<String>,
) -> Result<ParsedRemoteSource, String> {
    let marker = segments
        .iter()
        .position(|segment| segment == "-")
        .unwrap_or(segments.len());
    let repo_segments = &segments[..marker];
    if repo_segments.len() < 2 {
        return Err("GitLab Skill URL must include namespace and project".to_string());
    }
    let mut repository = repo_segments.to_vec();
    if let Some(last) = repository.last_mut() {
        *last = trim_git_suffix(last);
    }
    let after = if marker < segments.len() {
        marker + 1
    } else {
        segments.len()
    };
    let (reference, skill_path) = parse_ref_and_path(&segments, after, &["tree", "blob"]);
    Ok(ParsedRemoteSource {
        provider: SourceProvider::Gitlab,
        source_url,
        base_url: "https://gitlab.com".to_string(),
        repository: Some(repository.join("/")),
        reference,
        skill_path: normalize_skill_path(skill_path),
    })
}

fn parse_gitee_source(
    source_url: String,
    segments: Vec<String>,
) -> Result<ParsedRemoteSource, String> {
    if segments.len() < 2 {
        return Err("Gitee Skill URL must include owner and repository".to_string());
    }
    let repository = format!("{}/{}", segments[0], trim_git_suffix(&segments[1]));
    let (reference, skill_path) = parse_ref_and_path(&segments, 2, &["tree", "blob"]);
    Ok(ParsedRemoteSource {
        provider: SourceProvider::Gitee,
        source_url,
        base_url: "https://gitee.com".to_string(),
        repository: Some(repository),
        reference,
        skill_path: normalize_skill_path(skill_path),
    })
}

fn parse_gitea_source(
    source_url: String,
    host: String,
    segments: Vec<String>,
) -> Result<ParsedRemoteSource, String> {
    if segments.len() < 2 {
        return Err("Gitea Skill URL must include owner and repository".to_string());
    }
    let repository = format!("{}/{}", segments[0], trim_git_suffix(&segments[1]));
    let (reference, skill_path) = if segments.get(2).map(String::as_str) == Some("src") {
        let start = if matches!(
            segments.get(3).map(String::as_str),
            Some("branch" | "tag" | "commit")
        ) {
            4
        } else {
            3
        };
        if segments.len() > start {
            (
                Some(segments[start].clone()),
                Some(segments[start + 1..].join("/")),
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };
    Ok(ParsedRemoteSource {
        provider: SourceProvider::Gitea,
        source_url,
        base_url: format!("https://{host}"),
        repository: Some(repository),
        reference,
        skill_path: normalize_skill_path(skill_path),
    })
}

fn parse_ref_and_path(
    segments: &[String],
    start: usize,
    markers: &[&str],
) -> (Option<String>, Option<String>) {
    if segments
        .get(start)
        .map(String::as_str)
        .map(|segment| markers.contains(&segment))
        != Some(true)
    {
        return (None, None);
    }
    let reference = segments.get(start + 1).cloned();
    let path = if segments.len() > start + 2 {
        Some(segments[start + 2..].join("/"))
    } else {
        None
    };
    (reference, path)
}

fn normalize_skill_path(path: Option<String>) -> Option<String> {
    path.map(|path| {
        let trimmed = path.trim_matches('/');
        if trimmed == "SKILL.md" {
            String::new()
        } else {
            trimmed
                .trim_end_matches("/SKILL.md")
                .trim_matches('/')
                .to_string()
        }
    })
    .filter(|path| !path.is_empty())
}

fn trim_git_suffix(value: &str) -> String {
    value.trim_end_matches(".git").to_string()
}

async fn resolve_remote_source(
    client: &Client,
    parsed: ParsedRemoteSource,
    credentials: &RemoteCredentials,
) -> Result<ResolvedRemoteSource, String> {
    if matches!(parsed.provider, SourceProvider::DirectZip) {
        return Ok(ResolvedRemoteSource {
            revision: "downloaded-artifact".to_string(),
            archive_url: parsed.source_url.clone(),
            github_tree_sha: None,
            parsed,
        });
    }
    let repository = parsed
        .repository
        .as_deref()
        .ok_or("Remote repository is missing")?;
    match parsed.provider {
        SourceProvider::Github => {
            let repo_url = Url::parse(&format!("https://api.github.com/repos/{repository}"))
                .map_err(|error| format!("Failed to build GitHub repository URL: {error}"))?;
            let repo_response = send_with_retry(github_request_optional(
                client,
                repo_url,
                credentials.github_token.as_deref(),
            ))
            .await?;
            ensure_api_success(
                repo_response.status(),
                repo_response.headers(),
                "GitHub repository lookup",
            )?;
            let repo_payload = repo_response
                .json::<Value>()
                .await
                .map_err(|error| format!("GitHub repository response is invalid: {error}"))?;
            let reference = parsed
                .reference
                .clone()
                .or_else(|| {
                    repo_payload
                        .get("default_branch")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "main".to_string());
            let commit_url = Url::parse(&format!(
                "https://api.github.com/repos/{repository}/commits/{}",
                urlencoding::encode(&reference)
            ))
            .map_err(|error| format!("Failed to build GitHub commit URL: {error}"))?;
            let response = send_with_retry(github_request_optional(
                client,
                commit_url,
                credentials.github_token.as_deref(),
            ))
            .await?;
            ensure_api_success(
                response.status(),
                response.headers(),
                "GitHub commit lookup",
            )?;
            let payload = response
                .json::<Value>()
                .await
                .map_err(|error| format!("GitHub commit response is invalid: {error}"))?;
            let revision = json_string(&payload, "sha", "GitHub commit SHA")?;
            let github_tree_sha = payload
                .get("commit")
                .and_then(|commit| commit.get("tree"))
                .and_then(|tree| tree.get("sha"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Ok(ResolvedRemoteSource {
                archive_url: format!("https://codeload.github.com/{repository}/zip/{revision}"),
                revision,
                github_tree_sha,
                parsed,
            })
        }
        SourceProvider::Gitlab => {
            let project = urlencoding::encode(repository);
            let repo_url = format!("{}/api/v4/projects/{project}", parsed.base_url);
            let repo_payload =
                request_json(client, &repo_url, SourceProvider::Gitlab, credentials).await?;
            let reference = parsed
                .reference
                .clone()
                .or_else(|| {
                    repo_payload
                        .get("default_branch")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "main".to_string());
            let commit_url = format!(
                "{}/api/v4/projects/{project}/repository/commits/{}",
                parsed.base_url,
                urlencoding::encode(&reference)
            );
            let payload =
                request_json(client, &commit_url, SourceProvider::Gitlab, credentials).await?;
            let revision = json_string(&payload, "id", "GitLab commit SHA")?;
            Ok(ResolvedRemoteSource {
                archive_url: format!(
                    "{}/api/v4/projects/{project}/repository/archive.zip?sha={revision}",
                    parsed.base_url
                ),
                revision,
                github_tree_sha: None,
                parsed,
            })
        }
        SourceProvider::Gitee => {
            let repo_url = format!("{}/api/v5/repos/{repository}", parsed.base_url);
            let repo_payload =
                request_json(client, &repo_url, SourceProvider::Gitee, credentials).await?;
            let reference = parsed
                .reference
                .clone()
                .or_else(|| {
                    repo_payload
                        .get("default_branch")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "master".to_string());
            let commit_url = format!(
                "{}/api/v5/repos/{repository}/commits/{}",
                parsed.base_url,
                urlencoding::encode(&reference)
            );
            let payload =
                request_json(client, &commit_url, SourceProvider::Gitee, credentials).await?;
            let revision = json_string(&payload, "sha", "Gitee commit SHA")?;
            Ok(ResolvedRemoteSource {
                archive_url: format!(
                    "{}/{repository}/repository/archive/{revision}.zip",
                    parsed.base_url
                ),
                revision,
                github_tree_sha: None,
                parsed,
            })
        }
        SourceProvider::Gitea => {
            let repo_url = format!("{}/api/v1/repos/{repository}", parsed.base_url);
            let repo_payload =
                request_json(client, &repo_url, SourceProvider::Gitea, credentials).await?;
            let reference = parsed
                .reference
                .clone()
                .or_else(|| {
                    repo_payload
                        .get("default_branch")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "main".to_string());
            let commit_url = format!(
                "{}/api/v1/repos/{repository}/git/commits/{}",
                parsed.base_url,
                urlencoding::encode(&reference)
            );
            let payload =
                request_json(client, &commit_url, SourceProvider::Gitea, credentials).await?;
            let revision = json_string(&payload, "sha", "Gitea commit SHA")?;
            Ok(ResolvedRemoteSource {
                archive_url: format!("{}/{repository}/archive/{revision}.zip", parsed.base_url),
                revision,
                github_tree_sha: None,
                parsed,
            })
        }
        SourceProvider::DirectZip => unreachable!(),
    }
}

async fn request_json(
    client: &Client,
    url: &str,
    provider: SourceProvider,
    credentials: &RemoteCredentials,
) -> Result<Value, String> {
    let parsed = Url::parse(url).map_err(|error| format!("Invalid provider API URL: {error}"))?;
    let response =
        send_with_retry(provider_request(client, parsed, &provider, credentials)).await?;
    if !response.status().is_success() {
        return Err(format!(
            "{} request failed with HTTP {}",
            provider.id(),
            response.status()
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("{} returned invalid JSON: {error}", provider.id()))
}

fn provider_request(
    client: &Client,
    url: Url,
    provider: &SourceProvider,
    credentials: &RemoteCredentials,
) -> reqwest::RequestBuilder {
    let mut request = client.get(url).header(USER_AGENT, "NoteGen");
    match provider {
        SourceProvider::Github => {
            if let Some(token) = credentials.github_token.as_deref() {
                request = request
                    .bearer_auth(token)
                    .header(ACCEPT, "application/vnd.github+json")
                    .header("X-GitHub-Api-Version", GITHUB_API_VERSION);
            }
        }
        SourceProvider::Gitlab => {
            if let Some(token) = credentials.gitlab_token.as_deref() {
                request = request.header("PRIVATE-TOKEN", token);
            }
        }
        SourceProvider::Gitee => {
            if let Some(token) = credentials.gitee_token.as_deref() {
                request = request.header(AUTHORIZATION, format!("token {token}"));
            }
        }
        SourceProvider::Gitea => {
            // Generic public Gitea sources are read without borrowing credentials
            // configured for a different provider.
        }
        SourceProvider::DirectZip => {}
    }
    request
}

async fn send_with_retry(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let mut last_error = None;
    for attempt in 0..3_u64 {
        let current = request
            .try_clone()
            .ok_or("Failed to clone remote Skill request")?;
        match current.send().await {
            Ok(response)
                if response.status() == StatusCode::REQUEST_TIMEOUT
                    || response.status().is_server_error() =>
            {
                last_error = Some(format!(
                    "Third-party service returned HTTP {}",
                    response.status()
                ));
            }
            Ok(response) => return Ok(response),
            Err(error) => last_error = Some(map_network_error(error)),
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(if attempt == 0 { 1 } else { 3 })).await;
        }
    }
    Err(last_error.unwrap_or_else(|| "Remote Skill request failed".to_string()))
}

async fn download_archive(
    app_handle: &AppHandle,
    client: &Client,
    source: &ResolvedRemoteSource,
    credentials: &RemoteCredentials,
    destination: &Path,
    request_id: &str,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    if destination.is_file() {
        let length = fs::metadata(destination)
            .map_err(|error| format!("Failed to inspect cached Skill archive: {error}"))?
            .len();
        if length > 0 && length <= MAX_REMOTE_ZIP_BYTES {
            emit_progress(app_handle, request_id, "cached", Some(length), Some(length));
            return Ok(());
        }
        fs::remove_file(destination)
            .map_err(|error| format!("Failed to reset cached Skill archive: {error}"))?;
    }
    let part_path = destination.with_extension("zip.part");
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create Skill download directory: {error}"))?;
    }
    if matches!(source.parsed.provider, SourceProvider::Github)
        && source.parsed.skill_path.is_some()
        && source.github_tree_sha.is_some()
    {
        return download_github_subtree(
            app_handle,
            client,
            source,
            credentials,
            destination,
            request_id,
            cancellation,
        )
        .await;
    }
    let archive_url =
        Url::parse(&source.archive_url).map_err(|error| format!("Invalid archive URL: {error}"))?;
    validate_remote_url(&archive_url)?;

    let mut last_error = None;
    for attempt in 0..3_u64 {
        if cancellation.is_cancelled() {
            return Err("REMOTE_SKILL_DOWNLOAD_CANCELLED".to_string());
        }
        let existing = fs::metadata(&part_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut request = provider_request(
            client,
            archive_url.clone(),
            &source.parsed.provider,
            credentials,
        );
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        match request.send().await {
            Ok(response) => {
                if !response.status().is_success()
                    && response.status() != StatusCode::PARTIAL_CONTENT
                {
                    let status = response.status();
                    if status == StatusCode::TOO_MANY_REQUESTS
                        || status == StatusCode::REQUEST_TIMEOUT
                        || status.is_server_error()
                    {
                        last_error = Some(format!("Archive download returned HTTP {status}"));
                    } else {
                        return Err(format!("Archive download failed with HTTP {status}"));
                    }
                } else {
                    validate_remote_url(response.url())?;
                    let resumes = response.status() == StatusCode::PARTIAL_CONTENT && existing > 0;
                    let total = response
                        .headers()
                        .get(CONTENT_LENGTH)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| u64::from_str(value).ok())
                        .map(|value| if resumes { value + existing } else { value });
                    if total.is_some_and(|value| value > MAX_REMOTE_ZIP_BYTES) {
                        return Err(format!(
                            "Remote Skill archive exceeds the {} MB limit",
                            MAX_REMOTE_ZIP_BYTES / 1024 / 1024
                        ));
                    }
                    let mut file = if resumes {
                        tokio::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&part_path)
                            .await
                    } else {
                        tokio::fs::OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(true)
                            .open(&part_path)
                            .await
                    }
                    .map_err(|error| format!("Failed to open partial Skill archive: {error}"))?;
                    let mut downloaded = if resumes { existing } else { 0 };
                    let mut stream = response.bytes_stream();
                    let mut failed = None;
                    while let Some(chunk) = stream.next().await {
                        if cancellation.is_cancelled() {
                            return Err("REMOTE_SKILL_DOWNLOAD_CANCELLED".to_string());
                        }
                        match chunk {
                            Ok(chunk) => {
                                downloaded = downloaded.saturating_add(chunk.len() as u64);
                                if downloaded > MAX_REMOTE_ZIP_BYTES {
                                    return Err(format!(
                                        "Remote Skill archive exceeds the {} MB limit",
                                        MAX_REMOTE_ZIP_BYTES / 1024 / 1024
                                    ));
                                }
                                file.write_all(&chunk).await.map_err(|error| {
                                    format!("Failed to write Skill archive: {error}")
                                })?;
                                emit_progress(
                                    app_handle,
                                    request_id,
                                    "downloading",
                                    Some(downloaded),
                                    total,
                                );
                            }
                            Err(error) => {
                                failed = Some(map_network_error(error));
                                break;
                            }
                        }
                    }
                    file.flush()
                        .await
                        .map_err(|error| format!("Failed to flush Skill archive: {error}"))?;
                    if let Some(error) = failed {
                        last_error = Some(error);
                    } else {
                        fs::rename(&part_path, destination).map_err(|error| {
                            format!("Failed to finalize Skill archive download: {error}")
                        })?;
                        return Ok(());
                    }
                }
            }
            Err(error) => last_error = Some(map_network_error(error)),
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(if attempt == 0 { 1 } else { 3 })).await;
        }
    }
    Err(format!(
        "REMOTE_SKILL_DOWNLOAD_FAILED: {}",
        last_error.unwrap_or_else(|| "Unknown network error".to_string())
    ))
}

async fn download_github_subtree(
    app_handle: &AppHandle,
    client: &Client,
    source: &ResolvedRemoteSource,
    credentials: &RemoteCredentials,
    destination: &Path,
    request_id: &str,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    let repository = source
        .parsed
        .repository
        .as_deref()
        .ok_or("GitHub repository is missing")?;
    let skill_path = source
        .parsed
        .skill_path
        .as_deref()
        .ok_or("GitHub Skill path is missing")?
        .trim_matches('/');
    let tree_sha = source
        .github_tree_sha
        .as_deref()
        .ok_or("GitHub commit tree is missing")?;
    let tree_url =
        format!("https://api.github.com/repos/{repository}/git/trees/{tree_sha}?recursive=1");
    let payload = request_json(client, &tree_url, SourceProvider::Github, credentials).await?;
    if payload
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err("GitHub repository tree is too large to inspect safely".to_string());
    }

    let path_prefix = format!("{skill_path}/");
    let mut blobs = Vec::new();
    let mut declared_bytes = 0_u64;
    for item in payload
        .get("tree")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(path) = item.get("path").and_then(Value::as_str) else {
            continue;
        };
        if path != skill_path && !path.starts_with(&path_prefix) {
            continue;
        }
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
        if item_type == "tree" {
            continue;
        }
        if item_type != "blob" {
            return Err(format!("Unsupported Git object in selected Skill: {path}"));
        }
        let is_symlink = item.get("mode").and_then(Value::as_str) == Some("120000");
        let sha = item
            .get("sha")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("GitHub blob SHA is missing for {path}"))?;
        let size = item.get("size").and_then(Value::as_u64).unwrap_or(0);
        declared_bytes = declared_bytes.saturating_add(size);
        if declared_bytes > MAX_REMOTE_ZIP_BYTES {
            return Err(format!(
                "Selected Skill exceeds the {} MB limit",
                MAX_REMOTE_ZIP_BYTES / 1024 / 1024
            ));
        }
        blobs.push((
            path.to_string(),
            if is_symlink {
                None
            } else {
                Some(sha.to_string())
            },
        ));
        if blobs.len() > MAX_REMOTE_SKILL_FILES {
            return Err(format!(
                "Selected Skill contains more than {MAX_REMOTE_SKILL_FILES} files"
            ));
        }
    }
    if blobs.is_empty() {
        return Err("No files were found at the requested GitHub Skill path".to_string());
    }

    let mut files = Vec::with_capacity(blobs.len());
    let mut downloaded = 0_u64;
    for (path, sha) in blobs {
        if cancellation.is_cancelled() {
            return Err("REMOTE_SKILL_DOWNLOAD_CANCELLED".to_string());
        }
        let Some(sha) = sha else {
            files.push((path, None));
            continue;
        };
        let blob_url = Url::parse(&format!(
            "https://api.github.com/repos/{repository}/git/blobs/{sha}"
        ))
        .map_err(|error| format!("Failed to build GitHub blob URL: {error}"))?;
        let response = send_with_retry(github_raw_request_optional(
            client,
            blob_url,
            credentials.github_token.as_deref(),
        ))
        .await?;
        ensure_api_success(
            response.status(),
            response.headers(),
            "GitHub Skill file download",
        )?;
        validate_remote_url(response.url())?;
        if response
            .content_length()
            .is_some_and(|length| downloaded.saturating_add(length) > MAX_REMOTE_ZIP_BYTES)
        {
            return Err(format!(
                "Selected Skill exceeds the {} MB limit",
                MAX_REMOTE_ZIP_BYTES / 1024 / 1024
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to download GitHub Skill file {path}: {error}"))?;
        downloaded = downloaded.saturating_add(bytes.len() as u64);
        if downloaded > MAX_REMOTE_ZIP_BYTES {
            return Err(format!(
                "Selected Skill exceeds the {} MB limit",
                MAX_REMOTE_ZIP_BYTES / 1024 / 1024
            ));
        }
        emit_progress(
            app_handle,
            request_id,
            "downloading",
            Some(downloaded),
            None,
        );
        files.push((path, Some(bytes)));
    }

    let part_path = destination.with_extension("zip.part");
    if part_path.exists() {
        fs::remove_file(&part_path)
            .map_err(|error| format!("Failed to reset partial Skill archive: {error}"))?;
    }
    let output = fs::File::create(&part_path)
        .map_err(|error| format!("Failed to create Skill archive: {error}"))?;
    let mut archive = ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let archive_root = format!(
        "{}-{}",
        repository.rsplit('/').next().unwrap_or("repository"),
        &source.revision[..source.revision.len().min(12)]
    );
    for (path, bytes) in files {
        let entry_path = format!("{archive_root}/{path}");
        if let Some(bytes) = bytes {
            archive
                .start_file(entry_path, options)
                .map_err(|error| format!("Failed to add Skill file to archive: {error}"))?;
            std::io::Write::write_all(&mut archive, &bytes)
                .map_err(|error| format!("Failed to write Skill file to archive: {error}"))?;
        } else {
            archive
                .add_symlink(entry_path, "skipped-symbolic-link", options)
                .map_err(|error| format!("Failed to record Skill symbolic link: {error}"))?;
        }
    }
    archive
        .finish()
        .map_err(|error| format!("Failed to finish Skill archive: {error}"))?;
    let archive_size = fs::metadata(&part_path)
        .map_err(|error| format!("Failed to inspect Skill archive: {error}"))?
        .len();
    if archive_size > MAX_REMOTE_ZIP_BYTES {
        let _ = fs::remove_file(&part_path);
        return Err(format!(
            "Remote Skill archive exceeds the {} MB limit",
            MAX_REMOTE_ZIP_BYTES / 1024 / 1024
        ));
    }
    fs::rename(&part_path, destination)
        .map_err(|error| format!("Failed to finalize Skill archive download: {error}"))
}

fn emit_progress(
    app_handle: &AppHandle,
    request_id: &str,
    phase: &str,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
) {
    let _ = app_handle.emit(
        PREVIEW_EVENT,
        RemoteSkillProgress {
            request_id: request_id.to_string(),
            phase: phase.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

fn validate_remote_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("Remote Skill sources must use HTTPS".to_string());
    }
    let host = url
        .host_str()
        .ok_or("Remote Skill URL must include a host")?
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Local network Skill sources are not allowed".to_string());
    }
    if let Ok(ip) = IpAddr::from_str(&host) {
        let blocked = match ip {
            IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_broadcast()
                    || ip.is_unspecified()
            }
            IpAddr::V6(ip) => ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local(),
        };
        if blocked {
            return Err("Private network Skill sources are not allowed".to_string());
        }
    }
    Ok(())
}

fn json_string(payload: &Value, key: &str, label: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label} is missing"))
}

fn sha256_text(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("{digest:x}")
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Failed to read Skill archive: {error}"))?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

fn write_install_receipt(app_handle: &AppHandle, receipt: &InstallReceipt) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let directory = app_data.join("remote-skill-receipts");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create Skill receipt directory: {error}"))?;
    let key = sha256_text(&format!(
        "{}:{}:{}",
        receipt.scope,
        receipt.workspace_root.as_deref().unwrap_or_default(),
        receipt.name
    ));
    let content = serde_json::to_vec_pretty(receipt)
        .map_err(|error| format!("Failed to serialize Skill receipt: {error}"))?;
    fs::write(directory.join(format!("{key}.json")), content)
        .map_err(|error| format!("Failed to save Skill receipt: {error}"))
}

fn map_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "REMOTE_SKILL_TIMEOUT: The third-party service did not respond in time".to_string()
    } else if error.is_connect() {
        "REMOTE_SKILL_CONNECTION_FAILED: Check the network or proxy settings".to_string()
    } else {
        format!("REMOTE_SKILL_NETWORK_ERROR: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_remote_sources() {
        let github =
            parse_remote_source("https://github.com/example/skills/tree/main/skills/weekly-report")
                .unwrap();
        assert_eq!(github.provider.id(), "github");
        assert_eq!(github.repository.as_deref(), Some("example/skills"));
        assert_eq!(github.skill_path.as_deref(), Some("skills/weekly-report"));

        let github_search_result = parse_remote_source(
            "https://github.com/example/skills/blob/0123456789abcdef/skills/weekly-report/SKILL.md",
        )
        .unwrap();
        assert_eq!(
            github_search_result.reference.as_deref(),
            Some("0123456789abcdef")
        );
        assert_eq!(
            github_search_result.skill_path.as_deref(),
            Some("skills/weekly-report")
        );

        let gitlab = parse_remote_source(
            "https://gitlab.com/example/team/skills/-/tree/main/skills/weekly-report",
        )
        .unwrap();
        assert_eq!(gitlab.repository.as_deref(), Some("example/team/skills"));
        assert_eq!(gitlab.skill_path.as_deref(), Some("skills/weekly-report"));

        let gitee =
            parse_remote_source("https://gitee.com/example/skills/tree/main/skills/weekly-report")
                .unwrap();
        assert_eq!(gitee.provider.id(), "gitee");

        let codeberg = parse_remote_source(
            "https://codeberg.org/example/skills/src/branch/main/skills/weekly-report",
        )
        .unwrap();
        assert_eq!(codeberg.provider.id(), "gitea");
        assert_eq!(codeberg.skill_path.as_deref(), Some("skills/weekly-report"));
    }

    #[test]
    fn blocks_insecure_and_private_sources() {
        assert!(parse_remote_source("http://example.com/skill.zip").is_err());
        assert!(parse_remote_source("https://127.0.0.1/skill.zip").is_err());
        assert!(parse_remote_source("https://localhost/skill.zip").is_err());
    }
}
