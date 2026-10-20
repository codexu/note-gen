use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;
use uuid::Uuid;

pub const LOCAL_MCP_PORT: u16 = 37_422;
const STORE_PATH: &str = "local-mcp.json";
const STORE_ENABLED_KEY: &str = "enabled";
const STORE_CONNECTIONS_KEY: &str = "connections";
const STORE_PORT_KEY: &str = "port";
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const RATE_LIMIT_WINDOW_MS: u64 = 60_000;
const RATE_LIMIT_REQUESTS: usize = 240;
const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpConnection {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    pub created_at: u64,
    pub last_used_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpConnectionView {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub last_used_at: u64,
}

impl From<&LocalMcpConnection> for LocalMcpConnectionView {
    fn from(value: &LocalMcpConnection) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            created_at: value.created_at,
            last_used_at: value.last_used_at,
        }
    }
}

type PendingRequest = oneshot::Sender<Result<Value, BridgeError>>;

pub struct LocalMcpState {
    app: Mutex<Option<AppHandle>>,
    enabled: AtomicBool,
    ready: AtomicBool,
    port: AtomicU16,
    server_error: Mutex<Option<String>>,
    server_shutdown: Mutex<Option<oneshot::Sender<()>>>,
    connections: Mutex<Vec<LocalMcpConnection>>,
    pending: Mutex<HashMap<String, PendingRequest>>,
    rate_limits: Mutex<HashMap<String, VecDeque<u64>>>,
}

impl LocalMcpState {
    pub fn new() -> Self {
        Self {
            app: Mutex::new(None),
            enabled: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            port: AtomicU16::new(LOCAL_MCP_PORT),
            server_error: Mutex::new(None),
            server_shutdown: Mutex::new(None),
            connections: Mutex::new(Vec::new()),
            pending: Mutex::new(HashMap::new()),
            rate_limits: Mutex::new(HashMap::new()),
        }
    }

    fn app(&self) -> Result<AppHandle, ApiError> {
        self.app
            .lock()
            .map_err(|_| ApiError::internal("Local MCP state is unavailable"))?
            .clone()
            .ok_or_else(|| ApiError::unavailable("NoteGen is starting"))
    }

    fn persist_connections(&self) -> Result<(), String> {
        let app = self
            .app
            .lock()
            .map_err(|_| "Local MCP state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "NoteGen is starting".to_string())?;
        let connections = self
            .connections
            .lock()
            .map_err(|_| "Local MCP connections are unavailable".to_string())?
            .clone();
        let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
        store.set(STORE_CONNECTIONS_KEY, json!(connections));
        store.save().map_err(|error| error.to_string())
    }

    fn persist_enabled(&self, enabled: bool) -> Result<(), String> {
        let app = self
            .app
            .lock()
            .map_err(|_| "Local MCP state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "NoteGen is starting".to_string())?;
        let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
        store.set(STORE_ENABLED_KEY, json!(enabled));
        store.save().map_err(|error| error.to_string())
    }

    fn persist_port(&self, port: u16) -> Result<(), String> {
        let app = self
            .app
            .lock()
            .map_err(|_| "Local MCP state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "NoteGen is starting".to_string())?;
        let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
        store.set(STORE_PORT_KEY, json!(port));
        store.save().map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
struct HttpState {
    app: AppHandle,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "unavailable",
            message: message.into(),
        }
    }

    fn rate_limited(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "rate_limited",
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": {
                    "code": -32000,
                    "message": self.message,
                    "data": { "code": self.code },
                }
            })),
        )
            .into_response()
    }
}

#[derive(Clone, Debug)]
struct BridgeError {
    code: String,
    message: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveLocalMcpRequest {
    request_id: String,
    result: Option<Value>,
    error: Option<ResolveLocalMcpError>,
}

#[derive(Debug, Deserialize)]
struct ResolveLocalMcpError {
    code: String,
    message: String,
    data: Option<Value>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn hash_value(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn create_token() -> String {
    let mut token_bytes = [0_u8; 32];
    token_bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    token_bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(token_bytes)
}

fn normalize_connection_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Connection name must contain between 1 and 80 characters".to_string());
    }
    Ok(name.to_string())
}

fn check_rate_limit(state: &LocalMcpState, connection_id: &str) -> Result<(), ApiError> {
    let now = now_ms();
    let cutoff = now.saturating_sub(RATE_LIMIT_WINDOW_MS);
    let mut limits = state
        .rate_limits
        .lock()
        .map_err(|_| ApiError::internal("Rate limit state is unavailable"))?;
    let requests = limits.entry(connection_id.to_string()).or_default();
    while requests
        .front()
        .is_some_and(|timestamp| *timestamp < cutoff)
    {
        requests.pop_front();
    }
    if requests.len() >= RATE_LIMIT_REQUESTS {
        return Err(ApiError::rate_limited("Too many local MCP requests"));
    }
    requests.push_back(now);
    Ok(())
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("Authorization bearer token is required"))?;
    value
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
        .ok_or_else(|| ApiError::unauthorized("Authorization bearer token is invalid"))
}

fn authorize(state: &LocalMcpState, headers: &HeaderMap) -> Result<LocalMcpConnection, ApiError> {
    if !state.enabled.load(Ordering::Relaxed) {
        return Err(ApiError::unavailable("Local MCP server is disabled"));
    }
    let token_hash = hash_value(bearer_token(headers)?);
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| ApiError::internal("Local MCP connections are unavailable"))?;
    let connection = connections
        .iter_mut()
        .find(|connection| connection.token_hash == token_hash)
        .ok_or_else(|| ApiError::unauthorized("Local MCP token is invalid or revoked"))?;
    connection.last_used_at = now_ms();
    let connection = connection.clone();
    drop(connections);
    state.persist_connections().map_err(ApiError::internal)?;
    check_rate_limit(state, &connection.id)?;
    Ok(connection)
}

fn read_annotations() -> Value {
    json!({
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false,
    })
}

fn write_annotations(idempotent: bool) -> Value {
    json!({
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": idempotent,
        "openWorldHint": false,
    })
}

fn tool_definitions() -> Vec<Value> {
    let empty = json!({ "type": "object", "properties": {}, "additionalProperties": false });
    vec![
        json!({
            "name": "notegen_get_context",
            "description": "Get the current NoteGen workspace and live editor context. Connections follow the workspace currently open in NoteGen.",
            "inputSchema": empty,
            "annotations": read_annotations(),
        }),
        json!({
            "name": "notegen_search",
            "description": "Search NoteGen articles, records, and canvases. Results are candidates; use notegen_read_sources to read the sources you need.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "mode": { "type": "string", "enum": ["rag", "keyword"] },
                    "sourceTypes": { "type": "array", "items": { "type": "string", "enum": ["article", "record", "canvas"] } },
                    "sourceMode": { "type": "string", "enum": ["prefer", "only"] },
                    "folderPath": { "type": "string" },
                    "tagId": { "type": "integer", "minimum": 1 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "notegen_read_sources",
            "description": "Read full content or the next page for candidates returned by notegen_search.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "requests": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": { "sourceKey": { "type": "string" }, "cursor": { "type": "string" } },
                            "required": ["sourceKey"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["requests"],
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "note_list",
            "description": "List Markdown files in the current NoteGen workspace, optionally restricted to a folder.",
            "inputSchema": {
                "type": "object",
                "properties": { "folderPath": { "type": "string" }, "recursive": { "type": "boolean", "default": true } },
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "note_read",
            "description": "Read a Markdown note, including unsaved content when it is active in the editor. Returns an opaque revision required by content-writing tools.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" } },
                "required": ["filePath"],
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "note_get_document_map",
            "description": "Read a note's headings, line ranges, and frontmatter keys for precise edits.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" } },
                "required": ["filePath"],
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "note_create",
            "description": "Create a new Markdown note. Existing files are never overwritten.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "content": { "type": "string" } },
                "required": ["filePath", "content"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_update",
            "description": "Replace a Markdown note's complete content when expectedRevision still matches.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "content": { "type": "string" }, "expectedRevision": { "type": "string" } },
                "required": ["filePath", "content", "expectedRevision"],
                "additionalProperties": false
            },
            "annotations": write_annotations(true),
        }),
        json!({
            "name": "note_append",
            "description": "Append Markdown to a note when expectedRevision still matches.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "content": { "type": "string" }, "expectedRevision": { "type": "string" } },
                "required": ["filePath", "content", "expectedRevision"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_patch",
            "description": "Apply non-overlapping line replacements or insertions to a Markdown note when expectedRevision still matches. All line numbers refer to the original content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filePath": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "operations": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": { "type": "string", "enum": ["replace_lines", "insert_before_line", "insert_after_line"] },
                                "startLine": { "type": "integer", "minimum": 1 },
                                "endLine": { "type": "integer", "minimum": 1 },
                                "line": { "type": "integer", "minimum": 1 },
                                "content": { "type": "string" }
                            },
                            "required": ["type", "content"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["filePath", "expectedRevision", "operations"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_copy",
            "description": "Copy a Markdown note to another folder, optionally with a new name.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "targetFolderPath": { "type": "string" }, "newName": { "type": "string" } },
                "required": ["filePath"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_move",
            "description": "Move a Markdown note to an existing folder.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "targetFolderPath": { "type": "string" } },
                "required": ["filePath", "targetFolderPath"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_rename",
            "description": "Rename a Markdown note without changing its folder.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" }, "newName": { "type": "string" } },
                "required": ["filePath", "newName"],
                "additionalProperties": false
            },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "note_delete",
            "description": "Move a Markdown note to the operating system trash and update NoteGen state.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" } },
                "required": ["filePath"],
                "additionalProperties": false
            },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            },
        }),
        json!({
            "name": "note_open",
            "description": "Open an existing Markdown note in the NoteGen editor.",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" } },
                "required": ["filePath"],
                "additionalProperties": false
            },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "tag_list",
            "description": "List NoteGen record tags.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "record_list", "description": "List NoteGen records, optionally filtered by tag.",
            "inputSchema": { "type": "object", "properties": { "tagId": { "type": "integer", "minimum": 1 }, "includeDeleted": { "type": "boolean", "default": false } }, "additionalProperties": false },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "record_create", "description": "Create a NoteGen record and update its knowledge index.",
            "inputSchema": { "type": "object", "properties": { "tagId": { "type": "integer", "minimum": 1 }, "type": { "type": "string", "enum": ["scan", "text", "image", "link", "file", "recording", "todo"], "default": "text" }, "content": { "type": "string" }, "description": { "type": "string" }, "url": { "type": "string" } }, "required": ["tagId"], "additionalProperties": false },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "record_update", "description": "Update an existing NoteGen record.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 }, "tagId": { "type": "integer", "minimum": 1 }, "content": { "type": "string" }, "description": { "type": "string" }, "url": { "type": "string" } }, "required": ["id"], "additionalProperties": false },
            "annotations": write_annotations(true),
        }),
        json!({
            "name": "record_delete", "description": "Move a NoteGen record to its trash.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 } }, "required": ["id"], "additionalProperties": false },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false },
        }),
        json!({
            "name": "record_restore", "description": "Restore a NoteGen record from its trash.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 } }, "required": ["id"], "additionalProperties": false },
            "annotations": write_annotations(false),
        }),
        json!({
            "name": "conversation_list", "description": "List NoteGen conversations.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }, "annotations": read_annotations(),
        }),
        json!({
            "name": "conversation_read", "description": "Read a NoteGen conversation and a page of its messages.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 }, "offset": { "type": "integer", "minimum": 0 }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 } }, "required": ["id"], "additionalProperties": false },
            "annotations": read_annotations(),
        }),
        json!({
            "name": "conversation_create", "description": "Create a NoteGen conversation.",
            "inputSchema": { "type": "object", "properties": { "title": { "type": "string" } }, "required": ["title"], "additionalProperties": false }, "annotations": write_annotations(false),
        }),
        json!({
            "name": "conversation_append", "description": "Append a user or assistant message to a NoteGen conversation. The system alias is accepted for compatibility.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 }, "role": { "type": "string", "enum": ["user", "assistant", "system"] }, "content": { "type": "string" } }, "required": ["id", "role", "content"], "additionalProperties": false }, "annotations": write_annotations(false),
        }),
        json!({
            "name": "conversation_rename", "description": "Rename a NoteGen conversation.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 }, "title": { "type": "string" } }, "required": ["id", "title"], "additionalProperties": false }, "annotations": write_annotations(true),
        }),
        json!({
            "name": "conversation_open", "description": "Open a NoteGen conversation in the app.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 } }, "required": ["id"], "additionalProperties": false }, "annotations": read_annotations(),
        }),
        json!({
            "name": "conversation_delete", "description": "Permanently delete a NoteGen conversation and its messages.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "integer", "minimum": 1 } }, "required": ["id"], "additionalProperties": false },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false },
        }),
        json!({
            "name": "canvas_list", "description": "List NoteGen canvas projects.",
            "inputSchema": { "type": "object", "properties": { "includeDeleted": { "type": "boolean", "default": false } }, "additionalProperties": false }, "annotations": read_annotations(),
        }),
        json!({
            "name": "canvas_create", "description": "Create a NoteGen native canvas.",
            "inputSchema": { "type": "object", "properties": { "title": { "type": "string" }, "canvasType": { "type": "string", "enum": ["blank", "flowchart", "mindmap", "timeline", "quadrant", "kanban", "swot"], "default": "blank" } }, "required": ["title"], "additionalProperties": false }, "annotations": write_annotations(false),
        }),
        json!({
            "name": "canvas_read", "description": "Read a NoteGen canvas including nodes, edges, positions, and settings.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" } }, "required": ["canvasId"], "additionalProperties": false }, "annotations": read_annotations(),
        }),
        json!({
            "name": "canvas_open", "description": "Open a canvas in the NoteGen interface.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" } }, "required": ["canvasId"], "additionalProperties": false }, "annotations": read_annotations(),
        }),
        json!({
            "name": "canvas_create_diagram", "description": "Create a complete diagram on a NoteGen canvas from named nodes and edges.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" }, "replaceExisting": { "type": "boolean" }, "nodes": { "type": "array", "minItems": 1, "items": { "type": "object", "properties": { "id": { "type": "string" }, "nodeType": { "type": "string" }, "label": { "type": "string" }, "description": { "type": "string" }, "x": { "type": "number" }, "y": { "type": "number" } }, "required": ["id", "nodeType", "label", "x", "y"], "additionalProperties": false } }, "edges": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "source": { "type": "string" }, "target": { "type": "string" }, "label": { "type": "string" } }, "required": ["id", "source", "target"], "additionalProperties": false } } }, "required": ["canvasId", "replaceExisting", "nodes", "edges"], "additionalProperties": false }, "annotations": write_annotations(true),
        }),
        json!({
            "name": "canvas_apply_operations", "description": "Incrementally add, update, move, or delete nodes and edges on a NoteGen canvas.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" }, "operations": { "type": "array", "minItems": 1, "items": { "type": "object", "properties": { "type": { "type": "string", "enum": ["add_node", "update_node", "delete_node", "add_edge", "delete_edge", "clear"] }, "id": { "type": "string" }, "nodeType": { "type": "string" }, "label": { "type": "string" }, "description": { "type": "string" }, "x": { "type": "number" }, "y": { "type": "number" }, "source": { "type": "string" }, "target": { "type": "string" } }, "required": ["type"], "additionalProperties": false } } }, "required": ["canvasId", "operations"], "additionalProperties": false }, "annotations": write_annotations(false),
        }),
        json!({
            "name": "canvas_rename", "description": "Rename a NoteGen canvas.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" }, "title": { "type": "string" } }, "required": ["canvasId", "title"], "additionalProperties": false }, "annotations": write_annotations(true),
        }),
        json!({
            "name": "canvas_delete", "description": "Move a NoteGen canvas to its trash.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" } }, "required": ["canvasId"], "additionalProperties": false },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false },
        }),
        json!({
            "name": "canvas_restore", "description": "Restore a NoteGen canvas from its trash.",
            "inputSchema": { "type": "object", "properties": { "canvasId": { "type": "string" } }, "required": ["canvasId"], "additionalProperties": false }, "annotations": write_annotations(false),
        }),
    ]
}

fn tool_exists(name: &str) -> bool {
    tool_definitions()
        .iter()
        .any(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
}

fn jsonrpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn jsonrpc_error(id: Value, code: i64, message: impl Into<String>, data: Option<Value>) -> Value {
    let mut error = json!({ "code": code, "message": message.into() });
    if let Some(data) = data {
        error["data"] = data;
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error })
}

async fn request_frontend(
    state: &LocalMcpState,
    connection: &LocalMcpConnection,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, BridgeError> {
    if !state.ready.load(Ordering::Relaxed) {
        return Err(BridgeError {
            code: "not_ready".to_string(),
            message: "NoteGen is still initializing".to_string(),
            data: None,
        });
    }
    let request_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    state
        .pending
        .lock()
        .map_err(|_| BridgeError {
            code: "bridge_unavailable".to_string(),
            message: "Local MCP bridge state is unavailable".to_string(),
            data: None,
        })?
        .insert(request_id.clone(), sender);
    let emit_result = state
        .app()
        .map_err(|error| BridgeError {
            code: error.code.to_string(),
            message: error.message,
            data: None,
        })?
        .emit(
            "local-mcp://request",
            json!({
                "requestId": request_id,
                "connection": LocalMcpConnectionView::from(connection),
                "toolName": tool_name,
                "arguments": arguments,
            }),
        );
    if let Err(error) = emit_result {
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&request_id);
        }
        return Err(BridgeError {
            code: "bridge_emit_failed".to_string(),
            message: error.to_string(),
            data: None,
        });
    }
    match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(BridgeError {
            code: "bridge_closed".to_string(),
            message: "Local MCP bridge closed unexpectedly".to_string(),
            data: None,
        }),
        Err(_) => {
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&request_id);
            }
            Err(BridgeError {
                code: "request_timeout".to_string(),
                message: "NoteGen did not respond within 120 seconds".to_string(),
                data: None,
            })
        }
    }
}

async fn handle_mcp(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let state = http.app.state::<LocalMcpState>();
    let connection = authorize(&state, &headers)?;
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let method = body.get("method").and_then(Value::as_str).unwrap_or("");

    if method == "notifications/initialized" {
        return Ok(StatusCode::ACCEPTED.into_response());
    }

    let response = match method {
        "initialize" => jsonrpc_result(
            id,
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": {
                    "name": "notegen",
                    "title": "NoteGen Local MCP",
                    "version": http.app.package_info().version.to_string(),
                },
                "instructions": "This connection follows the workspace currently open in NoteGen. Use notegen_get_context when the task depends on the active workspace or editor. For knowledge retrieval, call notegen_search first, then use notegen_read_sources to read the relevant candidates. Before changing a note, call note_read and pass its revision as expectedRevision to note_update, note_append, or note_patch. Prefer note_patch for localized edits and note_update only when replacing the complete document. Resolve paths, IDs, and revisions with list, search, or read tools instead of guessing them. Only delete, move, rename, clear, or replace content when the user's intent is explicit."
            }),
        ),
        "ping" => jsonrpc_result(id, json!({})),
        "tools/list" => jsonrpc_result(id, json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let params = body.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            if !tool_exists(name) {
                jsonrpc_error(
                    id,
                    -32602,
                    format!("Unknown NoteGen tool: {name}"),
                    Some(json!({ "code": "unknown_tool" })),
                )
            } else {
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match request_frontend(&state, &connection, name, arguments).await {
                    Ok(result) => jsonrpc_result(id, result),
                    Err(error) => jsonrpc_error(
                        id,
                        -32002,
                        error.message,
                        Some(json!({ "code": error.code, "details": error.data })),
                    ),
                }
            }
        }
        _ => jsonrpc_error(id, -32601, format!("Method not found: {method}"), None),
    };

    Ok(Json(response).into_response())
}

fn install_server(app: AppHandle, listener: tokio::net::TcpListener, port: u16) -> Result<(), String> {
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let previous_shutdown = {
        let state = app.state::<LocalMcpState>();
        let mut shutdown = state
            .server_shutdown
            .lock()
            .map_err(|_| "Local MCP server state is unavailable".to_string())?;
        let previous = shutdown.replace(shutdown_sender);
        state.port.store(port, Ordering::Relaxed);
        if let Ok(mut error) = state.server_error.lock() {
            *error = None;
        }
        previous
    };
    if let Some(shutdown) = previous_shutdown {
        let _ = shutdown.send(());
    }

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/mcp", post(handle_mcp))
            .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
            .with_state(HttpState { app: app.clone() });
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_receiver.await;
            })
            .await;
        if let Err(error) = result {
            let state = app.state::<LocalMcpState>();
            if state.port.load(Ordering::Relaxed) == port {
                *state
                    .server_error
                    .lock()
                    .expect("local MCP server error poisoned") = Some(error.to_string());
            }
        }
    });
    Ok(())
}

fn stop_server(state: &LocalMcpState) -> Result<(), String> {
    if let Some(shutdown) = state
        .server_shutdown
        .lock()
        .map_err(|_| "Local MCP server state is unavailable".to_string())?
        .take()
    {
        let _ = shutdown.send(());
    }
    if let Ok(mut error) = state.server_error.lock() {
        *error = None;
    }
    Ok(())
}

async fn bind_server(app: AppHandle, port: u16) -> Result<(), String> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| error.to_string())?;
    install_server(app, listener, port)
}

pub fn start_server(app: &AppHandle) {
    let state = app.state::<LocalMcpState>();
    *state.app.lock().expect("local MCP app state poisoned") = Some(app.clone());

    if let Ok(store) = app.store(STORE_PATH) {
        state.enabled.store(
            store
                .get(STORE_ENABLED_KEY)
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            Ordering::Relaxed,
        );
        if let Some(value) = store.get(STORE_CONNECTIONS_KEY) {
            if let Ok(connections) = serde_json::from_value::<Vec<LocalMcpConnection>>(value) {
                *state
                    .connections
                    .lock()
                    .expect("local MCP connections poisoned") = connections;
            }
        }
        let port = store
            .get(STORE_PORT_KEY)
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value >= 1024)
            .unwrap_or(LOCAL_MCP_PORT);
        state.port.store(port, Ordering::Relaxed);
    }

    if !state.enabled.load(Ordering::Relaxed) {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let port = app_handle
            .state::<LocalMcpState>()
            .port
            .load(Ordering::Relaxed);
        if let Err(error) = bind_server(app_handle.clone(), port).await {
            *app_handle
                .state::<LocalMcpState>()
                .server_error
                .lock()
                .expect("local MCP server error poisoned") = Some(error);
        }
    });
}

#[tauri::command]
pub fn set_local_mcp_ready(ready: bool, state: TauriState<'_, LocalMcpState>) {
    state.ready.store(ready, Ordering::Relaxed);
}

#[tauri::command]
pub async fn set_local_mcp_enabled(
    enabled: bool,
    app: AppHandle,
    state: TauriState<'_, LocalMcpState>,
) -> Result<(), String> {
    let current = state.enabled.load(Ordering::Relaxed);
    let server_has_error = state
        .server_error
        .lock()
        .map_err(|_| "Local MCP server state is unavailable".to_string())?
        .is_some();
    if current == enabled && (!enabled || !server_has_error) {
        return Ok(());
    }

    if !enabled {
        state.persist_enabled(false)?;
        state.enabled.store(false, Ordering::Relaxed);
        return stop_server(&state);
    }

    let port = state.port.load(Ordering::Relaxed);
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| error.to_string())?;
    state.persist_enabled(true)?;
    state.enabled.store(true, Ordering::Relaxed);
    if let Err(error) = install_server(app, listener, port) {
        state.enabled.store(false, Ordering::Relaxed);
        let _ = state.persist_enabled(false);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn get_local_mcp_status(state: TauriState<'_, LocalMcpState>) -> Value {
    json!({
        "enabled": state.enabled.load(Ordering::Relaxed),
        "ready": state.ready.load(Ordering::Relaxed),
        "port": state.port.load(Ordering::Relaxed),
        "serverError": state.server_error.lock().ok().and_then(|value| value.clone()),
    })
}

#[tauri::command]
pub async fn set_local_mcp_port(
    port: u16,
    app: AppHandle,
    state: TauriState<'_, LocalMcpState>,
) -> Result<Value, String> {
    if port < 1024 {
        return Err("Local MCP port must be between 1024 and 65535".to_string());
    }
    let current_port = state.port.load(Ordering::Relaxed);
    let enabled = state.enabled.load(Ordering::Relaxed);
    let server_has_error = state
        .server_error
        .lock()
        .map_err(|_| "Local MCP server state is unavailable".to_string())?
        .is_some();
    if current_port == port && (!enabled || !server_has_error) {
        return Ok(get_local_mcp_status(state));
    }

    if !enabled {
        state.persist_port(port)?;
        state.port.store(port, Ordering::Relaxed);
        if let Ok(mut error) = state.server_error.lock() {
            *error = None;
        }
        return Ok(get_local_mcp_status(state));
    }

    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| error.to_string())?;
    state.persist_port(port)?;
    install_server(app, listener, port)?;
    Ok(get_local_mcp_status(state))
}

#[tauri::command]
pub fn list_local_mcp_connections(
    state: TauriState<'_, LocalMcpState>,
) -> Result<Vec<LocalMcpConnectionView>, String> {
    Ok(state
        .connections
        .lock()
        .map_err(|_| "Local MCP connections are unavailable".to_string())?
        .iter()
        .map(LocalMcpConnectionView::from)
        .collect())
}

#[tauri::command]
pub fn create_local_mcp_connection(
    name: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<Value, String> {
    let name = normalize_connection_name(&name)?;
    let token = create_token();
    let now = now_ms();
    let connection = LocalMcpConnection {
        id: Uuid::new_v4().to_string(),
        name,
        token_hash: hash_value(&token),
        token: Some(token.clone()),
        created_at: now,
        last_used_at: 0,
    };
    state
        .connections
        .lock()
        .map_err(|_| "Local MCP connections are unavailable".to_string())?
        .push(connection.clone());
    if let Err(error) = state.persist_connections() {
        if let Ok(mut connections) = state.connections.lock() {
            connections.retain(|item| item.id != connection.id);
        }
        return Err(error);
    }
    Ok(json!({
        "connection": LocalMcpConnectionView::from(&connection),
        "token": token,
    }))
}

#[tauri::command]
pub fn get_or_create_local_mcp_connection(
    name: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<Value, String> {
    let existing_connection = {
        let connections = state
            .connections
            .lock()
            .map_err(|_| "Local MCP connections are unavailable".to_string())?;
        connections
            .iter()
            .rev()
            .find(|connection| connection.token.is_some())
            .cloned()
    };
    if let Some(connection) = existing_connection {
        let token = connection
            .token
            .clone()
            .ok_or_else(|| "Local MCP access token is unavailable".to_string())?;
        return Ok(json!({
            "connection": LocalMcpConnectionView::from(&connection),
            "token": token,
        }));
    }

    create_local_mcp_connection(name, state)
}

#[tauri::command]
pub fn rename_local_mcp_connection(
    id: String,
    name: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<(), String> {
    let name = normalize_connection_name(&name)?;
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| "Local MCP connections are unavailable".to_string())?;
    let connection = connections
        .iter_mut()
        .find(|connection| connection.id == id)
        .ok_or_else(|| "Local MCP connection was not found".to_string())?;
    let previous_name = connection.name.clone();
    connection.name = name;
    drop(connections);
    if let Err(error) = state.persist_connections() {
        if let Ok(mut connections) = state.connections.lock() {
            if let Some(connection) = connections
                .iter_mut()
                .find(|connection| connection.id == id)
            {
                connection.name = previous_name;
            }
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn reset_local_mcp_connection_token(
    id: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<Value, String> {
    let token = create_token();
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| "Local MCP connections are unavailable".to_string())?;
    let connection = connections
        .iter_mut()
        .find(|connection| connection.id == id)
        .ok_or_else(|| "Local MCP connection was not found".to_string())?;
    let previous_hash = connection.token_hash.clone();
    let previous_token = connection.token.clone();
    connection.token_hash = hash_value(&token);
    connection.token = Some(token.clone());
    let connection = connection.clone();
    drop(connections);
    if let Err(error) = state.persist_connections() {
        if let Ok(mut connections) = state.connections.lock() {
            if let Some(item) = connections.iter_mut().find(|item| item.id == id) {
                item.token_hash = previous_hash;
                item.token = previous_token;
            }
        }
        return Err(error);
    }
    Ok(json!({
        "connection": LocalMcpConnectionView::from(&connection),
        "token": token,
    }))
}

#[tauri::command]
pub fn reset_local_mcp_access_token(
    name: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<Value, String> {
    let name = normalize_connection_name(&name)?;
    let token = create_token();
    let now = now_ms();
    let connection = LocalMcpConnection {
        id: Uuid::new_v4().to_string(),
        name,
        token_hash: hash_value(&token),
        token: Some(token.clone()),
        created_at: now,
        last_used_at: 0,
    };
    let previous_connections = {
        let mut connections = state
            .connections
            .lock()
            .map_err(|_| "Local MCP connections are unavailable".to_string())?;
        let previous = connections.clone();
        connections.clear();
        connections.push(connection.clone());
        previous
    };
    if let Err(error) = state.persist_connections() {
        if let Ok(mut connections) = state.connections.lock() {
            *connections = previous_connections;
        }
        return Err(error);
    }
    if let Ok(mut limits) = state.rate_limits.lock() {
        limits.clear();
    }
    Ok(json!({
        "connection": LocalMcpConnectionView::from(&connection),
        "token": token,
    }))
}

#[tauri::command]
pub fn revoke_local_mcp_connection(
    id: String,
    state: TauriState<'_, LocalMcpState>,
) -> Result<(), String> {
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| "Local MCP connections are unavailable".to_string())?;
    let index = connections
        .iter()
        .position(|connection| connection.id == id)
        .ok_or_else(|| "Local MCP connection was not found".to_string())?;
    let removed = connections.remove(index);
    drop(connections);
    if let Err(error) = state.persist_connections() {
        if let Ok(mut connections) = state.connections.lock() {
            let restore_index = index.min(connections.len());
            connections.insert(restore_index, removed);
        }
        return Err(error);
    }
    if let Ok(mut limits) = state.rate_limits.lock() {
        limits.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_local_mcp_request(
    body: ResolveLocalMcpRequest,
    state: TauriState<'_, LocalMcpState>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Local MCP bridge state is unavailable".to_string())?
        .remove(&body.request_id)
        .ok_or_else(|| "Local MCP request was not found".to_string())?;
    let result = if let Some(error) = body.error {
        Err(BridgeError {
            code: error.code,
            message: error.message,
            data: error.data,
        })
    } else {
        Ok(body.result.unwrap_or_else(|| json!({})))
    };
    sender
        .send(result)
        .map_err(|_| "Local MCP response receiver closed".to_string())
}
