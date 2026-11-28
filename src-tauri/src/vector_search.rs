use crate::record_transaction::record_database_pool;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool, TypeInfo, ValueRef};
use tauri::State;
use tauri_plugin_sql::DbInstances;

// SQLite keeps the storage class on each value, including BLOBs in existing TEXT columns.
fn is_binary(row: &SqliteRow) -> bool {
    row.try_get_raw("embedding")
        .expect("embedding column")
        .type_info()
        .name()
        == "BLOB"
}

fn encode_embedding(values: &[f64]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn binary_values(bytes: &[u8]) -> impl ExactSizeIterator<Item = f64> + '_ {
    bytes
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
}

#[derive(Deserialize, Serialize)]
pub struct VectorDocument {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<i64>,
    filename: String,
    chunk_id: i64,
    content: String,
    embedding: String,
    // Sync snapshots accept JS timestamps with fractional milliseconds.
    updated_at: f64,
}

// Snapshots and clients copying an article still exchange JSON embeddings.
#[tauri::command]
pub async fn read_vector_documents(
    databases: State<'_, DbInstances>,
    filename: Option<String>,
) -> Result<Vec<VectorDocument>, String> {
    let pool = record_database_pool(&databases).await?;
    let with_id = filename.is_some();
    let query = match filename {
        Some(key) => sqlx::query("SELECT id, filename, chunk_id, content, embedding, CAST(updated_at AS REAL) AS updated_at FROM vector_documents WHERE filename = ? ORDER BY chunk_id").bind(key),
        None => sqlx::query("SELECT id, filename, chunk_id, content, embedding, CAST(updated_at AS REAL) AS updated_at FROM vector_documents ORDER BY filename, chunk_id"),
    };
    let mut rows = query.fetch(&pool);
    let mut documents = Vec::new();
    while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
        let embedding = if is_binary(&row) {
            let bytes: &[u8] = row.get("embedding");
            if bytes.len() % 8 != 0 {
                return Err("Invalid binary embedding length".into());
            }
            let values: Vec<f64> = binary_values(bytes).collect();
            if values.iter().any(|n| !n.is_finite()) {
                return Err("Invalid binary embedding value".into());
            }
            serde_json::to_string(&values).map_err(|e| e.to_string())?
        } else {
            row.try_get("embedding").map_err(|e| e.to_string())?
        };
        documents.push(VectorDocument {
            id: with_id.then(|| row.get("id")),
            filename: row.get("filename"),
            chunk_id: row.get("chunk_id"),
            content: row.get("content"),
            embedding,
            updated_at: row.get("updated_at"),
        });
    }
    Ok(documents)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VectorWrite {
    Upsert,
    ReplaceFile(String),
    ReplaceAll,
}

#[tauri::command]
pub async fn write_vector_documents(
    databases: State<'_, DbInstances>,
    operation: VectorWrite,
    documents: Vec<VectorDocument>,
) -> Result<(), String> {
    let pool = record_database_pool(&databases).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let delete = match &operation {
        VectorWrite::ReplaceAll => Some(sqlx::query("DELETE FROM vector_documents")),
        VectorWrite::ReplaceFile(key) => {
            Some(sqlx::query("DELETE FROM vector_documents WHERE filename = ?").bind(key))
        }
        VectorWrite::Upsert => None,
    };
    if let Some(query) = delete {
        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    let insert = if matches!(operation, VectorWrite::Upsert) {
        "INSERT INTO vector_documents(filename, chunk_id, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(filename, chunk_id) DO UPDATE SET content=excluded.content, embedding=excluded.embedding, updated_at=excluded.updated_at"
    } else {
        "INSERT INTO vector_documents(filename, chunk_id, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?)"
    };
    for doc in documents {
        let filename = match &operation {
            VectorWrite::ReplaceFile(key) => key,
            _ => &doc.filename,
        };
        let query = sqlx::query(insert)
            .bind(filename)
            .bind(doc.chunk_id)
            .bind(doc.content);
        let query = match serde_json::from_str::<Vec<f64>>(&doc.embedding) {
            Ok(values) => query.bind(encode_embedding(&values)),
            // Preserve opaque legacy data when restoring a snapshot. Search skips unreadable rows.
            Err(_) => query.bind(doc.embedding),
        };
        query
            .bind(doc.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

fn cosine(
    query: &[f64],
    query_norm: f64,
    values: impl ExactSizeIterator<Item = f64>,
) -> Result<f64, String> {
    if values.len() != query.len() {
        return Err("向量维度不匹配".into());
    }
    let mut dot = 0.0;
    let mut norm = 0.0;
    for (value, q) in values.zip(query) {
        dot += value * q;
        norm += value * value;
    }
    Ok(if query_norm == 0.0 || norm == 0.0 {
        0.0
    } else {
        dot / (query_norm * norm.sqrt())
    })
}

struct LegacyEmbedding {
    id: i64,
    json: String,
    binary: Vec<u8>,
}

// Migrate only rows already decoded for a real query, with one bounded writer for all windows.
static MIGRATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const MAX_MIGRATION_ROWS: usize = 64;
const MAX_MIGRATION_BYTES: usize = 1024 * 1024;

async fn migrate_embeddings(
    pool: SqlitePool,
    entries: Vec<LegacyEmbedding>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for entry in entries {
        // A concurrent edit or a completed migration must win over this earlier read snapshot.
        sqlx::query("UPDATE vector_documents SET embedding = ? WHERE id = ? AND typeof(embedding) = 'text' AND embedding = ?")
            .bind(entry.binary).bind(entry.id).bind(entry.json).execute(&mut *tx).await?;
    }
    tx.commit().await
}

#[derive(Serialize)]
pub struct SimilarVectorDocument {
    id: i64,
    filename: String,
    chunk_id: i64,
    content: String,
    similarity: f64,
}

#[tauri::command]
pub async fn search_vector_documents(
    databases: State<'_, DbInstances>,
    query_embedding: Vec<f64>,
    limit: usize,
    threshold: f64,
    filenames: Option<Vec<String>>,
) -> Result<Vec<SimilarVectorDocument>, String> {
    if limit == 0 || filenames.as_ref().is_some_and(Vec::is_empty) {
        return Ok(Vec::new());
    }
    let pool = record_database_pool(&databases).await?;
    // Rank embeddings and read their winning text from the same SQLite snapshot.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let query = match filenames {
        Some(keys) => sqlx::query("SELECT id, embedding FROM vector_documents WHERE filename IN (SELECT value FROM json_each(?))")
            .bind(serde_json::to_string(&keys).map_err(|e| e.to_string())?),
        None => sqlx::query("SELECT id, embedding FROM vector_documents"),
    };
    let query_norm = query_embedding.iter().map(|n| n * n).sum::<f64>().sqrt();
    let mut best: Vec<(i64, f64)> = Vec::new();
    let permit = MIGRATION.try_lock().ok();
    let mut migration = Vec::new();
    let mut migration_bytes = 0;
    let mut rows = query.fetch(&mut *tx);
    while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
        let id = row.get::<i64, _>("id");
        let score = if is_binary(&row) {
            let blob: &[u8] = row.get("embedding");
            if blob.len() % 8 != 0 {
                continue;
            }
            cosine(&query_embedding, query_norm, binary_values(blob))?
        } else {
            let Ok(text) = row.try_get::<&str, _>("embedding") else {
                continue;
            };
            let Ok(values) = serde_json::from_str::<Vec<f64>>(text) else {
                continue;
            };
            let score = cosine(&query_embedding, query_norm, values.iter().copied())?;
            let size = text.len() + 8 * values.len();
            if permit.is_some()
                && migration.len() < MAX_MIGRATION_ROWS
                && migration_bytes + size <= MAX_MIGRATION_BYTES
            {
                migration_bytes += size;
                migration.push(LegacyEmbedding {
                    id,
                    json: text.to_owned(),
                    binary: encode_embedding(&values),
                });
            }
            score
        };
        if !score.is_finite() || score < threshold {
            continue;
        }
        let at = best.partition_point(|&(other_id, other_score)| {
            other_score > score || (other_score == score && other_id < id)
        });
        if at < limit {
            best.insert(at, (id, score));
            best.truncate(limit);
        }
    }
    drop(rows);
    // json_each preserves the positions in the ranked list. Only these bodies cross the bridge.
    let ids: Vec<_> = best.iter().map(|&(id, _)| id).collect();
    let rows = sqlx::query("SELECT v.id, v.filename, v.chunk_id, v.content, hit.key AS rank FROM json_each(?) hit JOIN vector_documents v ON v.id = hit.value ORDER BY hit.key")
        .bind(serde_json::to_string(&ids).map_err(|e| e.to_string())?)
        .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let result = rows
        .iter()
        .map(|row| SimilarVectorDocument {
            id: row.get("id"),
            filename: row.get("filename"),
            chunk_id: row.get("chunk_id"),
            content: row.get("content"),
            similarity: best[row.get::<i64, _>("rank") as usize].1,
        })
        .collect();
    tx.commit().await.map_err(|e| e.to_string())?;
    if !migration.is_empty() {
        tauri::async_runtime::spawn(async move {
            let _guard = permit;
            // A busy or closed database can retry on a later search. Rankings are already final.
            let _ = migrate_embeddings(pool, migration).await;
        });
    }
    Ok(result)
}
