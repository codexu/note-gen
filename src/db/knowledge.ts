import { db, executeRecordTransaction, getDb } from './index'
import { initVectorDb } from './vector'
import { ensureSourceRevisions } from './bm25-source-revisions'
import { initTagsDb } from './tags'
import type {
  KnowledgeIndexStatus,
  KnowledgeLocator,
  KnowledgeSource,
  KnowledgeSourceType,
} from '@/types/knowledge'

interface KnowledgeSourceRow {
  source_key: string
  source_type: KnowledgeSourceType
  source_id: string
  title: string
  locator: string
  content_hash: string
  indexed_hash?: string | null
  status: KnowledgeIndexStatus
  error?: string | null
  updated_at: number
}

function rowToSource(row: KnowledgeSourceRow): KnowledgeSource {
  let locator: KnowledgeLocator = {}
  try {
    locator = JSON.parse(row.locator) as KnowledgeLocator
  } catch {
    locator = {}
  }
  return {
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    locator,
    contentHash: row.content_hash,
    indexedHash: row.indexed_hash,
    status: row.status,
    error: row.error,
    updatedAt: row.updated_at,
  }
}

type KnowledgeDatabase = Awaited<ReturnType<typeof getDb>>
const knowledgeSchemas = new WeakMap<KnowledgeDatabase, Promise<void>>()

export async function initKnowledgeDb() {
  const connection = await getDb()
  let ready = knowledgeSchemas.get(connection)
  if (!ready) {
    ready = initializeKnowledgeSchema(connection).catch(error => {
      knowledgeSchemas.delete(connection)
      throw error
    })
    knowledgeSchemas.set(connection, ready)
  }
  return ready
}

async function initializeKnowledgeSchema(db: KnowledgeDatabase) {
  await initVectorDb()
  await db.execute(`
    create table if not exists knowledge_sources (
      source_key text primary key,
      source_type text not null,
      source_id text not null,
      title text not null,
      locator text not null default '{}',
      content_hash text not null,
      indexed_hash text default null,
      status text not null default 'pending',
      error text default null,
      updated_at integer not null,
      unique(source_type, source_id)
    )
  `)
  await db.execute(`
    create index if not exists idx_knowledge_sources_type_status
    on knowledge_sources(source_type, status)
  `)

  await db.execute(`create table if not exists canvas_knowledge_checkpoints (
    source_key text primary key references knowledge_sources(source_key) on delete cascade,
    revision text not null, content_hash text not null)`)

  await Promise.all([ensureSourceRevisions(), initTagsDb()])
  const journal = await db.select<{ name: string }[]>(
    "select name from sqlite_master where type = 'trigger' and name = 'knowledge_tag_renamed_v1'",
  )
  if (!journal.length) {
    // Persist one entry per changed source. Triggers share the source write's
    // transaction across windows, including writes made by imports and plugins.
    const statements = ['create table if not exists knowledge_source_changes (source_key text primary key, revision text not null)']
    for (const action of ['insert', 'update', 'delete']) {
      const row = action === 'delete' ? 'old' : 'new'
      const revision = action === 'delete' ? 'hex(randomblob(16))' : 'new.revision'
      statements.push(`create trigger if not exists knowledge_revision_${action} after ${action} on bm25_source_revisions begin
        insert into knowledge_source_changes (source_key, revision) values (${row}.source_key, ${revision})
        on conflict(source_key) do update set revision = excluded.revision; end`)
    }
    // A tag name contributes to record content and determines its ancestor tag scopes.
    statements.push(`create trigger if not exists knowledge_tag_renamed_v1 after update of name on tags
      when old.name <> new.name begin
        update bm25_source_revisions set revision = hex(randomblob(16)) where source_key in (
          select 'record:' || id from marks where tagId = new.id and deleted = 0
          union all select 'record:' || t.markId from record_tag_metadata t
            where exists (select 1 from json_each(t.tagIds) where value = new.id)
        );
      end`)
    statements.push(`insert or ignore into knowledge_source_changes (source_key, revision)
      select r.source_key, r.revision from bm25_source_revisions r
      where not exists (select 1 from knowledge_sources k where k.source_key = r.source_key)`)
    await executeRecordTransaction(statements.map(sql => ({ sql, values: [] })))
  }

  const legacyArticles = await db.select<Array<{ filename: string; updated_at: number }>>(`
    select filename, max(updated_at) as updated_at
    from vector_documents
    where filename like 'article:%'
    group by filename
  `)
  for (const article of legacyArticles) {
    const sourceId = article.filename.slice('article:'.length)
    const migrationHash = `migrated:${article.updated_at}`
    await db.execute(
      `insert into knowledge_sources
        (source_key, source_type, source_id, title, locator, content_hash, indexed_hash, status, updated_at)
       values ($1, 'article', $2, $3, $4, $5, $5, 'ready', $6)
       on conflict(source_key) do nothing`,
      [
        article.filename,
        sourceId,
        sourceId.split('/').pop() || sourceId,
        JSON.stringify({ filePath: sourceId }),
        migrationHash,
        article.updated_at,
      ]
    )
  }
}

export async function upsertKnowledgeSource(source: KnowledgeSource, sourceRevision?: string) {
  // Comparing the durable revision in the write prevents a slower read from
  // publishing an earlier edit or resurrecting a source deleted in another window.
  const live = source.sourceType === 'record'
    ? 'exists (select 1 from marks where id = $3 and deleted = 0)'
    : 'exists (select 1 from canvases where id = $3 and updatedAt = $10 and deletedAt is null)'
  const current = `exists (select 1 from bm25_source_revisions where source_key = $1 and revision = $11) and ${live}`
  const sql = `insert into knowledge_sources
      (source_key, source_type, source_id, title, locator, content_hash, indexed_hash, status, error, updated_at)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 ${sourceRevision ? `where ${current}` : ''}
     on conflict(source_key) do update set
       source_type = excluded.source_type,
       source_id = excluded.source_id,
       title = excluded.title,
       locator = excluded.locator,
       content_hash = excluded.content_hash,
       indexed_hash = excluded.indexed_hash,
       status = excluded.status,
       error = excluded.error,
       updated_at = excluded.updated_at`
  const values = [
    source.sourceKey,
    source.sourceType,
    source.sourceId,
    source.title,
    JSON.stringify(source.locator),
    source.contentHash,
    source.indexedHash || null,
    source.status,
    source.error || null,
    source.updatedAt,
  ]
  if (!sourceRevision) {
    await db.execute(sql, values)
    return
  }
  await executeRecordTransaction([
    { sql, values: [...values, sourceRevision] },
    { sql: `delete from knowledge_source_changes where source_key = $1 and revision = $11 and ${current}`,
      values: [...values, sourceRevision] },
    ...(source.sourceType === 'canvas' ? [{ sql: `insert into canvas_knowledge_checkpoints (source_key, revision, content_hash)
        select r.source_key, r.revision, k.content_hash from bm25_source_revisions r
        join knowledge_sources k on k.source_key = r.source_key join canvases c on c.id = k.source_id
        where r.source_key = $1 and r.revision = $2 and k.content_hash = $3 and c.updatedAt = $4 and c.deletedAt is null
        on conflict(source_key) do update set revision = excluded.revision, content_hash = excluded.content_hash`,
      values: [source.sourceKey, sourceRevision, source.contentHash, source.updatedAt] }] : []),
  ])
}

export async function listStructuredKnowledgeChanges(types: readonly KnowledgeSourceType[]) {
  const predicates = []
  if (types.includes('record')) predicates.push("source_key glob 'record:*'")
  if (types.includes('canvas')) predicates.push("source_key glob 'canvas:*'")
  if (!predicates.length) return []
  await initKnowledgeDb()
  return db.select<Array<{ sourceKey: string; revision: string }>>(
    `select source_key as sourceKey, revision from knowledge_source_changes where ${predicates.join(' or ')}`,
  )
}

export async function acknowledgeStructuredKnowledgeChange(sourceKey: string, revision: string) {
  await db.execute('delete from knowledge_source_changes where source_key = $1 and revision = $2', [sourceKey, revision])
}

/** A delayed delete must not erase a concurrently restored or re-created source. */
export async function removeDeletedStructuredKnowledgeSource(sourceKey: string) {
  const record = sourceKey.startsWith('record:')
  const sourceId = sourceKey.slice(sourceKey.indexOf(':') + 1)
  const absent = record
    ? 'not exists (select 1 from marks where id = $2 and deleted = 0)'
    : 'not exists (select 1 from canvases where id = $2 and deletedAt is null)'
  await executeRecordTransaction([
    { sql: `delete from vector_documents where filename = $1 and ${absent}`, values: [sourceKey, sourceId] },
    { sql: `delete from knowledge_sources where source_key = $1 and ${absent}`, values: [sourceKey, sourceId] },
  ])
}

export async function getCanvasRegistryInventory() {
  const canvas = await db.select<{ id: string }[]>('select id from canvases where deletedAt is null limit 1')
  if (!canvas.length) return []
  await ensureSourceRevisions()
  return db.select<Array<{ sourceKey: string; revision: string; registered: number; status: KnowledgeIndexStatus | null }>>(`
    select r.source_key as sourceKey, r.revision, k.status,
      coalesce(p.revision = r.revision and p.content_hash = k.content_hash and c.updatedAt = k.updated_at, 0) as registered
    from canvases c join bm25_source_revisions r on r.source_key = 'canvas:' || c.id
    left join knowledge_sources k on k.source_key = r.source_key
    left join canvas_knowledge_checkpoints p on p.source_key = r.source_key where c.deletedAt is null
  `)
}

// Wiki discovery only registers an original. Vector indexing owns indexed_hash, status and error.
export async function registerArticleKnowledgeSource(filePath: string, title: string, contentHash: string, updatedAt: number) {
  await db.execute(`insert into knowledge_sources
    (source_key, source_type, source_id, title, locator, content_hash, status, updated_at)
    values ($1, 'article', $2, $3, $4, $5, 'pending', $6)
    on conflict(source_key) do update set title=excluded.title, locator=excluded.locator,
      content_hash=excluded.content_hash, updated_at=excluded.updated_at`,
  [`article:${filePath}`, filePath, title, JSON.stringify({ filePath }), contentHash, updatedAt])
}

export async function getKnowledgeSource(sourceKey: string): Promise<KnowledgeSource | null> {
  await initKnowledgeDb()
  const rows = await db.select<KnowledgeSourceRow[]>(
    'select * from knowledge_sources where source_key = $1 limit 1',
    [sourceKey]
  )
  return rows[0] ? rowToSource(rows[0]) : null
}

export async function getKnowledgeSources(options: {
  sourceTypes?: readonly KnowledgeSourceType[]
  statuses?: readonly KnowledgeIndexStatus[]
} = {}): Promise<KnowledgeSource[]> {
  await initKnowledgeDb()
  const clauses: string[] = []
  const values: string[] = []
  if (options.sourceTypes?.length) {
    clauses.push(`source_type in (${options.sourceTypes.map((_, index) => `$${values.length + index + 1}`).join(', ')})`)
    values.push(...options.sourceTypes)
  }
  if (options.statuses?.length) {
    clauses.push(`status in (${options.statuses.map((_, index) => `$${values.length + index + 1}`).join(', ')})`)
    values.push(...options.statuses)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  const rows = await db.select<KnowledgeSourceRow[]>(
    `select * from knowledge_sources ${where} order by updated_at desc`,
    values
  )
  return rows.map(rowToSource)
}

export async function updateKnowledgeSourceIndexState(
  sourceKey: string,
  update: {
    status: KnowledgeIndexStatus
    indexedHash?: string | null
    error?: string | null
  }
) {
  await db.execute(
    `update knowledge_sources
     set status = $1, indexed_hash = $2, error = $3
     where source_key = $4`,
    [update.status, update.indexedHash ?? null, update.error ?? null, sourceKey]
  )
}

export async function deleteKnowledgeSource(sourceKey: string) {
  await db.execute('delete from knowledge_sources where source_key = $1', [sourceKey])
}

export async function getKnowledgeIndexStats() {
  const rows = await db.select<Array<{
    source_type: KnowledgeSourceType
    status: KnowledgeIndexStatus
    count: number
  }>>(`
    select source_type, status, count(*) as count
    from knowledge_sources
    group by source_type, status
  `)
  const result: Record<KnowledgeSourceType, Record<KnowledgeIndexStatus, number>> = {
    article: { pending: 0, indexing: 0, ready: 0, failed: 0 },
    record: { pending: 0, indexing: 0, ready: 0, failed: 0 },
    canvas: { pending: 0, indexing: 0, ready: 0, failed: 0 },
  }
  for (const row of rows) result[row.source_type][row.status] = Number(row.count)
  return result
}
