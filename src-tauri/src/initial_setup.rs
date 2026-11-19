use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::{json, Value};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub const INITIAL_SETUP_FILE: &str = "initial-setup.json";

const BUILTIN_MODELS: &[&str] = &[
    "note-gen-free", "note-gen-limited", "note-gen-chat", "note-gen-free-chat",
    "note-gen-embedding", "note-gen-vlm", "note-gen-stt",
];

fn has_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => values.iter().any(has_value),
        Value::Object(values) => values.values().any(has_value),
        Value::Number(_) => true,
    }
}

fn has_user_settings(settings: &Value) -> bool {
    if [
        "workspacePath", "workspaceHistory", "workspaceSyncRepos", "accessToken",
        "giteeAccessToken", "gitlabAccessToken", "giteaAccessToken",
        "githubImageAccessToken", "githubCustomSyncRepo", "giteeCustomSyncRepo",
        "gitlabCustomSyncRepo", "giteaCustomSyncRepo", "githubCustomImageRepo",
        "gitlabCustomUrl", "giteaCustomUrl", "webdavSyncConfig", "cloudFolderSyncConfig",
        "oneDriveAuthTokens", "customCss", "customThemeColors", "agentSystemPromptExtension",
        "desktopOnboardingProgress", "webSearch.apiKey", "webSearch.apiKeys",
    ].iter().any(|key| has_value(&settings[*key])) {
        return true;
    }

    // S3's initial form contains a default region even without an account.
    if ["accessKeyId", "secretAccessKey", "bucket", "endpoint", "pathPrefix", "customDomain"]
        .iter().any(|key| has_value(&settings["s3SyncConfig"][*key]))
    {
        return true;
    }

    if [
        ("language", json!("简体中文")),
        ("darkMode", json!("system")),
        ("appFontFamily", json!("__notegen_system_font__")),
        ("uiScale", json!(100)),
        ("contentTextScale", json!(100)),
        ("recordTextSize", json!("sm")),
        ("fileManagerTextSize", json!("sm")),
        ("editorContentWidth", json!("full")),
        ("editorLineHeight", json!("comfortable")),
        ("editorViewMode", json!("visual")),
        ("agentPermissionMode", json!("ask")),
        ("autoUpdate", json!(true)),
        ("closeBehavior", json!("minimize")),
        ("autostartMinimized", json!(false)),
        ("autoSync", json!("5")),
        ("autoRecordSyncEnabled", json!(true)),
        ("autoSettingsSyncEnabled", json!(true)),
        ("autoConversationSyncEnabled", json!(true)),
        ("autoPullOnOpen", json!(true)),
        ("excludeSensitiveConfig", json!(true)),
        ("assetsPath", json!("assets")),
    ].iter().any(|(key, default)| {
        settings.get(*key).is_some_and(|value| !value.is_null() && value != default)
    }) {
        return true;
    }

    if settings["primaryBackupMethod"].as_str().is_some_and(|method| {
        !matches!(method, "" | "local" | "github")
    }) {
        return true;
    }

    if [
        "primaryModel", "editorModel", "placeholderModel", "completionModel",
        "markDescModel", "commitModel", "embeddingModel", "rerankingModel",
        "imageMethodModel", "audioModel", "sttModel",
    ].iter().any(|key| settings[*key].as_str().is_some_and(|model| {
        !model.trim().is_empty() && !BUILTIN_MODELS.contains(&model)
            && !model.strip_prefix("note-gen-free-").is_some_and(|id| BUILTIN_MODELS.contains(&id))
    })) {
        return true;
    }

    settings["aiModelList"].as_array().is_some_and(|providers| providers.iter().any(|provider| {
        let key = provider["key"].as_str().unwrap_or_default();
        !BUILTIN_MODELS.contains(&key) && (
            provider["templateSource"].as_str() == Some("custom")
                || ["apiKey", "model", "models", "customHeaders", "proxyURL"]
                    .iter().any(|key| has_value(&provider[*key]))
        )
    }))
}

fn has_workspace_files(path: &Path) -> Result<bool, String> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if !kind.is_dir() || has_workspace_files(&entry.path())? {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn has_database_content(path: &Path) -> Result<bool, sqlx::Error> {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let mut db = SqliteConnection::connect_with(&options).await?;
    let tables: Vec<String> = sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
        .fetch_all(&mut db)
        .await?;

    // These tables hold user content, history or explicit sync connections.
    // Bootstrap rows such as the locked Idea tag are not usage evidence.
    for table in [
        "notes", "marks", "chats", "conversations", "canvases", "memories",
        "knowledge_sources", "activity_events", "self_hosted_sync_profiles",
    ] {
        if tables.iter().any(|name| name == table)
            && sqlx::query_scalar::<_, i64>(&format!("SELECT EXISTS(SELECT 1 FROM {table})"))
                .fetch_one(&mut db).await? != 0
        {
            return Ok(true);
        }
    }
    if tables.iter().any(|name| name == "tags") {
        return Ok(sqlx::query_scalar::<_, i64>(
            "SELECT EXISTS(SELECT 1 FROM tags WHERE name IS NOT 'Idea' OR coalesce(isLocked, 0) != 1)",
        ).fetch_one(&mut db).await? != 0);
    }
    Ok(false)
}

fn has_existing_data(data_dir: &Path, config_dir: &Path, settings: &Value) -> Result<bool, String> {
    if has_user_settings(settings) || has_workspace_files(&data_dir.join("article"))? {
        return Ok(true);
    }
    let mut paths = vec![config_dir.join("note.db")];
    if config_dir != data_dir {
        paths.push(data_dir.join("note.db"));
    }
    for path in paths {
        if !path.try_exists().map_err(|error| error.to_string())? {
            continue;
        }
        let check = has_database_content(&path);
        let result = if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            tokio::task::block_in_place(|| runtime.block_on(check))
        } else {
            tauri::async_runtime::block_on(check)
        };
        if result.map_err(|error| error.to_string())? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn read_json(path: &Path) -> Result<Value, String> {
    match fs::read(path) {
        Ok(contents) => serde_json::from_slice(&contents).map_err(|error| error.to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Value::Null),
        Err(error) => Err(error.to_string()),
    }
}

fn welcome_state(existing: bool) -> Value {
    json!({
        "schemaVersion": 1,
        "status": if existing { "existing-user" } else { "pending" },
        "step": "welcome",
        "isNewInstallation": !existing,
    })
}

fn apply_requested_data_reset(app: &AppHandle, data_dir: &Path, config_dir: &Path) -> Result<(), String> {
    let setup = app.store(INITIAL_SETUP_FILE).map_err(|error| error.to_string())?;
    let settings = app.store("store.json").map_err(|error| error.to_string())?;

    // Consume the request before touching data. If startup cannot finish the
    // reset, a subsequent launch must not erase data created after that failure.
    setup.delete("localDataResetRequested");
    setup.save().map_err(|error| error.to_string())?;

    crate::database_recovery::remove_local_database_files(config_dir)?;
    if config_dir != data_dir {
        crate::database_recovery::remove_local_database_files(data_dir)?;
    }
    settings.clear();
    settings.set("primaryBackupMethod", json!("local"));
    settings.save().map_err(|error| error.to_string())?;

    setup.set("state", welcome_state(false));
    setup.save().map_err(|error| error.to_string())
}

/// Decide whether to show the guide before normal startup writes defaults.
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let saved = read_json(&data_dir.join(INITIAL_SETUP_FILE))?;
    if saved["localDataResetRequested"].as_bool() == Some(true) {
        return apply_requested_data_reset(app, &data_dir, &config_dir);
    }

    let previous = &saved["state"];
    let status = previous["status"].as_str();
    let pending = previous["schemaVersion"].as_u64() == Some(1)
        && status == Some("pending")
        && previous["isNewInstallation"].as_bool() == Some(true)
        && matches!(
            previous["step"].as_str(),
            Some("welcome" | "workspace" | "model" | "knowledge" | "sync")
        );
    let existing = read_json(&data_dir.join("store.json")).and_then(|settings| {
        if !settings.is_null() && !settings.is_object() {
            return Err("Settings are not a JSON object".into());
        }
        if settings["initialSetupDismissed"].as_bool() == Some(true) {
            return Ok(true);
        }
        // Workspace and provider settings may have been created by the guide itself.
        if pending {
            return Ok(false);
        }
        has_existing_data(&data_dir, &config_dir, &settings)
    }).unwrap_or_else(|error| {
        eprintln!("Failed to check for existing NoteGen data: {error}");
        true
    });

    if existing && matches!(status, Some("completed" | "skipped" | "existing-user")) {
        return Ok(());
    }

    let resume = !existing && pending;
    if !resume {
        let store = app.store(INITIAL_SETUP_FILE).map_err(|error| error.to_string())?;
        store.set("state", welcome_state(existing));
        store.save().map_err(|error| error.to_string())?;
    }

    if !existing {
        let settings = app.store("store.json").map_err(|error| error.to_string())?;
        if !resume || settings.get("primaryBackupMethod").is_none() {
            settings.set("primaryBackupMethod", json!("local"));
            settings.save().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}
