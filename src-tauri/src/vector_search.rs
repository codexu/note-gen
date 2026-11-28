use crate::record_transaction::record_database_pool;
use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::Row;
use tauri::State;
use tauri_plugin_sql::DbInstances;

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
    let mut rows = query.fetch(&mut *tx);
    while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
        let id = row.get::<i64, _>("id");
        let Ok(vector) = serde_json::from_str::<Vec<f64>>(row.get("embedding")) else {
            continue;
        };
        if vector.len() != query_embedding.len() {
            return Err("向量维度不匹配".into());
        }
        let dot: f64 = vector
            .iter()
            .zip(&query_embedding)
            .map(|(a, b)| a * b)
            .sum();
        let norm: f64 = vector.iter().map(|n| n * n).sum::<f64>().sqrt();
        let score = if query_norm == 0.0 || norm == 0.0 {
            0.0
        } else {
            dot / (query_norm * norm)
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
    Ok(result)
}
