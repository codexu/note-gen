use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
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
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;
use uuid::Uuid;

pub const WEB_CLIPPER_PORT: u16 = 37_421;
const PROTOCOL_VERSION: u8 = 1;
const PAIRING_TTL_MS: u64 = 120_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const STORE_PATH: &str = "web-clipper.json";
const STORE_ENABLED_KEY: &str = "enabled";
const STORE_CONNECTIONS_KEY: &str = "connections";
const PROTOCOL_HEADER: &str = "x-notegen-protocol-version";
const EXTENSION_CLIENT_ID_HEADER: &str = "x-notegen-client-id";
const MAX_MARKDOWN_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebClipperConnection {
    pub id: String,
    pub install_id: String,
    pub origin: String,
    pub browser: String,
    pub extension_version: String,
    pub token_hash: String,
    pub created_at: u64,
    pub last_used_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebClipperConnectionView {
    pub id: String,
    pub install_id: String,
    pub origin: String,
    pub browser: String,
    pub extension_version: String,
    pub created_at: u64,
    pub last_used_at: u64,
}

impl From<&WebClipperConnection> for WebClipperConnectionView {
    fn from(value: &WebClipperConnection) -> Self {
        Self {
            id: value.id.clone(),
            install_id: value.install_id.clone(),
            origin: value.origin.clone(),
            browser: value.browser.clone(),
            extension_version: value.extension_version.clone(),
            created_at: value.created_at,
            last_used_at: value.last_used_at,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingEvent {
    id: String,
    install_id: String,
    origin: String,
    browser: String,
    extension_version: String,
    expires_at: u64,
}

#[derive(Clone, Debug)]
struct PairingRequest {
    event: PairingEvent,
    code_challenge: String,
    status: PairingStatus,
}

#[derive(Clone, Debug)]
enum PairingStatus {
    Pending,
    Approved { token: String },
    Rejected,
}

type PendingBridgeRequest = oneshot::Sender<Result<Value, ApiError>>;

pub struct WebClipperState {
    app: Mutex<Option<AppHandle>>,
    enabled: AtomicBool,
    ready: AtomicBool,
    server_error: Mutex<Option<String>>,
    connections: Mutex<Vec<WebClipperConnection>>,
    pairings: Mutex<HashMap<String, PairingRequest>>,
    pending: Mutex<HashMap<String, PendingBridgeRequest>>,
    rate_limits: Mutex<HashMap<String, VecDeque<u64>>>,
}

impl WebClipperState {
    pub fn new() -> Self {
        Self {
            app: Mutex::new(None),
            enabled: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            server_error: Mutex::new(None),
            connections: Mutex::new(Vec::new()),
            pairings: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            rate_limits: Mutex::new(HashMap::new()),
        }
    }

    fn app(&self) -> Result<AppHandle, ApiError> {
        self.app
            .lock()
            .map_err(|_| ApiError::internal("Web clipper state is unavailable"))?
            .clone()
            .ok_or_else(|| ApiError::unavailable("NoteGen is starting"))
    }

    fn persist_connections(&self) -> Result<(), String> {
        let app = self
            .app
            .lock()
            .map_err(|_| "Web clipper state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "NoteGen is starting".to_string())?;
        let connections = self
            .connections
            .lock()
            .map_err(|_| "Web clipper connections are unavailable".to_string())?
            .clone();
        let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
        store.set(STORE_CONNECTIONS_KEY, json!(connections));
        store.save().map_err(|error| error.to_string())
    }

    fn persist_enabled(&self) -> Result<(), String> {
        let app = self
            .app
            .lock()
            .map_err(|_| "Web clipper state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "NoteGen is starting".to_string())?;
        let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
        store.set(
            STORE_ENABLED_KEY,
            json!(self.enabled.load(Ordering::Relaxed)),
        );
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
    fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message: message.into(),
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "not-paired",
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "origin-not-allowed",
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "app-not-ready",
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal-error",
            message: message.into(),
        }
    }

    fn rate_limited(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "rate-limited",
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": { "code": self.code, "message": self.message } })),
        )
            .into_response()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePairingBody {
    install_id: String,
    browser: String,
    extension_version: String,
    code_challenge: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangePairingBody {
    verifier: String,
}

#[derive(Debug, Deserialize)]
struct CreateTagBody {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBridgeBody {
    request_id: String,
    result: Option<Value>,
    error: Option<BridgeErrorBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeErrorBody {
    code: String,
    message: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn hash_value(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

fn is_extension_origin(origin: &str) -> bool {
    let prefix = if origin.starts_with("chrome-extension://") {
        "chrome-extension://"
    } else if origin.starts_with("extension://") {
        "extension://"
    } else {
        return false;
    };
    let id = &origin[prefix.len()..];
    is_extension_id(id)
}

fn is_extension_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && id.len() <= 128
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn optional_request_origin(headers: &HeaderMap) -> Result<Option<String>, ApiError> {
    let header_origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let client_id = headers
        .get(EXTENSION_CLIENT_ID_HEADER)
        .and_then(|value| value.to_str().ok());

    if let Some(origin) = header_origin {
        if !is_extension_origin(origin) {
            return Err(ApiError::forbidden("Only browser extensions can connect"));
        }
        if client_id.is_some_and(|id| !origin.ends_with(&format!("://{id}"))) {
            return Err(ApiError::forbidden("Extension origin headers do not match"));
        }
        return Ok(Some(origin.to_string()));
    }

    let Some(id) = client_id else {
        return Ok(None);
    };
    if !is_extension_id(id) {
        return Err(ApiError::forbidden("Only browser extensions can connect"));
    }
    Ok(Some(format!("chrome-extension://{id}")))
}

fn request_origin(headers: &HeaderMap) -> Result<String, ApiError> {
    optional_request_origin(headers)?
        .ok_or_else(|| ApiError::forbidden("Extension client ID is required"))
}

fn request_install_id(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get("x-notegen-install-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("Extension installation ID is required"))
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("Pair NoteGen before saving clips"))
}

fn validate_protocol(headers: &HeaderMap) -> Result<(), ApiError> {
    let version = headers
        .get(PROTOCOL_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u8>().ok());
    if version != Some(PROTOCOL_VERSION) {
        return Err(ApiError::bad_request(
            "protocol-mismatch",
            format!("NoteGen web clipper protocol {PROTOCOL_VERSION} is required"),
        ));
    }
    Ok(())
}

fn valid_sha256_challenge(challenge: &str) -> bool {
    URL_SAFE_NO_PAD
        .decode(challenge)
        .map(|bytes| bytes.len() == 32)
        .unwrap_or(false)
}

fn check_rate_limit(
    state: &WebClipperState,
    key: String,
    maximum: usize,
    window_ms: u64,
) -> Result<(), ApiError> {
    let now = now_ms();
    let mut limits = state
        .rate_limits
        .lock()
        .map_err(|_| ApiError::internal("Rate limit state is unavailable"))?;
    let attempts = limits.entry(key).or_default();
    while attempts
        .front()
        .is_some_and(|timestamp| now.saturating_sub(*timestamp) >= window_ms)
    {
        attempts.pop_front();
    }
    if attempts.len() >= maximum {
        return Err(ApiError::rate_limited("Too many web clipper requests"));
    }
    attempts.push_back(now);
    Ok(())
}

fn validate_clip_size(payload: &Value) -> Result<(), ApiError> {
    let markdown = payload
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("invalid-request", "Clip Markdown is required"))?;
    if markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(ApiError::bad_request(
            "content-too-large",
            "Clip Markdown exceeds 2 MiB",
        ));
    }
    if payload
        .get("plainText")
        .and_then(Value::as_str)
        .is_some_and(|text| text.len() > MAX_MARKDOWN_BYTES)
    {
        return Err(ApiError::bad_request(
            "content-too-large",
            "Clipped text exceeds 2 MiB",
        ));
    }
    Ok(())
}

fn authorize(
    state: &WebClipperState,
    headers: &HeaderMap,
) -> Result<WebClipperConnection, ApiError> {
    validate_protocol(headers)?;
    if !state.enabled.load(Ordering::Relaxed) {
        return Err(ApiError::unavailable("Web clipper is disabled"));
    }
    let origin = optional_request_origin(headers)?;
    let install_id = request_install_id(headers)?;
    let token_hash = hash_value(bearer_token(headers)?);
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| ApiError::internal("Web clipper connections are unavailable"))?;
    let connection = connections
        .iter_mut()
        .find(|connection| {
            origin
                .as_ref()
                .is_none_or(|request_origin| connection.origin == *request_origin)
                && connection.install_id == install_id
                && connection.token_hash == token_hash
        })
        .ok_or_else(|| ApiError::unauthorized("Pairing token is invalid or revoked"))?;
    connection.last_used_at = now_ms();
    let result = connection.clone();
    drop(connections);
    let _ = state.persist_connections();
    Ok(result)
}

async fn cors_middleware(request: Request<Body>, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_extension_origin(value))
        .map(str::to_string);

    if request.method() == Method::OPTIONS {
        if origin.is_none() {
            return ApiError::forbidden("Only browser extensions can connect").into_response();
        }
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers(response.headers_mut(), origin.as_deref());
        return response;
    }

    let mut response = next.run(request).await;
    apply_cors_headers(response.headers_mut(), origin.as_deref());
    response
}

fn apply_cors_headers(headers: &mut HeaderMap, origin: Option<&str>) {
    let Some(origin) = origin else { return };
    if let Ok(value) = HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(
                "Authorization, Content-Type, X-NoteGen-Install-ID, X-NoteGen-Protocol-Version, X-NoteGen-Client-ID",
            ),
        );
    }
}

pub fn start_server(app: &AppHandle) {
    let state = app.state::<WebClipperState>();
    *state.app.lock().expect("web clipper app state poisoned") = Some(app.clone());

    if let Ok(store) = app.store(STORE_PATH) {
        let enabled = store
            .get(STORE_ENABLED_KEY)
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        state.enabled.store(enabled, Ordering::Relaxed);
        if let Some(value) = store.get(STORE_CONNECTIONS_KEY) {
            if let Ok(connections) = serde_json::from_value::<Vec<WebClipperConnection>>(value) {
                *state
                    .connections
                    .lock()
                    .expect("web clipper connections poisoned") = connections;
            }
        }
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/v1/health", get(health))
            .route("/v1/pairing-requests", post(create_pairing))
            .route(
                "/v1/pairing-requests/{id}",
                get(pairing_status).delete(reject_pairing_http),
            )
            .route("/v1/pairing-requests/{id}/exchange", post(exchange_pairing))
            .route("/v1/context", get(context))
            .route("/v1/tags", post(create_tag))
            .route("/v1/clips", post(create_clip))
            .layer(DefaultBodyLimit::max(2 * 1024 * 1024 + 64 * 1024))
            .layer(middleware::from_fn(cors_middleware))
            .with_state(HttpState {
                app: app_handle.clone(),
            });
        let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), WEB_CLIPPER_PORT);
        match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => {
                if let Err(error) = axum::serve(listener, router).await {
                    *app_handle
                        .state::<WebClipperState>()
                        .server_error
                        .lock()
                        .expect("web clipper server error poisoned") = Some(error.to_string());
                }
            }
            Err(error) => {
                *app_handle
                    .state::<WebClipperState>()
                    .server_error
                    .lock()
                    .expect("web clipper server error poisoned") = Some(error.to_string());
            }
        }
    });
}

async fn health(State(http): State<HttpState>) -> Result<Json<Value>, ApiError> {
    let state = http.app.state::<WebClipperState>();
    let server_error = state
        .server_error
        .lock()
        .ok()
        .and_then(|value| value.clone());
    Ok(Json(json!({
        "protocolVersion": PROTOCOL_VERSION,
        "appVersion": http.app.package_info().version.to_string(),
        "enabled": state.enabled.load(Ordering::Relaxed),
        "ready": state.ready.load(Ordering::Relaxed),
        "automaticPairing": true,
        "serverError": server_error,
    })))
}

async fn create_pairing(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Json(body): Json<CreatePairingBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let state = http.app.state::<WebClipperState>();
    if !state.enabled.load(Ordering::Relaxed) {
        return Err(ApiError::unavailable("Web clipper is disabled"));
    }
    let origin = request_origin(&headers)?;
    validate_protocol(&headers)?;
    check_rate_limit(&state, format!("pairing:{origin}"), 10, PAIRING_TTL_MS)?;
    if body.install_id.len() < 8 || body.install_id.len() > 128 {
        return Err(ApiError::bad_request(
            "invalid-request",
            "Invalid extension installation ID",
        ));
    }
    if !valid_sha256_challenge(&body.code_challenge) {
        return Err(ApiError::bad_request(
            "invalid-request",
            "Invalid pairing challenge",
        ));
    }
    let id = Uuid::new_v4().to_string();
    let event = PairingEvent {
        id: id.clone(),
        install_id: body.install_id,
        origin,
        browser: body.browser.chars().take(80).collect(),
        extension_version: body.extension_version.chars().take(40).collect(),
        expires_at: now_ms() + PAIRING_TTL_MS,
    };
    state
        .pairings
        .lock()
        .map_err(|_| ApiError::internal("Pairing state is unavailable"))?
        .insert(
            id.clone(),
            PairingRequest {
                event: event.clone(),
                code_challenge: body.code_challenge,
                status: PairingStatus::Pending,
            },
        );
    approve_pairing(&state, &id).map_err(ApiError::internal)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "id": id, "status": "approved", "expiresAt": event.expires_at })),
    ))
}

async fn pairing_status(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let origin = optional_request_origin(&headers)?;
    let install_id = request_install_id(&headers)?;
    let state = http.app.state::<WebClipperState>();
    let pairings = state
        .pairings
        .lock()
        .map_err(|_| ApiError::internal("Pairing state is unavailable"))?;
    let pairing = pairings
        .get(&id)
        .ok_or_else(|| ApiError::bad_request("pairing-expired", "Pairing request was not found"))?;
    if origin
        .as_ref()
        .is_some_and(|request_origin| pairing.event.origin != *request_origin)
        || pairing.event.install_id != install_id
        || pairing.event.expires_at < now_ms()
    {
        return Err(ApiError::bad_request(
            "pairing-expired",
            "Pairing request expired",
        ));
    }
    let status = match pairing.status {
        PairingStatus::Pending => "pending",
        PairingStatus::Approved { .. } => "approved",
        PairingStatus::Rejected => "rejected",
    };
    Ok(Json(
        json!({ "id": id, "status": status, "expiresAt": pairing.event.expires_at }),
    ))
}

async fn reject_pairing_http(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let origin = optional_request_origin(&headers)?;
    let install_id = request_install_id(&headers)?;
    let state = http.app.state::<WebClipperState>();
    let mut pairings = state
        .pairings
        .lock()
        .map_err(|_| ApiError::internal("Pairing state is unavailable"))?;
    if let Some(pairing) = pairings.get(&id) {
        if origin
            .as_ref()
            .is_some_and(|request_origin| pairing.event.origin != *request_origin)
            || pairing.event.install_id != install_id
        {
            return Err(ApiError::forbidden(
                "Pairing request belongs to another extension",
            ));
        }
    }
    pairings.remove(&id);
    Ok(StatusCode::NO_CONTENT)
}

async fn exchange_pairing(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ExchangePairingBody>,
) -> Result<Json<Value>, ApiError> {
    let origin = optional_request_origin(&headers)?;
    let install_id = request_install_id(&headers)?;
    let state = http.app.state::<WebClipperState>();
    let mut pairings = state
        .pairings
        .lock()
        .map_err(|_| ApiError::internal("Pairing state is unavailable"))?;
    let pairing = pairings
        .get(&id)
        .cloned()
        .ok_or_else(|| ApiError::bad_request("pairing-expired", "Pairing request was not found"))?;
    if origin
        .as_ref()
        .is_some_and(|request_origin| pairing.event.origin != *request_origin)
        || pairing.event.install_id != install_id
        || pairing.event.expires_at < now_ms()
    {
        pairings.remove(&id);
        return Err(ApiError::bad_request(
            "pairing-expired",
            "Pairing request expired",
        ));
    }
    if hash_value(&body.verifier) != pairing.code_challenge {
        return Err(ApiError::bad_request(
            "invalid-verifier",
            "Pairing verifier does not match",
        ));
    }
    match pairing.status {
        PairingStatus::Pending => Err(ApiError::bad_request(
            "pairing-pending",
            "Pairing is waiting for approval",
        )),
        PairingStatus::Rejected => {
            pairings.remove(&id);
            Err(ApiError::bad_request(
                "pairing-rejected",
                "Pairing was rejected",
            ))
        }
        PairingStatus::Approved { token } => {
            pairings.remove(&id);
            Ok(Json(
                json!({ "token": token, "protocolVersion": PROTOCOL_VERSION }),
            ))
        }
    }
}

async fn request_frontend(
    state: &WebClipperState,
    kind: &str,
    payload: Value,
) -> Result<Value, ApiError> {
    if !state.ready.load(Ordering::Relaxed) {
        return Err(ApiError::unavailable("NoteGen is still initializing"));
    }
    let request_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    state
        .pending
        .lock()
        .map_err(|_| ApiError::internal("Bridge state is unavailable"))?
        .insert(request_id.clone(), sender);
    state
        .app()?
        .emit(
            "web-clipper://request",
            json!({
                "requestId": request_id,
                "kind": kind,
                "payload": payload,
            }),
        )
        .map_err(|error| ApiError::internal(error.to_string()))?;
    match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(ApiError::internal("Web clipper bridge closed unexpectedly")),
        Err(_) => {
            state
                .pending
                .lock()
                .map_err(|_| ApiError::internal("Bridge state is unavailable"))?
                .remove(&request_id);
            Err(ApiError::unavailable("NoteGen did not respond in time"))
        }
    }
}

async fn context(
    State(http): State<HttpState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let state = http.app.state::<WebClipperState>();
    let connection = authorize(&state, &headers)?;
    let result =
        request_frontend(&state, "context", json!({ "connectionId": connection.id })).await?;
    Ok(Json(result))
}

async fn create_clip(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let state = http.app.state::<WebClipperState>();
    let connection = authorize(&state, &headers)?;
    validate_clip_size(&payload)?;
    check_rate_limit(&state, format!("clip:{}", connection.id), 120, 60_000)?;
    let result = request_frontend(
        &state,
        "createClip",
        json!({
            "connection": WebClipperConnectionView::from(&connection),
            "clip": payload,
        }),
    )
    .await?;
    let status = if result.get("status").and_then(Value::as_str) == Some("duplicate") {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((status, Json(result)))
}

async fn create_tag(
    State(http): State<HttpState>,
    headers: HeaderMap,
    Json(body): Json<CreateTagBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let state = http.app.state::<WebClipperState>();
    let connection = authorize(&state, &headers)?;
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(ApiError::bad_request(
            "invalid-tag-name",
            "Tag name must contain between 1 and 100 characters",
        ));
    }
    check_rate_limit(&state, format!("tag:{}", connection.id), 30, 60_000)?;
    let result = request_frontend(
        &state,
        "createTag",
        json!({
            "connection": WebClipperConnectionView::from(&connection),
            "name": name,
        }),
    )
    .await?;
    let status = if result.get("alreadyExists").and_then(Value::as_bool) == Some(true) {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((status, Json(result)))
}

#[tauri::command]
pub fn approve_web_clipper_pairing(
    id: String,
    state: TauriState<'_, WebClipperState>,
) -> Result<(), String> {
    approve_pairing(&state, &id)
}

fn approve_pairing(state: &WebClipperState, id: &str) -> Result<(), String> {
    let mut pairings = state
        .pairings
        .lock()
        .map_err(|_| "Pairing state is unavailable".to_string())?;
    let pairing = pairings
        .get_mut(id)
        .ok_or_else(|| "Pairing request was not found".to_string())?;
    if pairing.event.expires_at < now_ms() {
        pairings.remove(id);
        return Err("Pairing request expired".to_string());
    }
    let mut token_bytes = [0_u8; 32];
    token_bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    token_bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    let token = URL_SAFE_NO_PAD.encode(token_bytes);
    let now = now_ms();
    let connection = WebClipperConnection {
        id: Uuid::new_v4().to_string(),
        install_id: pairing.event.install_id.clone(),
        origin: pairing.event.origin.clone(),
        browser: pairing.event.browser.clone(),
        extension_version: pairing.event.extension_version.clone(),
        token_hash: hash_value(&token),
        created_at: now,
        last_used_at: now,
    };
    let mut connections = state
        .connections
        .lock()
        .map_err(|_| "Web clipper connections are unavailable".to_string())?;
    connections.retain(|item| {
        item.install_id != connection.install_id || item.origin != connection.origin
    });
    connections.push(connection);
    drop(connections);
    pairing.status = PairingStatus::Approved { token };
    drop(pairings);
    state.persist_connections()
}

#[tauri::command]
pub fn reject_web_clipper_pairing(
    id: String,
    state: TauriState<'_, WebClipperState>,
) -> Result<(), String> {
    let mut pairings = state
        .pairings
        .lock()
        .map_err(|_| "Pairing state is unavailable".to_string())?;
    let pairing = pairings
        .get_mut(&id)
        .ok_or_else(|| "Pairing request was not found".to_string())?;
    pairing.status = PairingStatus::Rejected;
    Ok(())
}

#[tauri::command]
pub fn set_web_clipper_ready(ready: bool, state: TauriState<'_, WebClipperState>) {
    state.ready.store(ready, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_web_clipper_enabled(
    enabled: bool,
    state: TauriState<'_, WebClipperState>,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    state.persist_enabled()
}

#[tauri::command]
pub fn get_web_clipper_status(state: TauriState<'_, WebClipperState>) -> Value {
    json!({
        "enabled": state.enabled.load(Ordering::Relaxed),
        "ready": state.ready.load(Ordering::Relaxed),
        "port": WEB_CLIPPER_PORT,
        "serverError": state.server_error.lock().ok().and_then(|value| value.clone()),
    })
}

#[tauri::command]
pub fn list_web_clipper_connections(
    state: TauriState<'_, WebClipperState>,
) -> Result<Vec<WebClipperConnectionView>, String> {
    Ok(state
        .connections
        .lock()
        .map_err(|_| "Web clipper connections are unavailable".to_string())?
        .iter()
        .map(WebClipperConnectionView::from)
        .collect())
}

#[tauri::command]
pub fn revoke_web_clipper_connection(
    id: String,
    state: TauriState<'_, WebClipperState>,
) -> Result<(), String> {
    state
        .connections
        .lock()
        .map_err(|_| "Web clipper connections are unavailable".to_string())?
        .retain(|connection| connection.id != id);
    state.persist_connections()
}

#[tauri::command]
pub fn resolve_web_clipper_request(
    body: ResolveBridgeBody,
    state: TauriState<'_, WebClipperState>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Bridge state is unavailable".to_string())?
        .remove(&body.request_id)
        .ok_or_else(|| "Bridge request was not found".to_string())?;
    let result = if let Some(error) = body.error {
        let code: &'static str = match error.code.as_str() {
            "invalid-request" => "invalid-request",
            "invalid-tag" => "invalid-tag",
            "content-too-large" => "content-too-large",
            "protocol-mismatch" => "protocol-mismatch",
            _ => "internal-error",
        };
        Err(ApiError {
            status: if code == "internal-error" {
                StatusCode::INTERNAL_SERVER_ERROR
            } else {
                StatusCode::BAD_REQUEST
            },
            code,
            message: error.message,
        })
    } else {
        Ok(body.result.unwrap_or_else(|| json!({})))
    };
    sender
        .send(result)
        .map_err(|_| "Bridge response receiver closed".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        authorize, check_rate_limit, hash_value, is_extension_origin, request_origin,
        valid_sha256_challenge, validate_clip_size, validate_protocol, WebClipperConnection,
        WebClipperState, EXTENSION_CLIENT_ID_HEADER, MAX_MARKDOWN_BYTES, PROTOCOL_HEADER,
    };
    use axum::http::{HeaderMap, HeaderValue, StatusCode};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use sha2::{Digest, Sha256};

    #[test]
    fn only_accepts_extension_origins() {
        assert!(is_extension_origin("chrome-extension://abcdefghijklmnop"));
        assert!(is_extension_origin("extension://clipper-id"));
        assert!(!is_extension_origin("https://example.com"));
        assert!(!is_extension_origin("chrome-extension://id/path"));
    }

    #[test]
    fn accepts_declared_origin_when_chrome_omits_origin_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            EXTENSION_CLIENT_ID_HEADER,
            HeaderValue::from_static("clipper"),
        );
        assert_eq!(
            request_origin(&headers).unwrap(),
            "chrome-extension://clipper"
        );
    }

    #[test]
    fn rejects_mismatched_origin_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "origin",
            HeaderValue::from_static("chrome-extension://clipper"),
        );
        headers.insert(
            EXTENSION_CLIENT_ID_HEADER,
            HeaderValue::from_static("other"),
        );
        assert_eq!(
            request_origin(&headers).unwrap_err().code,
            "origin-not-allowed"
        );
    }

    #[test]
    fn hashes_pairing_values_deterministically() {
        assert_eq!(hash_value("verifier"), hash_value("verifier"));
        assert_ne!(hash_value("verifier"), hash_value("other"));
    }

    #[test]
    fn authorizes_only_the_bound_token_origin_and_installation() {
        let state = WebClipperState::new();
        state
            .connections
            .lock()
            .unwrap()
            .push(WebClipperConnection {
                id: "connection".into(),
                install_id: "install-123".into(),
                origin: "chrome-extension://clipper".into(),
                browser: "Chrome".into(),
                extension_version: "0.1.0".into(),
                token_hash: hash_value("secret-token"),
                created_at: 1,
                last_used_at: 1,
            });
        let mut headers = HeaderMap::new();
        headers.insert(
            "origin",
            HeaderValue::from_static("chrome-extension://clipper"),
        );
        headers.insert(
            "x-notegen-install-id",
            HeaderValue::from_static("install-123"),
        );
        headers.insert(PROTOCOL_HEADER, HeaderValue::from_static("1"));
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token"),
        );
        assert!(authorize(&state, &headers).is_ok());
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer wrong-token"),
        );
        assert_eq!(
            authorize(&state, &headers).unwrap_err().status,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn validates_pairing_challenge_shape() {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(b"verifier"));
        assert!(valid_sha256_challenge(&challenge));
        assert!(!valid_sha256_challenge("not-a-sha256-challenge"));
    }

    #[test]
    fn validates_protocol_header() {
        let mut headers = HeaderMap::new();
        headers.insert(PROTOCOL_HEADER, HeaderValue::from_static("1"));
        assert!(validate_protocol(&headers).is_ok());
        headers.insert(PROTOCOL_HEADER, HeaderValue::from_static("2"));
        assert_eq!(
            validate_protocol(&headers).unwrap_err().code,
            "protocol-mismatch"
        );
    }

    #[test]
    fn limits_repeated_requests() {
        let state = WebClipperState::new();
        assert!(check_rate_limit(&state, "test".into(), 2, 60_000).is_ok());
        assert!(check_rate_limit(&state, "test".into(), 2, 60_000).is_ok());
        let error = check_rate_limit(&state, "test".into(), 2, 60_000).unwrap_err();
        assert_eq!(error.status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn enforces_markdown_size_limit() {
        assert!(validate_clip_size(&json!({ "contentMarkdown": "ok" })).is_ok());
        let too_large = "x".repeat(MAX_MARKDOWN_BYTES + 1);
        assert_eq!(
            validate_clip_size(&json!({ "contentMarkdown": too_large }))
                .unwrap_err()
                .code,
            "content-too-large"
        );
    }
}
