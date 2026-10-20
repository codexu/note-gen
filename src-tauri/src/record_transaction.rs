use serde::Deserialize;
use serde_json::Value;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatement {
    sql: String,
    values: Vec<Value>,
    expected_rows: Option<u64>,
}

// The SQL plugin otherwise acquires a new pooled connection for each invoke.
// Keep every statement, including trigger effects, on one real transaction.
#[tauri::command]
pub async fn execute_record_transaction(
    databases: State<'_, DbInstances>,
    statements: Vec<RecordStatement>,
) -> Result<(), String> {
    let pool = {
        let instances = databases.0.read().await;
        match instances.get("sqlite:note.db") {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("Record database is not loaded".into()),
        }
    };
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.values {
            query = match value {
                Value::Null => query.bind(None::<String>),
                Value::String(value) => query.bind(value),
                Value::Bool(value) => query.bind(value),
                Value::Number(value) => {
                    if let Some(integer) = value.as_i64() {
                        query.bind(integer)
                    } else {
                        query.bind(value.as_f64().ok_or("Invalid numeric value")?)
                    }
                }
                _ => return Err("Record SQL parameters must be scalar values".into()),
            };
        }
        let result = query.execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        if statement.expected_rows.is_some_and(|expected| expected != result.rows_affected()) {
            return Err("Record tags changed. Reopen the tag editor and try again.".into());
        }
    }
    transaction.commit().await.map_err(|error| error.to_string())
}
