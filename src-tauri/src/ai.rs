use futures_util::StreamExt;
use reqwest::{header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE}, multipart::{Form, Part}, Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, str::FromStr};
use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AiRequestManager {
    requests: Mutex<HashMap<String, CancellationToken>>,
}

impl AiRequestManager {
    pub fn new() -> Self {
        Self {
            requests: Mutex::new(HashMap::new()),
        }
    }

    async fn register(&self, request_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.requests
            .lock()
            .await
            .insert(request_id.to_string(), token.clone());
        token
    }

    async fn cancel(&self, request_id: &str) -> bool {
        if let Some(token) = self.requests.lock().await.remove(request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    async fn finish(&self, request_id: &str) {
        self.requests.lock().await.remove(request_id);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigPayload {
    pub base_url: String,
    pub api_key: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiJsonRequest {
    pub config: AiConfigPayload,
    pub path: String,
    pub method: Option<String>,
    pub body: Option<Value>,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMultipartFile {
    pub bytes: Vec<u8>,
    pub file_name: String,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMultipartRequest {
    pub config: AiConfigPayload,
    pub path: String,
    pub fields: Option<HashMap<String, String>>,
    pub file_field_name: String,
    pub file: AiMultipartFile,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamRequest {
    pub config: AiConfigPayload,
    pub request_id: String,
    pub body: Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Chunk(Value),
    Error(String),
    Done,
}

fn abort_error() -> String {
    "Request was aborted.".to_string()
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))
}

fn build_url(base_url: &str, path: &str) -> Result<Url, String> {
    let normalized_base = base_url.trim_end_matches('/');
    let normalized_path = path.trim_start_matches('/');
    let full_url = format!("{normalized_base}/{normalized_path}");
    Url::parse(&full_url).map_err(|error| format!("Invalid request URL `{full_url}`: {error}"))
}

fn build_headers(config: &AiConfigPayload, include_json_content_type: bool) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if let Some(api_key) = &config.api_key {
        if !api_key.is_empty() {
            let bearer = format!("Bearer {api_key}");
            let value = HeaderValue::from_str(&bearer)
                .map_err(|error| format!("Invalid authorization header: {error}"))?;
            headers.insert(AUTHORIZATION, value);
        }
    }

    if include_json_content_type {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }

    if let Some(custom_headers) = &config.custom_headers {
        for (key, value) in custom_headers {
            let key = HeaderName::from_str(key)
                .map_err(|error| format!("Invalid header name `{key}`: {error}"))?;
            let value = HeaderValue::from_str(value)
                .map_err(|error| format!("Invalid header value for `{key}`: {error}"))?;
            headers.insert(key, value);
        }
    }

    Ok(headers)
}

async fn read_response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Request failed: {status} {error_text}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Failed to parse JSON response: {error}"))
}

async fn run_json_request(
    request: AiJsonRequest,
    manager: &AiRequestManager,
) -> Result<Value, String> {
    let client = build_client()?;
    let url = build_url(&request.config.base_url, &request.path)?;
    let method = Method::from_str(request.method.as_deref().unwrap_or("POST"))
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let headers = build_headers(&request.config, request.body.is_some())?;
    let cancellation = if let Some(request_id) = &request.request_id {
        Some(manager.register(request_id).await)
    } else {
        None
    };

    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let send_future = builder.send();

    let response = if let Some(token) = cancellation {
        tokio::select! {
            _ = token.cancelled() => {
                if let Some(request_id) = &request.request_id {
                    manager.finish(request_id).await;
                }
                return Err(abort_error())
            },
            response = send_future => response.map_err(|error| format!("Request failed: {error}"))?,
        }
    } else {
        send_future
            .await
            .map_err(|error| format!("Request failed: {error}"))?
    };

    let result = read_response_json(response).await;
    if let Some(request_id) = &request.request_id {
        manager.finish(request_id).await;
    }
    result
}

struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.push_str(&String::from_utf8_lossy(chunk));
        let mut messages = Vec::new();

        loop {
            let separator = self
                .buffer
                .find("\n\n")
                .or_else(|| self.buffer.find("\r\n\r\n"));

            let Some(separator) = separator else {
                break;
            };

            let raw = self.buffer[..separator].to_string();
            let drain_len = if self.buffer[separator..].starts_with("\r\n\r\n") {
                separator + 4
            } else {
                separator + 2
            };
            self.buffer.drain(..drain_len);

            let event = raw.replace("\r\n", "\n");
            let mut data_lines = Vec::new();
            for line in event.lines() {
                if let Some(data) = line.strip_prefix("data:") {
                    data_lines.push(data.trim_start().to_string());
                }
            }

            if !data_lines.is_empty() {
                messages.push(data_lines.join("\n"));
            }
        }

        messages
    }
}

#[tauri::command]
pub async fn ai_json_request(
    request: AiJsonRequest,
    manager: State<'_, AiRequestManager>,
) -> Result<Value, String> {
    run_json_request(request, &manager).await
}

#[tauri::command]
pub async fn ai_binary_request(
    request: AiJsonRequest,
    manager: State<'_, AiRequestManager>,
) -> Result<Vec<u8>, String> {
    let client = build_client()?;
    let url = build_url(&request.config.base_url, &request.path)?;
    let method = Method::from_str(request.method.as_deref().unwrap_or("POST"))
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let headers = build_headers(&request.config, request.body.is_some())?;
    let cancellation = if let Some(request_id) = &request.request_id {
        Some(manager.register(request_id).await)
    } else {
        None
    };

    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let send_future = builder.send();
    let response = if let Some(token) = cancellation {
        tokio::select! {
            _ = token.cancelled() => {
                if let Some(request_id) = &request.request_id {
                    manager.finish(request_id).await;
                }
                return Err(abort_error())
            },
            response = send_future => response.map_err(|error| format!("Request failed: {error}"))?,
        }
    } else {
        send_future
            .await
            .map_err(|error| format!("Request failed: {error}"))?
    };

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        if let Some(request_id) = &request.request_id {
            manager.finish(request_id).await;
        }
        return Err(format!("Request failed: {status} {error_text}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read binary response: {error}"))?;

    if let Some(request_id) = &request.request_id {
        manager.finish(request_id).await;
    }
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn ai_multipart_request(
    request: AiMultipartRequest,
    manager: State<'_, AiRequestManager>,
) -> Result<Value, String> {
    let client = build_client()?;
    let url = build_url(&request.config.base_url, &request.path)?;
    let headers = build_headers(&request.config, false)?;
    let cancellation = if let Some(request_id) = &request.request_id {
        Some(manager.register(request_id).await)
    } else {
        None
    };

    let mut form = Form::new();
    if let Some(fields) = request.fields {
        for (key, value) in fields {
            form = form.text(key, value);
        }
    }

    let mut part = Part::bytes(request.file.bytes).file_name(request.file.file_name);
    if let Some(content_type) = request.file.content_type {
        part = part
            .mime_str(&content_type)
            .map_err(|error| format!("Invalid file content type: {error}"))?;
    }
    form = form.part(request.file_field_name, part);

    let send_future = client.post(url).headers(headers).multipart(form).send();
    let response = if let Some(token) = cancellation {
        tokio::select! {
            _ = token.cancelled() => {
                if let Some(request_id) = &request.request_id {
                    manager.finish(request_id).await;
                }
                return Err(abort_error())
            },
            response = send_future => response.map_err(|error| format!("Request failed: {error}"))?,
        }
    } else {
        send_future
            .await
            .map_err(|error| format!("Request failed: {error}"))?
    };

    let result = read_response_json(response).await;
    if let Some(request_id) = &request.request_id {
        manager.finish(request_id).await;
    }
    result
}

#[tauri::command]
pub async fn ai_chat_completion_stream(
    request: AiStreamRequest,
    on_event: Channel<AiStreamEvent>,
    manager: State<'_, AiRequestManager>,
) -> Result<(), String> {
    let client = build_client()?;
    let url = build_url(&request.config.base_url, "/chat/completions")?;
    let headers = build_headers(&request.config, true)?;
    let cancellation = manager.register(&request.request_id).await;

    let response = tokio::select! {
        _ = cancellation.cancelled() => {
            manager.finish(&request.request_id).await;
            return Err(abort_error());
        }
        response = client
            .post(url)
            .headers(headers)
            .json(&request.body)
            .send() => response.map_err(|error| format!("Request failed: {error}"))?,
    };

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        manager.finish(&request.request_id).await;
        return Err(format!("Request failed: {status} {error_text}"));
    }

    let mut decoder = SseDecoder::new();
    let mut stream = response.bytes_stream();

    loop {
        let next = tokio::select! {
            _ = cancellation.cancelled() => {
                manager.finish(&request.request_id).await;
                return Err(abort_error());
            }
            item = stream.next() => item,
        };

        let Some(item) = next else {
            break;
        };

        let chunk = item.map_err(|error| format!("Stream read failed: {error}"))?;
        for message in decoder.push(chunk.as_ref()) {
            if message == "[DONE]" {
                let _ = on_event.send(AiStreamEvent::Done);
                manager.finish(&request.request_id).await;
                return Ok(());
            }

            match serde_json::from_str::<Value>(&message) {
                Ok(value) => {
                    let _ = on_event.send(AiStreamEvent::Chunk(value));
                }
                Err(error) => {
                    let _ = on_event.send(AiStreamEvent::Error(format!(
                        "Failed to parse stream chunk: {error}"
                    )));
                    manager.finish(&request.request_id).await;
                    return Err(format!("Failed to parse stream chunk: {error}"));
                }
            }
        }
    }

    let _ = on_event.send(AiStreamEvent::Done);
    manager.finish(&request.request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_ai_request(
    request_id: String,
    manager: State<'_, AiRequestManager>,
) -> Result<bool, String> {
    Ok(manager.cancel(&request_id).await)
}

#[cfg(test)]
mod tests {
    use super::SseDecoder;

    #[test]
    fn parses_split_sse_chunks() {
        let mut decoder = SseDecoder::new();
        let first = decoder.push(br#"data: {"id":"1"}"#);
        assert!(first.is_empty());

        let second = decoder.push(b"\n\ndata: [DONE]\n\n");
        assert_eq!(second, vec![r#"{"id":"1"}"#.to_string(), "[DONE]".to_string()]);
    }

    #[test]
    fn parses_multiline_sse_messages() {
        let mut decoder = SseDecoder::new();
        let messages = decoder.push(b"data: hello\r\ndata: world\r\n\r\n");
        assert_eq!(messages, vec!["hello\nworld".to_string()]);
    }
}
