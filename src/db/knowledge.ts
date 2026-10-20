import { db } from './index'
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

export async function initKnowledgeDb() {
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

export async function upsertKnowledgeSource(source: KnowledgeSource) {
  await db.execute(
    `insert into knowledge_sources
      (source_key, source_type, source_id, title, locator, content_hash, indexed_hash, status, error, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict(source_key) do update set
       source_type = excluded.source_type,
       source_id = excluded.source_id,
       title = excluded.title,
       locator = excluded.locator,
       content_hash = excluded.content_hash,
       indexed_hash = excluded.indexed_hash,
       status = excluded.status,
       error = excluded.error,
       updated_at = excluded.updated_at`,
    [
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
  )
}

export async function getKnowledgeSource(sourceKey: string): Promise<KnowledgeSource | null> {
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
