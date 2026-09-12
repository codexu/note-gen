use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use futures_util::StreamExt;
use ring::signature::{UnparsedPublicKey, ED25519};
use semver::Version;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State as TauriState};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex as AsyncMutex;
use unicode_normalization::UnicodeNormalization;
use url::Url;
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive};

const PLUGIN_API_VERSION: &str = "0.1.6";
const PLUGIN_STATE_SCHEMA_VERSION: u32 = 1;
const MARKET_SCHEMA_VERSION: u32 = 1;
const INTEGRITY_SCHEMA_VERSION: u32 = 1;
const SETTINGS_STORE_PATH: &str = "store.json";
const PLUGIN_DATA_STORE_PATH: &str = "plugin-data.json";
const PLUGIN_HOST_STATE_STORE_PATH: &str = "plugins.json";
const PLUGIN_HOST_STATE_KEY: &str = "state";
const PLUGIN_HOST_STATE_FILE: &str = "host-state.json";
const PLUGIN_STORAGE_FILE: &str = "storage.json";
const DEVELOPER_MODE_KEY: &str = "developerMode";
const PACKAGE_SIGNATURE_DOMAIN: &[u8] = b"NOTEGEN_PLUGIN_SIGNATURE_V1\0";
const MAX_ARCHIVE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ENTRY_SOURCE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 256;
const MAX_PATH_DEPTH: usize = 12;
const MAX_COMPRESSION_RATIO: u64 = 100;
const MAX_INDEX_BYTES: u64 = 5 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 8 * 1024;
const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PLUGIN_STATE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_PLUGIN_HOST_STATE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PLUGIN_STORAGE_FILE_BYTES: usize = 128 * 1024 * 1024;
const MAX_PLUGIN_STORAGE_BYTES: usize = 1024 * 1024;
const MAX_PLUGIN_STORAGE_KEYS: usize = 256;
const MAX_JAVASCRIPT_INTEGER: u64 = (1_u64 << 53) - 1;
const MAX_MARKET_INDEX_VALIDITY_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);

// Reads can repair state.json from its backup, so they must serialize with
// commits even when invoked outside the asynchronous package mutation lock.
// Keep this lock inside synchronous state I/O only: never hold it across an
// await or while deleting program/data directories.
static PLUGIN_STATE_IO_LOCK: StdMutex<()> = StdMutex::new(());

const MARKET_ENDPOINTS: [(&str, &str); 2] = [
    (
        "https://download.notegen.top/plugins/v1/index.json",
        "https://download.notegen.top/plugins/v1/index.sig",
    ),
    (
        "https://github.com/codexu/note-gen-plugins/releases/latest/download/index.json",
        "https://github.com/codexu/note-gen-plugins/releases/latest/download/index.sig",
    ),
];

const MARKET_PUBLIC_KEY_SOURCE: &str = include_str!("../plugin-market-public-key.txt");

pub struct PluginManager {
    mutation_lock: AsyncMutex<()>,
    host_state_lock: AsyncMutex<()>,
    storage_lock: AsyncMutex<()>,
    note_locks: StdMutex<BTreeMap<PathBuf, Arc<AsyncMutex<()>>>>,
}

impl Default for PluginManager {
    fn default() -> Self {
        Self {
            mutation_lock: AsyncMutex::new(()),
            host_state_lock: AsyncMutex::new(()),
            storage_lock: AsyncMutex::new(()),
            note_locks: StdMutex::new(BTreeMap::new()),
        }
    }
}

impl PluginManager {
    fn note_lock(&self, path: &Path) -> PluginResult<Arc<AsyncMutex<()>>> {
        let mut locks = self
            .note_locks
            .lock()
            .map_err(|_| plugin_error("Internal", "Plugin note lock registry is unavailable"))?;
        Ok(locks
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone())
    }

    fn release_note_lock(&self, path: &Path, lock: &Arc<AsyncMutex<()>>) {
        if let Ok(mut locks) = self.note_locks.lock() {
            if locks
                .get(path)
                .is_some_and(|current| Arc::ptr_eq(current, lock) && Arc::strong_count(current) == 2)
            {
                locks.remove(path);
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBackendError {
    pub code: String,
    pub message: String,
}

type PluginResult<T> = Result<T, PluginBackendError>;

fn plugin_error(code: &str, message: impl Into<String>) -> PluginBackendError {
    PluginBackendError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn io_error(action: &str) -> PluginBackendError {
    plugin_error("Io", format!("Unable to {action}"))
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum PluginPlatform {
    Desktop,
    Ios,
    Android,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPermissionDeclaration {
    pub scope: String,
    #[serde(default)]
    pub optional: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCommandContribution {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_shortcut: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginSettingOption {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginSettingContribution {
    pub key: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    pub scope: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub default: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<PluginSettingOption>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginStatusBarContribution {
    pub id: String,
    pub alignment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMenuContribution {
    pub location: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginViewContribution {
    pub id: String,
    pub title: String,
    pub location: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginContributions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<PluginCommandContribution>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings: Vec<PluginSettingContribution>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub status_bar: Vec<PluginStatusBarContribution>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub menus: Vec<PluginMenuContribution>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<PluginViewContribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAuthor {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifestV1 {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub version: String,
    pub api_version: String,
    pub min_app_version: String,
    pub platforms: Vec<PluginPlatform>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<Value>,
    pub activation_events: Vec<String>,
    pub permissions: BTreeMap<String, PluginPermissionDeclaration>,
    pub contributes: PluginContributions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_locale: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub locales: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<PluginAuthor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
enum PluginSource {
    Marketplace,
    Development,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledVersionState {
    manifest: PluginManifestV1,
    source: PluginSource,
    package_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publisher_key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publisher_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publisher_public_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    development_path: Option<String>,
    installed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledPluginState {
    active_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    previous_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_activation_version: Option<String>,
    versions: BTreeMap<String, InstalledVersionState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginStateFile {
    schema_version: u32,
    plugins: BTreeMap<String, InstalledPluginState>,
}

impl Default for PluginStateFile {
    fn default() -> Self {
        Self {
            schema_version: PLUGIN_STATE_SCHEMA_VERSION,
            plugins: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifestV1,
    pub source: PluginSourceView,
    pub active_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    pub pending_activation: bool,
    pub installed_at: String,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub development_path: Option<String>,
    pub verified: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginSourceView {
    Marketplace,
    Development,
}

impl From<PluginSource> for PluginSourceView {
    fn from(value: PluginSource) -> Self {
        match value {
            PluginSource::Marketplace => Self::Marketplace,
            PluginSource::Development => Self::Development,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPublisherKey {
    pub key_id: String,
    pub public_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMarketPublisher {
    pub id: String,
    pub name: String,
    pub key_id: String,
    pub public_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previous_keys: Vec<PluginPublisherKey>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMarketRelease {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher_key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked: Option<String>,
    pub version: String,
    pub min_app_version: String,
    pub api_version: String,
    pub platforms: Vec<PluginPlatform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    pub package_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_urls: Option<Vec<String>>,
    pub package_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_url: Option<String>,
    pub published_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMarketLocalizedText {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMarketEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub localizations: BTreeMap<String, PluginMarketLocalizedText>,
    pub author: String,
    pub publisher_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub official: bool,
    pub permissions: Vec<String>,
    pub releases: Vec<PluginMarketRelease>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginMarketIndex {
    schema_version: u32,
    generation: u64,
    generated_at: String,
    expires_at: u64,
    publishers: Vec<PluginMarketPublisher>,
    plugins: Vec<PluginMarketEntry>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginMarketSource {
    Remote,
    Cache,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketCatalog {
    pub schema_version: u32,
    pub generation: u64,
    pub generated_at: String,
    pub expires_at: u64,
    pub publishers: Vec<PluginMarketPublisher>,
    pub plugins: Vec<PluginMarketEntry>,
    pub source: PluginMarketSource,
    pub stale: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CachedMarketEnvelope {
    schema_version: u32,
    index_base64: String,
    signature_base64: String,
    cached_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketHighWater {
    schema_version: u32,
    generation: u64,
    index_sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IntegrityManifest {
    version: u32,
    algorithm: String,
    files: Vec<IntegrityFile>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IntegrityFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug)]
struct ActualFile {
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug)]
struct PackageContent {
    manifest: PluginManifestV1,
    manifest_json: Value,
    integrity_json: Value,
    signature: Option<Vec<u8>>,
    files: BTreeMap<String, ActualFile>,
}

#[derive(Clone, Debug)]
struct PreparedPackage {
    staging_dir: PathBuf,
    archive_sha256: String,
    content: PackageContent,
}

#[derive(Clone, Debug)]
struct ResolvedMarketRelease {
    entry: PluginMarketEntry,
    release: PluginMarketRelease,
    publisher: PluginMarketPublisher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallResult {
    pub plugin: InstalledPlugin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_version: Option<String>,
    pub permissions_changed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUninstallResult {
    pub plugin_id: String,
    pub removed_versions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_warning: Option<PluginBackendError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginOpenOrCreateNoteResult {
    pub status: PluginOpenOrCreateStatus,
    pub path: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginOpenOrCreateStatus {
    Created,
    OpenedExisting,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginWorkspaceNote {
    pub path: String,
    pub content: String,
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNoteEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNoteList {
    pub entries: Vec<PluginNoteEntry>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PluginNoteCursor {
    workspace: String,
    folder: String,
    recursive: bool,
    after: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginWriteNoteResult {
    pub path: String,
    pub revision: u64,
    pub created: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNetworkResponse {
    pub url: String,
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

#[derive(Clone, Debug)]
struct VerifiedInstalledPackage {
    content: PackageContent,
    directory: PathBuf,
    content_hash: String,
}

struct StrictJsonValue(Value);

impl<'de> Deserialize<'de> for StrictJsonValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictJsonVisitor)
    }
}

struct StrictJsonVisitor;

impl<'de> Visitor<'de> for StrictJsonVisitor {
    type Value = StrictJsonValue;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value without duplicate object keys")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Bool(value)))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Number(JsonNumber::from(value))))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Number(JsonNumber::from(value))))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        JsonNumber::from_f64(value)
            .map(|number| StrictJsonValue(Value::Number(number)))
            .ok_or_else(|| E::custom("non-finite JSON numbers are not allowed"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(StrictJsonValue(Value::String(value.to_string())))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::String(value)))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Null))
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Null))
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<StrictJsonValue>()? {
            values.push(value.0);
        }
        Ok(StrictJsonValue(Value::Array(values)))
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = JsonMap::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(serde::de::Error::custom(format!(
                    "duplicate JSON object key: {key}"
                )));
            }
            let value = map.next_value::<StrictJsonValue>()?;
            values.insert(key, value.0);
        }
        Ok(StrictJsonValue(Value::Object(values)))
    }
}

fn parse_strict_json(bytes: &[u8], label: &str) -> PluginResult<Value> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictJsonValue::deserialize(&mut deserializer)
        .map_err(|_| plugin_error("InvalidJson", format!("{label} is not valid strict JSON")))?;
    deserializer
        .end()
        .map_err(|_| plugin_error("InvalidJson", format!("{label} has trailing JSON data")))?;
    Ok(value.0)
}

fn parse_strict_type<T>(bytes: &[u8], label: &str) -> PluginResult<(T, Value)>
where
    T: for<'de> Deserialize<'de>,
{
    let value = parse_strict_json(bytes, label)?;
    let parsed = serde_json::from_value(value.clone()).map_err(|_| {
        plugin_error(
            "InvalidManifest",
            format!("{label} does not match the supported schema"),
        )
    })?;
    Ok((parsed, value))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn format_timestamp_ms(timestamp_ms: u64) -> String {
    let total_seconds = timestamp_ms / 1_000;
    let milliseconds = timestamp_ms % 1_000;
    let days = (total_seconds / 86_400) as i64;
    let seconds_in_day = total_seconds % 86_400;
    let hour = seconds_in_day / 3_600;
    let minute = (seconds_in_day % 3_600) / 60;
    let second = seconds_in_day % 60;

    // Civil date conversion for days since 1970-01-01.
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096)
            / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);

    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z"
    )
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_file(path: &Path, byte_limit: u64) -> PluginResult<(String, u64)> {
    let metadata = fs::symlink_metadata(path).map_err(|_| io_error("inspect plugin package"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(plugin_error(
            "InvalidPackage",
            "Plugin package must be a regular file",
        ));
    }
    if metadata.len() > byte_limit {
        return Err(plugin_error(
            "PackageTooLarge",
            format!("Plugin package exceeds the {} MiB limit", byte_limit / 1024 / 1024),
        ));
    }

    let mut file = File::open(path).map_err(|_| io_error("open plugin package"))?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| io_error("read plugin package"))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| plugin_error("PackageTooLarge", "Plugin package size overflow"))?;
        if total > byte_limit {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin package exceeded its download limit",
            ));
        }
        digest.update(&buffer[..read]);
    }
    Ok((format!("{:x}", digest.finalize()), total))
}

fn decode_base64(value: &str, expected_bytes: usize, label: &str) -> PluginResult<Vec<u8>> {
    let compact = value.chars().filter(|character| !character.is_whitespace()).collect::<String>();
    let decoded = STANDARD
        .decode(compact.as_bytes())
        .or_else(|_| STANDARD_NO_PAD.decode(compact.as_bytes()))
        .or_else(|_| URL_SAFE_NO_PAD.decode(compact.as_bytes()))
        .map_err(|_| plugin_error("SignatureInvalid", format!("{label} is not valid base64")))?;
    if decoded.len() != expected_bytes {
        return Err(plugin_error(
            "SignatureInvalid",
            format!("{label} has an invalid length"),
        ));
    }
    Ok(decoded)
}

fn market_public_key() -> PluginResult<Vec<u8>> {
    let encoded = MARKET_PUBLIC_KEY_SOURCE
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<String>();
    if encoded.is_empty() {
        return Err(
            plugin_error(
                "MarketTrustUnavailable",
                "This build does not contain the NoteGen plugin marketplace public key",
            )
        );
    }
    decode_base64(&encoded, 32, "Marketplace public key")
}

fn verify_ed25519(public_key: &[u8], signature: &[u8], message: &[u8]) -> PluginResult<()> {
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(message, signature)
        .map_err(|_| plugin_error("SignatureInvalid", "Ed25519 signature verification failed"))
}

fn canonical_json_bytes(value: &Value) -> PluginResult<Vec<u8>> {
    serde_json_canonicalizer::to_vec(value).map_err(|_| {
        plugin_error(
            "InvalidJson",
            "Plugin signing document cannot be canonicalized with RFC 8785 JCS",
        )
    })
}

fn package_signature_message(manifest: &Value, integrity: &Value) -> PluginResult<Vec<u8>> {
    let manifest = canonical_json_bytes(manifest)?;
    let integrity = canonical_json_bytes(integrity)?;
    let mut message = Vec::with_capacity(
        PACKAGE_SIGNATURE_DOMAIN.len() + 16 + manifest.len() + integrity.len(),
    );
    message.extend_from_slice(PACKAGE_SIGNATURE_DOMAIN);
    message.extend_from_slice(&(manifest.len() as u64).to_be_bytes());
    message.extend_from_slice(&manifest);
    message.extend_from_slice(&(integrity.len() as u64).to_be_bytes());
    message.extend_from_slice(&integrity);
    Ok(message)
}

fn is_valid_plugin_id(value: &str) -> bool {
    if value.len() < 3 || value.len() > 160 || !value.is_ascii() {
        return false;
    }
    let segments = value.split('.').collect::<Vec<_>>();
    segments.len() >= 2
        && segments.iter().all(|segment| {
            !segment.is_empty()
                && segment.len() <= 63
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                && segment
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
}

fn is_reserved_host_plugin_id(value: &str) -> bool {
    value == "app.notegen" || value.starts_with("app.notegen.")
}

fn is_valid_market_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.is_ascii()
        && value.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && value.as_bytes().last().is_some_and(u8::is_ascii_alphanumeric)
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
        })
}

fn is_namespaced_id(plugin_id: &str, value: &str) -> bool {
    value
        .strip_prefix(plugin_id)
        .is_some_and(|suffix| suffix.starts_with('.') && suffix.len() > 1)
        && value.len() <= 220
        && value.is_ascii()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')
        })
}

fn validate_text(value: &str, field: &str, max_bytes: usize) -> PluginResult<()> {
    if value.trim().is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(plugin_error(
            "InvalidManifest",
            format!("Manifest field {field} is empty or too long"),
        ));
    }
    Ok(())
}

fn validate_localized_text(value: &str, field: &str, max_bytes: usize) -> PluginResult<()> {
    validate_text(value, field, max_bytes)?;
    if value.starts_with('%') && localization_key(value).is_none() {
        return Err(plugin_error(
            "InvalidManifest",
            format!("Manifest field {field} contains a malformed localization reference"),
        ));
    }
    Ok(())
}

fn is_windows_reserved_name(segment: &str) -> bool {
    let stem = segment
        .trim_end_matches(|character| character == '.' || character == ' ')
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].into_iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
        })
    })
}

fn validate_package_path(raw: &str, directory: bool) -> PluginResult<String> {
    if raw.is_empty()
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.contains('\\')
        || raw.chars().any(char::is_control)
    {
        return Err(plugin_error("UnsafeArchive", "Plugin archive contains an unsafe path"));
    }

    let path = if directory {
        raw.strip_suffix('/').unwrap_or(raw)
    } else {
        if raw.ends_with('/') {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive file path ends with a separator",
            ));
        }
        raw
    };
    if path.is_empty() || path.len() > 1_024 || path.contains("//") {
        return Err(plugin_error("UnsafeArchive", "Plugin archive contains an empty path"));
    }

    let segments = path.split('/').collect::<Vec<_>>();
    if segments.len() > MAX_PATH_DEPTH {
        return Err(plugin_error(
            "UnsafeArchive",
            "Plugin archive path is nested too deeply",
        ));
    }
    for segment in &segments {
        let normalized = segment.nfc().collect::<String>();
        if segment.is_empty()
            || segment.len() > 240
            || *segment == "."
            || *segment == ".."
            || normalized != *segment
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || segment
                .chars()
                .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
            || is_windows_reserved_name(segment)
        {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive contains a non-canonical or platform-unsafe path",
            ));
        }
        let lower = segment.to_lowercase();
        if matches!(
            lower.as_str(),
            ".notegen" | "node_modules" | ".git" | ".hg" | ".svn" | ".cache"
        ) || lower == ".env"
            || lower.starts_with(".env.")
        {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive contains a reserved directory or sensitive file",
            ));
        }
    }

    if !directory {
        let lower = path.to_lowercase();
        let forbidden_suffixes = [
            ".exe", ".dll", ".dylib", ".so", ".node", ".msi", ".dmg", ".pkg",
            ".deb", ".rpm", ".apk", ".ipa", ".app", ".jar", ".class", ".bat", ".cmd",
            ".ps1", ".sh", ".map", ".pem", ".p12", ".pfx",
        ];
        if forbidden_suffixes.iter().any(|suffix| lower.ends_with(suffix)) {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive contains an executable, native, or sensitive file type",
            ));
        }
    }

    Ok(path.to_string())
}

fn casefold_path(path: &str) -> String {
    path.to_lowercase().nfc().collect::<String>()
}

fn validate_https_url(raw: &str, allowed_hosts: &[&str], label: &str) -> PluginResult<Url> {
    let url = Url::parse(raw)
        .map_err(|_| plugin_error("InvalidMarket", format!("{label} is not a valid URL")))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
    {
        return Err(plugin_error(
            "InvalidMarket",
            format!("{label} must be a plain HTTPS URL"),
        ));
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| plugin_error("InvalidMarket", format!("{label} has no host")))?;
    if !allowed_hosts.iter().any(|allowed| host == *allowed) {
        return Err(plugin_error(
            "InvalidMarket",
            format!("{label} uses a host that is not allowed for plugin distribution"),
        ));
    }
    Ok(url)
}

fn validate_package_url(raw: &str) -> PluginResult<Url> {
    validate_https_url(
        raw,
        &[
            "download.notegen.top",
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com",
        ],
        "Plugin package URL",
    )
}

fn market_package_urls(release: &PluginMarketRelease) -> PluginResult<Vec<Url>> {
    let primary = validate_package_url(&release.package_url)?;
    let Some(mirrors) = release.package_urls.as_deref() else {
        return Ok(vec![primary]);
    };
    if mirrors.is_empty() || mirrors.len() > 3 {
        return Err(plugin_error(
            "InvalidMarket",
            "Marketplace packageUrls must contain between one and three URLs",
        ));
    }

    let mut seen = BTreeSet::new();
    let mut urls = Vec::with_capacity(mirrors.len());
    for raw in mirrors {
        let url = validate_package_url(raw)?;
        if !seen.insert(url.as_str().to_string()) {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace packageUrls must not contain duplicates",
            ));
        }
        urls.push(url);
    }
    if urls.first() != Some(&primary) {
        return Err(plugin_error(
            "InvalidMarket",
            "Marketplace packageUrls must begin with packageUrl",
        ));
    }
    Ok(urls)
}

fn validate_sha256(value: &str, label: &str) -> PluginResult<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(plugin_error(
            "InvalidDigest",
            format!("{label} must be a lowercase SHA-256 digest"),
        ));
    }
    Ok(())
}

fn semver_core_is_javascript_safe(version: &Version) -> bool {
    version.major <= MAX_JAVASCRIPT_INTEGER
        && version.minor <= MAX_JAVASCRIPT_INTEGER
        && version.patch <= MAX_JAVASCRIPT_INTEGER
}

fn parse_api_requirement(raw: &str, label: &str) -> PluginResult<(String, Version)> {
    if raw.is_empty() || raw.len() > 80 || raw.chars().any(char::is_control) {
        return Err(plugin_error(
            "InvalidManifest",
            format!("{label} is not a supported SemVer requirement"),
        ));
    }
    let operator = [">=", "<=", "^", "~", ">", "<"]
        .into_iter()
        .find(|operator| raw.starts_with(operator))
        .unwrap_or("");
    let version_text = raw[operator.len()..].trim_start_matches(' ');
    if version_text.is_empty()
        || version_text.ends_with(' ')
        || (operator.is_empty() && version_text.len() != raw.len())
    {
        return Err(plugin_error(
            "InvalidManifest",
            format!("{label} is not a supported SemVer requirement"),
        ));
    }
    let version = Version::parse(version_text).map_err(|_| {
        plugin_error(
            "InvalidManifest",
            format!("{label} is not a supported SemVer requirement"),
        )
    })?;
    if !version.build.is_empty() || version.to_string() != version_text {
        return Err(plugin_error(
            "InvalidManifest",
            format!("{label} is not a supported SemVer requirement"),
        ));
    }
    if !semver_core_is_javascript_safe(&version) {
        return Err(plugin_error(
            "InvalidManifest",
            format!("{label} core components exceed the JavaScript safe integer range"),
        ));
    }
    Ok((operator.to_string(), version))
}

fn api_requirement_matches(supported: &Version, operator: &str, target: &Version) -> bool {
    match operator {
        "" => supported == target,
        ">=" => supported >= target,
        ">" => supported > target,
        "<=" => supported <= target,
        "<" => supported < target,
        "~" => {
            supported >= target
                && supported.major == target.major
                && supported.minor == target.minor
        }
        "^" if target.major > 0 => supported >= target && supported.major == target.major,
        "^" if target.minor > 0 => {
            supported >= target
                && supported.major == 0
                && supported.minor == target.minor
        }
        "^" => {
            supported >= target
                && supported.major == 0
                && supported.minor == 0
                && supported.patch == target.patch
        }
        _ => false,
    }
}

fn reject_explicit_null_fields(
    object: &JsonMap<String, Value>,
    fields: &[&str],
    context: &str,
) -> PluginResult<()> {
    if let Some(field) = fields
        .iter()
        .copied()
        .find(|field| object.get(*field).is_some_and(Value::is_null))
    {
        return Err(plugin_error(
            "InvalidManifest",
            format!("Manifest optional field {context}.{field} must be omitted instead of null"),
        ));
    }
    Ok(())
}

fn manifest_object<'a>(
    value: &'a Value,
    context: &str,
) -> PluginResult<&'a JsonMap<String, Value>> {
    value.as_object().ok_or_else(|| {
        plugin_error(
            "InvalidManifest",
            format!("Manifest field {context} must be an object"),
        )
    })
}

fn validate_manifest_json_shape(value: &Value) -> PluginResult<()> {
    let manifest = manifest_object(value, "$")?;
    if manifest.get("entry").and_then(Value::as_str) == Some("") {
        return Err(plugin_error("InvalidManifest", "Omit entry for a resource package; empty entry is invalid"));
    }
    reject_explicit_null_fields(
        manifest,
        &["description", "defaultLocale", "author", "repository", "license", "resources"],
        "$",
    )?;

    if let Some(author) = manifest.get("author") {
        reject_explicit_null_fields(manifest_object(author, "$.author")?, &["url"], "$.author")?;
    }

    let permissions = manifest
        .get("permissions")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            plugin_error(
                "InvalidManifest",
                "Manifest field $.permissions must be an object",
            )
        })?;
    for (permission, declaration) in permissions {
        let context = format!("$.permissions.{permission}");
        reject_explicit_null_fields(
            manifest_object(declaration, &context)?,
            &["description"],
            &context,
        )?;
    }

    let contributes = manifest
        .get("contributes")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            plugin_error(
                "InvalidManifest",
                "Manifest field $.contributes must be an object",
            )
        })?;

    if let Some(commands) = contributes.get("commands").and_then(Value::as_array) {
        for (index, command) in commands.iter().enumerate() {
            let context = format!("$.contributes.commands[{index}]");
            reject_explicit_null_fields(
                manifest_object(command, &context)?,
                &["description", "icon", "suggestedShortcut", "keywords"],
                &context,
            )?;
        }
    }

    if let Some(settings) = contributes.get("settings").and_then(Value::as_array) {
        const COMMON_FIELDS: &[&str] =
            &["key", "type", "scope", "title", "description", "default"];
        for (index, setting) in settings.iter().enumerate() {
            let context = format!("$.contributes.settings[{index}]");
            let setting = manifest_object(setting, &context)?;
            reject_explicit_null_fields(
                setting,
                &[
                    "description",
                    "placeholder",
                    "maxLength",
                    "permissionPaths",
                    "min",
                    "max",
                    "step",
                    "options",
                ],
                &context,
            )?;
            let setting_type = setting
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    plugin_error(
                        "InvalidManifest",
                        format!("Manifest field {context}.type must be a string"),
                    )
                })?;
            let extra_fields: &[&str] = match setting_type {
                "boolean" | "workspace-file" | "workspace-folder" => &[],
                "string" => &["placeholder", "maxLength", "permissionPaths"],
                "number" => &["min", "max", "step"],
                "select" => &["options"],
                _ => {
                    return Err(plugin_error(
                        "InvalidManifest",
                        format!("Manifest setting type is unsupported at {context}.type"),
                    ));
                }
            };
            if let Some(field) = setting.keys().find(|field| {
                !COMMON_FIELDS.contains(&field.as_str())
                    && !extra_fields.contains(&field.as_str())
            }) {
                return Err(plugin_error(
                    "InvalidManifest",
                    format!(
                        "Manifest setting type {setting_type} does not support field {context}.{field}"
                    ),
                ));
            }
        }
    }

    if let Some(status_items) = contributes.get("statusBar").and_then(Value::as_array) {
        for (index, status) in status_items.iter().enumerate() {
            let context = format!("$.contributes.statusBar[{index}]");
            reject_explicit_null_fields(
                manifest_object(status, &context)?,
                &["priority", "command"],
                &context,
            )?;
        }
    }

    if let Some(menus) = contributes.get("menus").and_then(Value::as_array) {
        for (index, menu) in menus.iter().enumerate() {
            let context = format!("$.contributes.menus[{index}]");
            reject_explicit_null_fields(
                manifest_object(menu, &context)?,
                &["when", "group", "enableWhen", "order", "icon"],
                &context,
            )?;
        }
    }
    if let Some(views) = contributes.get("views").and_then(Value::as_array) {
        for (index, view) in views.iter().enumerate() {
            let context = format!("$.contributes.views[{index}]");
            reject_explicit_null_fields(manifest_object(view, &context)?, &["icon"], &context)?;
        }
    }
    Ok(())
}

fn validate_manifest(
    app: &AppHandle,
    manifest: &PluginManifestV1,
    manifest_json: &Value,
    package_root: &Path,
    files: &BTreeMap<String, ActualFile>,
) -> PluginResult<()> {
    validate_manifest_json_shape(manifest_json)?;
    if manifest.manifest_version != 1 {
        return Err(plugin_error(
            "InvalidManifest",
            "Only plugin manifestVersion 1 is supported",
        ));
    }
    if !is_valid_plugin_id(&manifest.id) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin id must use a lowercase reverse-domain identifier",
        ));
    }
    if is_reserved_host_plugin_id(&manifest.id) {
        return Err(plugin_error(
            "InvalidManifest",
            "The app.notegen.* namespace is reserved for NoteGen host internals",
        ));
    }
    validate_text(&manifest.name, "name", 100)?;
    if let Some(description) = &manifest.description {
        validate_text(description, "description", 500)?;
    }

    if manifest.version.len() > 80 {
        return Err(plugin_error("InvalidManifest", "Plugin version is too long"));
    }
    let plugin_version = Version::parse(&manifest.version).map_err(|_| {
        plugin_error("InvalidManifest", "Plugin version is not valid SemVer")
    })?;
    if !semver_core_is_javascript_safe(&plugin_version) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin version core components exceed the JavaScript safe integer range",
        ));
    }
    let (api_operator, api_target) =
        parse_api_requirement(&manifest.api_version, "Plugin apiVersion")?;
    let supported_api = Version::parse(PLUGIN_API_VERSION)
        .map_err(|_| plugin_error("Internal", "Plugin API version is invalid"))?;
    if !api_requirement_matches(&supported_api, &api_operator, &api_target) {
        return Err(plugin_error(
            "Incompatible",
            format!("Plugin requires API {}", manifest.api_version),
        ));
    }
    if manifest.min_app_version.len() > 80 {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin minAppVersion is not valid SemVer",
        ));
    }
    let minimum_app = Version::parse(&manifest.min_app_version).map_err(|_| {
        plugin_error(
            "InvalidManifest",
            "Plugin minAppVersion is not valid SemVer",
        )
    })?;
    if !semver_core_is_javascript_safe(&minimum_app) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin minAppVersion core components exceed the JavaScript safe integer range",
        ));
    }
    let current_app = Version::parse(&app.package_info().version.to_string())
        .map_err(|_| plugin_error("Internal", "NoteGen application version is invalid"))?;
    if minimum_app.cmp_precedence(&current_app).is_gt() {
        return Err(plugin_error(
            "Incompatible",
            format!("Plugin requires NoteGen {} or newer", manifest.min_app_version),
        ));
    }

    if manifest.platforms.is_empty() {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin platforms must not be empty",
        ));
    }
    let platform_set = manifest.platforms.iter().copied().collect::<BTreeSet<_>>();
    if platform_set.len() != manifest.platforms.len() {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin platforms contains duplicate entries",
        ));
    }
    if !platform_set.contains(&PluginPlatform::Desktop) {
        return Err(plugin_error(
            "UnavailableOnPlatform",
            "Community plugin packages are currently supported only on desktop",
        ));
    }

    validate_resources(manifest, package_root, files)?;
    if !manifest.entry.is_empty() {
        let entry = validate_package_path(&manifest.entry, false)?;
        if entry.len() > 240 || !entry.ends_with(".js") {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin entry must be a JavaScript ESM file",
            ));
        }
        let entry_file = files.get(&entry).ok_or_else(|| {
            plugin_error(
                "InvalidManifest",
                "Plugin entry does not exist in the verified package",
            )
        })?;
        if entry_file.size > MAX_ENTRY_SOURCE_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin entry exceeds the 5 MiB source limit",
            ));
        }
        let entry_bytes = read_limited_file(
            &package_root.join(&entry),
            MAX_ENTRY_SOURCE_BYTES,
            "plugin entry",
        )?;
        ensure_bytes_match_actual(&entry_bytes, Some(entry_file), "plugin entry")?;
        let entry_source = std::str::from_utf8(&entry_bytes).map_err(|_| {
            plugin_error(
                "InvalidManifest",
                "Plugin entry must contain valid UTF-8 JavaScript",
            )
        })?;
        if entry_source.contains('\0') {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin entry contains invalid null characters",
            ));
        }
    }
    validate_permissions(manifest)?;
    validate_contributions(manifest)?;
    validate_activation_events(manifest)?;
    validate_locales(manifest, package_root, files)?;

    if let Some(author) = &manifest.author {
        validate_text(&author.name, "author.name", 120)?;
        if let Some(url) = &author.url {
            if url.len() > 500 {
                return Err(plugin_error("InvalidManifest", "Manifest author URL is too long"));
            }
            validate_public_metadata_url(url, "author.url")?;
        }
    }
    if let Some(repository) = &manifest.repository {
        if repository.len() > 500 {
            return Err(plugin_error(
                "InvalidManifest",
                "Manifest repository URL is too long",
            ));
        }
        validate_public_metadata_url(repository, "repository")?;
    }
    if let Some(license) = &manifest.license {
        validate_text(license, "license", 80)?;
    }
    Ok(())
}

fn validate_public_metadata_url(raw: &str, field: &str) -> PluginResult<()> {
    let url = Url::parse(raw).map_err(|_| {
        plugin_error(
            "InvalidManifest",
            format!("Manifest field {field} is not a valid URL"),
        )
    })?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err(plugin_error(
            "InvalidManifest",
            format!("Manifest field {field} must be an HTTP(S) URL without credentials"),
        ));
    }
    Ok(())
}

fn validate_permissions(manifest: &PluginManifestV1) -> PluginResult<()> {
    for (permission, declaration) in &manifest.permissions {
        let valid = match permission.as_str() {
            "records.read" | "records.write" | "chat.write" | "ai.generate" => declaration.scope == "application",
            "editor.read" | "editor.write" => declaration.scope == "active-editor",
            "notes.read" | "attachments.read" => matches!(
                declaration.scope.as_str(),
                "workspace-file" | "workspace-files" | "workspace-folder"
            ),
            "notes.create" | "notes.open" | "notes.list" | "notes.move" | "attachments.create" => declaration.scope == "workspace-folder",
            "notes.write" | "notes.delete" => matches!(
                declaration.scope.as_str(),
                "workspace-file" | "workspace-files" | "workspace-folder"
            ),
            "network.fetch" => declaration.scope == "network-origins",
            _ => false,
        };
        if !valid {
            return Err(plugin_error(
                "InvalidManifest",
                format!("Unsupported plugin permission or scope: {permission}"),
            ));
        }
        if let Some(description) = &declaration.description {
            validate_text(description, "permissions.description", 240)?;
        }
    }
    Ok(())
}

fn validate_contributions(manifest: &PluginManifestV1) -> PluginResult<()> {
    if manifest.contributes.commands.len() > 100
        || manifest.contributes.settings.len() > 100
        || manifest.contributes.status_bar.len() > 30
        || manifest.contributes.menus.len() > 100
        || manifest.contributes.views.len() > 30
    {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin declares too many UI contributions",
        ));
    }
    let mut command_ids = BTreeSet::new();
    for command in &manifest.contributes.commands {
        if !is_namespaced_id(&manifest.id, &command.id) || !command_ids.insert(command.id.clone()) {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin command ids must be unique and use the plugin namespace",
            ));
        }
        validate_localized_text(&command.title, "contributes.commands.title", 240)?;
        if let Some(description) = &command.description {
            validate_localized_text(description, "contributes.commands.description", 240)?;
        }
        if let Some(icon) = &command.icon {
            if icon.is_empty()
                || icon.len() > 80
                || !icon
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Plugin command icon must be a supported symbolic icon name",
                ));
            }
        }
        if command.keywords.as_ref().is_some_and(|words| words.len() > 20 || words.iter().any(|word| word.is_empty() || word.encode_utf16().count() > 80)) {
            return Err(plugin_error("InvalidManifest", "Invalid command keywords"));
        }
        if let Some(shortcut) = &command.suggested_shortcut {
            validate_text(shortcut, "contributes.commands.suggestedShortcut", 80)?;
        }
    }

    let mut folder_binding_seen = false;
    let mut setting_ids = BTreeSet::new();
    for setting in &manifest.contributes.settings {
        if let Some(permissions) = &setting.permission_paths {
            if folder_binding_seen || setting.setting_type != "string" || setting.scope != "workspace"
                || permissions.is_empty() || permissions.len() > 20
                || permissions.iter().collect::<BTreeSet<_>>().len() != permissions.len()
                || permissions.iter().any(|name| !manifest.permissions.get(name)
                    .is_some_and(|permission| permission.scope == "workspace-folder" && !permission.optional)) {
                return Err(plugin_error("InvalidManifest", "Invalid workspace folder permission binding"));
            }
            folder_binding_seen = true;
        }
        if !is_namespaced_id(&manifest.id, &setting.key) || !setting_ids.insert(setting.key.clone()) {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin setting keys must be unique and use the plugin namespace",
            ));
        }
        validate_localized_text(&setting.title, "contributes.settings.title", 240)?;
        if let Some(description) = &setting.description {
            validate_localized_text(description, "contributes.settings.description", 240)?;
        }
        if let Some(placeholder) = &setting.placeholder {
            validate_localized_text(placeholder, "contributes.settings.placeholder", 240)?;
        }
        if !matches!(setting.scope.as_str(), "device" | "workspace") {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin setting scope must be device or workspace",
            ));
        }
        validate_setting_shape(setting)?;
    }

    let mut status_ids = BTreeSet::new();
    for status in &manifest.contributes.status_bar {
        if !is_namespaced_id(&manifest.id, &status.id) || !status_ids.insert(status.id.clone()) {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin status bar ids must be unique and use the plugin namespace",
            ));
        }
        if !matches!(status.alignment.as_str(), "left" | "right") {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin status bar alignment must be left or right",
            ));
        }
        if status
            .priority
            .is_some_and(|priority| !(-10_000..=10_000).contains(&priority))
        {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin status bar priority is outside the supported range",
            ));
        }
        if let Some(command) = &status.command {
            if !command_ids.contains(command) {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Plugin status bar command must reference a declared command",
                ));
            }
        }
    }

    for menu in &manifest.contributes.menus {
        if !matches!(
            menu.location.as_str(),
            "editor/slash" | "editor/context" | "editor/selection" | "editor/toolbar" | "tab/context" | "file/context" | "mobile/writing/overflow"
        ) || !command_ids.contains(&menu.command)
        {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin menu must use a supported location and declared command",
            ));
        }
        if menu
            .when
            .as_ref()
            .is_some_and(|condition| !is_supported_menu_condition(condition))
        {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin menu uses an unsupported when condition",
            ));
        }
        if menu.enable_when.as_ref().is_some_and(|condition| !is_supported_menu_condition(condition))
            || menu.order.is_some_and(|order| !(-10000..=10000).contains(&order))
            || menu.icon.as_ref().is_some_and(|icon| icon.is_empty() || icon.len() > 80 || !icon.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')) {
            return Err(plugin_error("InvalidManifest", "Invalid menu condition, order, or icon"));
        }
        if menu
            .group
            .as_ref()
            .is_some_and(|group| group.is_empty() || group.len() > 80 || group.chars().any(char::is_control))
        {
            return Err(plugin_error("InvalidManifest", "Plugin menu group is invalid"));
        }
    }
    let mut view_ids = BTreeSet::new();
    for view in &manifest.contributes.views {
        if !is_namespaced_id(&manifest.id, &view.id) || !view_ids.insert(view.id.clone()) {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin view ids must be unique and use the plugin namespace",
            ));
        }
        validate_localized_text(&view.title, "contributes.views.title", 240)?;
        if !matches!(view.location.as_str(), "left-sidebar" | "right-sidebar" | "editor-tab" | "settings" | "title-bar-left" | "title-bar-center" | "title-bar-right" | "new-tab" | "document-top" | "document-bottom" | "file-panel" | "editor-toolbar" | "chat-input" | "record-list" | "status-bar-panel") {
            return Err(plugin_error("InvalidManifest", "Plugin view location is unsupported"));
        }
        if view.icon.as_ref().is_some_and(|icon| {
            icon.is_empty() || icon.len() > 80 || !icon.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        }) {
            return Err(plugin_error("InvalidManifest", "Plugin view icon is invalid"));
        }
    }
    Ok(())
}

fn validate_setting_shape(setting: &PluginSettingContribution) -> PluginResult<()> {
    let only = |allowed: &[&str]| -> bool {
        (setting.placeholder.is_none() || allowed.contains(&"placeholder"))
            && (setting.max_length.is_none() || allowed.contains(&"maxLength"))
            && (setting.permission_paths.is_none() || allowed.contains(&"permissionPaths"))
            && (setting.min.is_none() || allowed.contains(&"min"))
            && (setting.max.is_none() || allowed.contains(&"max"))
            && (setting.step.is_none() || allowed.contains(&"step"))
            && (setting.options.is_none() || allowed.contains(&"options"))
    };

    match setting.setting_type.as_str() {
        "boolean" if setting.default.is_boolean() && only(&[]) => Ok(()),
        "string"
            if setting.default.is_string()
                && only(&["placeholder", "maxLength", "permissionPaths"])
                && setting.max_length.unwrap_or(1) > 0
                && setting.max_length.unwrap_or(65_536) <= 65_536
                && setting.default.as_str().is_some_and(|value| {
                    value.len() as u64 <= setting.max_length.unwrap_or(65_536)
                }) =>
        {
            Ok(())
        }
        "number"
            if setting.default.is_number()
                && only(&["min", "max", "step"])
                && setting.step.unwrap_or(1.0) > 0.0
                && setting
                    .min
                    .zip(setting.max)
                    .is_none_or(|(minimum, maximum)| minimum <= maximum)
                && setting
                    .default
                    .as_f64()
                    .is_some_and(|value| setting.min.is_none_or(|minimum| value >= minimum))
                && setting
                    .default
                    .as_f64()
                    .is_some_and(|value| setting.max.is_none_or(|maximum| value <= maximum)) =>
        {
            Ok(())
        }
        "select" if setting.default.is_string() && only(&["options"]) => {
            let options = setting.options.as_ref().ok_or_else(|| {
                plugin_error("InvalidManifest", "Select plugin setting requires options")
            })?;
            if options.is_empty() || options.len() > 100 {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Select plugin setting has an invalid option count",
                ));
            }
            let mut values = BTreeSet::new();
            for option in options {
                validate_localized_text(
                    &option.label,
                    "contributes.settings.options.label",
                    240,
                )?;
                if option.value.is_empty()
                    || option.value.len() > 160
                    || option.value.chars().any(char::is_control)
                    || !values.insert(option.value.clone())
                {
                    return Err(plugin_error(
                        "InvalidManifest",
                        "Select plugin setting option values must be unique",
                    ));
                }
            }
            if !setting
                .default
                .as_str()
                .is_some_and(|value| values.contains(value))
            {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Select plugin setting default must match an option",
                ));
            }
            Ok(())
        }
        "workspace-file" | "workspace-folder"
            if setting.scope == "workspace" && setting.default.is_string() && only(&[]) =>
        {
            if let Some(path) = setting.default.as_str() {
                if !path.is_empty() {
                    validate_package_path(path, setting.setting_type == "workspace-folder")?;
                }
            }
            Ok(())
        }
        _ => Err(plugin_error(
            "InvalidManifest",
            "Plugin setting type, default, scope, or constraints are inconsistent",
        )),
    }
}

fn is_supported_menu_condition(condition: &str) -> bool {
    if condition.is_empty() || condition.encode_utf16().count() > 240 { return false; }
    condition.split("||").all(|group| group.split("&&").all(|atom| {
        let atom = atom.trim();
        let boolean_key = |key: &str| matches!(key, "selection" | "readOnly" | "codeBlock");
        if boolean_key(atom.strip_prefix('!').unwrap_or(atom)) { return true; }
        let comparison = atom.split_once("==").or_else(|| atom.split_once("!="));
        let Some((key, value)) = comparison else { return false; };
        let key = key.trim();
        let value = value.trim();
        if boolean_key(key) { return matches!(value, "true" | "false"); }
        matches!(key, "editor" | "resourceKind" | "resourceExt") && !value.is_empty()
            && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    }))
}

fn validate_activation_events(manifest: &PluginManifestV1) -> PluginResult<()> {
    if manifest.activation_events.len() > 100 {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin declares too many activation events",
        ));
    }
    let commands = manifest
        .contributes
        .commands
        .iter()
        .map(|command| command.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut events = BTreeSet::new();
    for event in &manifest.activation_events {
        let valid = matches!(event.as_str(), "onEditor:markdown" | "onWorkspace:open" | "onNotes:change")
            || event
                .strip_prefix("onCommand:")
                .is_some_and(|command| commands.contains(command));
        if !valid || !events.insert(event) {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin activation events must be unique and reference supported capabilities",
            ));
        }
    }
    Ok(())
}

fn localization_key(value: &str) -> Option<&str> {
    value
        .strip_prefix('%')
        .and_then(|value| value.strip_suffix('%'))
        .filter(|value| {
            value.len() <= 160
                && value
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && value.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                })
        })
}

fn is_valid_locale_tag(value: &str) -> bool {
    if value.len() < 2 || value.len() > 35 || !value.is_ascii() {
        return false;
    }
    let mut segments = value.split('-');
    let Some(language) = segments.next() else {
        return false;
    };
    if !(2..=8).contains(&language.len()) || !language.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return false;
    }
    segments.all(|segment| {
        !segment.is_empty()
            && segment.len() <= 8
            && segment.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn validate_locales(
    manifest: &PluginManifestV1,
    package_root: &Path,
    files: &BTreeMap<String, ActualFile>,
) -> PluginResult<()> {
    if manifest.locales.len() > 50 {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin declares too many locale resources",
        ));
    }
    if manifest.locales.is_empty() != manifest.default_locale.is_none() {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin defaultLocale and locales must be declared together",
        ));
    }
    if manifest.locales.is_empty() {
        for command in &manifest.contributes.commands {
            if localization_key(&command.title).is_some()
                || command
                    .description
                    .as_deref()
                    .and_then(localization_key)
                    .is_some()
            {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Localized contribution text requires locale resources",
                ));
            }
        }
        if manifest.contributes.views.iter().any(|view| localization_key(&view.title).is_some()) {
            return Err(plugin_error(
                "InvalidManifest",
                "Localized contribution text requires locale resources",
            ));
        }
        for setting in &manifest.contributes.settings {
            let has_localized_text = localization_key(&setting.title).is_some()
                || setting
                    .description
                    .as_deref()
                    .and_then(localization_key)
                    .is_some()
                || setting
                    .placeholder
                    .as_deref()
                    .and_then(localization_key)
                    .is_some()
                || setting.options.as_ref().is_some_and(|options| {
                    options
                        .iter()
                        .any(|option| localization_key(&option.label).is_some())
                });
            if has_localized_text {
                return Err(plugin_error(
                    "InvalidManifest",
                    "Localized contribution text requires locale resources",
                ));
            }
        }
        return Ok(());
    }

    let default_locale = manifest.default_locale.as_ref().ok_or_else(|| {
        plugin_error("InvalidManifest", "Plugin defaultLocale is missing")
    })?;
    if !manifest.locales.contains_key(default_locale) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin defaultLocale is not present in locales",
        ));
    }

    let mut locale_tags = BTreeSet::new();
    let mut locale_paths = BTreeSet::new();
    let mut default_messages = None;
    for (locale, raw_path) in &manifest.locales {
        if !is_valid_locale_tag(locale)
            || !locale_tags.insert(locale.to_ascii_lowercase())
        {
            return Err(plugin_error("InvalidManifest", "Plugin locale tag is invalid"));
        }
        let path = validate_package_path(raw_path, false)?;
        if path.len() > 240
            || !path.to_ascii_lowercase().ends_with(".json")
            || !files.contains_key(&path)
            || !locale_paths.insert(casefold_path(&path))
        {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin locale resource is missing, duplicated, or not JSON",
            ));
        }
        let bytes = read_limited_file(
            &package_root.join(&path),
            MAX_ENTRY_BYTES,
            "plugin locale resource",
        )?;
        ensure_bytes_match_actual(
            &bytes,
            files.get(&path),
            "plugin locale resource",
        )?;
        let messages = parse_locale_messages(&bytes)?;
        if locale == default_locale {
            default_messages = Some(messages);
        }
    }

    let messages = default_messages.ok_or_else(|| {
        plugin_error("InvalidManifest", "Plugin default locale could not be loaded")
    })?;
    let mut referenced = BTreeSet::new();
    for command in &manifest.contributes.commands {
        if let Some(key) = localization_key(&command.title) {
            referenced.insert(key.to_string());
        }
        if let Some(key) = command.description.as_deref().and_then(localization_key) {
            referenced.insert(key.to_string());
        }
    }
    for view in &manifest.contributes.views {
        if let Some(key) = localization_key(&view.title) {
            referenced.insert(key.to_string());
        }
    }
    for setting in &manifest.contributes.settings {
        if let Some(key) = localization_key(&setting.title) {
            referenced.insert(key.to_string());
        }
        if let Some(key) = setting.description.as_deref().and_then(localization_key) {
            referenced.insert(key.to_string());
        }
        if let Some(key) = setting.placeholder.as_deref().and_then(localization_key) {
            referenced.insert(key.to_string());
        }
        if let Some(options) = &setting.options {
            for option in options {
                if let Some(key) = localization_key(&option.label) {
                    referenced.insert(key.to_string());
                }
            }
        }
    }
    if referenced.iter().any(|key| !messages.contains_key(key)) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin default locale is missing a referenced contribution key",
        ));
    }
    Ok(())
}

fn parse_locale_messages(bytes: &[u8]) -> PluginResult<BTreeMap<String, String>> {
    let value = parse_strict_json(bytes, "Plugin locale")?;
    let object = value.as_object().ok_or_else(|| {
        plugin_error("InvalidManifest", "Plugin locale must be a JSON object")
    })?;
    if object.len() > 2_000 {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin locale contains too many messages",
        ));
    }
    let mut messages = BTreeMap::new();
    for (key, value) in object {
        if key.is_empty()
            || key.len() > 160
            || key.chars().any(char::is_control)
            || !value.is_string()
        {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin locale contains an invalid key or non-string value",
            ));
        }
        let message = value.as_str().unwrap_or_default();
        if message.len() > 4_096 || message.chars().any(|character| character == '\0') {
            return Err(plugin_error(
                "InvalidManifest",
                "Plugin locale message exceeds its limit",
            ));
        }
        messages.insert(key.clone(), message.to_string());
    }
    Ok(messages)
}

#[derive(Clone, Debug)]
struct ArchiveEntryMeta {
    index: usize,
    path: String,
    directory: bool,
    declared_size: u64,
}

fn prepare_package(
    app: &AppHandle,
    package_path: &Path,
    expected_sha256: Option<&str>,
) -> PluginResult<PreparedPackage> {
    if let Some(expected) = expected_sha256 {
        validate_sha256(expected, "Expected package digest")?;
    }

    let staging_root = plugin_data_root(app)?.join("staging");
    ensure_real_directory(&staging_root, "plugin staging directory")?;
    let staging_dir = staging_root.join(Uuid::new_v4().to_string());
    fs::create_dir(&staging_dir).map_err(|_| io_error("create plugin staging directory"))?;

    let result = (|| {
        let archive_sha256 = extract_archive(package_path, &staging_dir, expected_sha256)?;
        let content = validate_package_directory(app, &staging_dir)?;
        Ok(PreparedPackage {
            staging_dir: staging_dir.clone(),
            archive_sha256,
            content,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    result
}

fn canonical_development_root(source_path: &Path) -> PluginResult<PathBuf> {
    let metadata = fs::symlink_metadata(source_path)
        .map_err(|_| io_error("inspect development plugin directory"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(plugin_error(
            "InvalidPackage",
            "Development plugin source must be a real directory",
        ));
    }

    let canonical = fs::canonicalize(source_path)
        .map_err(|_| io_error("resolve development plugin directory"))?;
    let canonical_metadata = fs::symlink_metadata(&canonical)
        .map_err(|_| io_error("inspect resolved development plugin directory"))?;
    if canonical_metadata.file_type().is_symlink() || !canonical_metadata.is_dir() {
        return Err(plugin_error(
            "InvalidPackage",
            "Resolved development plugin source must be a real directory",
        ));
    }
    Ok(canonical)
}

fn ensure_development_source_file(source_root: &Path, relative_path: &str) -> PluginResult<PathBuf> {
    let canonical_relative = validate_package_path(relative_path, false)?;
    let mut source = source_root.to_path_buf();
    let segments = canonical_relative.split('/').collect::<Vec<_>>();
    for (index, segment) in segments.iter().enumerate() {
        source.push(segment);
        let metadata = fs::symlink_metadata(&source)
            .map_err(|_| plugin_error("InvalidPackage", format!("Development plugin is missing {canonical_relative}")))?;
        if metadata.file_type().is_symlink() {
            return Err(plugin_error(
                "UnsafeArchive",
                format!("Development plugin path contains a symbolic link: {canonical_relative}"),
            ));
        }
        let final_component = index + 1 == segments.len();
        if (final_component && !metadata.is_file()) || (!final_component && !metadata.is_dir()) {
            return Err(plugin_error(
                "InvalidPackage",
                format!("Development plugin path has an invalid file type: {canonical_relative}"),
            ));
        }
    }

    let canonical_source = fs::canonicalize(&source)
        .map_err(|_| io_error("resolve development plugin file"))?;
    if !canonical_source.starts_with(source_root) {
        return Err(plugin_error(
            "UnsafeArchive",
            "Development plugin file escaped its source directory",
        ));
    }
    Ok(source)
}

#[cfg(unix)]
fn development_file_is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn development_file_is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

fn ensure_snapshot_parent_directories(
    staging_dir: &Path,
    relative_path: &str,
) -> PluginResult<()> {
    let mut current = staging_dir.to_path_buf();
    let segments = relative_path.split('/').collect::<Vec<_>>();
    for segment in segments.iter().take(segments.len().saturating_sub(1)) {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(plugin_error(
                        "UnsafePath",
                        "Development snapshot parent is not a real directory",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|_| io_error("create development snapshot directory"))?;
                let metadata = fs::symlink_metadata(&current)
                    .map_err(|_| io_error("inspect development snapshot directory"))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(plugin_error(
                        "UnsafePath",
                        "Development snapshot parent is not a real directory",
                    ));
                }
            }
            Err(_) => return Err(io_error("inspect development snapshot directory")),
        }
    }
    Ok(())
}

fn copy_development_source_file(
    source_root: &Path,
    staging_dir: &Path,
    relative_path: &str,
    byte_limit: u64,
    expected: Option<&IntegrityFile>,
    total_bytes: &mut u64,
) -> PluginResult<()> {
    let canonical_relative = validate_package_path(relative_path, false)?;
    let source = ensure_development_source_file(source_root, &canonical_relative)?;
    let before = fs::symlink_metadata(&source)
        .map_err(|_| io_error("inspect development plugin file"))?;
    if before.file_type().is_symlink()
        || !before.is_file()
        || before.len() > byte_limit
        || development_file_is_executable(&before)
    {
        return Err(plugin_error(
            "InvalidPackage",
            format!("Development plugin contains an invalid file: {canonical_relative}"),
        ));
    }
    if let Some(declared) = expected {
        if declared.size != before.len() {
            return Err(plugin_error(
                "IntegrityMismatch",
                format!("Development plugin file size does not match integrity.json: {canonical_relative}"),
            ));
        }
    }

    let mut input = File::open(&source).map_err(|_| io_error("open development plugin file"))?;
    let opened = input
        .metadata()
        .map_err(|_| io_error("inspect opened development plugin file"))?;
    if !opened.is_file() || opened.len() != before.len() || opened.len() > byte_limit {
        return Err(plugin_error(
            "IntegrityMismatch",
            format!("Development plugin file changed before it could be copied: {canonical_relative}"),
        ));
    }

    ensure_snapshot_parent_directories(staging_dir, &canonical_relative)?;
    let destination = staging_dir.join(canonical_relative.split('/').collect::<PathBuf>());
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&destination)
        .map_err(|_| io_error("create development snapshot file"))?;
    let mut digest = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|_| io_error("read development plugin file"))?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| plugin_error("PackageTooLarge", "Development plugin file size overflow"))?;
        *total_bytes = (*total_bytes)
            .checked_add(read as u64)
            .ok_or_else(|| plugin_error("PackageTooLarge", "Development plugin size overflow"))?;
        if copied > byte_limit || *total_bytes > MAX_UNCOMPRESSED_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Development plugin exceeded its snapshot size limit",
            ));
        }
        digest.update(&buffer[..read]);
        output
            .write_all(&buffer[..read])
            .map_err(|_| io_error("write development snapshot file"))?;
    }
    output
        .sync_all()
        .map_err(|_| io_error("flush development snapshot file"))?;

    let copied_sha256 = format!("{:x}", digest.finalize());
    let integrity_mismatch = expected.is_some_and(|declared| {
        declared.size != copied || declared.sha256.as_str() != copied_sha256.as_str()
    });
    if copied != opened.len() || integrity_mismatch {
        return Err(plugin_error(
            "IntegrityMismatch",
            format!("Development plugin file changed while it was copied: {canonical_relative}"),
        ));
    }

    let after = fs::symlink_metadata(&source)
        .map_err(|_| io_error("reinspect development plugin file"))?;
    let canonical_after = fs::canonicalize(&source)
        .map_err(|_| io_error("reresolve development plugin file"))?;
    if after.file_type().is_symlink()
        || !after.is_file()
        || after.len() != opened.len()
        || !canonical_after.starts_with(source_root)
    {
        return Err(plugin_error(
            "IntegrityMismatch",
            format!("Development plugin file changed during snapshot creation: {canonical_relative}"),
        ));
    }
    Ok(())
}

fn development_snapshot_hash(content: &PackageContent) -> String {
    let mut digest = Sha256::new();
    digest.update(b"NOTEGEN_DEVELOPMENT_SNAPSHOT_V1\0");
    for (path, file) in &content.files {
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path.as_bytes());
        digest.update(file.size.to_be_bytes());
        digest.update(file.sha256.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn prepare_development_directory(
    app: &AppHandle,
    source_path: &Path,
) -> PluginResult<PreparedPackage> {
    let source_root = canonical_development_root(source_path)?;
    let staging_root = plugin_data_root(app)?.join("staging");
    ensure_real_directory(&staging_root, "plugin staging directory")?;
    let staging_dir = staging_root.join(Uuid::new_v4().to_string());
    fs::create_dir(&staging_dir).map_err(|_| io_error("create development snapshot directory"))?;

    let result = (|| {
        let mut total_bytes = 0_u64;
        copy_development_source_file(
            &source_root,
            &staging_dir,
            "integrity.json",
            MAX_ENTRY_BYTES,
            None,
            &mut total_bytes,
        )?;
        let integrity_bytes = read_limited_file(
            &staging_dir.join("integrity.json"),
            MAX_ENTRY_BYTES,
            "integrity.json",
        )?;
        let (integrity, _) = parse_strict_type::<IntegrityManifest>(&integrity_bytes, "integrity.json")?;
        if integrity.version != INTEGRITY_SCHEMA_VERSION || integrity.algorithm != "sha256" {
            return Err(plugin_error(
                "InvalidPackage",
                "Plugin integrity manifest uses an unsupported version or algorithm",
            ));
        }
        if integrity.files.len().saturating_add(1) > MAX_ARCHIVE_ENTRIES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Development plugin contains too many payload files",
            ));
        }

        let mut payload = BTreeMap::<String, &IntegrityFile>::new();
        let mut folded_paths = BTreeMap::<String, String>::new();
        let mut declared_total = 0_u64;
        for declared in &integrity.files {
            let path = validate_package_path(&declared.path, false)?;
            validate_sha256(&declared.sha256, "Integrity file digest")?;
            if matches!(path.as_str(), "integrity.json" | "signature.sig")
                || payload.insert(path.clone(), declared).is_some()
                || folded_paths
                    .insert(casefold_path(&path), path.clone())
                    .is_some_and(|previous| previous != path)
            {
                return Err(plugin_error(
                    "InvalidPackage",
                    "Plugin integrity manifest contains a duplicate or forbidden path",
                ));
            }
            if declared.size > MAX_ENTRY_BYTES {
                return Err(plugin_error(
                    "PackageTooLarge",
                    format!("Development plugin file exceeds its size limit: {path}"),
                ));
            }
            declared_total = declared_total
                .checked_add(declared.size)
                .ok_or_else(|| plugin_error("PackageTooLarge", "Development plugin size overflow"))?;
            if declared_total > MAX_UNCOMPRESSED_BYTES {
                return Err(plugin_error(
                    "PackageTooLarge",
                    "Development plugin exceeds its total size limit",
                ));
            }
        }
        if !payload.contains_key("plugin.json") {
            return Err(plugin_error(
                "IntegrityMismatch",
                "Plugin integrity manifest must cover plugin.json",
            ));
        }

        let payload_paths = payload.keys().cloned().collect::<BTreeSet<_>>();
        let mut directory_paths = BTreeSet::new();
        for path in payload.keys() {
            let mut prefix = String::new();
            let segments = path.split('/').collect::<Vec<_>>();
            for segment in segments.iter().take(segments.len().saturating_sub(1)) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(segment);
                if payload_paths.contains(&prefix) {
                    return Err(plugin_error(
                        "InvalidPackage",
                        "Plugin integrity manifest uses a file as a parent directory",
                    ));
                }
                directory_paths.insert(prefix.clone());
            }
        }

        let signature_path = source_root.join("signature.sig");
        let has_signature = match fs::symlink_metadata(&signature_path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(plugin_error(
                        "InvalidPackage",
                        "Development plugin signature.sig must be a regular file",
                    ));
                }
                true
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(io_error("inspect development plugin signature")),
        };
        let snapshot_entries = payload
            .len()
            .saturating_add(directory_paths.len())
            .saturating_add(1)
            .saturating_add(if has_signature { 1 } else { 0 });
        if snapshot_entries > MAX_ARCHIVE_ENTRIES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Development plugin snapshot contains too many entries",
            ));
        }

        for (path, declared) in payload {
            copy_development_source_file(
                &source_root,
                &staging_dir,
                &path,
                MAX_ENTRY_BYTES,
                Some(declared),
                &mut total_bytes,
            )?;
        }
        if has_signature {
            copy_development_source_file(
                &source_root,
                &staging_dir,
                "signature.sig",
                MAX_SIGNATURE_BYTES,
                None,
                &mut total_bytes,
            )?;
        }

        let current_root = canonical_development_root(&source_root)?;
        if current_root != source_root {
            return Err(plugin_error(
                "IntegrityMismatch",
                "Development plugin source directory changed during snapshot creation",
            ));
        }
        sync_directory(&staging_dir);
        let content = validate_package_directory(app, &staging_dir)?;
        let content_hash = development_snapshot_hash(&content);
        Ok(PreparedPackage {
            staging_dir: staging_dir.clone(),
            archive_sha256: content_hash,
            content,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    result
}

fn inspect_archive(archive: &mut ZipArchive<File>) -> PluginResult<Vec<ArchiveEntryMeta>> {
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(plugin_error(
            "InvalidPackage",
            format!("Plugin package must contain between 1 and {MAX_ARCHIVE_ENTRIES} entries"),
        ));
    }

    let mut total_uncompressed = 0_u64;
    let mut exact_paths = BTreeMap::<String, bool>::new();
    let mut folded_paths = BTreeMap::<String, String>::new();
    let mut entries = Vec::with_capacity(archive.len());

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| plugin_error("InvalidPackage", "Unable to inspect plugin archive entry"))?;
        if entry.encrypted() {
            return Err(plugin_error(
                "InvalidPackage",
                "Encrypted plugin archive entries are not allowed",
            ));
        }
        if !matches!(entry.compression(), CompressionMethod::Stored | CompressionMethod::Deflated) {
            return Err(plugin_error(
                "InvalidPackage",
                "Plugin archive uses an unsupported compression method",
            ));
        }
        if entry.is_symlink() {
            return Err(plugin_error(
                "UnsafeArchive",
                "Symbolic links are not allowed in plugin packages",
            ));
        }
        if let Some(mode) = entry.unix_mode() {
            let file_type = mode & 0o170000;
            if !matches!(file_type, 0 | 0o040000 | 0o100000)
                || (entry.is_dir() && file_type == 0o100000)
                || (!entry.is_dir() && file_type == 0o040000)
                || (!entry.is_dir() && mode & 0o111 != 0)
            {
                return Err(plugin_error(
                    "UnsafeArchive",
                    "Plugin archive contains a special or executable file",
                ));
            }
        }

        let directory = entry.is_dir();
        if directory && entry.size() != 0 {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive directory entries must not contain payload bytes",
            ));
        }
        if !directory && !entry.is_file() {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive contains a non-regular file",
            ));
        }
        let path = validate_package_path(entry.name(), directory)?;
        if exact_paths.insert(path.clone(), directory).is_some() {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive contains duplicate paths",
            ));
        }
        // Directory entries are optional in ZIPs. Include every implicit parent
        // so A/x.json and a/y.json cannot collide only after extraction on a
        // case-insensitive filesystem, or fail the later directory validation.
        let mut expanded_path = String::new();
        for segment in path.split('/') {
            if !expanded_path.is_empty() {
                expanded_path.push('/');
            }
            expanded_path.push_str(segment);
            let folded = casefold_path(&expanded_path);
            if folded_paths
                .insert(folded, expanded_path.clone())
                .is_some_and(|previous| previous != expanded_path)
            {
                return Err(plugin_error(
                    "UnsafeArchive",
                    "Plugin archive contains paths that collide by case or Unicode normalization",
                ));
            }
            if folded_paths.len() > MAX_ARCHIVE_ENTRIES {
                return Err(plugin_error(
                    "PackageTooLarge",
                    "Extracted plugin archive would contain too many entries",
                ));
            }
        }

        if entry.size() > MAX_ENTRY_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin archive entry exceeds the 10 MiB limit",
            ));
        }
        if entry.compressed_size() == 0 && entry.size() > 0
            || (entry.size() > 1024 * 1024
                && entry.size() > entry.compressed_size().saturating_mul(MAX_COMPRESSION_RATIO))
        {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin archive entry exceeds the allowed compression ratio",
            ));
        }
        total_uncompressed = total_uncompressed
            .checked_add(entry.size())
            .ok_or_else(|| plugin_error("PackageTooLarge", "Plugin archive size overflow"))?;
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin archive exceeds the 50 MiB uncompressed limit",
            ));
        }
        entries.push(ArchiveEntryMeta {
            index,
            path,
            directory,
            declared_size: entry.size(),
        });
    }

    let file_paths = exact_paths
        .iter()
        .filter_map(|(path, directory)| (!*directory).then_some(path.as_str()))
        .collect::<BTreeSet<_>>();
    for (path, directory) in &exact_paths {
        let mut prefix = String::new();
        let segment_count = path.split('/').count();
        for (index, segment) in path.split('/').enumerate() {
            if index + 1 == segment_count {
                break;
            }
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(segment);
            if file_paths.contains(prefix.as_str()) {
                return Err(plugin_error(
                    "UnsafeArchive",
                    "Plugin archive uses a file as a parent directory",
                ));
            }
        }
        if *directory && file_paths.contains(path.as_str()) {
            return Err(plugin_error(
                "UnsafeArchive",
                "Plugin archive path is both a file and directory",
            ));
        }
    }
    Ok(entries)
}

fn extract_archive(
    package_path: &Path,
    staging_dir: &Path,
    expected_sha256: Option<&str>,
) -> PluginResult<String> {
    let metadata = fs::symlink_metadata(package_path)
        .map_err(|_| io_error("inspect plugin archive"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(plugin_error(
            "InvalidPackage",
            "Plugin package must be a regular file",
        ));
    }
    if metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(plugin_error(
            "PackageTooLarge",
            "Plugin package exceeds the 20 MiB limit",
        ));
    }
    let mut file = File::open(package_path).map_err(|_| io_error("open plugin archive"))?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| io_error("inspect opened plugin archive"))?;
    if !opened_metadata.is_file() || opened_metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(plugin_error(
            "InvalidPackage",
            "Opened plugin package is not a permitted regular file",
        ));
    }
    let mut digest = Sha256::new();
    let mut archive_bytes = 0_u64;
    let mut hash_buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut hash_buffer)
            .map_err(|_| io_error("read plugin archive"))?;
        if read == 0 {
            break;
        }
        archive_bytes = archive_bytes
            .checked_add(read as u64)
            .ok_or_else(|| plugin_error("PackageTooLarge", "Plugin package size overflow"))?;
        if archive_bytes > MAX_ARCHIVE_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Plugin package exceeded the 20 MiB limit",
            ));
        }
        digest.update(&hash_buffer[..read]);
    }
    if archive_bytes != opened_metadata.len() {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin package changed while it was being read",
        ));
    }
    let archive_sha256 = format!("{:x}", digest.finalize());
    if expected_sha256.is_some_and(|expected| expected != archive_sha256.as_str()) {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Downloaded plugin package does not match the signed marketplace digest",
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| io_error("rewind plugin archive"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| plugin_error("InvalidPackage", "Plugin package is not a valid ZIP archive"))?;
    let entries = inspect_archive(&mut archive)?;
    let mut total_actual = 0_u64;

    for metadata in entries {
        let mut entry = archive
            .by_index(metadata.index)
            .map_err(|_| plugin_error("InvalidPackage", "Unable to read plugin archive entry"))?;
        let destination = staging_dir.join(metadata.path.split('/').collect::<PathBuf>());
        if metadata.directory {
            fs::create_dir_all(&destination)
                .map_err(|_| io_error("create plugin archive directory"))?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| io_error("create plugin archive parent directory"))?;
        }
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination)
            .map_err(|_| io_error("create extracted plugin file"))?;
        let mut actual_size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = entry
                .read(&mut buffer)
                .map_err(|_| plugin_error("InvalidPackage", "Unable to decompress plugin archive entry"))?;
            if read == 0 {
                break;
            }
            actual_size = actual_size
                .checked_add(read as u64)
                .ok_or_else(|| plugin_error("PackageTooLarge", "Plugin entry size overflow"))?;
            total_actual = total_actual
                .checked_add(read as u64)
                .ok_or_else(|| plugin_error("PackageTooLarge", "Plugin archive size overflow"))?;
            if actual_size > MAX_ENTRY_BYTES || total_actual > MAX_UNCOMPRESSED_BYTES {
                return Err(plugin_error(
                    "PackageTooLarge",
                    "Plugin archive exceeded its extraction limit",
                ));
            }
            output
                .write_all(&buffer[..read])
                .map_err(|_| io_error("write extracted plugin file"))?;
        }
        if actual_size != metadata.declared_size {
            return Err(plugin_error(
                "IntegrityMismatch",
                "Plugin archive entry size does not match its metadata",
            ));
        }
        output
            .sync_all()
            .map_err(|_| io_error("flush extracted plugin file"))?;
    }
    sync_directory(staging_dir);
    Ok(archive_sha256)
}

fn validate_package_directory(app: &AppHandle, root: &Path) -> PluginResult<PackageContent> {
    let metadata = fs::symlink_metadata(root).map_err(|_| io_error("inspect plugin directory"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(plugin_error(
            "InvalidPackage",
            "Plugin installation directory is not a real directory",
        ));
    }

    let mut files = BTreeMap::new();
    let mut folded_paths = BTreeMap::new();
    let mut entry_count = 0_usize;
    let mut total_bytes = 0_u64;
    collect_verified_files(
        root,
        root,
        0,
        &mut files,
        &mut folded_paths,
        &mut entry_count,
        &mut total_bytes,
    )?;

    let manifest_bytes = read_limited_file(&root.join("plugin.json"), MAX_ENTRY_BYTES, "plugin.json")?;
    let integrity_bytes =
        read_limited_file(&root.join("integrity.json"), MAX_ENTRY_BYTES, "integrity.json")?;
    ensure_bytes_match_actual(&manifest_bytes, files.get("plugin.json"), "plugin.json")?;
    ensure_bytes_match_actual(
        &integrity_bytes,
        files.get("integrity.json"),
        "integrity.json",
    )?;
    let (manifest, manifest_json) =
        parse_strict_type::<PluginManifestV1>(&manifest_bytes, "plugin.json")?;
    let (integrity, integrity_json) =
        parse_strict_type::<IntegrityManifest>(&integrity_bytes, "integrity.json")?;
    validate_integrity(&integrity, &files)?;
    validate_manifest(app, &manifest, &manifest_json, root, &files)?;
    validate_optional_package_json(root, &files)?;

    let signature = if files.contains_key("signature.sig") {
        let signature_bytes = read_limited_file(
            &root.join("signature.sig"),
            MAX_SIGNATURE_BYTES,
            "signature.sig",
        )?;
        let encoded = std::str::from_utf8(&signature_bytes).map_err(|_| {
            plugin_error("SignatureInvalid", "Plugin signature must be base64 text")
        })?;
        ensure_bytes_match_actual(
            &signature_bytes,
            files.get("signature.sig"),
            "signature.sig",
        )?;
        Some(decode_base64(encoded, 64, "Plugin signature")?)
    } else {
        None
    };

    Ok(PackageContent {
        manifest,
        manifest_json,
        integrity_json,
        signature,
        files,
    })
}

fn ensure_bytes_match_actual(
    bytes: &[u8],
    actual: Option<&ActualFile>,
    label: &str,
) -> PluginResult<()> {
    let actual = actual.ok_or_else(|| {
        plugin_error("IntegrityMismatch", format!("Verified package is missing {label}"))
    })?;
    if bytes.len() as u64 != actual.size || sha256_hex(bytes) != actual.sha256 {
        return Err(plugin_error(
            "IntegrityMismatch",
            format!("Plugin package {label} changed during verification"),
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn collect_verified_files(
    root: &Path,
    current: &Path,
    depth: usize,
    files: &mut BTreeMap<String, ActualFile>,
    folded_paths: &mut BTreeMap<String, String>,
    entry_count: &mut usize,
    total_bytes: &mut u64,
) -> PluginResult<()> {
    if depth > MAX_PATH_DEPTH {
        return Err(plugin_error(
            "UnsafeArchive",
            "Installed plugin directory is nested too deeply",
        ));
    }
    for entry in fs::read_dir(current).map_err(|_| io_error("read installed plugin directory"))? {
        let entry = entry.map_err(|_| io_error("read installed plugin directory entry"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| io_error("inspect installed plugin file"))?;
        if metadata.file_type().is_symlink() {
            return Err(plugin_error(
                "UnsafeArchive",
                "Installed plugin contains a symbolic link",
            ));
        }
        *entry_count += 1;
        if *entry_count > MAX_ARCHIVE_ENTRIES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Installed plugin contains too many entries",
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| plugin_error("UnsafeArchive", "Installed plugin path escaped its root"))?;
        let relative = relative
            .iter()
            .map(|component| component.to_str())
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| {
                plugin_error("UnsafeArchive", "Installed plugin path is not valid UTF-8")
            })?
            .join("/");
        let canonical = validate_package_path(&relative, metadata.is_dir())?;
        let folded = casefold_path(&canonical);
        if folded_paths
            .insert(folded, canonical.clone())
            .is_some_and(|previous| previous != canonical)
        {
            return Err(plugin_error(
                "UnsafeArchive",
                "Installed plugin contains case-colliding paths",
            ));
        }
        if metadata.is_dir() {
            collect_verified_files(
                root,
                &path,
                depth + 1,
                files,
                folded_paths,
                entry_count,
                total_bytes,
            )?;
            continue;
        }
        if !metadata.is_file() || metadata.len() > MAX_ENTRY_BYTES {
            return Err(plugin_error(
                "InvalidPackage",
                "Installed plugin contains a non-file or oversized entry",
            ));
        }
        *total_bytes = total_bytes
            .checked_add(metadata.len())
            .ok_or_else(|| plugin_error("PackageTooLarge", "Installed plugin size overflow"))?;
        if *total_bytes > MAX_UNCOMPRESSED_BYTES {
            return Err(plugin_error(
                "PackageTooLarge",
                "Installed plugin exceeds its total size limit",
            ));
        }
        let (sha256, actual_size) = sha256_file(&path, MAX_ENTRY_BYTES)?;
        files.insert(
            canonical,
            ActualFile {
                size: actual_size,
                sha256,
            },
        );
    }
    Ok(())
}

fn read_limited_file(path: &Path, limit: u64, label: &str) -> PluginResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| plugin_error("InvalidPackage", format!("Plugin package is missing {label}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > limit {
        return Err(plugin_error(
            "InvalidPackage",
            format!("Plugin package contains an invalid {label}"),
        ));
    }
    let mut file = File::open(path).map_err(|_| io_error(&format!("open {label}")))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| io_error(&format!("read {label}")))?;
    if bytes.len() as u64 > limit {
        return Err(plugin_error(
            "PackageTooLarge",
            format!("Plugin package {label} exceeded its size limit"),
        ));
    }
    Ok(bytes)
}

fn validate_integrity(
    integrity: &IntegrityManifest,
    actual_files: &BTreeMap<String, ActualFile>,
) -> PluginResult<()> {
    if integrity.version != INTEGRITY_SCHEMA_VERSION || integrity.algorithm != "sha256" {
        return Err(plugin_error(
            "InvalidPackage",
            "Plugin integrity manifest uses an unsupported version or algorithm",
        ));
    }
    let payload_paths = actual_files
        .keys()
        .filter(|path| path.as_str() != "integrity.json" && path.as_str() != "signature.sig")
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut declared_paths = BTreeSet::new();
    let mut folded_paths = BTreeSet::new();
    for declared in &integrity.files {
        let path = validate_package_path(&declared.path, false)?;
        validate_sha256(&declared.sha256, "Integrity file digest")?;
        if matches!(path.as_str(), "integrity.json" | "signature.sig")
            || !declared_paths.insert(path.clone())
            || !folded_paths.insert(casefold_path(&path))
        {
            return Err(plugin_error(
                "InvalidPackage",
                "Plugin integrity manifest contains a duplicate or forbidden path",
            ));
        }
        let actual = actual_files.get(&path).ok_or_else(|| {
            plugin_error(
                "IntegrityMismatch",
                "Plugin integrity manifest references a missing file",
            )
        })?;
        if actual.size != declared.size || actual.sha256 != declared.sha256 {
            return Err(plugin_error(
                "IntegrityMismatch",
                "Plugin payload does not match integrity.json",
            ));
        }
    }
    if declared_paths != payload_paths {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin payload file set does not exactly match integrity.json",
        ));
    }
    if !declared_paths.contains("plugin.json") {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin integrity manifest must cover plugin.json",
        ));
    }
    Ok(())
}

fn validate_optional_package_json(
    package_root: &Path,
    files: &BTreeMap<String, ActualFile>,
) -> PluginResult<()> {
    if !files.contains_key("package.json") {
        return Ok(());
    }
    let bytes = read_limited_file(&package_root.join("package.json"), MAX_ENTRY_BYTES, "package.json")?;
    ensure_bytes_match_actual(&bytes, files.get("package.json"), "package.json")?;
    let value = parse_strict_json(&bytes, "package.json")?;
    if value
        .get("scripts")
        .and_then(Value::as_object)
        .is_some_and(|scripts| {
            scripts
                .keys()
                .any(|key| matches!(key.as_str(), "install" | "preinstall" | "postinstall"))
        })
    {
        return Err(plugin_error(
            "InvalidPackage",
            "Plugin package must not contain install scripts",
        ));
    }
    Ok(())
}

fn verify_package_signature(content: &PackageContent, public_key_base64: &str) -> PluginResult<()> {
    let signature = content.signature.as_ref().ok_or_else(|| {
        plugin_error(
            "SignatureInvalid",
            "Marketplace plugin package is missing signature.sig",
        )
    })?;
    let public_key = decode_base64(public_key_base64, 32, "Publisher public key")?;
    let message = package_signature_message(&content.manifest_json, &content.integrity_json)?;
    verify_ed25519(&public_key, signature, &message)
}

fn validate_market_index(index: &PluginMarketIndex, allow_expired: bool) -> PluginResult<()> {
    let now = now_ms();
    if index.schema_version != MARKET_SCHEMA_VERSION
        || index.generation == 0
        || index.generation > MAX_JAVASCRIPT_INTEGER
        || index.expires_at == 0
        || (!allow_expired && index.expires_at <= now)
        || index.expires_at > MAX_JAVASCRIPT_INTEGER
        || index.expires_at > now.saturating_add(MAX_MARKET_INDEX_VALIDITY_MS)
    {
        return Err(plugin_error(
            "InvalidMarket",
            "Marketplace index uses an unsupported schema, generation, or validity period",
        ));
    }
    validate_text(&index.generated_at, "market.generatedAt", 100)?;
    if index.publishers.len() > 1_000 || index.plugins.len() > 10_000 {
        return Err(plugin_error(
            "InvalidMarket",
            "Marketplace index exceeds its publisher or plugin count limit",
        ));
    }

    let mut publisher_ids = BTreeSet::new();
    let mut publisher_keys = BTreeSet::new();
    for publisher in &index.publishers {
        if !is_valid_market_identifier(&publisher.id)
            || !publisher_ids.insert(publisher.id.clone())
            || publisher.key_id.trim().is_empty()
            || publisher.key_id.len() > 160
            || !publisher.key_id.bytes().all(|byte| byte.is_ascii_graphic())
            || !publisher_keys.insert(publisher.key_id.clone())
        {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace contains an invalid or duplicate publisher",
            ));
        }
        validate_text(&publisher.name, "market.publisher.name", 160)?;
        decode_base64(&publisher.public_key, 32, "Publisher public key")?;
        if publisher.previous_keys.len() > 16 {
            return Err(plugin_error("InvalidMarket", "Too many previous publisher keys"));
        }
        let mut keys = BTreeSet::from([publisher.key_id.as_str()]);
        for key in &publisher.previous_keys {
            validate_text(&key.key_id, "publisher.previousKeys.keyId", 160)?;
            if !keys.insert(&key.key_id) {
                return Err(plugin_error("InvalidMarket", "Duplicate publisher key"));
            }
            decode_base64(&key.public_key, 32, "Previous publisher public key")?;
        }
    }

    let mut plugin_ids = BTreeSet::new();
    for plugin in &index.plugins {
        if !is_valid_plugin_id(&plugin.id)
            || is_reserved_host_plugin_id(&plugin.id)
            || !plugin_ids.insert(plugin.id.clone())
        {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace contains an invalid or duplicate plugin id",
            ));
        }
        if !publisher_ids.contains(&plugin.publisher_id) {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace plugin references an unknown publisher",
            ));
        }
        validate_text(&plugin.name, "market.plugin.name", 120)?;
        validate_text(&plugin.description, "market.plugin.description", 2_000)?;
        if plugin.localizations.len() > 20 {
            return Err(plugin_error("InvalidMarket", "Too many marketplace locales"));
        }
        for (locale, text) in &plugin.localizations {
            let mut segments = locale.split('-');
            let language = segments.next().unwrap_or_default();
            if locale.len() > 35
                || !(2..=3).contains(&language.len())
                || !language.bytes().all(|byte| byte.is_ascii_lowercase())
                || !segments.all(|segment| (2..=8).contains(&segment.len())
                    && segment.bytes().all(|byte| byte.is_ascii_alphanumeric()))
            {
                return Err(plugin_error("InvalidMarket", "Invalid marketplace locale"));
            }
            validate_text(&text.name, "market.plugin.localizations.name", 120)?;
            validate_text(&text.description, "market.plugin.localizations.description", 2_000)?;
        }
        validate_text(&plugin.author, "market.plugin.author", 160)?;
        if plugin.categories.len() > 50 {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace plugin declares too many categories",
            ));
        }
        let mut categories = BTreeSet::new();
        for category in &plugin.categories {
            validate_text(category, "market.plugin.category", 80)?;
            if !categories.insert(category.to_ascii_lowercase()) {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace plugin contains duplicate categories",
                ));
            }
        }
        if let Some(license) = &plugin.license {
            validate_text(license, "market.plugin.license", 80)?;
        }
        if plugin.releases.is_empty() || plugin.releases.len() > 100 {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace plugin has an invalid release count",
            ));
        }
        validate_market_permissions(&plugin.permissions)?;
        if let Some(repository) = &plugin.repository {
            validate_public_metadata_url(repository, "market.plugin.repository")?;
        }
        if let Some(homepage) = &plugin.homepage {
            validate_public_metadata_url(homepage, "market.plugin.homepage")?;
        }
        if let Some(icon) = &plugin.icon {
            validate_https_url(
                icon,
                &[
                    "download.notegen.top",
                    "raw.githubusercontent.com",
                    "github.com",
                    "objects.githubusercontent.com",
                ],
                "Marketplace plugin icon",
            )?;
        }

        let mut versions = BTreeSet::new();
        for release in &plugin.releases {
            if let Some(reason) = &release.revoked { validate_text(reason, "release.revoked", 500)?; }
            if let Some(key) = &release.publisher_key_id {
                validate_text(key, "release.publisherKeyId", 160)?;
                let publisher = index.publishers.iter().find(|publisher| publisher.id == plugin.publisher_id)
                    .ok_or_else(|| plugin_error("InvalidMarket", "Release publisher is missing"))?;
                if key != &publisher.key_id && !publisher.previous_keys.iter().any(|previous| &previous.key_id == key) {
                    return Err(plugin_error("InvalidMarket", "Release publisher key is not registered"));
                }
            }
            if let Some(permissions) = &release.permissions {
                validate_market_permissions(permissions)?;
            }
            if release.version.len() > 80 || release.min_app_version.len() > 80 {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace release version is too long",
                ));
            }
            let release_version = Version::parse(&release.version).map_err(|_| {
                plugin_error("InvalidMarket", "Marketplace release version is not valid SemVer")
            })?;
            if !semver_core_is_javascript_safe(&release_version) {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace release version exceeds the JavaScript safe integer range",
                ));
            }
            let minimum_app_version = Version::parse(&release.min_app_version).map_err(|_| {
                plugin_error(
                    "InvalidMarket",
                    "Marketplace release minAppVersion is not valid SemVer",
                )
            })?;
            if !semver_core_is_javascript_safe(&minimum_app_version) {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace release minAppVersion exceeds the JavaScript safe integer range",
                ));
            }
            parse_api_requirement(&release.api_version, "Marketplace release apiVersion")
                .map_err(|error| plugin_error("InvalidMarket", error.message))?;
            if !versions.insert(release.version.to_ascii_lowercase())
                || release.platforms.is_empty()
                || release.platforms.iter().copied().collect::<BTreeSet<_>>().len()
                    != release.platforms.len()
            {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace plugin contains duplicate or invalid releases",
                ));
            }
            validate_sha256(&release.package_sha256, "Marketplace package digest")?;
            market_package_urls(release)?;
            if let Some(signature_url) = &release.signature_url {
                validate_package_url(signature_url)?;
            }
            validate_text(&release.published_at, "market.release.publishedAt", 100)?;
            if release
                .changelog
                .as_ref()
                .is_some_and(|value| value.len() > 20_000 || value.chars().any(|character| character == '\0'))
            {
                return Err(plugin_error(
                    "InvalidMarket",
                    "Marketplace release changelog is invalid",
                ));
            }
        }
    }
    Ok(())
}

fn validate_market_permissions(permissions: &[String]) -> PluginResult<()> {
    let mut unique = BTreeSet::new();
    for permission in permissions {
        if !matches!(
            permission.as_str(),
            "editor.read" | "editor.write" | "notes.read" | "notes.create" | "notes.open"
                | "notes.list" | "notes.write" | "notes.delete" | "notes.move" | "network.fetch" | "attachments.read" | "attachments.create" | "records.read" | "records.write" | "chat.write" | "ai.generate"
        ) || !unique.insert(permission)
        {
            return Err(plugin_error(
                "InvalidMarket",
                "Marketplace contains an unknown or duplicate permission",
            ));
        }
    }
    Ok(())
}

fn parse_verified_market_index(
    index_bytes: &[u8],
    signature_text: &str,
    allow_expired: bool,
) -> PluginResult<PluginMarketIndex> {
    let public_key = market_public_key()?;
    let signature = decode_base64(signature_text, 64, "Marketplace index signature")?;
    verify_ed25519(&public_key, &signature, index_bytes)?;
    let (index, _) = parse_strict_type::<PluginMarketIndex>(index_bytes, "Marketplace index")?;
    validate_market_index(&index, allow_expired)?;
    Ok(index)
}

fn market_catalog(index: PluginMarketIndex, source: PluginMarketSource, stale: bool) -> PluginMarketCatalog {
    PluginMarketCatalog {
        schema_version: index.schema_version,
        generation: index.generation,
        generated_at: index.generated_at,
        expires_at: index.expires_at,
        publishers: index.publishers,
        plugins: index.plugins,
        source,
        stale,
    }
}

fn catalog_to_index(catalog: &PluginMarketCatalog) -> PluginMarketIndex {
    PluginMarketIndex {
        schema_version: catalog.schema_version,
        generation: catalog.generation,
        generated_at: catalog.generated_at.clone(),
        expires_at: catalog.expires_at,
        publishers: catalog.publishers.clone(),
        plugins: catalog.plugins.clone(),
    }
}

fn build_market_client() -> PluginResult<reqwest::Client> {
    let redirect = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many marketplace redirects");
        }
        let host = attempt.url().host_str().unwrap_or_default().to_ascii_lowercase();
        if attempt.url().scheme() != "https"
            || !attempt.url().username().is_empty()
            || attempt.url().password().is_some()
            || attempt.url().port().is_some_and(|port| port != 443)
            || attempt.url().fragment().is_some()
            || !matches!(
                host.as_str(),
                "download.notegen.top"
                    | "github.com"
                    | "objects.githubusercontent.com"
                    | "release-assets.githubusercontent.com"
            )
        {
            return attempt.error("marketplace redirect target is not allowed");
        }
        attempt.follow()
    });
    reqwest::Client::builder()
        .redirect(redirect)
        .connect_timeout(Duration::from_secs(10))
        .timeout(HTTP_TIMEOUT)
        .user_agent("NoteGen-Plugin-Market/1")
        .no_proxy()
        .build()
        .map_err(|_| plugin_error("MarketUnavailable", "Unable to initialize marketplace client"))
}

async fn fetch_limited(client: &reqwest::Client, url: &str, limit: u64) -> PluginResult<Vec<u8>> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| plugin_error("MarketUnavailable", "Marketplace request failed"))?;
    if !response.status().is_success() {
        return Err(plugin_error(
            "MarketUnavailable",
            format!("Marketplace returned HTTP {}", response.status().as_u16()),
        ));
    }
    if response.content_length().is_some_and(|length| length > limit) {
        return Err(plugin_error(
            "PackageTooLarge",
            "Marketplace response exceeds its size limit",
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|_| plugin_error("MarketUnavailable", "Marketplace response was interrupted"))?;
        if (bytes.len() as u64).saturating_add(chunk.len() as u64) > limit {
            return Err(plugin_error(
                "PackageTooLarge",
                "Marketplace response exceeded its size limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn market_catalog_directory(app: &AppHandle) -> PluginResult<PathBuf> {
    let catalog_dir = plugin_data_root(app)?.join("catalog");
    ensure_real_directory(&catalog_dir, "plugin marketplace cache directory")?;
    Ok(catalog_dir)
}

fn cached_market_path(app: &AppHandle) -> PluginResult<PathBuf> {
    Ok(market_catalog_directory(app)?.join("verified-index.json"))
}

fn market_high_water_path(app: &AppHandle) -> PluginResult<PathBuf> {
    Ok(market_catalog_directory(app)?.join("market-high-water.json"))
}

fn load_market_high_water(app: &AppHandle) -> PluginResult<Option<MarketHighWater>> {
    let path = market_high_water_path(app)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(io_error("inspect plugin marketplace high-water mark")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4 * 1024 {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace high-water mark is not a valid regular file",
        ));
    }
    let bytes = fs::read(&path)
        .map_err(|_| io_error("read plugin marketplace high-water mark"))?;
    let (high_water, _) =
        parse_strict_type::<MarketHighWater>(&bytes, "Marketplace high-water mark")?;
    if high_water.schema_version != MARKET_SCHEMA_VERSION
        || high_water.generation == 0
        || high_water.generation > MAX_JAVASCRIPT_INTEGER
        || validate_sha256(&high_water.index_sha256, "Marketplace high-water digest").is_err()
    {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace high-water mark is invalid",
        ));
    }
    Ok(Some(high_water))
}

fn market_high_water(index: &PluginMarketIndex, index_bytes: &[u8]) -> MarketHighWater {
    MarketHighWater {
        schema_version: MARKET_SCHEMA_VERSION,
        generation: index.generation,
        index_sha256: sha256_hex(index_bytes),
    }
}

fn validate_against_market_high_water(
    index: &PluginMarketIndex,
    index_bytes: &[u8],
    high_water: &MarketHighWater,
) -> PluginResult<()> {
    let digest = sha256_hex(index_bytes);
    if index.generation < high_water.generation
        || (index.generation == high_water.generation && digest != high_water.index_sha256)
    {
        return Err(plugin_error(
            "InvalidMarket",
            "Marketplace index is older than or conflicts with the accepted high-water mark",
        ));
    }
    Ok(())
}

fn save_market_high_water(app: &AppHandle, high_water: &MarketHighWater) -> PluginResult<()> {
    let bytes = serde_json::to_vec(high_water)
        .map_err(|_| plugin_error("Internal", "Unable to serialize marketplace high-water mark"))?;
    atomic_write(&market_high_water_path(app)?, &bytes)
}

fn load_cached_market(app: &AppHandle) -> PluginResult<Option<(PluginMarketIndex, Vec<u8>, String)>> {
    market_public_key()?;
    let path = cached_market_path(app)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(io_error("inspect plugin marketplace cache")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_INDEX_BYTES * 2 {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace cache is not a valid regular file",
        ));
    }
    let bytes = fs::read(&path).map_err(|_| io_error("read plugin marketplace cache"))?;
    let (envelope, _) = parse_strict_type::<CachedMarketEnvelope>(&bytes, "Marketplace cache")?;
    if envelope.schema_version != MARKET_SCHEMA_VERSION {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace cache uses an unsupported schema",
        ));
    }
    if envelope.cached_at_ms > now_ms().saturating_add(5 * 60 * 1_000) {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace cache timestamp is invalid",
        ));
    }
    let index_bytes = STANDARD
        .decode(envelope.index_base64.as_bytes())
        .map_err(|_| plugin_error("InvalidMarket", "Marketplace cache payload is invalid"))?;
    if index_bytes.len() as u64 > MAX_INDEX_BYTES || envelope.signature_base64.len() as u64 > MAX_SIGNATURE_BYTES {
        return Err(plugin_error(
            "InvalidMarket",
            "Plugin marketplace cache exceeds its size limit",
        ));
    }
    // Expired indexes remain useful as a signed offline catalog and, more
    // importantly, as rollback evidence. Installation rejects stale catalogs.
    let index = parse_verified_market_index(&index_bytes, &envelope.signature_base64, true)?;
    Ok(Some((index, index_bytes, envelope.signature_base64)))
}

fn save_cached_market(app: &AppHandle, index_bytes: &[u8], signature: &str) -> PluginResult<()> {
    let envelope = CachedMarketEnvelope {
        schema_version: MARKET_SCHEMA_VERSION,
        index_base64: STANDARD.encode(index_bytes),
        signature_base64: signature.to_string(),
        cached_at_ms: now_ms(),
    };
    let bytes = serde_json::to_vec(&envelope)
        .map_err(|_| plugin_error("Internal", "Unable to serialize marketplace cache"))?;
    atomic_write(&cached_market_path(app)?, &bytes)
}

async fn fetch_market_catalog(app: &AppHandle, refresh: bool) -> PluginResult<PluginMarketCatalog> {
    // Resolve the trust anchor before touching the network. A missing or malformed
    // build-time key must never degrade into an unsigned marketplace request.
    market_public_key()?;
    let mut high_water = load_market_high_water(app)?;
    let mut cached = match load_cached_market(app) {
        Ok(cached) => cached,
        // A bad cache is never consumed, but a freshly root-signed index may repair it.
        Err(error)
            if matches!(
                error.code.as_str(),
                "InvalidJson" | "InvalidManifest" | "InvalidMarket" | "SignatureInvalid"
            ) =>
        {
            None
        }
        Err(error) => return Err(error),
    };

    if let Some((cached_index, cached_bytes, _)) = &cached {
        if let Some(previous_high_water) = &high_water {
            if validate_against_market_high_water(cached_index, cached_bytes, previous_high_water).is_err() {
                // Keep the independent high-water mark and refuse the rolled-back
                // or conflicting cache. A current signed remote index may repair it.
                cached = None;
            } else if cached_index.generation > previous_high_water.generation {
                let accepted = market_high_water(cached_index, cached_bytes);
                save_market_high_water(app, &accepted)?;
                high_water = Some(accepted);
            }
        } else {
            let accepted = market_high_water(cached_index, cached_bytes);
            save_market_high_water(app, &accepted)?;
            high_water = Some(accepted);
        }
    }

    if !refresh {
        if let Some((index, _, _)) = &cached {
            if index.expires_at > now_ms() {
                return Ok(market_catalog(
                    index.clone(),
                    PluginMarketSource::Cache,
                    false,
                ));
            }
        }
    }

    let client = build_market_client()?;
    for (index_url, signature_url) in MARKET_ENDPOINTS {
        let index_bytes = match fetch_limited(&client, index_url, MAX_INDEX_BYTES).await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let signature_bytes = match fetch_limited(&client, signature_url, MAX_SIGNATURE_BYTES).await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let signature = match std::str::from_utf8(&signature_bytes) {
            Ok(value) => value.trim(),
            Err(_) => continue,
        };
        let index = match parse_verified_market_index(&index_bytes, signature, false) {
            Ok(index) => index,
            Err(_) => continue,
        };
        if let Some(high_water) = &high_water {
            if validate_against_market_high_water(&index, &index_bytes, high_water).is_err() {
                continue;
            }
        }
        // Advance rollback state before replacing the disposable cache. If the
        // second write fails, a later attempt must still satisfy this high-water mark.
        let accepted = market_high_water(&index, &index_bytes);
        save_market_high_water(app, &accepted)?;
        save_cached_market(app, &index_bytes, signature)?;
        return Ok(market_catalog(index, PluginMarketSource::Remote, false));
    }

    cached
        .map(|(index, _, _)| market_catalog(index, PluginMarketSource::Cache, true))
        .ok_or_else(|| {
            plugin_error(
                "MarketUnavailable",
                "Unable to load a verified plugin marketplace catalog",
            )
        })
}

fn release_compatible(app: &AppHandle, release: &PluginMarketRelease) -> PluginResult<bool> {
    if release.revoked.is_some() { return Ok(false); }
    let minimum_app = Version::parse(&release.min_app_version)
        .map_err(|_| plugin_error("InvalidMarket", "Marketplace minimum app version is invalid"))?;
    let current_app = Version::parse(&app.package_info().version.to_string())
        .map_err(|_| plugin_error("Internal", "NoteGen application version is invalid"))?;
    let (api_operator, api_target) =
        parse_api_requirement(&release.api_version, "Marketplace release apiVersion")
            .map_err(|_| {
                plugin_error("InvalidMarket", "Marketplace API requirement is invalid")
            })?;
    let supported_api = Version::parse(PLUGIN_API_VERSION)
        .map_err(|_| plugin_error("Internal", "Plugin API version is invalid"))?;
    Ok(release.platforms.contains(&PluginPlatform::Desktop)
        && !minimum_app.cmp_precedence(&current_app).is_gt()
        && api_requirement_matches(&supported_api, &api_operator, &api_target))
}

fn resolve_market_release(
    app: &AppHandle,
    index: &PluginMarketIndex,
    plugin_id: &str,
    requested_version: Option<&str>,
) -> PluginResult<ResolvedMarketRelease> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(plugin_error("InvalidManifest", "Plugin id is invalid"));
    }
    if let Some(version) = requested_version {
        if version.len() > 80 {
            return Err(plugin_error(
                "InvalidManifest",
                "Requested plugin version is invalid",
            ));
        }
        let requested = Version::parse(version)
            .map_err(|_| plugin_error("InvalidManifest", "Requested plugin version is invalid"))?;
        if !semver_core_is_javascript_safe(&requested) {
            return Err(plugin_error(
                "InvalidManifest",
                "Requested plugin version exceeds the JavaScript safe integer range",
            ));
        }
    }
    let entry = index
        .plugins
        .iter()
        .find(|entry| entry.id == plugin_id)
        .cloned()
        .ok_or_else(|| plugin_error("NotFound", "Plugin is not present in the marketplace"))?;
    let publisher = index
        .publishers
        .iter()
        .find(|publisher| publisher.id == entry.publisher_id)
        .cloned()
        .ok_or_else(|| plugin_error("InvalidMarket", "Plugin publisher is missing"))?;

    let mut compatible = entry
        .releases
        .iter()
        .filter_map(|release| {
            if requested_version.is_some_and(|version| version != release.version) {
                return None;
            }
            match release_compatible(app, release) {
                Ok(true) => Version::parse(&release.version)
                    .ok()
                    .map(|version| (version, release.clone())),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    // Build metadata does not affect SemVer precedence. Keep the signed index
    // order for equal-precedence releases, matching the frontend's selection.
    compatible.sort_by(|left, right| right.0.cmp_precedence(&left.0));
    let release = compatible
        .into_iter()
        .next()
        .map(|(_, release)| release)
        .ok_or_else(|| {
            plugin_error(
                "Incompatible",
                "No compatible desktop release is available for this plugin",
            )
        })?;
    let mut publisher = publisher;
    if let Some(key_id) = release.publisher_key_id.as_ref().filter(|id| *id != &publisher.key_id) {
        let key = publisher.previous_keys.iter().find(|key| &key.key_id == key_id)
            .ok_or_else(|| plugin_error("InvalidMarket", "Release publisher key is not registered"))?.clone();
        publisher.key_id = key.key_id;
        publisher.public_key = key.public_key;
    }
    Ok(ResolvedMarketRelease {
        entry,
        release,
        publisher,
    })
}

fn validate_package_against_release(
    prepared: &PreparedPackage,
    resolved: &ResolvedMarketRelease,
) -> PluginResult<()> {
    let manifest = &prepared.content.manifest;
    if manifest.id != resolved.entry.id
        || manifest.version != resolved.release.version
        || manifest.api_version != resolved.release.api_version
        || manifest.min_app_version != resolved.release.min_app_version
        || manifest.platforms.iter().copied().collect::<BTreeSet<_>>()
            != resolved.release.platforms.iter().copied().collect::<BTreeSet<_>>()
        || prepared.archive_sha256 != resolved.release.package_sha256
    {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin package metadata does not match the signed marketplace release",
        ));
    }
    let manifest_permissions = manifest.permissions.keys().cloned().collect::<BTreeSet<_>>();
    let market_permissions = resolved.release.permissions.as_ref()
        .unwrap_or(&resolved.entry.permissions)
        .iter().cloned().collect::<BTreeSet<_>>();
    if manifest_permissions != market_permissions {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin permissions do not match the signed marketplace summary",
        ));
    }
    verify_package_signature(&prepared.content, &resolved.publisher.public_key)
}

async fn download_market_package(
    app: &AppHandle,
    release: &PluginMarketRelease,
) -> PluginResult<PathBuf> {
    let urls = market_package_urls(release)?;
    let client = build_market_client()?;
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|_| io_error("resolve plugin download cache"))?;
    ensure_real_directory(&cache_root, "application cache directory")?;
    let plugin_cache = cache_root.join("plugins");
    ensure_real_directory(&plugin_cache, "plugin cache directory")?;
    let download_dir = plugin_cache.join("downloads");
    ensure_real_directory(&download_dir, "plugin download directory")?;
    let mut last_error = None;
    for url in urls {
        let destination =
            download_dir.join(format!("{}.notegen-plugin.part", Uuid::new_v4()));
        let result = async {
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|_| plugin_error("MarketUnavailable", "Plugin package download failed"))?;
            if !response.status().is_success() {
                return Err(plugin_error(
                    "MarketUnavailable",
                    format!("Plugin download returned HTTP {}", response.status().as_u16()),
                ));
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_ARCHIVE_BYTES)
            {
                return Err(plugin_error(
                    "PackageTooLarge",
                    "Plugin package exceeds the 20 MiB download limit",
                ));
            }
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&destination)
                .map_err(|_| io_error("create plugin download"))?;
            let mut digest = Sha256::new();
            let mut total = 0_u64;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| {
                    plugin_error("MarketUnavailable", "Plugin download was interrupted")
                })?;
                total = total.checked_add(chunk.len() as u64).ok_or_else(|| {
                    plugin_error("PackageTooLarge", "Plugin download size overflow")
                })?;
                if total > MAX_ARCHIVE_BYTES {
                    return Err(plugin_error(
                        "PackageTooLarge",
                        "Plugin package exceeded the 20 MiB download limit",
                    ));
                }
                digest.update(&chunk);
                output
                    .write_all(&chunk)
                    .map_err(|_| io_error("write plugin download"))?;
            }
            output
                .sync_all()
                .map_err(|_| io_error("flush plugin download"))?;
            let actual_sha256 = format!("{:x}", digest.finalize());
            if actual_sha256 != release.package_sha256 {
                return Err(plugin_error(
                    "IntegrityMismatch",
                    "Downloaded plugin package does not match the signed marketplace digest",
                ));
            }
            Ok(destination.clone())
        }
        .await;
        match result {
            Ok(path) => return Ok(path),
            Err(error) => {
                let _ = fs::remove_file(&destination);
                if error.code == "Io" {
                    return Err(error);
                }
                last_error = Some(error);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        plugin_error("MarketUnavailable", "Plugin package has no usable download URL")
    }))
}

fn ensure_real_directory(path: &Path, label: &str) -> PluginResult<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(|_| io_error(&format!("inspect {label}")))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(plugin_error(
                "UnsafePath",
                format!("The {label} is not a real directory"),
            ));
        }
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|_| io_error(&format!("create {label}")))?;
    let metadata = fs::symlink_metadata(path).map_err(|_| io_error(&format!("inspect {label}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(plugin_error(
            "UnsafePath",
            format!("The {label} is not a real directory"),
        ));
    }
    Ok(())
}

fn plugin_data_root(app: &AppHandle) -> PluginResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| io_error("resolve application data directory"))?
        .join("plugins");
    ensure_real_directory(&root, "plugin data directory")?;
    Ok(root)
}

fn plugin_state_path(app: &AppHandle) -> PluginResult<PathBuf> {
    Ok(plugin_data_root(app)?.join("state.json"))
}

fn read_plugin_state_file(path: &Path) -> PluginResult<PluginStateFile> {
    let metadata = fs::symlink_metadata(path).map_err(|_| io_error("inspect plugin state"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_PLUGIN_STATE_BYTES {
        return Err(plugin_error(
            "InvalidState",
            "Plugin state is not a valid regular file",
        ));
    }
    let bytes = fs::read(path).map_err(|_| io_error("read plugin state"))?;
    let (state, _) = parse_strict_type::<PluginStateFile>(&bytes, "Plugin state")?;
    validate_plugin_state(&state)?;
    Ok(state)
}

fn restore_plugin_state_file(path: &Path, state: &PluginStateFile) -> PluginResult<()> {
    let bytes = serde_json::to_vec(state)
        .map_err(|_| plugin_error("Internal", "Unable to serialize recovered plugin state"))?;
    let existing = file_exists_checked(path)?;
    let quarantine = path.parent().ok_or_else(|| {
        plugin_error("UnsafePath", "Plugin state has no parent directory")
    })?.join(format!(".state.json.{}.corrupt", Uuid::new_v4()));
    if existing {
        fs::rename(path, &quarantine)
            .map_err(|_| io_error("quarantine corrupt plugin state"))?;
    }
    if let Err(error) = atomic_write(path, &bytes) {
        if existing {
            let _ = fs::rename(&quarantine, path);
        }
        return Err(error);
    }
    // Keep the damaged registry for diagnosis instead of deleting its original
    // bytes (or recursively deleting an unexpected directory at this path).
    Ok(())
}

fn load_plugin_state(app: &AppHandle) -> PluginResult<PluginStateFile> {
    let _guard = PLUGIN_STATE_IO_LOCK.lock()
        .map_err(|_| plugin_error("Internal", "Plugin state I/O lock is unavailable"))?;
    load_plugin_state_locked(app)
}

// The caller must hold PLUGIN_STATE_IO_LOCK for the complete read/repair.
fn load_plugin_state_locked(app: &AppHandle) -> PluginResult<PluginStateFile> {
    let state_path = plugin_state_path(app)?;
    let backup_path = state_path.with_extension("json.bak");
    let primary_exists = file_exists_checked(&state_path)?;
    let backup_exists = file_exists_checked(&backup_path)?;

    if primary_exists {
        match read_plugin_state_file(&state_path) {
            Ok(state) => return Ok(state),
            Err(primary_error) => {
                if backup_exists {
                    if let Ok(state) = read_plugin_state_file(&backup_path) {
                        restore_plugin_state_file(&state_path, &state)?;
                        return Ok(state);
                    }
                }
                return Err(primary_error);
            }
        }
    }
    if backup_exists {
        let state = read_plugin_state_file(&backup_path)?;
        restore_plugin_state_file(&state_path, &state)?;
        return Ok(state);
    }
    Ok(PluginStateFile::default())
}

fn validate_plugin_state(state: &PluginStateFile) -> PluginResult<()> {
    if state.schema_version != PLUGIN_STATE_SCHEMA_VERSION {
        return Err(plugin_error(
            "InvalidState",
            "Plugin state uses an unsupported schema version",
        ));
    }
    for (plugin_id, plugin) in &state.plugins {
        if !is_valid_plugin_id(plugin_id)
            || is_reserved_host_plugin_id(plugin_id)
            || !plugin.versions.contains_key(&plugin.active_version)
            || plugin
                .previous_version
                .as_ref()
                .is_some_and(|version| {
                    version == &plugin.active_version || !plugin.versions.contains_key(version)
                })
            || plugin
                .pending_activation_version
                .as_ref()
                .is_some_and(|version| {
                    version != &plugin.active_version
                        || plugin.previous_version.is_none()
                        || plugin
                            .versions
                            .get(version)
                            .is_none_or(|installed| installed.source != PluginSource::Marketplace)
                })
            || plugin
                .versions
                .values()
                .map(|version| version.source)
                .collect::<BTreeSet<_>>()
                .len()
                > 1
        {
            return Err(plugin_error("InvalidState", "Plugin state contains an invalid version pointer"));
        }
        let mut folded_versions = BTreeSet::new();
        for (version, installed) in &plugin.versions {
            if version.len() > 80
                || Version::parse(version)
                    .map_or(true, |version| !semver_core_is_javascript_safe(&version))
                || !folded_versions.insert(version.to_ascii_lowercase())
                || installed.manifest.id != *plugin_id
                || installed.manifest.version != *version
                || validate_sha256(&installed.package_sha256, "Installed package digest").is_err()
                || (installed.source == PluginSource::Marketplace
                    && (installed.publisher_key_id.as_deref().unwrap_or_default().is_empty()
                        || installed.publisher_id.as_ref().is_none_or(|id| {
                            !is_valid_market_identifier(id)
                        })
                        || installed.publisher_public_key.as_ref().is_none_or(|key| {
                            decode_base64(key, 32, "Installed publisher public key").is_err()
                        })
                        || installed.development_path.is_some()))
                || (installed.source == PluginSource::Development
                    && (installed.publisher_key_id.is_some()
                        || installed.publisher_id.is_some()
                        || installed.publisher_public_key.is_some()
                        || installed.development_path.as_ref().is_none_or(|path| {
                            path.is_empty()
                                || path.len() > 4_096
                                || path.chars().any(char::is_control)
                                || !Path::new(path).is_absolute()
                        })))
            {
                return Err(plugin_error(
                    "InvalidState",
                    "Plugin state contains invalid package metadata",
                ));
            }
        }
    }
    Ok(())
}

fn save_plugin_state(app: &AppHandle, state: &PluginStateFile) -> PluginResult<()> {
    validate_plugin_state(state)?;
    let bytes = serde_json::to_vec(state)
        .map_err(|_| plugin_error("Internal", "Unable to serialize plugin state"))?;
    if bytes.len() as u64 > MAX_PLUGIN_STATE_BYTES {
        return Err(plugin_error("QuotaExceeded", "Installed plugin state exceeds its file size limit"));
    }
    let _guard = PLUGIN_STATE_IO_LOCK.lock()
        .map_err(|_| plugin_error("Internal", "Plugin state I/O lock is unavailable"))?;
    let state_path = plugin_state_path(app)?;
    let backup_path = state_path.with_extension("json.bak");
    // Recover and capture the prior valid snapshot under the same lock as the
    // commit. A delayed reader can no longer restore a pre-uninstall snapshot.
    let previous = load_plugin_state_locked(app)?;
    let previous_bytes = serde_json::to_vec(&previous)
        .map_err(|_| plugin_error("Internal", "Unable to serialize previous plugin state"))?;
    atomic_write(&backup_path, &previous_bytes)?;
    atomic_write(&state_path, &bytes)?;

    // Once the primary commit succeeds, mirror the same valid snapshot into
    // the recovery file before callers remove program directories referenced
    // only by the previous state. If this second commit fails, best-effort
    // restore both files so callers can safely treat the mutation as failed.
    if let Err(error) = atomic_write(&backup_path, &bytes) {
        let _ = atomic_write(&state_path, &previous_bytes);
        let _ = atomic_write(&backup_path, &previous_bytes);
        return Err(error);
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> PluginResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| plugin_error("UnsafePath", "Atomic file has no parent directory"))?;
    ensure_real_directory(parent, "atomic file parent directory")?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(plugin_error(
                "UnsafePath",
                "Atomic file target is not a regular file",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(io_error("inspect existing atomic file")),
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| plugin_error("UnsafePath", "Atomic file name is invalid"))?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| io_error("create atomic temporary file"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        let _ = error;
        return Err(io_error("write atomic temporary file"));
    }
    drop(file);

    #[cfg(not(target_os = "windows"))]
    {
        if fs::rename(&temporary, path).is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(io_error("replace atomic file"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // Both files are in the same directory/volume. Replace in one native
        // operation: never rename or delete a user-owned *.json.bak sibling.
        let replaced = unsafe {
            MoveFileExW(
                PCWSTR(source.as_ptr()),
                PCWSTR(destination.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if replaced.is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(io_error("replace atomic file"));
        }
    }

    sync_directory(parent);
    Ok(())
}

fn sync_directory(path: &Path) {
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
}

fn plugin_artifact_is_stale(metadata: &fs::Metadata) -> bool {
    metadata
        .modified()
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age >= Duration::from_secs(24 * 60 * 60))
}

pub fn cleanup_plugin_artifacts(app: &AppHandle) {
    if let Ok(root) = plugin_data_root(app) {
        let staging_root = root.join("staging");
        if ensure_real_directory(&staging_root, "plugin staging directory").is_ok() {
            if let Ok(entries) = fs::read_dir(&staging_root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let file_name = entry.file_name();
                    let valid_name = file_name
                        .to_str()
                        .is_some_and(|name| Uuid::parse_str(name).is_ok());
                    let removable = fs::symlink_metadata(&path).is_ok_and(|metadata| {
                        valid_name
                            && !metadata.file_type().is_symlink()
                            && metadata.is_dir()
                            && plugin_artifact_is_stale(&metadata)
                    });
                    if removable {
                        let _ = fs::remove_dir_all(path);
                    }
                }
            }
        }
    }

    let download_root = app.path().app_cache_dir().ok().and_then(|root| {
        ensure_real_directory(&root, "application cache directory").ok()?;
        let plugin_cache = root.join("plugins");
        ensure_real_directory(&plugin_cache, "plugin cache directory").ok()?;
        let downloads = plugin_cache.join("downloads");
        ensure_real_directory(&downloads, "plugin download directory").ok()?;
        Some(downloads)
    });
    if let Some(download_root) = download_root {
        if let Ok(entries) = fs::read_dir(download_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = entry.file_name();
                let valid_name = file_name
                    .to_str()
                    .and_then(|name| name.strip_suffix(".notegen-plugin.part"))
                    .is_some_and(|name| Uuid::parse_str(name).is_ok());
                let removable = fs::symlink_metadata(&path).is_ok_and(|metadata| {
                    valid_name
                        && !metadata.file_type().is_symlink()
                        && metadata.is_file()
                        && plugin_artifact_is_stale(&metadata)
                });
                if removable {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
}

fn packages_root(app: &AppHandle) -> PluginResult<PathBuf> {
    let root = plugin_data_root(app)?.join("packages");
    ensure_real_directory(&root, "plugin packages directory")?;
    Ok(root)
}

fn installed_version_directory(
    app: &AppHandle,
    plugin_id: &str,
    version: &str,
    version_state: &InstalledVersionState,
) -> PluginResult<PathBuf> {
    if !is_valid_plugin_id(plugin_id)
        || version.len() > 80
        || Version::parse(version)
            .map_or(true, |version| !semver_core_is_javascript_safe(&version))
        || version_state.manifest.id != plugin_id
        || version_state.manifest.version != version
    {
        return Err(plugin_error("InvalidManifest", "Plugin id or version is invalid"));
    }
    let plugin_root = packages_root(app)?.join(plugin_id);
    match version_state.source {
        PluginSource::Marketplace => Ok(plugin_root.join(version)),
        PluginSource::Development => {
            validate_sha256(
                &version_state.package_sha256,
                "Development snapshot digest",
            )?;
            Ok(plugin_root
                .join("development")
                .join(&version_state.package_sha256))
        }
    }
}

fn remove_development_snapshot(plugin_parent: &Path, content_hash: &str) {
    if validate_sha256(content_hash, "Development snapshot digest").is_err() {
        return;
    }
    let development_root = plugin_parent.join("development");
    let snapshot = development_root.join(content_hash);
    let removable = fs::symlink_metadata(&snapshot).is_ok_and(|metadata| {
        !metadata.file_type().is_symlink() && metadata.is_dir()
    });
    if removable && fs::remove_dir_all(&snapshot).is_ok() {
        sync_directory(&development_root);
        if fs::remove_dir(&development_root).is_ok() {
            sync_directory(plugin_parent);
        }
    }
}

fn developer_mode_enabled(app: &AppHandle) -> PluginResult<bool> {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .map_err(|_| plugin_error("DeveloperModeRequired", "Unable to read developer mode setting"))?;
    Ok(store
        .get(DEVELOPER_MODE_KEY)
        .and_then(|value| value.as_bool())
        .unwrap_or(false))
}

fn ensure_source_compatible(
    state: &PluginStateFile,
    plugin_id: &str,
    source: PluginSource,
) -> PluginResult<()> {
    if let Some(installed) = state.plugins.get(plugin_id) {
        if installed
            .versions
            .values()
            .any(|version| version.source != source)
        {
            return Err(plugin_error(
                "Conflict",
                "Development and marketplace packages with the same plugin id cannot replace each other",
            ));
        }
    }
    Ok(())
}

fn ensure_marketplace_publisher_continuity(
    state: &PluginStateFile,
    plugin_id: &str,
    publisher: &PluginMarketPublisher,
) -> PluginResult<()> {
    let Some(active) = state
        .plugins
        .get(plugin_id)
        .and_then(|plugin| plugin.versions.get(&plugin.active_version))
    else {
        return Ok(());
    };
    if active.source != PluginSource::Marketplace {
        return Ok(());
    }
    let installed_key = active.publisher_public_key.as_deref().ok_or_else(|| {
        plugin_error("InvalidState", "Installed publisher public key is missing")
    })?;
    let same_key = active.publisher_key_id.as_deref() == Some(publisher.key_id.as_str())
        && installed_key == publisher.public_key;
    let authorized_rotation = publisher.previous_keys.iter().any(|key| {
        active.publisher_key_id.as_deref() == Some(key.key_id.as_str()) && installed_key == key.public_key
    });
    if active.publisher_id.as_deref() != Some(publisher.id.as_str()) || (!same_key && !authorized_rotation) {
        return Err(plugin_error("SignatureInvalid", "Publisher key change is not authorized by the signed market index"));
    }
    Ok(())
}

fn installed_plugin_view(state: &InstalledPluginState) -> PluginResult<InstalledPlugin> {
    let active = state.versions.get(&state.active_version).ok_or_else(|| {
        plugin_error("InvalidState", "Active plugin version is missing from plugin state")
    })?;
    Ok(InstalledPlugin {
        manifest: active.manifest.clone(),
        source: active.source.into(),
        active_version: state.active_version.clone(),
        previous_version: state.previous_version.clone(),
        pending_activation: state.pending_activation_version.as_deref()
            == Some(state.active_version.as_str()),
        installed_at: format_timestamp_ms(active.installed_at_ms),
        content_hash: active.package_sha256.clone(),
        publisher_key_id: active.publisher_key_id.clone(),
        development_path: (active.source == PluginSource::Development)
            .then(|| active.development_path.clone())
            .flatten(),
        verified: active.source == PluginSource::Marketplace,
    })
}

fn installation_changes(
    state: &PluginStateFile,
    manifest: &PluginManifestV1,
) -> (Option<String>, bool) {
    let Some(installed) = state.plugins.get(&manifest.id) else {
        return (None, false);
    };
    let previous = installed
        .versions
        .get(&installed.active_version)
        .map(|version| &version.manifest);
    let replaced_version = (installed.active_version != manifest.version)
        .then(|| installed.active_version.clone());
    let permissions_changed = previous.is_some_and(|previous| previous.permissions != manifest.permissions);
    (replaced_version, permissions_changed)
}

fn activate_prepared_package(
    app: &AppHandle,
    mut state: PluginStateFile,
    prepared: PreparedPackage,
    source: PluginSource,
    publisher: Option<&PluginMarketPublisher>,
    development_path: Option<String>,
) -> PluginResult<InstalledPlugin> {
    let plugin_id = prepared.content.manifest.id.clone();
    let version = prepared.content.manifest.version.clone();
    let previous_storage_hash = state.plugins.get(&plugin_id)
        .and_then(|plugin| plugin.versions.get(&plugin.active_version))
        .map(|version| version.package_sha256.clone());
    let publisher_key_id = publisher.map(|publisher| publisher.key_id.clone());
    let publisher_id = publisher.map(|publisher| publisher.id.clone());
    let publisher_public_key = publisher.map(|publisher| publisher.public_key.clone());
    ensure_source_compatible(&state, &plugin_id, source)?;
    if state.plugins.get(&plugin_id).is_some_and(|plugin| {
        plugin.pending_activation_version.is_some() && plugin.active_version != version
    }) {
        return Err(plugin_error(
            "Conflict",
            "The current plugin update must activate successfully or be rolled back before another version is installed",
        ));
    }
    if source == PluginSource::Marketplace {
        let publisher = publisher
            .ok_or_else(|| plugin_error("InvalidMarket", "Marketplace publisher is missing"))?;
        ensure_marketplace_publisher_continuity(&state, &plugin_id, publisher)?;
    }
    if state.plugins.get(&plugin_id).is_some_and(|plugin| {
        plugin
            .versions
            .keys()
            .any(|installed| installed != &version && installed.eq_ignore_ascii_case(&version))
    }) {
        return Err(plugin_error(
            "Conflict",
            "Plugin versions that differ only by ASCII case cannot be installed together",
        ));
    }
    let new_version_state = InstalledVersionState {
        manifest: prepared.content.manifest.clone(),
        source,
        package_sha256: prepared.archive_sha256.clone(),
        publisher_key_id: publisher_key_id.clone(),
        publisher_id: publisher_id.clone(),
        publisher_public_key: publisher_public_key.clone(),
        development_path,
        installed_at_ms: now_ms(),
    };
    let replaced_development_hash = state
        .plugins
        .get(&plugin_id)
        .and_then(|plugin| plugin.versions.get(&version))
        .filter(|installed| {
            source == PluginSource::Development
                && installed.source == PluginSource::Development
                && installed.package_sha256 != prepared.archive_sha256
        })
        .map(|installed| installed.package_sha256.clone());

    let plugin_parent = packages_root(app)?.join(&plugin_id);
    ensure_real_directory(&plugin_parent, "plugin version parent directory")?;
    let destination_parent = if source == PluginSource::Development {
        let development_root = plugin_parent.join("development");
        ensure_real_directory(&development_root, "development snapshot directory")?;
        development_root
    } else {
        plugin_parent.clone()
    };
    let destination = if source == PluginSource::Development {
        destination_parent.join(&prepared.archive_sha256)
    } else {
        destination_parent.join(&version)
    };
    let already_installed = match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(plugin_error(
                    "UnsafePath",
                    "Installed plugin version path is not a real directory",
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err(io_error("inspect installed plugin version directory")),
    };
    let version_has_state = state
        .plugins
        .get(&plugin_id)
        .is_some_and(|plugin| plugin.versions.contains_key(&version));
    if !already_installed && source == PluginSource::Marketplace {
        if let Some(existing) = state
            .plugins
            .get(&plugin_id)
            .and_then(|plugin| plugin.versions.get(&version))
        {
            if existing.manifest != prepared.content.manifest
                || existing.package_sha256 != prepared.archive_sha256
                || existing.publisher_key_id != publisher_key_id
                || existing.publisher_id != publisher_id
                || existing.publisher_public_key != publisher_public_key
            {
                return Err(plugin_error(
                    "IntegrityMismatch",
                    "Marketplace state does not match the package being restored",
                ));
            }
        }
    }
    let mut replaced_directory_backup = None;
    let mut installed_new_directory = false;
    if source == PluginSource::Development {
        if already_installed {
            let existing_content = validate_package_directory(app, &destination)?;
            if existing_content.manifest != prepared.content.manifest
                || development_snapshot_hash(&existing_content) != prepared.archive_sha256
            {
                return Err(plugin_error(
                    "IntegrityMismatch",
                    "Existing development snapshot does not match its content-addressed directory",
                ));
            }
            fs::remove_dir_all(&prepared.staging_dir)
                .map_err(|_| io_error("remove duplicate plugin staging directory"))?;
        } else {
            fs::rename(&prepared.staging_dir, &destination)
                .map_err(|_| io_error("activate staged development snapshot"))?;
            installed_new_directory = true;
            sync_directory(&destination_parent);
        }
    } else if already_installed && !version_has_state {
        // A crash may leave a fully moved version directory before state.json is
        // committed. Packages are disposable program files, so quarantine the
        // orphan and activate the freshly verified package.
        let backup = plugin_parent.join(format!(".{version}.{}.orphan", Uuid::new_v4()));
        fs::rename(&destination, &backup)
            .map_err(|_| io_error("quarantine orphaned plugin version"))?;
        if fs::rename(&prepared.staging_dir, &destination).is_err() {
            let _ = fs::rename(&backup, &destination);
            return Err(io_error("activate plugin after orphan recovery"));
        }
        replaced_directory_backup = Some(backup);
        sync_directory(&plugin_parent);
    } else if already_installed {
        let existing = state
            .plugins
            .get(&plugin_id)
            .and_then(|plugin| plugin.versions.get(&version))
            .ok_or_else(|| {
                plugin_error(
                    "Conflict",
                    "A plugin version directory exists without a trusted state record",
                )
            })?;
        if existing.source != source {
            return Err(plugin_error(
                "Conflict",
                "The same plugin version is already installed from a different source",
            ));
        }
        if existing.manifest != prepared.content.manifest
            && (source == PluginSource::Marketplace
                || existing.package_sha256 == prepared.archive_sha256)
        {
            return Err(plugin_error(
                "IntegrityMismatch",
                "Installed plugin state does not match the package being activated",
            ));
        }
        if existing.package_sha256 == prepared.archive_sha256 {
            if source == PluginSource::Marketplace {
                if existing.publisher_key_id != publisher_key_id
                    || existing.publisher_id != publisher_id
                    || existing.publisher_public_key != publisher_public_key
                {
                    return Err(plugin_error(
                        "IntegrityMismatch",
                        "Installed plugin publisher identity does not match the marketplace",
                    ));
                }
            }
            let existing_is_valid = (|| -> PluginResult<()> {
                let existing_content = validate_package_directory(app, &destination)?;
                if existing_content.manifest != prepared.content.manifest {
                    return Err(plugin_error(
                        "IntegrityMismatch",
                        "Installed plugin version no longer matches its verified manifest",
                    ));
                }
                let public_key = publisher
                    .map(|publisher| publisher.public_key.as_str())
                    .ok_or_else(|| {
                        plugin_error("InvalidMarket", "Plugin publisher key is missing")
                    })?;
                verify_package_signature(&existing_content, public_key)
            })()
            .is_ok();

            if existing_is_valid {
                fs::remove_dir_all(&prepared.staging_dir)
                    .map_err(|_| io_error("remove duplicate plugin staging directory"))?;
            } else {
                // The freshly downloaded package has already been checked against
                // the root-signed release and publisher signature. Replace only the
                // corrupt same-version directory, retaining it until state commits.
                let public_key = publisher
                    .map(|publisher| publisher.public_key.as_str())
                    .ok_or_else(|| {
                        plugin_error("InvalidMarket", "Plugin publisher key is missing")
                    })?;
                let repair_content = validate_package_directory(app, &prepared.staging_dir)?;
                if repair_content.manifest_json != prepared.content.manifest_json
                    || repair_content.integrity_json != prepared.content.integrity_json
                {
                    return Err(plugin_error(
                        "IntegrityMismatch",
                        "Verified repair staging content changed before activation",
                    ));
                }
                verify_package_signature(&repair_content, public_key)?;
                let backup = plugin_parent.join(format!(
                    ".{version}.{}.corrupt",
                    Uuid::new_v4()
                ));
                fs::rename(&destination, &backup)
                    .map_err(|_| io_error("quarantine corrupt installed plugin version"))?;
                if fs::rename(&prepared.staging_dir, &destination).is_err() {
                    let _ = fs::rename(&backup, &destination);
                    return Err(io_error("repair installed plugin version"));
                }
                replaced_directory_backup = Some(backup);
                sync_directory(&plugin_parent);
            }
        } else {
            return Err(plugin_error(
                "Conflict",
                "Marketplace plugin versions are immutable and cannot be replaced",
            ));
        }
    } else {
        fs::rename(&prepared.staging_dir, &destination)
            .map_err(|_| io_error("activate staged plugin package"))?;
        installed_new_directory = true;
        sync_directory(&destination_parent);
    }

    let mut pruned_versions = Vec::new();
    {
        let plugin = state
            .plugins
            .entry(plugin_id.clone())
            .or_insert_with(|| InstalledPluginState {
                active_version: version.clone(),
                previous_version: None,
                pending_activation_version: None,
                versions: BTreeMap::new(),
            });
        let previous_active = plugin.active_version.clone();
        if source == PluginSource::Development {
            plugin.versions.insert(version.clone(), new_version_state);
        } else {
            plugin
                .versions
                .entry(version.clone())
                .or_insert(new_version_state);
        }
        if previous_active != version && plugin.versions.contains_key(&previous_active) {
            plugin.previous_version = Some(previous_active);
            plugin.pending_activation_version = (source == PluginSource::Marketplace)
                .then(|| version.clone());
        }
        plugin.active_version = version;

        let retained = [
            Some(plugin.active_version.clone()),
            plugin.previous_version.clone(),
        ]
        .into_iter()
        .flatten()
        .collect::<BTreeSet<_>>();
        let removable = plugin
            .versions
            .keys()
            .filter(|candidate| !retained.contains(*candidate))
            .cloned()
            .collect::<Vec<_>>();
        for removable_version in removable {
            if let Some(version_state) = plugin.versions.remove(&removable_version) {
                pruned_versions.push((removable_version, version_state));
            }
        }
    }

    let storage_result = (|| {
        if let Some(hash) = previous_storage_hash.as_deref() {
            prepare_storage_version(app, &plugin_id, hash, None)?;
        }
        prepare_storage_version(app, &plugin_id, &prepared.archive_sha256, previous_storage_hash.as_deref())
    })();
    if let Err(error) = storage_result.and_then(|_| save_plugin_state(app, &state)) {
        if let Some(backup) = &replaced_directory_backup {
            let _ = fs::remove_dir_all(&destination);
            let _ = fs::rename(backup, &destination);
        } else if installed_new_directory {
            if fs::remove_dir_all(&destination).is_ok() {
                sync_directory(&destination_parent);
            }
        }
        return Err(error);
    }
    if let Some(backup) = replaced_directory_backup {
        let _ = fs::remove_dir_all(backup);
    }
    for (pruned_version, pruned_state) in pruned_versions {
        match pruned_state.source {
            PluginSource::Marketplace => {
                let directory = plugin_parent.join(pruned_version);
                let removable = fs::symlink_metadata(&directory).is_ok_and(|metadata| {
                    !metadata.file_type().is_symlink() && metadata.is_dir()
                });
                if removable && fs::remove_dir_all(&directory).is_ok() {
                    sync_directory(&plugin_parent);
                }
            }
            PluginSource::Development => {
                let still_referenced = state
                    .plugins
                    .get(&plugin_id)
                    .is_some_and(|plugin| {
                        plugin.versions.values().any(|installed| {
                            installed.source == PluginSource::Development
                                && installed.package_sha256 == pruned_state.package_sha256
                        })
                    });
                if !still_referenced {
                    remove_development_snapshot(&plugin_parent, &pruned_state.package_sha256);
                }
            }
        }
    }
    if let Some(content_hash) = replaced_development_hash {
        let still_referenced = state
            .plugins
            .get(&plugin_id)
            .is_some_and(|plugin| {
                plugin.versions.values().any(|installed| {
                    installed.source == PluginSource::Development
                        && installed.package_sha256 == content_hash
                })
            });
        if !still_referenced {
            remove_development_snapshot(&plugin_parent, &content_hash);
        }
    }
    installed_plugin_view(
        state
            .plugins
            .get(&plugin_id)
            .ok_or_else(|| plugin_error("Internal", "Installed plugin state disappeared"))?,
    )
}

fn verify_installed_package(
    app: &AppHandle,
    plugin_id: &str,
    requested_version: Option<&str>,
) -> PluginResult<VerifiedInstalledPackage> {
    let state = load_plugin_state(app)?;
    let plugin = state
        .plugins
        .get(plugin_id)
        .ok_or_else(|| plugin_error("NotFound", "Plugin is not installed"))?;
    let version = requested_version.unwrap_or(&plugin.active_version);
    let version_state = plugin
        .versions
        .get(version)
        .cloned()
        .ok_or_else(|| plugin_error("NotFound", "Requested plugin version is not installed"))?;
    if version_state.source == PluginSource::Development && !developer_mode_enabled(app)? {
        return Err(plugin_error(
            "DeveloperModeRequired",
            "Developer mode must remain enabled to load a development plugin",
        ));
    }
    if version_state.source == PluginSource::Marketplace {
        if let Some((index, bytes, _)) = load_cached_market(app)? {
            if let Some(high_water) = load_market_high_water(app)? {
                validate_against_market_high_water(&index, &bytes, &high_water)?;
            }
            if let Some(reason) = index.plugins.iter().find(|entry| entry.id == plugin_id)
                .and_then(|entry| entry.releases.iter().find(|release| release.version == version))
                .and_then(|release| release.revoked.as_ref()) {
                return Err(plugin_error("PermissionDenied", format!("Plugin release revoked: {reason}")));
            }
        }
    }
    let directory = installed_version_directory(app, plugin_id, version, &version_state)?;
    let content = validate_package_directory(app, &directory)?;
    if content.manifest.id != plugin_id
        || content.manifest.version != version
        || content.manifest != version_state.manifest
    {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Installed plugin manifest no longer matches the active state",
        ));
    }

    if version_state.source == PluginSource::Development
        && development_snapshot_hash(&content) != version_state.package_sha256
    {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Installed development snapshot no longer matches its content hash",
        ));
    }

    if version_state.source == PluginSource::Marketplace {
        let public_key = version_state.publisher_public_key.as_deref().ok_or_else(|| {
            plugin_error("InvalidState", "Installed publisher public key is missing")
        })?;
        verify_package_signature(&content, public_key)?;
    }

    Ok(VerifiedInstalledPackage {
        content,
        directory,
        content_hash: version_state.package_sha256,
    })
}

fn assert_expected_installed_package(
    verified: &VerifiedInstalledPackage,
    expected_version: &str,
    expected_content_hash: &str,
) -> PluginResult<()> {
    if verified.content.manifest.version != expected_version
        || verified.content_hash != expected_content_hash
    {
        return Err(plugin_error(
            "Cancelled",
            "Plugin package changed before its code or translations could be loaded",
        ));
    }
    Ok(())
}

fn plugin_host_state_revisions(
    value: &Value,
    allow_legacy_missing_revisions: bool,
) -> PluginResult<(u64, u64)> {
    let object = value.as_object().ok_or_else(|| {
        plugin_error("InvalidState", "Plugin host state must be a JSON object")
    })?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(plugin_error(
            "InvalidState",
            "Plugin host state uses an unsupported schema version",
        ));
    }
    let read_revision = |key: &str| -> PluginResult<u64> {
        match object.get(key) {
            Some(value) => value.as_u64().filter(|value| *value <= MAX_JAVASCRIPT_INTEGER)
                .ok_or_else(|| {
                    plugin_error("InvalidState", format!("Plugin host state {key} is invalid"))
                }),
            None if allow_legacy_missing_revisions => Ok(0),
            None => Err(plugin_error(
                "InvalidState",
                format!("Plugin host state {key} is missing"),
            )),
        }
    };
    Ok((read_revision("revision")?, read_revision("packageRevision")?))
}

fn file_exists_checked(path: &Path) -> PluginResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(io_error("inspect plugin persistence file")),
    }
}

fn validate_host_state_document(document: &JsonMap<String, Value>) -> PluginResult<()> {
    if document.is_empty() {
        return Ok(());
    }
    let state = document.get(PLUGIN_HOST_STATE_KEY)
        .ok_or_else(|| plugin_error("InvalidState", "Plugin host document is missing its state"))?;
    plugin_host_state_revisions(state, true)?;
    let state = state.as_object()
        .ok_or_else(|| plugin_error("InvalidState", "Plugin host state must be an object"))?;
    let valid_map = |key: &str, required: bool, predicate: fn(&Value) -> bool| {
        match state.get(key) {
            Some(Value::Object(values)) => values.values().all(predicate),
            None => !required,
            Some(_) => false,
        }
    };
    let valid_workspaces = valid_map("workspaces", true, |workspace| {
        workspace.as_object().is_some_and(|plugins| plugins.values().all(|plugin| {
            plugin.as_object().is_some_and(|plugin| {
                matches!(plugin.get("enablement").and_then(Value::as_str),
                    Some("disabled" | "workspace" | "all-workspaces"))
                    && plugin.get("enabledFingerprint").map_or(true, Value::is_string)
                    && plugin.get("permissions").is_some_and(Value::is_object)
                    && plugin.get("settings").is_some_and(Value::is_object)
            })
        }))
    });
    if !valid_map("workspaceIds", true, Value::is_string)
        || !valid_workspaces
        || !valid_map("deviceSettings", true, Value::is_object)
        || !valid_map("failures", true, Value::is_object)
        || !valid_map("developerSources", false, Value::is_string)
        || !valid_map("allWorkspacePlugins", false, Value::is_boolean)
        || !valid_map("pendingUpdates", false, |update| {
            update.as_object().is_some_and(|update| ["version", "previousVersion", "installedAt"]
                .iter().all(|key| update.get(*key).is_some_and(Value::is_string)))
        })
    {
        return Err(plugin_error("InvalidState", "Plugin host state contains invalid settings or workspace data"));
    }
    Ok(())
}

fn validate_storage_document(_document: &JsonMap<String, Value>) -> PluginResult<()> {
    // Values have already passed the strict JSON parser. Existing storage may
    // include keys from older versions; retain them during the first migration.
    Ok(())
}

fn read_plugin_document(
    path: &Path,
    max_bytes: usize,
    validate: fn(&JsonMap<String, Value>) -> PluginResult<()>,
) -> PluginResult<JsonMap<String, Value>> {
    let bytes = read_limited_file(path, max_bytes as u64, "persistent plugin data")
        .map_err(|error| plugin_error("InvalidState", error.message))?;
    let value = parse_strict_json(&bytes, "Persistent plugin data")
        .map_err(|error| plugin_error("InvalidState", error.message))?;
    let Value::Object(document) = value else {
        return Err(plugin_error("InvalidState", "Persistent plugin data must be a JSON object"));
    };
    validate(&document)?;
    Ok(document)
}

fn load_plugin_document_with_recovery(
    path: &Path,
    max_bytes: usize,
    validate: fn(&JsonMap<String, Value>) -> PluginResult<()>,
) -> PluginResult<Option<JsonMap<String, Value>>> {
    let backup = path.with_extension("json.bak");
    let primary_exists = file_exists_checked(path)?;
    let backup_exists = file_exists_checked(&backup)?;
    let primary_error = if primary_exists {
        match read_plugin_document(path, max_bytes, validate) {
            Ok(document) => return Ok(Some(document)),
            Err(error) => Some(error),
        }
    } else {
        None
    };
    if backup_exists {
        if let Ok(document) = read_plugin_document(&backup, max_bytes, validate) {
            let bytes = serde_json::to_vec(&document)
                .map_err(|_| plugin_error("InvalidState", "Unable to serialize recovered plugin data"))?;
            // Preserve the damaged file for manual recovery; never silently
            // replace unrecoverable state with an empty store.
            let quarantine = path.with_extension(format!("json.{}.corrupt", Uuid::new_v4()));
            if primary_exists {
                fs::rename(path, &quarantine)
                    .map_err(|_| io_error("preserve corrupt plugin data"))?;
            }
            if let Err(error) = atomic_write(path, &bytes) {
                if primary_exists {
                    let _ = fs::rename(&quarantine, path);
                }
                return Err(error);
            }
            return Ok(Some(document));
        }
    }
    if primary_exists || backup_exists {
        return Err(plugin_error(
            "InvalidState",
            format!(
                "Plugin data and its backup could not be recovered; original files were preserved: {}",
                primary_error.map(|error| error.message).unwrap_or_else(|| "backup is invalid".into()),
            ),
        ));
    }
    Ok(None)
}

fn save_plugin_document(
    path: &Path,
    document: &JsonMap<String, Value>,
    max_bytes: usize,
    validate: fn(&JsonMap<String, Value>) -> PluginResult<()>,
) -> PluginResult<()> {
    validate(document)?;
    let bytes = serde_json::to_vec(document)
        .map_err(|_| plugin_error("InvalidState", "Unable to serialize persistent plugin data"))?;
    if bytes.len() > max_bytes {
        return Err(plugin_error("QuotaExceeded", "Persistent plugin data exceeds its file size limit"));
    }
    let previous = load_plugin_document_with_recovery(path, max_bytes, validate)?;
    let previous_bytes = match previous {
        Some(previous) => serde_json::to_vec(&previous)
            .map_err(|_| plugin_error("InvalidState", "Unable to serialize previous plugin data"))?,
        // During first migration there is no native-owned primary yet. Seed
        // its backup with the migrated data, not an empty placeholder, so a
        // crash before primary creation cannot hide the legacy state.
        None => bytes.clone(),
    };
    let backup = path.with_extension("json.bak");
    atomic_write(&backup, &previous_bytes)?;
    atomic_write(path, &bytes)?;
    // The backup mirrors the committed state, including permission revocations
    // and deletions, before a successful result is returned to the caller.
    if let Err(error) = atomic_write(&backup, &bytes) {
        let _ = atomic_write(path, &previous_bytes);
        let _ = atomic_write(&backup, &previous_bytes);
        return Err(error);
    }
    Ok(())
}

fn load_owned_plugin_document(
    app: &AppHandle,
    file_name: &str,
    legacy_file_name: &str,
    max_bytes: usize,
    validate: fn(&JsonMap<String, Value>) -> PluginResult<()>,
) -> PluginResult<(PathBuf, JsonMap<String, Value>)> {
    let path = plugin_data_root(app)?.join(file_name);
    if let Some(document) = load_plugin_document_with_recovery(&path, max_bytes, validate)? {
        return Ok((path, document));
    }
    let legacy = app.path().app_data_dir()
        .map_err(|_| io_error("resolve legacy plugin data directory"))?
        .join(legacy_file_name);
    let document = load_plugin_document_with_recovery(&legacy, max_bytes, validate)?
        .unwrap_or_default();
    // A separate native-owned file prevents a previously cached Tauri Store
    // instance from overwriting committed data during shutdown or uninstall.
    // Keep the original legacy file intact as an additional recovery copy.
    save_plugin_document(&path, &document, max_bytes, validate)?;
    Ok((path, document))
}

#[tauri::command]
pub async fn plugin_read_host_state(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
) -> PluginResult<Option<Value>> {
    let _guard = manager.host_state_lock.lock().await;
    let (_, document) = load_owned_plugin_document(
        &app, PLUGIN_HOST_STATE_FILE, PLUGIN_HOST_STATE_STORE_PATH,
        MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document,
    )?;
    Ok(document.get(PLUGIN_HOST_STATE_KEY).cloned())
}

#[tauri::command]
pub async fn plugin_commit_host_state(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    expected_revision: u64,
    next_state: Value,
) -> PluginResult<()> {
    if expected_revision > MAX_JAVASCRIPT_INTEGER {
        return Err(plugin_error(
            "InvalidState",
            "Expected plugin host state revision is invalid",
        ));
    }
    let serialized = serde_json::to_vec(&next_state)
        .map_err(|_| plugin_error("InvalidState", "Unable to serialize plugin host state"))?;
    if serialized.len() > MAX_PLUGIN_HOST_STATE_BYTES {
        return Err(plugin_error(
            "PackageTooLarge",
            "Plugin host state exceeds its size limit",
        ));
    }
    let (next_revision, next_package_revision) =
        plugin_host_state_revisions(&next_state, false)?;
    if next_revision != expected_revision.saturating_add(1) {
        return Err(plugin_error(
            "InvalidState",
            "Plugin host state revision must advance by exactly one",
        ));
    }

    let _guard = manager.host_state_lock.lock().await;
    let (path, mut document) = load_owned_plugin_document(
        &app, PLUGIN_HOST_STATE_FILE, PLUGIN_HOST_STATE_STORE_PATH,
        MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document,
    )?;
    let previous = document.get(PLUGIN_HOST_STATE_KEY);
    let (current_revision, current_package_revision) = match previous {
        Some(value) => plugin_host_state_revisions(value, true)?,
        None => (0, 0),
    };
    if current_revision != expected_revision {
        return Err(plugin_error(
            "Conflict",
            "Plugin host state changed in another window",
        ));
    }
    if next_package_revision < current_package_revision
        || next_package_revision > current_package_revision.saturating_add(1)
    {
        return Err(plugin_error(
            "InvalidState",
            "Plugin package revision must stay unchanged or advance by one",
        ));
    }

    document.insert(PLUGIN_HOST_STATE_KEY.into(), next_state);
    save_plugin_document(&path, &document, MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document)
}

#[derive(Serialize)]
pub struct PluginStorageValue {
    found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
}

fn validate_plugin_storage_key(plugin_id: &str, key: &str) -> PluginResult<()> {
    let entry_key = key.rsplit(':').next().unwrap_or_default();
    if !is_valid_plugin_id(plugin_id)
        || is_reserved_host_plugin_id(plugin_id)
        || key.starts_with("version:") || key.starts_with("head:")
        || !plugin_storage_key_belongs_to(key, plugin_id)
        || key.len() > 4_096
        || key.chars().any(char::is_control)
        || entry_key.is_empty()
        || entry_key.len() > 128
        || !entry_key.as_bytes()[0].is_ascii_alphanumeric()
        || !entry_key.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(plugin_error("InvalidManifest", "Plugin storage key is invalid or outside its namespace"));
    }
    Ok(())
}

// Data follows the package fingerprint. Switching the package pointer on rollback
// switches its data atomically too; a failed activation cannot migrate old data.
fn storage_version_prefix(plugin_id: &str, hash: &str) -> String {
    format!("version:{plugin_id}:{hash}:")
}

fn prepare_storage_version(
    app: &AppHandle,
    plugin_id: &str,
    hash: &str,
    previous_hash: Option<&str>,
) -> PluginResult<(PathBuf, JsonMap<String, Value>, String)> {
    let (path, mut document) = load_owned_plugin_document(
        app, PLUGIN_STORAGE_FILE, PLUGIN_DATA_STORE_PATH,
        MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document,
    )?;
    let prefix = storage_version_prefix(plugin_id, hash);
    let installed = load_plugin_state(app)?;
    let mut retained = installed.plugins.get(plugin_id).map(|plugin| plugin.versions.values()
        .map(|version| version.package_sha256.clone()).collect::<BTreeSet<_>>()).unwrap_or_default();
    retained.insert(hash.to_string());
    if let Some(previous) = previous_hash { retained.insert(previous.to_string()); }
    // Preserve retained uninstall data until it has been copied into a fresh installation.
    let previous_head = document.get(&format!("head:{plugin_id}")).and_then(Value::as_str).map(str::to_string);
    let before_prune = document.len();
    let namespace = format!("version:{plugin_id}:");
    document.retain(|key, _| {
        let Some(rest) = key.strip_prefix(&namespace) else { return true; };
        rest.split_once(':').is_some_and(|(hash, _)| retained.contains(hash))
            || previous_head.as_ref().is_some_and(|head| key.starts_with(head))
    });
    let pruned = document.len() != before_prune;
    let marker = format!("{prefix}$initialized");
    if !document.contains_key(&marker) {
        let previous_prefix = previous_hash.map(|hash| storage_version_prefix(plugin_id, hash))
            .or_else(|| document.get(&format!("head:{plugin_id}"))
                .and_then(Value::as_str).map(str::to_string));
        let entries = document.iter().filter_map(|(key, value)| {
            let logical_key = match previous_prefix.as_deref() {
                Some(previous) if document.contains_key(&format!("{previous}$initialized")) => key.strip_prefix(previous),
                _ => Some(key.as_str()),
            }?;
            if logical_key.starts_with("version:") || logical_key.starts_with("head:")
                || !plugin_storage_key_belongs_to(logical_key, plugin_id) { return None; }
            Some((format!("{prefix}{logical_key}"), value.clone()))
        }).collect::<Vec<_>>();
        document.extend(entries);
        document.insert(marker, Value::Bool(true));
        save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)?;
    }
    if pruned {
        save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)?;
    }
    Ok((path, document, prefix))
}

fn active_storage_version(app: &AppHandle, plugin_id: &str)
    -> PluginResult<(PathBuf, JsonMap<String, Value>, String)>
{
    let state = load_plugin_state(app)?;
    let plugin = state.plugins.get(plugin_id)
        .ok_or_else(|| plugin_error("NotFound", "Plugin was uninstalled before its storage operation"))?;
    let active = plugin.versions.get(&plugin.active_version)
        .ok_or_else(|| plugin_error("InvalidState", "Active plugin version is missing"))?;
    let (path, mut document, prefix) = prepare_storage_version(app, plugin_id, &active.package_sha256, None)?;
    let head = format!("head:{plugin_id}");
    if document.get(&head).and_then(Value::as_str) != Some(prefix.as_str()) {
        document.insert(head, Value::String(prefix.clone()));
        save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)?;
    }
    Ok((path, document, prefix))
}

fn plugin_workspace_key(path: Option<&str>) -> String {
    let Some(path) = path.filter(|path| !path.trim().is_empty()) else { return "@notegen-default-workspace".into(); };
    let normalized = path.trim().replace('\\', "/");
    let drive = normalized.as_bytes().get(1) == Some(&b':');
    let normalized = if normalized == "/" || (drive && normalized.len() == 3) { normalized }
        else { normalized.trim_end_matches('/').to_string() };
    if drive { normalized.to_lowercase() } else { normalized }
}

pub async fn snapshot_plugin_user_data(app: &AppHandle, workspace_path: Option<&str>) -> Result<Vec<u8>, String> {
    let manager = app.state::<PluginManager>();
    let _guard = manager.storage_lock.lock().await;
    let (_, document) = load_owned_plugin_document(
        app, PLUGIN_STORAGE_FILE, PLUGIN_DATA_STORE_PATH,
        MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document,
    ).map_err(|error| error.message)?;
    let _host_guard = manager.host_state_lock.lock().await;
    let (_, host) = load_owned_plugin_document(app, PLUGIN_HOST_STATE_FILE, PLUGIN_HOST_STATE_STORE_PATH,
        MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document).map_err(|error| error.message)?;
    let workspace_id = host.get("state").and_then(|state| state.get("workspaceIds"))
        .and_then(|ids| ids.get(plugin_workspace_key(workspace_path))).and_then(Value::as_str);
    serde_json::to_vec(&serde_json::json!({ "format": "notegen-plugin-user-data", "version": 1,
        "workspaceId": workspace_id, "data": document })).map_err(|error| error.to_string())
}

pub fn restore_plugin_user_data(app: &AppHandle, source: &Path, recovered_workspace: Option<&str>) -> Result<(), String> {
    if !source.exists() { return Ok(()); } // Older backups have no plugin data.
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file()
        || metadata.len() > MAX_PLUGIN_STORAGE_FILE_BYTES as u64 + 1024 * 1024 {
        return Err("Invalid plugin user-data backup".into());
    }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    let (envelope, _) = parse_strict_type::<JsonMap<String, Value>>(&bytes, "Plugin user-data backup")
        .map_err(|error| error.message)?;
    if envelope.get("format").and_then(Value::as_str) != Some("notegen-plugin-user-data")
        || envelope.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported plugin user-data backup".into());
    }
    let mut document = envelope.get("data").and_then(Value::as_object).cloned()
        .ok_or_else(|| "Missing plugin backup data".to_string())?;
    let manager = app.state::<PluginManager>();
    let _guard = manager.storage_lock.try_lock()
        .map_err(|_| "Plugin data is busy; retry the restore".to_string())?;
    let _host_guard = manager.host_state_lock.try_lock()
        .map_err(|_| "Plugin settings are busy; retry the restore".to_string())?;
    if let (Some(old_id), Some(recovered)) = (envelope.get("workspaceId").and_then(Value::as_str), recovered_workspace) {
        let (host_path, mut host) = load_owned_plugin_document(app, PLUGIN_HOST_STATE_FILE, PLUGIN_HOST_STATE_STORE_PATH,
            MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document).map_err(|error| error.message)?;
        let state = host.entry("state").or_insert_with(|| serde_json::json!({
            "schemaVersion": 1, "revision": 0, "packageRevision": 0, "workspaceIds": {}, "workspaces": {},
            "deviceSettings": {}, "failures": {}, "developerSources": {}, "pendingUpdates": {}, "allWorkspacePlugins": {}
        }));
        let new_id = Uuid::new_v4().to_string();
        let old_prefix = format!("workspace:{old_id}:");
        let new_prefix = format!("workspace:{new_id}:");
        document = document.into_iter().map(|(key, value)| {
            let key = if let Some(suffix) = key.strip_prefix(&old_prefix) { format!("{new_prefix}{suffix}") }
                else if key.starts_with("version:") { key.replacen(&format!(":{old_prefix}"), &format!(":{new_prefix}"), 1) }
                else { key };
            (key, value)
        }).collect();
        state["workspaceIds"][plugin_workspace_key(Some(recovered))] = Value::String(new_id.clone());
        // A new workspace identity deliberately receives no old permission grants.
        state["workspaces"][&new_id] = serde_json::json!({});
        let revision = state.get("revision").and_then(Value::as_u64).unwrap_or(0);
        state["revision"] = Value::from(revision.saturating_add(1));
        save_plugin_document(&host_path, &host, MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document)
            .map_err(|error| error.message)?;
    }
    let path = plugin_data_root(app).map_err(|error| error.message)?.join(PLUGIN_STORAGE_FILE);
    save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)
        .map_err(|error| error.message)
}

#[tauri::command]
pub async fn plugin_storage_get(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> PluginResult<PluginStorageValue> {
    validate_plugin_storage_key(&plugin_id, &key)?;
    let _guard = manager.storage_lock.lock().await;
    let (_, document, prefix) = active_storage_version(&app, &plugin_id)?;
    let value = document.get(&format!("{prefix}{key}")).cloned();
    Ok(PluginStorageValue { found: value.is_some(), value })
}

#[tauri::command]
pub async fn plugin_storage_set(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    key: String,
    value: Value,
) -> PluginResult<()> {
    validate_plugin_storage_key(&plugin_id, &key)?;
    // Uninstall removes the installed-state entry before taking this lock for
    // data cleanup. An earlier writer completes before cleanup; a later writer
    // sees the missing installation and cannot resurrect the removed data.
    let _storage_guard = manager.storage_lock.lock().await;
    let (path, mut document, prefix) = active_storage_version(&app, &plugin_id)?;
    document.insert(format!("head:{plugin_id}"), Value::String(prefix.clone()));
    document.insert(format!("{prefix}{key}"), value);
    let plugin_entries = document.iter()
        .filter_map(|(key, value)| key.strip_prefix(&prefix)
            .filter(|key| *key != "$initialized")
            .map(|key| (key.to_string(), value.clone())))
        .collect::<JsonMap<String, Value>>();
    if plugin_entries.len() > MAX_PLUGIN_STORAGE_KEYS {
        return Err(plugin_error("QuotaExceeded", "Plugin storage key quota exceeded"));
    }
    let total_bytes = serde_json::to_vec(&plugin_entries)
        .map_err(|_| plugin_error("InvalidState", "Unable to serialize plugin storage"))?.len();
    if total_bytes > MAX_PLUGIN_STORAGE_BYTES {
        return Err(plugin_error("QuotaExceeded", "Plugin storage quota exceeded"));
    }
    save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)
}

#[tauri::command]
pub async fn plugin_storage_remove(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    key: String,
) -> PluginResult<()> {
    validate_plugin_storage_key(&plugin_id, &key)?;
    let _storage_guard = manager.storage_lock.lock().await;
    let (path, mut document, prefix) = active_storage_version(&app, &plugin_id)?;
    document.insert(format!("head:{plugin_id}"), Value::String(prefix.clone()));
    if document.remove(&format!("{prefix}{key}")).is_some() {
        save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_list_installed(app: AppHandle) -> PluginResult<Vec<InstalledPlugin>> {
    let state = load_plugin_state(&app)?;
    state
        .plugins
        .values()
        .map(installed_plugin_view)
        .collect()
}

#[tauri::command]
pub async fn plugin_fetch_market(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    force: Option<bool>,
) -> PluginResult<PluginMarketCatalog> {
    let _guard = manager.mutation_lock.lock().await;
    fetch_market_catalog(&app, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn plugin_install_market(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    version: Option<String>,
) -> PluginResult<PluginInstallResult> {
    let _guard = manager.mutation_lock.lock().await;
    let catalog = fetch_market_catalog(&app, true).await?;
    if catalog.stale {
        return Err(plugin_error(
            "MarketUnavailable",
            "A fresh signed marketplace catalog is required to install or update plugins",
        ));
    }
    let index = catalog_to_index(&catalog);
    let resolved = resolve_market_release(&app, &index, &plugin_id, version.as_deref())?;
    // All installation mutations share this guard. Read the authoritative state
    // before creating temporary package files so a corrupt state cannot leave
    // an otherwise valid staging directory behind on every retry.
    let state = load_plugin_state(&app)?;
    let downloaded = download_market_package(&app, &resolved.release).await?;
    let prepared_result = prepare_package(
        &app,
        &downloaded,
        Some(&resolved.release.package_sha256),
    );
    let _ = fs::remove_file(&downloaded);
    let prepared = prepared_result?;
    if index.expires_at <= now_ms() {
        let _ = fs::remove_dir_all(&prepared.staging_dir);
        return Err(plugin_error(
            "MarketUnavailable",
            "The signed marketplace catalog expired while the plugin was being downloaded",
        ));
    }
    if let Err(error) = validate_package_against_release(&prepared, &resolved) {
        let _ = fs::remove_dir_all(&prepared.staging_dir);
        return Err(error);
    }
    let staging_dir = prepared.staging_dir.clone();
    let (replaced_version, permissions_changed) =
        installation_changes(&state, &prepared.content.manifest);
    let _storage_guard = manager.storage_lock.lock().await;
    let result = activate_prepared_package(
        &app,
        state,
        prepared,
        PluginSource::Marketplace,
        Some(&resolved.publisher),
        None,
    );
    if result.is_err() && staging_dir.exists() {
        let _ = fs::remove_dir_all(staging_dir);
    }
    result.map(|plugin| PluginInstallResult {
        plugin,
        replaced_version,
        permissions_changed,
    })
}

#[tauri::command]
pub fn plugin_development_revision(app: AppHandle, plugin_id: String) -> PluginResult<Value> {
    if !developer_mode_enabled(&app)? { return Err(plugin_error("DeveloperModeRequired", "Developer mode is required")); }
    let state = load_plugin_state(&app)?;
    let plugin = state.plugins.get(&plugin_id).ok_or_else(|| plugin_error("NotFound", "Development plugin is not installed"))?;
    let version = plugin.versions.get(&plugin.active_version).ok_or_else(|| plugin_error("NotFound", "Active plugin version is missing"))?;
    if version.source != PluginSource::Development { return Err(plugin_error("PermissionDenied", "Only development plugins can be watched")); }
    let path = version.development_path.as_ref().ok_or_else(|| plugin_error("NotFound", "Development source path is missing"))?;
    let root = canonical_development_root(Path::new(path))?;
    let integrity = ensure_development_source_file(&root, "integrity.json")?;
    let bytes = read_limited_file(&integrity, 1_048_576, "development integrity manifest")?;
    let installed_root = installed_version_directory(&app, &plugin_id, &plugin.active_version, version)?;
    let installed_integrity = ensure_development_source_file(&installed_root, "integrity.json")?;
    let installed_bytes = read_limited_file(&installed_integrity, 1_048_576, "installed integrity manifest")?;
    Ok(serde_json::json!({
        "source": format!("{:x}", Sha256::digest(&bytes)),
        "installed": format!("{:x}", Sha256::digest(&installed_bytes)),
    }))
}

#[tauri::command]
pub async fn plugin_import_local(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    path: String,
    developer_mode: bool,
    expected_plugin_id: Option<String>,
) -> PluginResult<PluginInstallResult> {
    let _guard = manager.mutation_lock.lock().await;
    if !developer_mode || !developer_mode_enabled(&app)? {
        return Err(plugin_error(
            "DeveloperModeRequired",
            "Enable developer mode before importing an unsigned development plugin",
        ));
    }
    if path.is_empty()
        || path.len() > 4_096
        || path.chars().any(char::is_control)
    {
        return Err(plugin_error(
            "InvalidPath",
            "Development plugin directory path is invalid",
        ));
    }
    let package_path = PathBuf::from(path);
    if !package_path.is_absolute() {
        return Err(plugin_error(
            "InvalidPath",
            "Development plugin directory path must be absolute",
        ));
    }
    let source_directory = canonical_development_root(&package_path)?;
    let built_package = source_directory.join(".notegen").join("package");
    let development_directory = if built_package.exists() {
        // Accept a plugin project, but never follow a redirected build directory.
        canonical_development_root(&source_directory.join(".notegen"))?;
        let built_directory = canonical_development_root(&built_package)?;
        if !built_directory.starts_with(&source_directory) {
            return Err(plugin_error("InvalidPackage", "Built plugin must remain inside its source directory"));
        }
        built_directory
    } else {
        source_directory
    };
    let development_path = development_directory
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| {
            plugin_error(
                "InvalidPath",
                "Development plugin directory path must be valid UTF-8",
            )
        })?;
    if development_path.len() > 4_096 || development_path.chars().any(char::is_control) {
        return Err(plugin_error(
            "InvalidPath",
            "Development plugin directory path is too long",
        ));
    }
    let state = load_plugin_state(&app)?;
    let prepared = prepare_development_directory(&app, &development_directory)?;
    let staging_dir = prepared.staging_dir.clone();
    if expected_plugin_id.as_ref().is_some_and(|id| id != &prepared.content.manifest.id) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(plugin_error("InvalidManifest", "Auto-reload cannot change the plugin identity"));
    }
    let (replaced_version, permissions_changed) =
        installation_changes(&state, &prepared.content.manifest);
    let _storage_guard = manager.storage_lock.lock().await;
    let result = activate_prepared_package(
        &app,
        state,
        prepared,
        PluginSource::Development,
        None,
        Some(development_path),
    );
    if result.is_err() && staging_dir.exists() {
        let _ = fs::remove_dir_all(staging_dir);
    }
    result.map(|plugin| PluginInstallResult {
        plugin,
        replaced_version,
        permissions_changed,
    })
}

#[tauri::command]
pub async fn plugin_rollback(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    version: Option<String>,
) -> PluginResult<InstalledPlugin> {
    let _guard = manager.mutation_lock.lock().await;
    let _storage_guard = manager.storage_lock.lock().await;
    let mut state = load_plugin_state(&app)?;
    let plugin = state
        .plugins
        .get(&plugin_id)
        .ok_or_else(|| plugin_error("NotFound", "Plugin is not installed"))?;
    let target = version
        .or_else(|| plugin.previous_version.clone())
        .ok_or_else(|| plugin_error("NotFound", "Plugin has no previous version to roll back to"))?;
    if !plugin.versions.contains_key(&target) {
        return Err(plugin_error(
            "NotFound",
            "Requested rollback version is not installed",
        ));
    }
    verify_installed_package(&app, &plugin_id, Some(&target))?;
    let plugin = state
        .plugins
        .get_mut(&plugin_id)
        .ok_or_else(|| plugin_error("Internal", "Plugin state disappeared during rollback"))?;
    if plugin.active_version != target {
        let previous = std::mem::replace(&mut plugin.active_version, target);
        plugin.previous_version = Some(previous);
    }
    plugin.pending_activation_version = None;
    save_plugin_state(&app, &state)?;
    installed_plugin_view(
        state
            .plugins
            .get(&plugin_id)
            .ok_or_else(|| plugin_error("Internal", "Plugin state disappeared after rollback"))?,
    )
}

#[tauri::command]
pub async fn plugin_confirm_activation(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    version: String,
    expected_content_hash: String,
) -> PluginResult<InstalledPlugin> {
    let _guard = manager.mutation_lock.lock().await;
    let mut state = load_plugin_state(&app)?;
    let plugin = state
        .plugins
        .get_mut(&plugin_id)
        .ok_or_else(|| plugin_error("NotFound", "Plugin is not installed"))?;
    if plugin.active_version != version
        || !plugin.versions.get(&plugin.active_version).is_some_and(|active| {
            active.package_sha256 == expected_content_hash
        })
    {
        return Err(plugin_error(
            "Conflict",
            "The active plugin package changed before activation was confirmed",
        ));
    }
    if plugin.pending_activation_version.as_deref() == Some(version.as_str()) {
        plugin.pending_activation_version = None;
        save_plugin_state(&app, &state)?;
    }
    installed_plugin_view(
        state
            .plugins
            .get(&plugin_id)
            .ok_or_else(|| plugin_error("Internal", "Plugin state disappeared after confirmation"))?,
    )
}

#[tauri::command]
pub async fn plugin_uninstall(
    app: AppHandle,
    manager: TauriState<'_, PluginManager>,
    plugin_id: String,
    remove_data: Option<bool>,
) -> PluginResult<PluginUninstallResult> {
    let _guard = manager.mutation_lock.lock().await;
    if !is_valid_plugin_id(&plugin_id) || is_reserved_host_plugin_id(&plugin_id) {
        return Err(plugin_error(
            "InvalidManifest",
            "Plugin id is invalid or belongs to the reserved NoteGen host namespace",
        ));
    }
    let mut state = load_plugin_state(&app)?;
    if !state.plugins.contains_key(&plugin_id) {
        let cleanup_warning = if remove_data.unwrap_or(false) {
            remove_plugin_data(&app, &manager, &plugin_id).await.err()
        } else { None };
        return Ok(PluginUninstallResult {
            plugin_id,
            removed_versions: Vec::new(),
            cleanup_warning,
        });
    }

    let removed_versions = state
        .plugins
        .get(&plugin_id)
        .map(|plugin| plugin.versions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    state.plugins.remove(&plugin_id);
    save_plugin_state(&app, &state)?;

    // The state file is the installation authority. Program files are cleaned
    // only after the atomic state commit, so a crash can leave an orphan but
    // can never leave state pointing at a directory that was already removed.
    if let Ok(root) = packages_root(&app) {
        let package_directory = root.join(&plugin_id);
        let removable = fs::symlink_metadata(&package_directory).is_ok_and(|metadata| {
            !metadata.file_type().is_symlink() && metadata.is_dir()
        });
        if removable && fs::remove_dir_all(&package_directory).is_ok() {
            sync_directory(&root);
        }
    }
    // A data-cleanup failure must not turn a completed uninstall into an
    // ambiguous command error. Return it as a warning so every window can
    // revoke the removed package immediately while still informing the user.
    let cleanup_warning = if remove_data.unwrap_or(false) {
        remove_plugin_data(&app, &manager, &plugin_id).await.err()
    } else { None };
    Ok(PluginUninstallResult {
        plugin_id,
        removed_versions,
        cleanup_warning,
    })
}

#[tauri::command]
pub fn plugin_read_entry(
    app: AppHandle,
    plugin_id: String,
    expected_version: String,
    expected_content_hash: String,
) -> PluginResult<String> {
    let verified = verify_installed_package(&app, &plugin_id, None)?;
    assert_expected_installed_package(&verified, &expected_version, &expected_content_hash)?;
    let entry = verified.content.manifest.entry.clone();
    let actual = verified.content.files.get(&entry).ok_or_else(|| {
        plugin_error("IntegrityMismatch", "Verified plugin entry is missing")
    })?;
    let bytes = read_limited_file(
        &verified.directory.join(&entry),
        MAX_ENTRY_SOURCE_BYTES,
        "plugin entry",
    )?;
    let code = String::from_utf8(bytes).map_err(|_| {
        plugin_error("InvalidManifest", "Plugin entry is not valid UTF-8 JavaScript")
    })?;
    if sha256_hex(code.as_bytes()) != actual.sha256 {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin entry changed while it was being read",
        ));
    }
    Ok(code)
}

#[tauri::command]
pub fn plugin_read_locale(
    app: AppHandle,
    plugin_id: String,
    locale: String,
    expected_version: String,
    expected_content_hash: String,
) -> PluginResult<Option<BTreeMap<String, String>>> {
    let verified = verify_installed_package(&app, &plugin_id, None)?;
    assert_expected_installed_package(&verified, &expected_version, &expected_content_hash)?;
    let manifest = &verified.content.manifest;
    if manifest.locales.is_empty() {
        return Ok(None);
    }
    let exact = manifest
        .locales
        .keys()
        .find(|candidate| candidate.eq_ignore_ascii_case(&locale))
        .cloned();
    let language = locale.split('-').next().unwrap_or(&locale);
    let base = manifest
        .locales
        .keys()
        .find(|candidate| candidate.eq_ignore_ascii_case(language))
        .cloned();
    let resolved_locale = exact
        .or(base)
        .or_else(|| manifest.default_locale.clone())
        .ok_or_else(|| plugin_error("NotFound", "Plugin default locale is unavailable"))?;
    let path = manifest.locales.get(&resolved_locale).ok_or_else(|| {
        plugin_error("IntegrityMismatch", "Plugin locale mapping is invalid")
    })?;
    let expected = verified.content.files.get(path).ok_or_else(|| {
        plugin_error("IntegrityMismatch", "Verified plugin locale is missing")
    })?;
    let bytes = read_limited_file(
        &verified.directory.join(path.split('/').collect::<PathBuf>()),
        MAX_ENTRY_BYTES,
        "plugin locale",
    )?;
    if bytes.len() as u64 != expected.size || sha256_hex(&bytes) != expected.sha256 {
        return Err(plugin_error(
            "IntegrityMismatch",
            "Plugin locale changed while it was being read",
        ));
    }
    let messages = parse_locale_messages(&bytes)?;
    Ok(Some(messages))
}

#[tauri::command]
pub fn plugin_read_usage(
    app: AppHandle,
    plugin_id: String,
    locale: String,
    expected_version: String,
    expected_content_hash: String,
) -> PluginResult<Option<String>> {
    let verified = verify_installed_package(&app, &plugin_id, None)?;
    assert_expected_installed_package(&verified, &expected_version, &expected_content_hash)?;
    if locale.len() > 64 || !locale.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(plugin_error("InvalidArgument", "Invalid guide locale"));
    }
    let locale = if locale == "zh" { "zh-CN" } else { &locale };
    let language = locale.split('-').next().unwrap_or(locale);
    let candidates = [format!("USAGE.{locale}.md"), format!("USAGE.{language}.md"), "USAGE.md".to_string()];
    for candidate in candidates {
        let Some((path, expected)) = verified.content.files.iter().find(|(path, _)| path.eq_ignore_ascii_case(&candidate)) else { continue };
        let bytes = read_limited_file(&verified.directory.join(path), 131_072, "plugin usage guide")?;
        if bytes.len() as u64 != expected.size || sha256_hex(&bytes) != expected.sha256 {
            return Err(plugin_error("IntegrityMismatch", "Plugin usage guide changed while being read"));
        }
        return String::from_utf8(bytes).map(Some).map_err(|_| plugin_error("InvalidPackage", "Usage guide must be UTF-8"));
    }
    Ok(None)
}

async fn remove_plugin_data(app: &AppHandle, manager: &PluginManager, plugin_id: &str) -> PluginResult<()> {
    let _guard = manager.storage_lock.lock().await;
    let (path, mut document) = load_owned_plugin_document(
        app, PLUGIN_STORAGE_FILE, PLUGIN_DATA_STORE_PATH,
        MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document,
    )?;
    document.retain(|key, _| !plugin_storage_key_belongs_to(key, plugin_id));
    // Commit even when the primary already lacks these keys: an interrupted
    // earlier cleanup may still have left them in the recovery snapshot.
    save_plugin_document(&path, &document, MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document)?;
    let mut retained_copy_warning = remove_plugin_recovery_copies(
        app, plugin_id, PLUGIN_DATA_STORE_PATH, PLUGIN_STORAGE_FILE,
        MAX_PLUGIN_STORAGE_FILE_BYTES, validate_storage_document, remove_storage_namespace,
    ).err();
    {
        // The host-state paths are separate from KV storage. Only legacy and
        // diagnostic copies are scrubbed here; the active document is changed
        // through the frontend's revision-checked host-state transaction.
        let _host_guard = manager.host_state_lock.lock().await;
        if let Err(error) = remove_plugin_recovery_copies(
            app, plugin_id, PLUGIN_HOST_STATE_STORE_PATH, PLUGIN_HOST_STATE_FILE,
            MAX_PLUGIN_HOST_STATE_BYTES, validate_host_state_document, remove_host_state_namespace,
        ) {
            retained_copy_warning.get_or_insert(error);
        }
    }

    // Remove legacy filesystem-backed plugin storage as well, if present.
    let data_root = plugin_data_root(app)?.join("data");
    match fs::symlink_metadata(&data_root) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {}
        Ok(_) => {
            return Err(plugin_error(
                "UnsafePath",
                "Legacy plugin data root is not a real directory",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return retained_copy_warning.map_or(Ok(()), Err);
        }
        Err(_) => return Err(io_error("inspect legacy plugin data root")),
    }
    let device_root = data_root.join("device");
    match fs::symlink_metadata(&device_root) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {
            remove_owned_path_if_exists(&device_root.join(plugin_id))?;
            remove_owned_path_if_exists(&device_root.join(format!("{plugin_id}.json")))?;
        }
        Ok(_) => {
            return Err(plugin_error(
                "UnsafePath",
                "Legacy plugin device data root is not a real directory",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(io_error("inspect legacy plugin device data root")),
    }

    let workspace_root = data_root.join("workspaces");
    match fs::symlink_metadata(&workspace_root) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {
            for entry in fs::read_dir(&workspace_root)
                .map_err(|_| io_error("read plugin workspace data directory"))?
            {
                let entry = entry.map_err(|_| io_error("read plugin workspace data entry"))?;
                let metadata = fs::symlink_metadata(entry.path())
                    .map_err(|_| io_error("inspect plugin workspace data entry"))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    continue;
                }
                remove_owned_path_if_exists(&entry.path().join(plugin_id))?;
                remove_owned_path_if_exists(&entry.path().join(format!("{plugin_id}.json")))?;
            }
        }
        Ok(_) => {
            return Err(plugin_error(
                "UnsafePath",
                "Legacy plugin workspace data root is not a real directory",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(io_error("inspect legacy plugin workspace data root")),
    }
    retained_copy_warning.map_or(Ok(()), Err)
}

fn remove_storage_namespace(document: &mut JsonMap<String, Value>, plugin_id: &str) -> bool {
    let previous_length = document.len();
    document.retain(|key, _| !plugin_storage_key_belongs_to(key, plugin_id));
    document.len() != previous_length
}

fn remove_host_state_namespace(document: &mut JsonMap<String, Value>, plugin_id: &str) -> bool {
    let Some(state) = document.get_mut(PLUGIN_HOST_STATE_KEY).and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    if let Some(workspaces) = state.get_mut("workspaces").and_then(Value::as_object_mut) {
        for workspace in workspaces.values_mut() {
            if let Some(plugins) = workspace.as_object_mut() {
                changed |= plugins.remove(plugin_id).is_some();
            }
        }
    }
    for key in ["deviceSettings", "failures", "developerSources", "pendingUpdates", "allWorkspacePlugins"] {
        if let Some(plugins) = state.get_mut(key).and_then(Value::as_object_mut) {
            changed |= plugins.remove(plugin_id).is_some();
        }
    }
    // Global workspace IDs, revisions, and every other plugin's grants remain
    // untouched. These are retired migration sources, not active CAS state.
    changed
}

fn remove_plugin_recovery_copies(
    app: &AppHandle,
    plugin_id: &str,
    legacy_file_name: &str,
    owned_file_name: &str,
    max_bytes: usize,
    validate: fn(&JsonMap<String, Value>) -> PluginResult<()>,
    remove_namespace: fn(&mut JsonMap<String, Value>, &str) -> bool,
) -> PluginResult<()> {
    let legacy = app.path().app_data_dir()
        .map_err(|_| io_error("resolve legacy plugin data directory"))?
        .join(legacy_file_name);
    let owned = plugin_data_root(app)?.join(owned_file_name);
    let mut retained_copy_warning = None;

    // A legacy Store's reload() merges keys instead of replacing its cache.
    // Retire the old resource and finish its pending autosave before scrubbing
    // disk, otherwise shutdown could write the removed namespace back later.
    if let Some(store) = app.get_store(legacy_file_name) {
        let cached_document = store.entries().into_iter().collect::<JsonMap<String, Value>>();
        let cached_bytes = serde_json::to_vec(&cached_document)
            .map_err(|_| plugin_error("InvalidState", "Unable to preserve cached legacy plugin data"))?;
        if cached_bytes.len() > max_bytes {
            return Err(plugin_error("QuotaExceeded", "Cached legacy plugin data exceeds its recovery limit"));
        }
        let cached_copy = legacy.with_extension(format!("json.{}.corrupt", Uuid::new_v4()));
        atomic_write(&cached_copy, &cached_bytes)?;
        if file_exists_checked(&legacy)? {
            let original = read_limited_file(
                &legacy, max_bytes as u64, "legacy plugin data",
            )?;
            let preserved = legacy.with_extension(format!("json.{}.corrupt", Uuid::new_v4()));
            // Preserve the pre-cache file too: it may contain recovery data or
            // unrelated entries that were never loaded into that old cache.
            atomic_write(&preserved, &original)?;
        }
        store.close_resource();
        if Arc::strong_count(&store) > 1 {
            // An in-flight old operation can still own the resource. Keep its
            // files rather than race it; a retry after restart can finish.
            return Err(plugin_error(
                "Io",
                "Legacy plugin data is still in use; restart NoteGen and retry data cleanup",
            ));
        }
        // Explicit save cancels the pending timer before dropping the resource.
        // Both the on-disk and cache snapshots above remain recoverable if this
        // final legacy flush fails; later cleanup never edits unrelated keys.
        store.save().map_err(|_| io_error("finish pending legacy plugin data save"))?;
        drop(store);
    }

    let mut copies = vec![legacy.clone(), legacy.with_extension("json.bak")];
    // Quarantined documents can contain several plugins. Clean only parseable
    // copies of these exact owned filenames; never delete a damaged document
    // just to erase one plugin's data.
    for original in [&legacy, &owned] {
        let parent = original.parent()
            .ok_or_else(|| plugin_error("UnsafePath", "Plugin data has no parent directory"))?;
        let name = original.file_name().and_then(|name| name.to_str())
            .ok_or_else(|| plugin_error("UnsafePath", "Plugin data filename is invalid"))?;
        let prefix = format!("{name}.");
        for entry in fs::read_dir(parent).map_err(|_| io_error("inspect plugin data recovery copies"))? {
            let entry = entry.map_err(|_| io_error("inspect plugin data recovery copy"))?;
            let file_name = entry.file_name();
            let matches_owned_copy = file_name.to_str()
                .and_then(|name| name.strip_prefix(prefix.as_str()))
                .and_then(|suffix| suffix.strip_suffix(".corrupt"))
                .is_some_and(|id| Uuid::parse_str(id).is_ok());
            if matches_owned_copy {
                copies.push(entry.path());
            }
        }
    }

    for copy in copies {
        let cleaned = (|| -> PluginResult<()> {
            if !file_exists_checked(&copy)? {
                return Ok(());
            }
            let mut document = read_plugin_document(&copy, max_bytes, validate)?;
            if remove_namespace(&mut document, plugin_id) {
                let bytes = serde_json::to_vec(&document)
                    .map_err(|_| plugin_error("InvalidState", "Unable to serialize cleaned legacy plugin data"))?;
                // Each copy keeps its own unrelated entries. Do not mirror one
                // copy over another, which would discard other plugins' data.
                atomic_write(&copy, &bytes)?;
            }
            Ok(())
        })();
        if let Err(error) = cleaned {
            retained_copy_warning.get_or_insert_with(|| plugin_error(
                "Io",
                format!(
                    "Plugin was uninstalled, but a data recovery copy was retained for manual recovery ({}): {}",
                    copy.file_name().unwrap_or_default().to_string_lossy(),
                    error.message,
                ),
            ));
        }
    }
    retained_copy_warning.map_or(Ok(()), Err)
}

fn plugin_storage_key_belongs_to(key: &str, plugin_id: &str) -> bool {
    if key == format!("head:{plugin_id}") { return true; }
    if let Some(rest) = key.strip_prefix("version:") {
        return rest.split_once(':').is_some_and(|(id, _)| id == plugin_id);
    }
    if let Some(rest) = key.strip_prefix("device:") {
        return rest
            .split_once(':')
            .is_some_and(|(stored_plugin_id, _)| stored_plugin_id == plugin_id);
    }
    let Some(rest) = key.strip_prefix("workspace:") else {
        return false;
    };
    let Some((_, rest)) = rest.split_once(':') else {
        return false;
    };
    rest.split_once(':')
        .is_some_and(|(stored_plugin_id, _)| stored_plugin_id == plugin_id)
}

fn remove_owned_path_if_exists(path: &Path) -> PluginResult<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(io_error("inspect plugin data")),
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|_| io_error("remove plugin data file"))
    } else if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|_| io_error("remove plugin data directory"))
    } else {
        Err(plugin_error("UnsafePath", "Plugin data contains a special file"))
    }
}

fn validate_attachment_path(raw: &str) -> PluginResult<String> {
    if raw.len() > 1_024 { return Err(plugin_error("InvalidPath", "Attachment path is too long")); }
    let path = validate_package_path(raw, false)
        .map_err(|_| plugin_error("InvalidPath", "Unsafe attachment path"))?;
    let extension = Path::new(&path).extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf" | "txt" | "csv") {
        return Err(plugin_error("InvalidPath", "Unsupported attachment extension"));
    }
    Ok(path)
}

#[derive(Serialize)]
pub struct PluginAttachment {
    path: String,
    size: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    base64: Option<String>,
}

#[tauri::command]
pub async fn plugin_read_attachment(workspace_root: String, relative_path: String) -> PluginResult<PluginAttachment> {
    let path = validate_attachment_path(&relative_path)?;
    let root = canonical_workspace_root(&workspace_root)?;
    let target = resolve_workspace_note_target(&root, &path, false)?;
    let file = File::open(&target).map_err(|_| plugin_error("NotFound", "Attachment does not exist"))?;
    if !file.metadata().map_err(|_| io_error("inspect attachment"))?.is_file() {
        return Err(plugin_error("InvalidPath", "Attachment is not a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(1_048_577).read_to_end(&mut bytes).map_err(|_| io_error("read attachment"))?;
    if bytes.len() > 1_048_576 { return Err(plugin_error("QuotaExceeded", "Attachment exceeds 1 MiB")); }
    // Revalidate the path after reading before returning any bytes.
    if resolve_workspace_note_target(&root, &path, false)? != target {
        return Err(plugin_error("InvalidPath", "Attachment path changed"));
    }
    Ok(PluginAttachment { path, size: bytes.len(), base64: Some(STANDARD.encode(bytes)) })
}

#[tauri::command]
pub async fn plugin_create_attachment(workspace_root: String, relative_path: String, base64: String) -> PluginResult<PluginAttachment> {
    let path = validate_attachment_path(&relative_path)?;
    if base64.len() > 1_398_104 { return Err(plugin_error("QuotaExceeded", "Attachment exceeds 1 MiB")); }
    let bytes = STANDARD.decode(&base64).map_err(|_| plugin_error("InvalidPath", "Invalid standard Base64"))?;
    if bytes.len() > 1_048_576 { return Err(plugin_error("QuotaExceeded", "Attachment exceeds 1 MiB")); }
    let root = canonical_workspace_root(&workspace_root)?;
    let target = resolve_workspace_note_target(&root, &path, true)?;
    let parent = target.parent().ok_or_else(|| plugin_error("InvalidPath", "Missing attachment parent"))?;
    let temporary = parent.join(format!(".notegen-attachment-{}.tmp", Uuid::new_v4()));
    let result = (|| -> PluginResult<PluginAttachment> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| io_error("stage attachment"))?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| io_error("write attachment"))?;
        drop(file);
        if resolve_workspace_note_target(&root, &path, false)? != target {
            return Err(plugin_error("InvalidPath", "Attachment path changed"));
        }
        // Linking a complete staging file is atomic and cannot replace an existing target.
        fs::hard_link(&temporary, &target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                plugin_error("InvalidPath", "Attachment already exists; choose another path")
            } else { io_error("commit attachment") }
        })?;
        sync_directory(parent);
        Ok(PluginAttachment { path: path.clone(), size: bytes.len(), base64: None })
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn validate_workspace_note_path(raw: &str) -> PluginResult<String> {
    if raw.len() > 1_024 {
        return Err(plugin_error("InvalidPath", "Workspace note path is too long"));
    }
    let path = validate_package_path(raw, false)
        .map_err(|_| plugin_error("InvalidPath", "Workspace note path is unsafe"))?;
    if !path.to_lowercase().ends_with(".md") {
        return Err(plugin_error(
            "InvalidPath",
            "Plugin note path must end in .md",
        ));
    }
    Ok(path)
}

fn canonical_workspace_root(raw: &str) -> PluginResult<PathBuf> {
    let root = PathBuf::from(raw);
    if !root.is_absolute() {
        return Err(plugin_error(
            "InvalidPath",
            "Workspace root must be an absolute directory",
        ));
    }
    let metadata = fs::symlink_metadata(&root)
        .map_err(|_| plugin_error("NotFound", "Workspace root does not exist"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(plugin_error(
            "InvalidPath",
            "Workspace root must be a real directory",
        ));
    }
    fs::canonicalize(root).map_err(|_| io_error("resolve workspace root"))
}

fn resolve_workspace_note_target(
    workspace_root: &Path,
    relative_path: &str,
    create_parents: bool,
) -> PluginResult<PathBuf> {
    let segments = relative_path.split('/').collect::<Vec<_>>();
    let (file_name, parents) = segments
        .split_last()
        .ok_or_else(|| plugin_error("InvalidPath", "Workspace note path is empty"))?;
    let mut parent = workspace_root.to_path_buf();
    for segment in parents {
        let next = parent.join(segment);
        match fs::symlink_metadata(&next) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(plugin_error(
                        "InvalidPath",
                        "Workspace note path contains a symlink or non-directory ancestor",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create_parents => {
                match fs::create_dir(&next) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(_) => return Err(io_error("create workspace note parent directory")),
                }
                let metadata = fs::symlink_metadata(&next)
                    .map_err(|_| io_error("inspect workspace note parent directory"))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(plugin_error(
                        "InvalidPath",
                        "Workspace note parent became a symlink or non-directory",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(plugin_error("NotFound", "Workspace note parent does not exist"));
            }
            Err(_) => return Err(io_error("inspect workspace note parent directory")),
        }
        let canonical = fs::canonicalize(&next)
            .map_err(|_| io_error("resolve workspace note parent directory"))?;
        if !canonical.starts_with(workspace_root) {
            return Err(plugin_error(
                "InvalidPath",
                "Workspace note parent escaped the workspace",
            ));
        }
        parent = canonical;
    }

    let canonical_parent =
        fs::canonicalize(&parent).map_err(|_| io_error("resolve workspace note parent"))?;
    if !canonical_parent.starts_with(workspace_root) {
        return Err(plugin_error(
            "InvalidPath",
            "Workspace note target escaped the workspace",
        ));
    }
    let target = canonical_parent.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(plugin_error(
                "InvalidPath",
                "Workspace note target is a symlink or non-file",
            ));
        }
        let canonical_target = fs::canonicalize(&target)
            .map_err(|_| io_error("resolve workspace note target"))?;
        if !canonical_target.starts_with(workspace_root) {
            return Err(plugin_error(
                "InvalidPath",
                "Workspace note target escaped the workspace",
            ));
        }
    }
    Ok(target)
}

#[tauri::command]
pub async fn plugin_open_or_create_note(
    manager: TauriState<'_, PluginManager>,
    workspace_root: String,
    relative_path: String,
    initial_content: String,
    idempotency_key: Option<String>,
) -> PluginResult<PluginOpenOrCreateNoteResult> {
    if initial_content.len() as u64 > MAX_NOTE_BYTES {
        return Err(plugin_error(
            "QuotaExceeded",
            "Initial note content exceeds the 2 MiB limit",
        ));
    }
    if idempotency_key.as_ref().is_some_and(|key| {
        key.is_empty() || key.len() > 256 || key.chars().any(char::is_control)
    }) {
        return Err(plugin_error("InvalidPath", "Note idempotency key is invalid"));
    }
    let relative_path = validate_workspace_note_path(&relative_path)?;
    let workspace_root = canonical_workspace_root(&workspace_root)?;
    let initial_target =
        resolve_workspace_note_target(&workspace_root, &relative_path, true)?;
    let lock = manager.note_lock(&initial_target)?;
    let result = {
        let _guard = lock.lock().await;
        (|| {
            let target =
                resolve_workspace_note_target(&workspace_root, &relative_path, true)?;
            if target != initial_target {
                return Err(plugin_error(
                    "InvalidPath",
                    "Workspace note target changed while waiting for its lock",
                ));
            }
            match fs::symlink_metadata(&target) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_file() {
                        return Err(plugin_error(
                            "InvalidPath",
                            "Workspace note target is not a regular file",
                        ));
                    }
                    return Ok(PluginOpenOrCreateNoteResult {
                        status: PluginOpenOrCreateStatus::OpenedExisting,
                        path: relative_path.clone(),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(io_error("inspect workspace note target")),
            }

            let mut file = match OpenOptions::new().write(true).create_new(true).open(&target) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = fs::symlink_metadata(&target)
                        .map_err(|_| io_error("inspect concurrently created note"))?;
                    if metadata.file_type().is_symlink() || !metadata.is_file() {
                        return Err(plugin_error(
                            "InvalidPath",
                            "Concurrent note target is not a regular file",
                        ));
                    }
                    return Ok(PluginOpenOrCreateNoteResult {
                        status: PluginOpenOrCreateStatus::OpenedExisting,
                        path: relative_path.clone(),
                    });
                }
                Err(_) => return Err(io_error("create workspace note")),
            };
            let write_result = file
                .write_all(initial_content.as_bytes())
                .and_then(|_| file.sync_all());
            if write_result.is_err() {
                drop(file);
                let _ = fs::remove_file(&target);
                return Err(io_error("write workspace note"));
            }
            drop(file);
            let canonical_target = fs::canonicalize(&target)
                .map_err(|_| io_error("resolve created workspace note"))?;
            if !canonical_target.starts_with(&workspace_root) {
                let _ = fs::remove_file(&target);
                return Err(plugin_error(
                    "InvalidPath",
                    "Created note escaped the workspace",
                ));
            }
            if let Some(parent) = target.parent() {
                sync_directory(parent);
            }
            Ok(PluginOpenOrCreateNoteResult {
                status: PluginOpenOrCreateStatus::Created,
                path: relative_path.clone(),
            })
        })()
    };
    manager.release_note_lock(&initial_target, &lock);
    result
}

#[tauri::command]
pub async fn plugin_read_workspace_note(
    manager: TauriState<'_, PluginManager>,
    workspace_root: String,
    relative_path: String,
) -> PluginResult<PluginWorkspaceNote> {
    let relative_path = validate_workspace_note_path(&relative_path)?;
    let workspace_root = canonical_workspace_root(&workspace_root)?;
    let initial_target =
        resolve_workspace_note_target(&workspace_root, &relative_path, false)?;
    let lock = manager.note_lock(&initial_target)?;
    let result = {
        let _guard = lock.lock().await;
        (|| {
            let target =
                resolve_workspace_note_target(&workspace_root, &relative_path, false)?;
            if target != initial_target {
                return Err(plugin_error(
                    "InvalidPath",
                    "Workspace note target changed while waiting for its lock",
                ));
            }
            let metadata = fs::symlink_metadata(&target)
                .map_err(|_| plugin_error("NotFound", "Workspace note does not exist"))?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(plugin_error(
                    "InvalidPath",
                    "Workspace note is not a regular file",
                ));
            }
            if metadata.len() > MAX_NOTE_BYTES {
                return Err(plugin_error(
                    "QuotaExceeded",
                    "Workspace note exceeds the 2 MiB read limit",
                ));
            }
            let mut file = File::open(&target).map_err(|_| io_error("open workspace note"))?;
            let canonical_target = fs::canonicalize(&target)
                .map_err(|_| io_error("resolve workspace note"))?;
            if !canonical_target.starts_with(&workspace_root) {
                return Err(plugin_error(
                    "InvalidPath",
                    "Workspace note escaped the workspace",
                ));
            }
            let mut bytes = Vec::with_capacity(metadata.len() as usize);
            Read::by_ref(&mut file)
                .take(MAX_NOTE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| io_error("read workspace note"))?;
            if bytes.len() as u64 > MAX_NOTE_BYTES {
                return Err(plugin_error(
                    "QuotaExceeded",
                    "Workspace note exceeded the 2 MiB read limit",
                ));
            }
            let content = String::from_utf8(bytes.clone()).map_err(|_| {
                plugin_error("InvalidPackage", "Workspace note is not valid UTF-8")
            })?;
            let digest = Sha256::digest(&bytes);
            let mut revision_bytes = [0_u8; 8];
            revision_bytes.copy_from_slice(&digest[..8]);
            Ok(PluginWorkspaceNote {
                path: relative_path.clone(),
                content,
                modified_at: file.metadata().ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                    .and_then(|duration| u64::try_from(duration.as_millis()).ok())
                    .filter(|value| *value <= MAX_JAVASCRIPT_INTEGER),
                // Keep the revision exactly representable by JavaScript Number.
                revision: u64::from_be_bytes(revision_bytes) & MAX_JAVASCRIPT_INTEGER,
            })
        })()
    };
    manager.release_note_lock(&initial_target, &lock);
    result
}

fn note_revision(bytes: &[u8]) -> u64 {
    let digest = Sha256::digest(bytes);
    let mut revision_bytes = [0_u8; 8];
    revision_bytes.copy_from_slice(&digest[..8]);
    u64::from_be_bytes(revision_bytes) & MAX_JAVASCRIPT_INTEGER
}

fn collect_workspace_notes(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<PluginNoteEntry>,
    limit: usize,
    recursive: bool,
    after: &mut Option<String>,
    visited: &mut usize,
) -> PluginResult<bool> {
    let relative_directory = directory.strip_prefix(root)
        .map_err(|_| plugin_error("InvalidPath", "Workspace folder escaped the workspace"))?;
    let checked_directory = resolve_workspace_note_directory(root, relative_directory)?;
    if checked_directory != directory {
        return Err(plugin_error("InvalidPath", "Workspace folder changed while it was being listed"));
    }
    let mut children = fs::read_dir(directory)
        .map_err(|_| io_error("list workspace note directory"))?
        .take(100_001)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| io_error("read workspace note directory entry"))?;
    if children.len() > 100_000 {
        return Err(plugin_error("QuotaExceeded", "Note directory exceeds 100000 entries; choose a smaller folder"));
    }
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        *visited += 1;
        if *visited > 100_000 {
            return Err(plugin_error("QuotaExceeded", "Note scan exceeds 100000 entries; choose a smaller folder"));
        }
        let child_name = child.file_name().to_string_lossy().into_owned();
        if child_name.starts_with('.') || child_name.eq_ignore_ascii_case("node_modules") {
            continue;
        }
        let file_type = child.file_type().map_err(|_| io_error("inspect workspace note entry type"))?;
        if file_type.is_symlink() {
            continue;
        }
        let metadata = fs::symlink_metadata(child.path())
            .map_err(|_| io_error("inspect workspace note entry"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let path = child.path();
        if file_type.is_dir() {
            if recursive && collect_workspace_notes(root, &path, entries, limit, true, after, visited)? {
                return Ok(true);
            }
            continue;
        }
        if !file_type.is_file() || !path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("md")) {
            continue;
        }
        let relative = path.strip_prefix(root)
            .map_err(|_| plugin_error("InvalidPath", "Workspace note escaped the workspace"))?
            .to_string_lossy()
            .replace('\\', "/");
        if let Some(marker) = after.as_ref() {
            if marker == &relative { *after = None; }
            continue;
        }
        if entries.len() >= limit {
            return Ok(true);
        }
        entries.push(PluginNoteEntry {
            name: child_name,
            path: relative,
            size: metadata.len(),
        });
    }
    Ok(false)
}

fn resolve_workspace_note_directory(root: &Path, relative: &Path) -> PluginResult<PathBuf> {
    let mut directory = root.to_path_buf();
    for segment in relative.components() {
        let std::path::Component::Normal(segment) = segment else {
            return Err(plugin_error("InvalidPath", "Workspace folder path is unsafe"));
        };
        let candidate = directory.join(segment);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|_| plugin_error("NotFound", "Workspace folder does not exist"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(plugin_error(
                "InvalidPath",
                "Workspace folder contains a symlink or non-directory ancestor",
            ));
        }
        let canonical = fs::canonicalize(&candidate)
            .map_err(|_| io_error("resolve workspace folder"))?;
        if !canonical.starts_with(root) {
            return Err(plugin_error("InvalidPath", "Workspace folder escaped the workspace"));
        }
        directory = canonical;
    }
    Ok(directory)
}

#[tauri::command]
pub async fn plugin_list_workspace_notes(
    workspace_root: String,
    folder: String,
    recursive: bool,
    limit: usize,
    cursor: Option<String>,
) -> PluginResult<PluginNoteList> {
    let root = canonical_workspace_root(&workspace_root)?;
    let workspace = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    let mut after = match cursor {
        Some(value) => {
            if value.len() > 8192 { return Err(plugin_error("InvalidPath", "Invalid note cursor")); }
            let parsed: PluginNoteCursor = serde_json::from_str(&value)
                .map_err(|_| plugin_error("InvalidPath", "Invalid note cursor"))?;
            if parsed.workspace != workspace || parsed.folder != folder || parsed.recursive != recursive {
                return Err(plugin_error("InvalidPath", "Note cursor does not match this query"));
            }
            Some(validate_workspace_note_path(&parsed.after)?)
        }
        None => None,
    };
    let directory = if folder.is_empty() {
        root.clone()
    } else {
        let normalized = validate_package_path(&folder, true)
            .map_err(|_| plugin_error("InvalidPath", "Workspace folder path is unsafe"))?;
        resolve_workspace_note_directory(&root, Path::new(&normalized))?
    };
    if !directory.starts_with(&root) {
        return Err(plugin_error("InvalidPath", "Workspace folder escaped the workspace"));
    }
    let safe_limit = limit.clamp(1, 1_000);
    let mut entries = Vec::new();
    let mut visited = 0;
    let truncated = collect_workspace_notes(&root, &directory, &mut entries, safe_limit, recursive, &mut after, &mut visited)?;
    if after.is_some() { return Err(plugin_error("StaleRevision", "Note cursor is stale; restart the scan")); }
    let next_cursor = if truncated {
        entries.last().map(|entry| serde_json::to_string(&PluginNoteCursor {
            workspace, folder: folder.clone(), recursive, after: entry.path.clone(),
        })).transpose().map_err(|_| plugin_error("RuntimeFailure", "Could not encode note cursor"))?
    } else { None };
    Ok(PluginNoteList { entries, truncated, next_cursor })
}

// Mutation preconditions must obey the same read quota as notes.read. A
// workspace file may be larger than the plugin can read or grow concurrently.
fn read_note_mutation_snapshot(target: &Path) -> PluginResult<Option<Vec<u8>>> {
    let file = match File::open(target) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(io_error("open workspace note before mutation")),
    };
    let metadata = file.metadata().map_err(|_| io_error("inspect workspace note before mutation"))?;
    if !metadata.is_file() {
        return Err(plugin_error("InvalidPath", "Workspace note is not a regular file"));
    }
    if metadata.len() > MAX_NOTE_BYTES {
        return Err(plugin_error("QuotaExceeded", "Workspace note exceeds the 2 MiB mutation limit"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_NOTE_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|_| io_error("read workspace note before mutation"))?;
    if bytes.len() as u64 > MAX_NOTE_BYTES {
        return Err(plugin_error("QuotaExceeded", "Workspace note exceeds the 2 MiB mutation limit"));
    }
    Ok(Some(bytes))
}

#[tauri::command]
pub async fn plugin_write_workspace_note(
    manager: TauriState<'_, PluginManager>,
    workspace_root: String,
    relative_path: String,
    content: String,
    expected_revision: Option<u64>,
    create: bool,
) -> PluginResult<PluginWriteNoteResult> {
    if content.len() as u64 > MAX_NOTE_BYTES {
        return Err(plugin_error("QuotaExceeded", "Workspace note exceeds the 2 MiB write limit"));
    }
    let relative_path = validate_workspace_note_path(&relative_path)?;
    let root = canonical_workspace_root(&workspace_root)?;
    let target = resolve_workspace_note_target(&root, &relative_path, create)?;
    let lock = manager.note_lock(&target)?;
    let guard = lock.lock().await;
    let result = (|| -> PluginResult<PluginWriteNoteResult> {
        if resolve_workspace_note_target(&root, &relative_path, create)? != target {
            return Err(plugin_error("InvalidPath", "Workspace note target changed while waiting for its lock"));
        }
        let existing = read_note_mutation_snapshot(&target);
        match existing {
            Err(error) => Err(error),
            Ok(existing) if existing.is_none() && !create => {
                Err(plugin_error("NotFound", "Workspace note does not exist"))
            }
            Ok(Some(_)) if expected_revision.is_none() => {
                Err(plugin_error("StaleRevision", "Read the existing note and provide expectedRevision before writing"))
            }
            Ok(existing) if expected_revision.is_some_and(|expected| {
                existing.as_deref().map(note_revision) != Some(expected)
            }) => Err(plugin_error("StaleRevision", "Workspace note revision has changed")),
            Ok(existing) => {
                let created = existing.is_none();
                atomic_write(&target, content.as_bytes())?;
                Ok(PluginWriteNoteResult {
                    path: relative_path.clone(),
                    revision: note_revision(content.as_bytes()),
                    created,
                })
            }
        }
    })();
    drop(guard);
    manager.release_note_lock(&target, &lock);
    result
}

#[tauri::command]
pub async fn plugin_delete_workspace_note(
    manager: TauriState<'_, PluginManager>,
    workspace_root: String,
    relative_path: String,
    expected_revision: Option<u64>,
) -> PluginResult<()> {
    let relative_path = validate_workspace_note_path(&relative_path)?;
    let root = canonical_workspace_root(&workspace_root)?;
    let target = resolve_workspace_note_target(&root, &relative_path, false)?;
    let lock = manager.note_lock(&target)?;
    let guard = lock.lock().await;
    let result = (|| -> PluginResult<()> {
        if resolve_workspace_note_target(&root, &relative_path, false)? != target {
            return Err(plugin_error("InvalidPath", "Workspace note target changed while waiting for its lock"));
        }
        let bytes = read_note_mutation_snapshot(&target)?
            .ok_or_else(|| plugin_error("NotFound", "Workspace note does not exist"))?;
        if expected_revision != Some(note_revision(&bytes)) {
            Err(plugin_error("StaleRevision", "Workspace note revision has changed"))
        } else {
            // Never fall back to permanent deletion if trash is unavailable.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                #[cfg(target_os = "macos")]
                {
                    // Finder automation can wait for an unrelated Automation prompt.
                    // Use the native trash API; files remain recoverable from Trash.
                    use trash::macos::{DeleteMethod, TrashContextExtMacos};
                    let mut context = trash::TrashContext::default();
                    context.set_delete_method(DeleteMethod::NsFileManager);
                    context.delete(&target).map_err(|_| io_error("move workspace note to system trash"))?;
                }
                #[cfg(not(target_os = "macos"))]
                trash::delete(&target).map_err(|_| io_error("move workspace note to system trash"))?;
                if let Some(parent) = target.parent() { sync_directory(parent); }
                Ok(())
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                Err(plugin_error("UnavailableOnPlatform", "Recoverable note deletion is unavailable on mobile"))
            }
        }
    })();
    drop(guard);
    manager.release_note_lock(&target, &lock);
    result
}

#[tauri::command]
pub async fn plugin_move_workspace_note(
    manager: TauriState<'_, PluginManager>,
    workspace_root: String,
    from: String,
    to: String,
) -> PluginResult<()> {
    let from = validate_workspace_note_path(&from)?;
    let to = validate_workspace_note_path(&to)?;
    if from == to { return Ok(()); }
    let root = canonical_workspace_root(&workspace_root)?;
    let source = resolve_workspace_note_target(&root, &from, false)?;
    let target = resolve_workspace_note_target(&root, &to, true)?;
    // Distinct normalized relative strings can still resolve to one path on a
    // case-insensitive filesystem. Avoid trying to acquire the same mutex twice.
    if source == target {
        return Ok(());
    }
    let _mutation_guard = manager.mutation_lock.lock().await;

    // Reads, writes, deletes and open-or-create operations synchronize on the
    // resolved note path. A move must hold both path locks or a concurrent
    // writer can recreate the source after the rename. Always acquire the
    // locks in path order so two overlapping moves cannot deadlock.
    let (first_path, second_path) = if source <= target {
        (&source, &target)
    } else {
        (&target, &source)
    };
    let first_lock = manager.note_lock(first_path)?;
    let second_lock = match manager.note_lock(second_path) {
        Ok(lock) => lock,
        Err(error) => {
            manager.release_note_lock(first_path, &first_lock);
            return Err(error);
        }
    };

    let result = {
        let first_guard = first_lock.lock().await;
        let second_guard = second_lock.lock().await;
        let result = (|| -> PluginResult<()> {
            let locked_source = resolve_workspace_note_target(&root, &from, false)?;
            let locked_target = resolve_workspace_note_target(&root, &to, true)?;
            if locked_source != source || locked_target != target {
                return Err(plugin_error(
                    "InvalidPath",
                    "Workspace note path changed while waiting for its move locks",
                ));
            }
            if locked_target.exists() {
                return Err(plugin_error("Conflict", "Destination note already exists"));
            }
            fs::rename(&locked_source, &locked_target)
                .map_err(|_| io_error("move workspace note"))?;
            if let Some(parent) = locked_source.parent() {
                sync_directory(parent);
            }
            if let Some(parent) = locked_target.parent() {
                sync_directory(parent);
            }
            Ok(())
        })();
        drop(second_guard);
        drop(first_guard);
        result
    };
    manager.release_note_lock(second_path, &second_lock);
    manager.release_note_lock(first_path, &first_lock);
    result
}

fn plugin_network_ipv4_is_global(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_documentation()
        || octets[0] == 0
        || (octets[0] == 100 && (octets[1] & 0xc0) == 0x40)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        || (octets[0] == 198 && (octets[1] & 0xfe) == 18)
        || octets[0] >= 240)
}

fn plugin_network_ipv6_is_global(ip: Ipv6Addr) -> bool {
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return plugin_network_ipv4_is_global(ipv4);
    }

    let segments = ip.segments();
    let octets = ip.octets();
    // The well-known NAT64 prefix embeds an IPv4 destination in the final
    // 32 bits. Apply the same public-address policy to that destination.
    if segments[0] == 0x0064
        && segments[1] == 0xff9b
        && segments[2..6].iter().all(|segment| *segment == 0)
    {
        return plugin_network_ipv4_is_global(Ipv4Addr::new(
            octets[12], octets[13], octets[14], octets[15],
        ));
    }

    let is_ipv4_compatible = segments[..6].iter().all(|segment| *segment == 0);
    let is_discard_only = segments[0] == 0x0100
        && segments[1..4].iter().all(|segment| *segment == 0);
    let is_documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
    let is_benchmarking = segments[0] == 0x2001
        && segments[1] == 0x0002
        && segments[2] == 0;
    let is_orchid = segments[0] == 0x2001
        && ((segments[1] & 0xfff0) == 0x0010 || (segments[1] & 0xfff0) == 0x0020);
    let is_ietf_special = segments[0] == 0x2001 && segments[1] <= 0x01ff;
    let is_6to4 = segments[0] == 0x2002;
    let is_additional_documentation = segments[0] == 0x3fff
        && (segments[1] & 0xf000) == 0;
    let is_site_local = (segments[0] & 0xffc0) == 0xfec0;
    let is_local_nat64 = segments[0] == 0x0064
        && segments[1] == 0xff9b
        && segments[2] == 0x0001;
    let is_global_unicast = (segments[0] & 0xe000) == 0x2000;

    is_global_unicast
        && !ip.is_loopback()
        && !ip.is_unspecified()
        && !ip.is_unique_local()
        && !ip.is_unicast_link_local()
        && !ip.is_multicast()
        && !is_ipv4_compatible
        && !is_discard_only
        && !is_documentation
        && !is_benchmarking
        && !is_orchid
        && !is_ietf_special
        && !is_6to4
        && !is_additional_documentation
        && !is_site_local
        && !is_local_nat64
}

fn plugin_network_ip_is_global(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => plugin_network_ipv4_is_global(ip),
        IpAddr::V6(ip) => plugin_network_ipv6_is_global(ip),
    }
}

#[tauri::command]
pub async fn plugin_network_fetch(
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    timeout_ms: u64,
) -> PluginResult<PluginNetworkResponse> {
    let parsed = Url::parse(&url).map_err(|_| plugin_error("InvalidPath", "Network URL is invalid"))?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.fragment().is_some() || host == "localhost" || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.parse::<std::net::IpAddr>().is_ok()
    {
        return Err(plugin_error("PermissionDenied", "Only public HTTPS hostnames are allowed"));
    }
    let method = method.to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err(plugin_error(
            "PermissionDenied",
            "Network method is not allowed",
        ));
    }
    if !(1_000..=30_000).contains(&timeout_ms) {
        return Err(plugin_error(
            "InvalidPath",
            "Network timeout must be between 1000 and 30000 milliseconds",
        ));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| plugin_error("InvalidPath", "Network method is invalid"))?;
    if headers.len() > 100 {
        return Err(plugin_error(
            "QuotaExceeded",
            "Network request declares too many headers",
        ));
    }
    // DNS resolution is part of the advertised request deadline. Dropping this
    // whole future after timeout also prevents a late DNS answer from starting
    // an HTTP request after the caller has already received a timeout.
    let operation = async {
        let port = parsed.port_or_known_default().unwrap_or(443);
        let addresses = tokio::net::lookup_host((host.as_str(), port)).await
            .map_err(|_| plugin_error("PermissionDenied", "Network hostname could not be resolved"))?
            .collect::<Vec<_>>();
        if addresses.is_empty()
            || addresses
                .iter()
                .any(|address| !plugin_network_ip_is_global(address.ip()))
        {
            return Err(plugin_error("PermissionDenied", "Private network destinations are not allowed"));
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            // Plugin traffic must not inherit host/user proxy settings: a proxy can
            // bypass the DNS pin above and expose requests to a local endpoint.
            .no_proxy()
            .timeout(Duration::from_millis(timeout_ms))
            // Retain every validated address so IPv4 can still succeed when the
            // first (often IPv6) address is unreachable. No address is re-resolved.
            .resolve_to_addrs(&host, &addresses)
            .build().map_err(|_| plugin_error("RuntimeFailure", "Unable to initialize network client"))?;
        let mut request = client.request(method, parsed);
        for (name, value) in headers {
            if name.len() > 100 || value.len() > 8_192 {
                return Err(plugin_error("QuotaExceeded", "Network header is too large"));
            }
            let lower_name = name.to_ascii_lowercase();
            if matches!(
                lower_name.as_str(),
                "connection"
                    | "content-length"
                    | "cookie"
                    | "expect"
                    | "host"
                    | "keep-alive"
                    | "origin"
                    | "referer"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
            ) || lower_name.starts_with("proxy-")
            {
                return Err(plugin_error(
                    "PermissionDenied",
                    "Network request contains a host-controlled or hop-by-hop header",
                ));
            }
            request = request.header(name, value);
        }
        if let Some(body) = body {
            if body.len() > 2 * 1024 * 1024 {
                return Err(plugin_error("QuotaExceeded", "Network request body exceeds 2 MiB"));
            }
            request = request.body(body);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                plugin_error("Timeout", "Network request timed out")
            } else {
                plugin_error("RuntimeFailure", "Network request failed")
            }
        })?;
        let status = response.status().as_u16();
        let final_url = response.url().to_string();
        let mut response_headers = BTreeMap::new();
        let mut response_header_count = 0_usize;
        for (name, value) in response
            .headers()
            .iter()
            .filter(|(name, _)| name.as_str() != "set-cookie")
        {
            response_header_count = response_header_count.saturating_add(1);
            if response_header_count > 100 {
                return Err(plugin_error(
                    "QuotaExceeded",
                    "Network response declares too many headers",
                ));
            }
            let value = value.to_str().map_err(|_| {
                plugin_error("RuntimeFailure", "Network response header is not UTF-8 text")
            })?;
            if name.as_str().len() > 100 || value.len() > 8_192 {
                return Err(plugin_error(
                    "QuotaExceeded",
                    "Network response header is too large",
                ));
            }
            response_headers.insert(name.to_string(), value.to_string());
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                if error.is_timeout() {
                    plugin_error("Timeout", "Network response timed out")
                } else {
                    plugin_error("RuntimeFailure", "Unable to read network response")
                }
            })?;
            if bytes.len().saturating_add(chunk.len()) > 2 * 1024 * 1024 {
                return Err(plugin_error("QuotaExceeded", "Network response exceeds 2 MiB"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = String::from_utf8(bytes)
            .map_err(|_| plugin_error("RuntimeFailure", "Network response is not UTF-8 text"))?;
        Ok(PluginNetworkResponse { url: final_url, status, headers: response_headers, body })
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), operation)
        .await
        .map_err(|_| plugin_error("Timeout", "Network request timed out"))?
}

// Kept alongside the SDK resources contract; package paths and hashes remain native authority.
fn resource_object<'a>(value: &'a Value, allowed: &[&str]) -> PluginResult<&'a JsonMap<String, Value>> {
    let object = value.as_object().ok_or_else(|| plugin_error("InvalidManifest", "Expected resource object"))?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(plugin_error("InvalidManifest", "Unknown resource field"));
    }
    Ok(object)
}
fn resource_text<'a>(value: &'a Value, maximum: usize) -> PluginResult<&'a str> {
    let text = value.as_str().ok_or_else(|| plugin_error("InvalidManifest", "Expected resource text"))?;
    validate_text(text, "resource", maximum)?;
    Ok(text)
}
fn resource_path(value: &Value) -> PluginResult<String> {
    let text = resource_text(value, 240)?;
    if text.len() > 240 || text.contains(':') { return Err(plugin_error("InvalidManifest", "Invalid resource path")); }
    validate_package_path(text, false)
}
fn resource_extension(value: &Value) -> bool {
    value.as_str().map(|s| !s.is_empty() && s.len() <= 32 && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')).unwrap_or(false)
}
fn resource_paths(resources: &Value) -> PluginResult<BTreeSet<String>> {
    let mut paths = BTreeSet::new();
    if let Some(languages) = resources.get("languages").and_then(Value::as_array) {
        for language in languages { paths.insert(resource_path(&language["messages"])?); }
    }
    if let Some(previews) = resources.get("documentPreviews").and_then(Value::as_array) {
        for preview in previews {
            paths.insert(resource_path(&preview["script"])?);
            if let Some(assets) = preview.get("assets").and_then(Value::as_array) {
                for asset in assets { paths.insert(resource_path(asset)?); }
            }
        }
    }
    Ok(paths)
}
fn validate_language_tree(value: &Value, depth: usize) -> PluginResult<()> {
    if depth > 20 { return Err(plugin_error("InvalidManifest", "Language nesting limit exceeded")); }
    let object = value.as_object().ok_or_else(|| plugin_error("InvalidManifest", "Expected language object"))?;
    for (key, child) in object {
        if key.is_empty() || key.contains('.') || ["__proto__", "constructor", "prototype"].contains(&key.as_str()) {
            return Err(plugin_error("InvalidManifest", "Invalid language key"));
        }
        if let Some(text) = child.as_str() {
            if text.encode_utf16().count() > 16384 { return Err(plugin_error("InvalidManifest", "Language message too long")); }
        } else { validate_language_tree(child, depth + 1)?; }
    }
    Ok(())
}
fn validate_resources(manifest: &PluginManifestV1, root: &Path, files: &BTreeMap<String, ActualFile>) -> PluginResult<()> {
    let invalid = || plugin_error("InvalidManifest", "Invalid plugin resources");
    for path in files.keys().filter(|path| path.to_lowercase().ends_with(".wasm")) {
        let declared = manifest.resources.as_ref().and_then(|r| r.get("documentPreviews")).and_then(Value::as_array)
            .map(|previews| previews.iter().any(|preview| preview.get("assets").and_then(Value::as_array)
                .map(|assets| assets.iter().any(|asset| asset.as_str() == Some(path.as_str()))).unwrap_or(false))).unwrap_or(false);
        if !declared { return Err(plugin_error("InvalidManifest", "WASM must be a declared preview asset")); }
    }
    let Some(resources) = &manifest.resources else {
        if manifest.entry.is_empty() { return Err(invalid()); }
        return Ok(());
    };
    let object = resource_object(resources, &["themes", "languages", "fileIcons", "documentPreviews"])?;
    let mut count = 0;
    for (kind, values) in object {
        let items = values.as_array().ok_or_else(invalid)?;
        if items.len() > if kind == "fileIcons" { 500 } else { 30 } { return Err(invalid()); }
        count += items.len();
        let mut ids = BTreeSet::new();
        for item in items {
            if kind != "fileIcons" {
                resource_text(&item["name"], 160)?;
                let id = resource_text(&item[if kind == "languages" { "locale" } else { "id" }], 160)?;
                if !id.as_bytes()[0].is_ascii_alphanumeric() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) || !ids.insert(id) { return Err(invalid()); }
            }
            match kind.as_str() {
                "themes" => {
                    resource_object(item, &["id", "name", "light", "dark"])?;
                    for mode in ["light", "dark"] {
                        let palette = resource_object(&item[mode], &["background", "foreground", "card", "cardForeground", "primary", "primaryForeground", "secondary", "secondaryForeground", "third", "thirdForeground", "muted", "mutedForeground", "accent", "accentForeground", "border", "shadow"])?;
                        for color in palette.values() {
                            let hsl = color.as_array().ok_or_else(invalid)?;
                            if hsl.len() != 3 || hsl.iter().enumerate().any(|(i,n)| n.as_f64().map(|v| !v.is_finite() || v < 0.0 || v > if i == 0 { 360.0 } else { 100.0 }).unwrap_or(true)) { return Err(invalid()); }
                        }
                    }
                }
                "languages" => {
                    resource_object(item, &["locale", "name", "messages"])?;
                    let locale = resource_text(&item["locale"], 160)?;
                    let parts: Vec<_> = locale.split('-').collect();
                    if !(2..=8).contains(&parts[0].len()) || !parts[0].bytes().all(|c| c.is_ascii_lowercase())
                        || parts.iter().skip(1).any(|p| p.is_empty() || p.len() > 8 || !p.bytes().all(|c| c.is_ascii_alphanumeric())) { return Err(invalid()); }
                    let path = resource_path(&item["messages"])?;
                    if !path.ends_with(".json") { return Err(invalid()); }
                    let bytes = read_limited_file(&root.join(&path), MAX_ENTRY_SOURCE_BYTES, "language resource")?;
                    ensure_bytes_match_actual(&bytes, files.get(&path), "language resource")?;
                    let (messages, _): (Value, Value) = parse_strict_type(&bytes, "language resource")?;
                    validate_language_tree(&messages, 0)?;
                }
                "fileIcons" => {
                    resource_object(item, &["kind", "path", "extension", "icon"])?;
                    if ![Some("file"), Some("folder")].contains(&item["kind"].as_str()) { return Err(invalid()); }
                    if let Some(path) = item.get("path") { resource_path(path)?; }
                    if let Some(extension) = item.get("extension") {
                        if item["kind"] != "file" || !resource_extension(extension) { return Err(invalid()); }
                    }
                    let icon = resource_object(&item["icon"], &["name", "emoji"])?;
                    if icon.len() != 1 { return Err(invalid()); }
                    let text = resource_text(icon.values().next().ok_or_else(invalid)?, if icon.contains_key("name") { 80 } else { 64 })?;
                    if icon.contains_key("name") && (text.len() > 80 || !text.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')) { return Err(invalid()); }
                    if icon.contains_key("emoji") && (text.encode_utf16().count() > 16 || !regex::Regex::new(r"\p{Extended_Pictographic}|\p{Regional_Indicator}").map_err(|_| invalid())?.is_match(text)) { return Err(invalid()); }
                }
                "documentPreviews" => {
                    resource_object(item, &["id", "name", "extensions", "script", "assets"])?;
                    let extensions = item["extensions"].as_array().ok_or_else(invalid)?;
                    if extensions.is_empty() || extensions.len() > 30 || extensions.iter().any(|x| !resource_extension(x)) { return Err(invalid()); }
                    if !resource_path(&item["script"])?.ends_with(".js") { return Err(invalid()); }
                    if let Some(assets) = item.get("assets") {
                        let assets = assets.as_array().ok_or_else(invalid)?;
                        if assets.len() > 100 { return Err(invalid()); }
                        for path in assets { resource_path(path)?; }
                    }
                    if !manifest.permissions.contains_key("attachments.read") { return Err(plugin_error("InvalidManifest", "Previews require attachments.read")); }
                }
                _ => return Err(invalid()),
            }
        }
    }
    if manifest.entry.is_empty() {
        if count == 0 || !manifest.activation_events.is_empty() || !manifest.contributes.commands.is_empty()
            || !manifest.contributes.settings.is_empty() || !manifest.contributes.views.is_empty() || !manifest.contributes.menus.is_empty() || !manifest.contributes.status_bar.is_empty()
            || manifest.permissions.keys().any(|key| key != "attachments.read")
            || (resources.get("documentPreviews").and_then(Value::as_array).map(|x| x.is_empty()).unwrap_or(true) && !manifest.permissions.is_empty()) { return Err(invalid()); }
    }
    for path in resource_paths(resources)? {
        let expected = files.get(&path).ok_or_else(invalid)?;
        if expected.size > MAX_ENTRY_SOURCE_BYTES { return Err(plugin_error("PackageTooLarge", "Resource exceeds 5 MiB")); }
        let bytes = read_limited_file(&root.join(&path), MAX_ENTRY_SOURCE_BYTES, "plugin resource")?;
        ensure_bytes_match_actual(&bytes, Some(expected), "plugin resource")?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_read_resource(app: AppHandle, plugin_id: String, path: String, expected_version: String, expected_content_hash: String) -> PluginResult<String> {
    let verified = verify_installed_package(&app, &plugin_id, None)?;
    assert_expected_installed_package(&verified, &expected_version, &expected_content_hash)?;
    let resources = verified.content.manifest.resources.as_ref().ok_or_else(|| plugin_error("NotFound", "No plugin resources"))?;
    let path = validate_package_path(&path, false)?;
    if !resource_paths(resources)?.contains(&path) { return Err(plugin_error("PermissionDenied", "Resource is not declared")); }
    let bytes = read_limited_file(&verified.directory.join(&path), MAX_ENTRY_SOURCE_BYTES, "plugin resource")?;
    ensure_bytes_match_actual(&bytes, verified.content.files.get(&path), "plugin resource")?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn plugin_read_preview_chunk(workspace_root: String, relative_path: String, offset: u64, length: u64) -> PluginResult<String> {
    if length == 0 || length > 1_048_576 || offset > 268_435_456 { return Err(plugin_error("QuotaExceeded", "Invalid preview read range")); }
    let path = validate_package_path(&relative_path, false)?;
    let root = canonical_workspace_root(&workspace_root)?;
    let target = resolve_workspace_note_target(&root, &path, false)?;
    let mut file = File::open(&target).map_err(|_| plugin_error("NotFound", "Preview document does not exist"))?;
    let metadata = file.metadata().map_err(|_| io_error("inspect preview document"))?;
    if !metadata.is_file() || metadata.len() > 268_435_456 { return Err(plugin_error("QuotaExceeded", "Preview limit is 256 MiB")); }
    file.seek(SeekFrom::Start(offset)).map_err(|_| io_error("seek preview document"))?;
    let mut bytes = Vec::new();
    file.take(length).read_to_end(&mut bytes).map_err(|_| io_error("read preview document"))?;
    if resolve_workspace_note_target(&root, &path, false)? != target { return Err(plugin_error("InvalidPath", "Preview path changed")); }
    Ok(STANDARD.encode(bytes))
}
