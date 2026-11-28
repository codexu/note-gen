use serde::Deserialize;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::collections::HashMap;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct ChunkDefinition {
    content: String,
    length: u32,
    terms: HashMap<String, u32>,
}

#[tauri::command]
pub async fn replace_bm25_source(
    databases: State<'_, DbInstances>,
    workspace: String,
    generation: i64,
    source_key: String,
    signature: String,
    expected_signature: Option<String>,
    definitions: Vec<ChunkDefinition>,
    ordinals: Vec<usize>,
) -> Result<bool, String> {
    let pool = match databases.0.read().await.get("sqlite:bm25.db") {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("BM25 database is not loaded".into()),
    };
    let total_length = ordinals
        .iter()
        .try_fold(0_i64, |n, &id| {
            definitions.get(id).map(|d| n + i64::from(d.length))
        })
        .ok_or("Invalid BM25 chunk reference")?;
    write_source(
        &pool,
        &workspace,
        generation,
        &source_key,
        &signature,
        expected_signature.as_deref(),
        definitions,
        &ordinals,
        total_length,
    )
    .await
    .map_err(|e| e.to_string())
}

async fn write_source(
    pool: &SqlitePool,
    workspace: &str,
    generation: i64,
    name: &str,
    signature: &str,
    expected: Option<&str>,
    definitions: Vec<ChunkDefinition>,
    ordinals: &[usize],
    length: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Acquiring the writer lock and comparing signatures in the first statement
    // prevents an older scan from overwriting an edit or a workspace reset.
    let id: Option<i64> = sqlx::query_scalar(
        "UPDATE workspaces SET revision = revision + 1
        WHERE name = ? AND generation = ? AND
        (SELECT signature FROM sources WHERE workspace = workspaces.id AND name = ?) IS ?
        RETURNING id",
    )
    .bind(workspace)
    .bind(generation)
    .bind(name)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(id) = id else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("DELETE FROM sources WHERE workspace = ? AND name = ?")
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    let source: i64 = sqlx::query_scalar(
        "INSERT INTO sources(workspace,name,signature,chunk_count,term_count)
        VALUES(?,?,?,?,?) RETURNING id",
    )
    .bind(id)
    .bind(name)
    .bind(signature)
    .bind(ordinals.len() as i64)
    .bind(length)
    .fetch_one(&mut *tx)
    .await?;

    // Only the distinct text and term maps cross the bridge. Expand occurrences
    // inside this transaction, keeping the existing disk format and ordinal IDs.
    sqlx::query("CREATE TEMP TABLE IF NOT EXISTS bm25_defs
        (id INTEGER PRIMARY KEY, content TEXT NOT NULL, length INTEGER NOT NULL, terms TEXT NOT NULL)")
        .execute(&mut *tx).await?;
    sqlx::query(
        "CREATE TEMP TABLE IF NOT EXISTS bm25_occurrences
        (ordinal INTEGER PRIMARY KEY, def INTEGER NOT NULL, chunk INTEGER)",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS temp.bm25_by_def ON bm25_occurrences(def)")
        .execute(&mut *tx)
        .await?;
    for (batch, defs) in definitions.chunks(200).enumerate() {
        let mut insert = QueryBuilder::<Sqlite>::new("INSERT INTO temp.bm25_defs ");
        insert.push_values(defs.iter().enumerate(), |mut row, (i, def)| {
            row.push_bind((batch * 200 + i) as i64)
                .push_bind(&def.content)
                .push_bind(i64::from(def.length))
                .push_bind(sqlx::types::Json(&def.terms));
        });
        insert.build().execute(&mut *tx).await?;
    }
    sqlx::query(
        "INSERT INTO temp.bm25_occurrences(ordinal, def) SELECT key,value FROM json_each(?)",
    )
    .bind(sqlx::types::Json(ordinals))
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO chunks(source,ordinal,length)
        SELECT ?,o.ordinal,d.length FROM temp.bm25_occurrences o JOIN temp.bm25_defs d ON d.id=o.def ORDER BY o.ordinal")
        .bind(source).execute(&mut *tx).await?;
    sqlx::query("UPDATE temp.bm25_occurrences SET chunk=(SELECT id FROM chunks WHERE source=? AND ordinal=bm25_occurrences.ordinal)")
        .bind(source).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO bodies(chunk,content)
        SELECT o.chunk,d.content FROM temp.bm25_occurrences o JOIN temp.bm25_defs d ON d.id=o.def",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO postings(workspace,term,chunk,frequency)
        SELECT ?,t.key,o.chunk,t.value FROM temp.bm25_defs d CROSS JOIN json_each(d.terms) t
        CROSS JOIN temp.bm25_occurrences o WHERE o.def=d.id",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM temp.bm25_defs")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM temp.bm25_occurrences")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}
