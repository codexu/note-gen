import { db, executeRecordTransaction, type RecordStatement } from './index'
import type {
  WikiJob, WikiPage, WikiSegmentCache, WikiSourceRevision,
  WikiSourceState, WikiUsage,
} from '@/types/wiki'

let initialization: Promise<void> | null = null

export function emitWikiUpdated() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('wiki-updated'))
}

export function initWikiDb(): Promise<void> {
  if (!initialization) initialization = (async () => {
    for (const sql of [
      `create table if not exists wiki_sources (context_id text not null, stable_id text not null,
        source_key text not null, content_hash text not null, status text not null, revision_id text,
        version integer not null, payload text not null, primary key(context_id, stable_id))`,
      `create table if not exists wiki_revisions (context_id text not null, id text not null,
        source_id text not null, input_hash text not null, output_hash text not null,
        payload text not null, primary key(context_id, id))`,
      `create index if not exists wiki_revisions_input on wiki_revisions(context_id, input_hash, output_hash)`,
      `create table if not exists wiki_pages (context_id text not null, id text not null,
        kind text not null, status text not null, payload text not null, primary key(context_id, id))`,
      `create table if not exists wiki_jobs (context_id text not null, id text not null,
        status text not null, ready_at integer not null, payload text not null, primary key(context_id, id))`,
      `create table if not exists wiki_segments (context_id text not null, cache_key text not null,
        payload text not null, primary key(context_id, cache_key))`,
      `create table if not exists wiki_meta (context_id text not null, key text not null,
        value text not null, primary key(context_id, key))`,
    ]) await db.execute(sql)
  })().catch(error => { initialization = null; throw error })
  return initialization
}

async function readPayloads<T>(sql: string, values: string[]): Promise<T[]> {
  await initWikiDb()
  const rows = await db.select<Array<{ payload: string }>>(sql, values)
  return rows.flatMap(row => {
    try { return [JSON.parse(row.payload) as T] } catch { return [] }
  })
}

export async function getWikiMeta<T>(contextId: string, key: string): Promise<T | null> {
  await initWikiDb()
  const rows = await db.select<Array<{ value: string }>>(
    'select value from wiki_meta where context_id = $1 and key = $2', [contextId, key])
  try { return rows[0] ? JSON.parse(rows[0].value) as T : null } catch { return null }
}

export async function setWikiMeta<T>(contextId: string, key: string, value: T) {
  await initWikiDb()
  if (key === 'dirty' && value === true) {
    const statement = dirtyStatement(contextId)
    await db.execute(statement.sql, statement.values)
    return
  }
  await db.execute(`insert into wiki_meta(context_id,key,value) values($1,$2,$3)
    on conflict(context_id,key) do update set value=excluded.value`, [contextId, key, JSON.stringify(value)])
}

function dirtyStatement(contextId: string): RecordStatement {
  return { sql: `insert into wiki_meta(context_id,key,value)
    values($1,'dirty','true'),($1,'dirty-version','1')
    on conflict(context_id,key) do update set value=case
      when excluded.key='dirty-version' then cast(cast(wiki_meta.value as integer)+1 as text)
      else excluded.value end`, values: [contextId] }
}

function sourceStatement(state: WikiSourceState): RecordStatement {
  return {
    sql: `insert into wiki_sources(context_id,stable_id,source_key,content_hash,status,revision_id,version,payload)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(context_id,stable_id) do update set
      source_key=excluded.source_key,content_hash=excluded.content_hash,status=excluded.status,
      revision_id=excluded.revision_id,version=excluded.version,payload=excluded.payload`,
    values: [state.contextId, state.stableId, state.sourceKey, state.contentHash, state.status,
      state.revisionId, state.version, JSON.stringify(state)],
  }
}

function revisionStatement(revision: WikiSourceRevision): RecordStatement {
  return { sql: `insert into wiki_revisions(context_id,id,source_id,input_hash,output_hash,payload)
    values($1,$2,$3,$4,$5,$6) on conflict(context_id,id) do nothing`,
  values: [revision.contextId, revision.id, revision.source.stableId, revision.inputHash,
    revision.outputHash, JSON.stringify(revision)] }
}

function pageStatement(page: WikiPage): RecordStatement {
  return { sql: `insert into wiki_pages(context_id,id,kind,status,payload) values($1,$2,$3,$4,$5)
    on conflict(context_id,id) do update set kind=excluded.kind,status=excluded.status,payload=excluded.payload`,
  values: [page.contextId, page.id, page.kind, page.status, JSON.stringify(page)] }
}

export async function getWikiSourceState(contextId: string, stableId: string) {
  return (await readPayloads<WikiSourceState>(
    'select payload from wiki_sources where context_id=$1 and stable_id=$2', [contextId, stableId]))[0] ?? null
}

export function listWikiSourceStates(contextId: string) {
  return readPayloads<WikiSourceState>('select payload from wiki_sources where context_id=$1', [contextId])
}

export async function upsertWikiSourceState(state: WikiSourceState) {
  await initWikiDb()
  await executeRecordTransaction([sourceStatement(state), dirtyStatement(state.contextId)])
  emitWikiUpdated()
}

export async function getWikiRevision(contextId: string, id: string) {
  return (await readPayloads<WikiSourceRevision>(
    'select payload from wiki_revisions where context_id=$1 and id=$2', [contextId, id]))[0] ?? null
}

export async function findWikiRevision(contextId: string, inputHash: string) {
  return (await readPayloads<WikiSourceRevision>(`select payload from wiki_revisions
    where context_id=$1 and input_hash=$2 order by output_hash asc limit 1`, [contextId, inputHash]))[0] ?? null
}

export async function getActiveWikiRevisions(contextId: string) {
  const revisions = await readPayloads<WikiSourceRevision>(`select r.payload from wiki_revisions r join wiki_sources s
    on r.context_id=s.context_id and r.id=s.revision_id
    where s.context_id=$1 and s.status='ready'`, [contextId])
  const sources = new Map((await listWikiSourceStates(contextId)).map(source => [source.stableId, source]))
  return revisions.flatMap(revision => {
    const state = sources.get(revision.source.stableId)
    return state?.status === 'ready' && state.revisionId === revision.id && state.contentHash === revision.source.contentHash
      ? [{ ...revision, source: state.source }] : []
  })
}

/** Persist Markdown first; SQLite stores the disposable projection and job guard. */
export async function commitWikiSourceRevision(
  revision: WikiSourceRevision, pages: WikiPage[], expectedVersion?: number,
): Promise<boolean> {
  await initWikiDb()
  const current = await getWikiSourceState(revision.contextId, revision.source.stableId)
  if (!current || current.contentHash !== revision.source.contentHash
    || ['deleted', 'excluded', 'unavailable'].includes(current.status)
    || (expectedVersion !== undefined && current.version !== expectedVersion)) return false
  const { writeWikiPageFile } = await import('@/lib/wiki/files')
  const persistedPages: WikiPage[] = []
  for (const page of pages) persistedPages.push(await writeWikiPageFile(page, revision))
  const next: WikiSourceState = { ...current, source: revision.source, status: 'ready',
    revisionId: revision.id, version: current.version + 1, updatedAt: Date.now(), error: null }
  try {
    await executeRecordTransaction([
      { sql: `update wiki_sources set revision_id=$1,status='ready',version=$2,payload=$3
          where context_id=$4 and stable_id=$5 and version=$6 and content_hash=$7`,
        values: [revision.id, next.version, JSON.stringify(next), revision.contextId,
          revision.source.stableId, current.version, revision.source.contentHash], expectedRows: 1 },
      revisionStatement(revision), ...persistedPages.map(pageStatement), dirtyStatement(revision.contextId),
    ])
    emitWikiUpdated()
    return true
  } catch (error) {
    // The existing native transaction command reports optimistic conflicts with this legacy text.
    if (error instanceof Error ? /changed|expected.*rows/i.test(error.message) : /changed|expected.*rows/i.test(String(error))) return false
    throw error
  }
}

export async function getWikiPage(contextId: string, id: string) {
  return (await readPayloads<WikiPage>('select payload from wiki_pages where context_id=$1 and id=$2', [contextId, id]))[0] ?? null
}

export function listWikiPages(contextId: string) {
  return readPayloads<WikiPage>('select payload from wiki_pages where context_id=$1', [contextId])
}

export async function upsertWikiPage(page: WikiPage) {
  await initWikiDb()
  const { writeWikiPageFile } = await import('@/lib/wiki/files')
  page = await writeWikiPageFile(page)
  await executeRecordTransaction([pageStatement(page), dirtyStatement(page.contextId)])
  emitWikiUpdated()
}

export function listWikiJobs(contextId: string) {
  return readPayloads<WikiJob>('select payload from wiki_jobs where context_id=$1 order by ready_at', [contextId])
}

export async function upsertWikiJob(job: WikiJob) {
  await initWikiDb()
  await db.execute(`insert into wiki_jobs(context_id,id,status,ready_at,payload) values($1,$2,$3,$4,$5)
    on conflict(context_id,id) do update set status=excluded.status,ready_at=excluded.ready_at,payload=excluded.payload`,
  [job.contextId, job.id, job.status, job.readyAt, JSON.stringify(job)])
  emitWikiUpdated()
}

export async function removeWikiJob(contextId: string, id: string, expectedInputHash?: string) {
  await initWikiDb()
  if (expectedInputHash !== undefined) {
    const current = (await readPayloads<WikiJob>('select payload from wiki_jobs where context_id=$1 and id=$2', [contextId, id]))[0]
    if (!current || current.inputHash !== expectedInputHash) return
    await db.execute('delete from wiki_jobs where context_id=$1 and id=$2 and payload=$3', [contextId, id, JSON.stringify(current)])
  } else await db.execute('delete from wiki_jobs where context_id=$1 and id=$2', [contextId, id])
  emitWikiUpdated()
}

export async function getWikiSegmentCache(contextId: string, key: string) {
  return (await readPayloads<WikiSegmentCache>(
    'select payload from wiki_segments where context_id=$1 and cache_key=$2', [contextId, key]))[0] ?? null
}

export async function saveWikiSegmentCache(contextId: string, key: string, value: WikiSegmentCache) {
  await initWikiDb()
  await db.execute(`insert into wiki_segments(context_id,cache_key,payload) values($1,$2,$3)
    on conflict(context_id,cache_key) do update set payload=excluded.payload`, [contextId, key, JSON.stringify(value)])
}

let usageQueue: Promise<void> = Promise.resolve()
export function recordWikiUsage(contextId: string, usage: WikiUsage): Promise<void> {
  const update = async () => {
    const current = await getWikiUsage(contextId)
    await setWikiMeta(contextId, 'usage', {
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      estimated: current.estimated || usage.estimated,
    })
    emitWikiUpdated()
  }
  usageQueue = usageQueue.then(update, update)
  return usageQueue
}

export async function getWikiUsage(contextId: string): Promise<WikiUsage> {
  return await getWikiMeta<WikiUsage>(contextId, 'usage')
    ?? { inputTokens: 0, outputTokens: 0, estimated: false }
}

export async function getWikiSyncDirty(contextId: string) {
  return await getWikiMeta<boolean>(contextId, 'dirty') ?? false
}

export async function markWikiSynced(contextId: string, expectedVersion?: number) {
  const version = expectedVersion ?? await getWikiMeta<number>(contextId, 'dirty-version') ?? 0
  await db.execute(`update wiki_meta set value='false' where context_id=$1 and key='dirty'
    and coalesce((select cast(value as integer) from wiki_meta where context_id=$1 and key='dirty-version'),0)=$2`,
  [contextId, version])
}

/** Cache a parsed Markdown document. This must never write back to the file. */
export async function cacheWikiMarkdownDocument(
  page: WikiPage, revision?: WikiSourceRevision, originalAvailable = true,
): Promise<WikiSourceState | null> {
  await initWikiDb()
  const previous = await getWikiPage(page.contextId, page.id)
  const statements: RecordStatement[] = []
  let sourceState: WikiSourceState | null = null
  if (JSON.stringify(previous) !== JSON.stringify(page)) statements.push(pageStatement(page))
  if (revision) {
    if (!await getWikiRevision(page.contextId, revision.id)) statements.push(revisionStatement(revision))
    const current = await getWikiSourceState(page.contextId, revision.source.stableId)
    sourceState = current
    // A newer local source save takes precedence over an older synchronized Wiki.
    const hasNewerSource = current && current.contentHash !== revision.source.contentHash
      && ['pending', 'processing', 'failed'].includes(current.status)
    const localJob = current && ['pending', 'failed'].includes(current.status)
      ? (await readPayloads<WikiJob>('select payload from wiki_jobs where context_id=$1 and id=$2',
        [page.contextId, `source:${revision.source.stableId}`]))[0] : null
    const guarded = current?.status === 'processing' || current?.status === 'deleted'
      || ((current?.status === 'pending' || current?.status === 'failed') && page.status !== 'ready')
      || (localJob && localJob.inputHash !== revision.inputHash)
    if (!hasNewerSource && !guarded) {
      const next: WikiSourceState = {
        contextId: page.contextId, stableId: revision.source.stableId,
        sourceKey: revision.source.sourceKey, sourceType: revision.source.sourceType,
        source: revision.source, contentHash: revision.source.contentHash,
        status: page.status === 'archived' ? 'excluded' : originalAvailable ? 'ready' : 'unavailable',
        revisionId: revision.id, version: current?.version ?? 0,
        updatedAt: page.updatedAt, error: null,
      }
      const changed = !current || JSON.stringify({ ...current, version: 0 }) !== JSON.stringify({ ...next, version: 0 })
      if (changed) {
        const statement = sourceStatement({ ...next, version: (current?.version ?? 0) + 1 })
        // Cache parsing runs beside the source queue. Never overwrite a source
        // that became pending/processing while the Markdown was being read.
        statement.sql += ' where wiki_sources.version=$9'
        statement.values.push(current?.version ?? -1)
        statements.push(statement)
      }
    }
  }
  if (statements.length) await executeRecordTransaction(statements)
  if (revision) sourceState = await getWikiSourceState(page.contextId, revision.source.stableId)
  if (JSON.stringify(previous) !== JSON.stringify(page)) emitWikiUpdated()
  return sourceState
}

/** Removing a Markdown document also removes its searchable cached body. */
export async function removeWikiMarkdownCache(contextId: string, pageId: string, expectedInputHash?: string) {
  const page = await getWikiPage(contextId, pageId)
  if (!page || (expectedInputHash !== undefined && page.inputHash !== expectedInputHash)) return
  const statements: RecordStatement[] = [{ sql: 'delete from wiki_pages where context_id=$1 and id=$2 and payload=$3',
    values: [contextId, pageId, JSON.stringify(page)] }]
  if (page.kind === 'source') for (const source of page.sourceRefs) {
    const state = await getWikiSourceState(contextId, source.stableId)
    const job = (await readPayloads<WikiJob>('select payload from wiki_jobs where context_id=$1 and id=$2',
      [contextId, `source:${source.stableId}`]))[0]
    const newerWork = state && ['pending', 'processing', 'failed'].includes(state.status)
      && (!job || job.inputHash !== page.inputHash)
    if (state && state.contentHash === source.contentHash && !newerWork) {
      const statement = sourceStatement({ ...state, status: 'unavailable', revisionId: null,
        version: state.version + 1, updatedAt: Date.now(), error: null })
      statement.sql += ' where wiki_sources.version=$9'
      statement.values.push(state.version)
      statements.push(statement)
    }
    // Keep a newer worker's revision (and any revision it still references).
    statements.push({ sql: `delete from wiki_revisions where context_id=$1 and source_id=$2 and input_hash=$3
      and not exists(select 1 from wiki_sources s where s.context_id=wiki_revisions.context_id
        and s.revision_id=wiki_revisions.id and s.status in ('ready','pending','processing','failed'))`,
    values: [contextId, source.stableId, page.inputHash] })
  }
  await executeRecordTransaction(statements)
  emitWikiUpdated()
}
