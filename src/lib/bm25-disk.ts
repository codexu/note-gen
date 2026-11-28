import Database from '@tauri-apps/plugin-sql'
import { createBM25ChunkKey } from './bm25'
import { tokenizeLexicalText } from './lexical-tokenizer'

let loading: Promise<Database> | undefined
const writeConflict = 'BM25_SOURCE_CHANGED'

async function openIndex() {
  const db = await Database.load('sqlite:bm25.db')
  // Enable page reclamation for a new cache without vacuuming on each note edit.
  await db.execute('PRAGMA auto_vacuum = INCREMENTAL')
  await db.execute(`CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    generation INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY, workspace INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, signature TEXT NOT NULL, chunk_count INTEGER NOT NULL, term_count INTEGER NOT NULL,
    UNIQUE(workspace, name)
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY, source INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, length INTEGER NOT NULL, UNIQUE(source, ordinal)
  )`)
  // Ranking needs document lengths, but never bodies until LIMIT has been applied.
  await db.execute(`CREATE TABLE IF NOT EXISTS bodies (
    chunk INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE, content TEXT NOT NULL
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS postings (
    workspace INTEGER NOT NULL, term TEXT NOT NULL,
    chunk INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, frequency INTEGER NOT NULL,
    PRIMARY KEY(workspace, term, chunk)
  ) WITHOUT ROWID`)
  await db.execute('CREATE INDEX IF NOT EXISTS postings_by_chunk ON postings(chunk)')
  await db.execute(`CREATE TRIGGER IF NOT EXISTS reset_workspace AFTER UPDATE OF generation ON workspaces BEGIN
    DELETE FROM sources WHERE workspace = NEW.id;
  END`)

  // The plugin uses a connection pool. A single statement and its trigger are one SQLite transaction.
  await db.execute(`CREATE VIEW IF NOT EXISTS source_write (
    workspace_name, generation, source_name, expected_signature, signature, chunks, length
  ) AS SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL WHERE 0`)
  const workspaceId = '(SELECT id FROM workspaces WHERE name = NEW.workspace_name)'
  const sourceId = `(SELECT id FROM sources WHERE workspace = ${workspaceId} AND name = NEW.source_name)`
  const staleGeneration = '(SELECT generation FROM workspaces WHERE name = NEW.workspace_name) IS NOT NEW.generation'
  await db.execute(`CREATE TRIGGER IF NOT EXISTS replace_source INSTEAD OF INSERT ON source_write BEGIN
    SELECT CASE WHEN ${staleGeneration} OR
      (SELECT signature FROM sources WHERE id = ${sourceId}) IS NOT NEW.expected_signature
      THEN RAISE(ABORT, '${writeConflict}') END;

    DELETE FROM sources WHERE id = ${sourceId};
    INSERT INTO sources(workspace, name, signature, chunk_count, term_count)
      VALUES(${workspaceId}, NEW.source_name, NEW.signature, json_array_length(NEW.chunks), NEW.length);
    INSERT INTO chunks(source, ordinal, length)
      SELECT ${sourceId}, d.key, json_extract(d.value, '$.length') FROM json_each(NEW.chunks) AS d;
    INSERT INTO bodies(chunk, content)
      SELECT c.id, json_extract(d.value, '$.content') FROM json_each(NEW.chunks) AS d
      CROSS JOIN chunks AS c WHERE c.source = ${sourceId} AND c.ordinal = d.key;
    INSERT INTO postings(workspace, term, chunk, frequency)
      SELECT ${workspaceId}, t.key, c.id, t.value FROM json_each(NEW.chunks) AS d
      CROSS JOIN chunks AS c CROSS JOIN json_each(d.value, '$.terms') AS t
      WHERE c.source = ${sourceId} AND c.ordinal = d.key;
    UPDATE workspaces SET revision = revision + 1 WHERE id = ${workspaceId};
  END`)

  await db.execute(`CREATE VIEW IF NOT EXISTS source_removal(workspace_name, generation, signatures)
    AS SELECT NULL, NULL, NULL WHERE 0`)
  await db.execute(`CREATE TRIGGER IF NOT EXISTS remove_sources INSTEAD OF INSERT ON source_removal BEGIN
    SELECT CASE WHEN ${staleGeneration} OR EXISTS (
      SELECT 1 FROM json_each(NEW.signatures) AS old_source
      WHERE (SELECT signature FROM sources WHERE workspace = ${workspaceId} AND name = old_source.key)
        IS NOT old_source.value
    ) THEN RAISE(ABORT, '${writeConflict}') END;
    DELETE FROM sources WHERE workspace = ${workspaceId} AND name IN (SELECT key FROM json_each(NEW.signatures));
    UPDATE workspaces SET revision = revision + 1 WHERE id = ${workspaceId};
  END`)
  return db
}

function database(): Promise<Database> {
  loading ??= openIndex().catch(error => {
    loading = undefined
    throw error
  })
  return loading
}

type CatalogRow = { generation: number; name: string | null; signature: string | null }

export async function readBM25Catalog(workspace: string): Promise<{ generation: number; sources: Map<string, string> }> {
  const db = await database()
  const sql = `SELECT w.generation, s.name, s.signature FROM workspaces AS w
    LEFT JOIN sources AS s ON s.workspace = w.id WHERE w.name = $1`
  let rows = await db.select<CatalogRow[]>(sql, [workspace])
  if (!rows.length) {
    await db.execute('INSERT OR IGNORE INTO workspaces(name) VALUES ($1)', [workspace])
    rows = await db.select<CatalogRow[]>(sql, [workspace])
  }
  const sources = new Map<string, string>()
  for (const row of rows) {
    if (row.name !== null && row.signature !== null) sources.set(row.name, row.signature)
  }
  return { generation: rows[0].generation, sources }
}

async function applySourceChange(sql: string, values: (string | number | null)[]): Promise<boolean> {
  try {
    await (await database()).execute(sql, values)
    return true
  } catch (error) {
    if (String(error).includes(writeConflict)) return false
    throw error
  }
}

export async function replaceBM25Source(
  workspace: string, generation: number, sourceKey: string, signature: string,
  chunks: readonly string[], expectedSignature: string | null,
): Promise<boolean> {
  let length = 0
  const encoded = chunks.map(content => {
    const tokens = tokenizeLexicalText(content)
    const terms: Record<string, number> = Object.create(null)
    for (const token of tokens) terms[token] = (terms[token] ?? 0) + 1
    length += tokens.length
    return { content, length: tokens.length, terms }
  })
  return applySourceChange('INSERT INTO source_write VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [workspace, generation, sourceKey, expectedSignature, signature, JSON.stringify(encoded), length])
}

export async function removeBM25Sources(
  workspace: string, generation: number, obsolete: ReadonlyMap<string, string>,
): Promise<boolean> {
  if (!obsolete.size) return true
  return applySourceChange('INSERT INTO source_removal VALUES ($1, $2, $3)',
    [workspace, generation, JSON.stringify(Object.fromEntries(obsolete))])
}

export async function resetBM25Workspace(workspace: string): Promise<void> {
  const db = await database()
  await db.execute(`INSERT INTO workspaces(name, generation, revision) VALUES ($1, 1, 1)
    ON CONFLICT(name) DO UPDATE SET generation = generation + 1, revision = revision + 1`, [workspace])
  await db.execute('PRAGMA incremental_vacuum')
}

export async function getDiskBM25Stats(workspace: string): Promise<{ documentCount: number; chunkCount: number }> {
  const [stats] = await (await database()).select<{ documentCount: number; chunkCount: number }[]>(`
    SELECT count(*) AS documentCount, coalesce(sum(chunk_count), 0) AS chunkCount FROM sources
    WHERE workspace = (SELECT id FROM workspaces WHERE name = $1) AND chunk_count > 0`, [workspace])
  return stats
}

interface TermFrequency {
  workspace: number
  revision: number
  chunks: number
  length: number
  term: string
  df: number
}

export interface DiskBM25Hit {
  id: string
  content: string
  score: number
}

export async function searchDiskBM25(
  workspace: string, query: string, limit: number, allowedSourceKeys?: ReadonlySet<string>,
): Promise<DiskBM25Hit[]> {
  const terms = Array.from(new Set(tokenizeLexicalText(query)))
  if (!terms.length || !Number.isFinite(limit) || limit < 1 || allowedSourceKeys?.size === 0) return []
  const db = await database()
  const scope = allowedSourceKeys && JSON.stringify(Array.from(allowedSourceKeys))
  // Compute IDF with Math.log, which is available on every platform even if SQLite lacks math functions.
  // A concurrent writer between these two reads invalidates the weights and retries the query.
  while (true) {
    const frequencies = await db.select<TermFrequency[]>(`
      WITH corpus AS (
        SELECT w.id AS workspace, w.revision, coalesce(sum(s.chunk_count), 0) AS chunks,
          coalesce(sum(s.term_count), 0) AS length
        FROM workspaces AS w LEFT JOIN sources AS s ON s.workspace = w.id WHERE w.name = $1 GROUP BY w.id
      )
      SELECT corpus.*, q.value AS term,
        (SELECT count(*) FROM postings AS p WHERE p.workspace = corpus.workspace AND p.term = q.value) AS df
      FROM corpus CROSS JOIN json_each($2) AS q`, [workspace, JSON.stringify(terms)])
    if (!frequencies.length || !frequencies[0].chunks) return []
    const corpus = frequencies[0]
    const weights = frequencies.filter(t => t.df > 0).map(t =>
      [t.term, Math.log1p((corpus.chunks - t.df + 0.5) / (t.df + 0.5))])
    if (!weights.length) return []
    const values: (string | number)[] = [corpus.workspace, corpus.revision, JSON.stringify(weights),
      corpus.length / corpus.chunks || 1, Math.trunc(limit)]
    if (scope !== undefined) values.push(scope)
    const hits = await db.select<{ source: string | null; ordinal: number; content: string; score: number }[]>(`
      WITH ranked AS MATERIALIZED (
        SELECT c.id, sum(json_extract(t.value, '$[1]') * p.frequency * 2.2 /
          (p.frequency + 1.2 * (0.25 + 0.75 * c.length / $4))) AS score
        FROM json_each($3) AS t CROSS JOIN postings AS p CROSS JOIN chunks AS c
        WHERE p.workspace = $1 AND p.term = json_extract(t.value, '$[0]') AND c.id = p.chunk
          AND (SELECT revision FROM workspaces WHERE id = $1) = $2
          ${scope === undefined ? '' : 'AND c.source IN (SELECT id FROM sources WHERE workspace = $1 AND name IN (SELECT value FROM json_each($6)))'}
        GROUP BY c.id ORDER BY score DESC, c.id LIMIT $5
      )
      SELECT s.name AS source, c.ordinal, b.content, ranked.score, ranked.id AS tie FROM ranked
        JOIN chunks AS c ON c.id = ranked.id JOIN sources AS s ON s.id = c.source
        JOIN bodies AS b ON b.chunk = c.id
      UNION ALL SELECT NULL, 0, '', 0, 0 WHERE (SELECT revision FROM workspaces WHERE id = $1) IS NOT $2
      ORDER BY score DESC, tie`, values)
    if (hits.some(hit => hit.source === null)) continue
    return hits.map(hit => ({ id: createBM25ChunkKey(hit.source!, hit.ordinal), score: hit.score, content: hit.content }))
  }
}
