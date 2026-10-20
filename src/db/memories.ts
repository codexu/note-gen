import { fetchEmbedding, getEmbeddingModelDescriptor } from '@/lib/ai/embedding'
import { invalidateMemoryCache } from '@/lib/memory/cache-version'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb } from './index'
import { getMemoryPolicy, initMemoryPolicyDb, type MemoryPolicy } from './memory-policy'

export type MemoryCategory = 'preference' | 'memory'
export type MemoryKind = 'preference' | 'fact' | 'experience' | 'decision'
export type MemoryScopeType = 'global' | 'workspace'
export type MemoryApplyMode = 'always' | 'relevant'
export type MemoryStatus = 'active' | 'pending' | 'archived'
export type MemoryOrigin = 'manual' | 'explicit_chat' | 'auto_chat'
export type MemoryIndexingStatus = 'ready' | 'pending' | 'failed'
export type MemorySensitivity = 'normal' | 'suspected_sensitive'

export interface Memory {
  id: string
  content: string
  embedding: string
  category: MemoryCategory
  kind: MemoryKind
  scopeType: MemoryScopeType
  scopeId?: string
  applyMode: MemoryApplyMode
  status: MemoryStatus
  origin: MemoryOrigin
  confidence: number
  conflictKey?: string
  replacedId?: string
  embeddingModel?: string
  embeddingDimensions?: number
  indexingStatus: MemoryIndexingStatus
  sensitivity: MemorySensitivity
  accessCount: number
  lastAccessedAt: number
  lastRecallReason?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
}

export type MemorySyncRecord = Omit<Memory,
  'embedding'
  | 'embeddingModel'
  | 'embeddingDimensions'
  | 'indexingStatus'
  | 'accessCount'
  | 'lastAccessedAt'
  | 'lastRecallReason'
>

export interface MemorySyncData {
  schemaVersion: 1
  memories: MemorySyncRecord[]
  policy: MemoryPolicy
}

export type MemoryJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface MemoryJob {
  id: number
  conversationId: number
  revision: number
  status: MemoryJobStatus
  attemptCount: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface MemoryWriteInput {
  content: string
  embedding?: string
  category?: MemoryCategory
  kind?: MemoryKind
  scopeType?: MemoryScopeType
  scopeId?: string
  applyMode?: MemoryApplyMode
  status?: MemoryStatus
  origin?: MemoryOrigin
  confidence?: number
  conflictKey?: string
  sensitivity?: MemorySensitivity
}

export interface MemoryUpdateInput {
  content?: string
  category?: MemoryCategory
  kind?: MemoryKind
  scopeType?: MemoryScopeType
  scopeId?: string
  applyMode?: MemoryApplyMode
  status?: MemoryStatus
  origin?: MemoryOrigin
  confidence?: number
  conflictKey?: string
  sensitivity?: MemorySensitivity
  embedding?: string
}

const PREFERENCE_KEYWORDS = [
  '中文', '英文', '清单体', '段落', '简洁', '详细', 'tl;dr',
  '格式', '风格', '语言', '回答', '输出', '回复',
]
const MEMORY_SYNC_EXCLUDED_FIELDS = new Set([
  'embedding',
  'embeddingModel',
  'embeddingDimensions',
  'indexingStatus',
  'accessCount',
  'lastAccessedAt',
  'lastRecallReason',
])
let memoryReindexRunning = false

const MEMORY_SELECT = `
  select
    id,
    content,
    coalesce(embedding, '') as embedding,
    category,
    coalesce(kind, case when category = 'preference' then 'preference' else 'fact' end) as kind,
    coalesce(scope_type, 'global') as scopeType,
    scope_id as scopeId,
    coalesce(apply_mode, case when category = 'preference' then 'always' else 'relevant' end) as applyMode,
    coalesce(status, 'active') as status,
    coalesce(origin, 'manual') as origin,
    coalesce(confidence, 1) as confidence,
    conflict_key as conflictKey,
    replaced_id as replacedId,
    embedding_model as embeddingModel,
    embedding_dimensions as embeddingDimensions,
    coalesce(indexing_status, case when embedding is null or embedding = '' then 'pending' else 'ready' end) as indexingStatus,
    coalesce(sensitivity, 'normal') as sensitivity,
    coalesce(access_count, 0) as accessCount,
    coalesce(last_accessed_at, 0) as lastAccessedAt,
    last_recall_reason as lastRecallReason,
    archived_at as archivedAt,
    created_at as createdAt,
    updated_at as updatedAt
  from memories
`

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0
    const value = character === 'x' ? random : (random & 0x3 | 0x8)
    return value.toString(16)
  })
}

function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function categorizeMemory(content: string): MemoryCategory {
  const normalized = content.toLocaleLowerCase()
  return PREFERENCE_KEYWORDS.some(keyword => normalized.includes(keyword))
    ? 'preference'
    : 'memory'
}

function categoryForKind(kind: MemoryKind): MemoryCategory {
  return kind === 'preference' ? 'preference' : 'memory'
}

function kindForCategory(category: MemoryCategory): MemoryKind {
  return category === 'preference' ? 'preference' : 'fact'
}

function enqueueMemorySync(reason: string) {
  enqueueAutoDataSync('settings', `memory:${reason}`)
}

async function addColumn(columnSql: string) {
  const db = await getDb()
  try {
    await db.execute(`alter table memories add column ${columnSql}`)
  } catch {
    // Idempotent migration: SQLite throws when a column already exists.
  }
}

export async function initMemoriesDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists memories (
      id text primary key,
      content text not null,
      embedding text,
      category text not null check(category in ('preference', 'memory')),
      replaced_id text,
      access_count integer default 0,
      last_accessed_at integer,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await addColumn("kind text default 'fact'")
  await addColumn("scope_type text default 'global'")
  await addColumn('scope_id text default null')
  await addColumn("apply_mode text default 'relevant'")
  await addColumn("status text default 'active'")
  await addColumn("origin text default 'manual'")
  await addColumn('confidence real default 1')
  await addColumn('conflict_key text default null')
  await addColumn('embedding_model text default null')
  await addColumn('embedding_dimensions integer default null')
  await addColumn("indexing_status text default 'pending'")
  await addColumn("sensitivity text default 'normal'")
  await addColumn('last_recall_reason text default null')
  await addColumn('archived_at integer default null')

  await db.execute(`
    update memories
    set
      kind = case when category = 'preference' then 'preference' else coalesce(nullif(kind, ''), 'fact') end,
      scope_type = coalesce(nullif(scope_type, ''), 'global'),
      apply_mode = case when category = 'preference' then 'always' else coalesce(nullif(apply_mode, ''), 'relevant') end,
      status = coalesce(nullif(status, ''), 'active'),
      origin = coalesce(nullif(origin, ''), 'manual'),
      confidence = coalesce(confidence, 1),
      indexing_status = case when embedding is null or embedding = '' then 'pending' else 'ready' end,
      sensitivity = coalesce(nullif(sensitivity, ''), 'normal'),
      replaced_id = case when replaced_id = id then null else replaced_id end
  `)

  await db.execute('create index if not exists idx_memories_category on memories(category)')
  await db.execute('create index if not exists idx_memories_access_count on memories(access_count)')
  await db.execute('create index if not exists idx_memories_scope_status on memories(scope_type, scope_id, status)')
  await db.execute('create index if not exists idx_memories_conflict_key on memories(conflict_key)')
  await db.execute('create index if not exists idx_memories_updated_at on memories(updated_at desc)')

  await db.execute('drop table if exists memory_evidence')
  await db.execute("delete from memories where status = 'superseded'")

  await db.execute(`
    create table if not exists memory_jobs (
      id integer primary key autoincrement,
      conversation_id integer not null,
      revision integer not null,
      status text not null,
      attempt_count integer not null default 0,
      error text,
      created_at integer not null,
      updated_at integer not null,
      unique(conversation_id, revision)
    )
  `)
  await db.execute('create index if not exists idx_memory_jobs_status on memory_jobs(status, updated_at)')

  await initMemoryPolicyDb()

  const syncStore = await Store.load('store.json')
  const syncInitialized = await syncStore.get<boolean>('memorySyncInitialized')
  if (!syncInitialized) {
    await syncStore.set('memorySyncInitialized', true)
    await syncStore.save()
    const existingMemories = await db.select<Array<{ total: number }>>(
      'select count(*) as total from memories',
    )
    if ((existingMemories[0]?.total || 0) > 0) {
      enqueueMemorySync('sync-initialized')
    }
  }
}

async function buildEmbedding(
  content: string,
  provided?: string,
  allowFetch = false
) {
  if (provided) {
    try {
      const vector = JSON.parse(provided) as number[]
      if (Array.isArray(vector) && vector.length > 0) {
        const descriptor = await getEmbeddingModelDescriptor()
        return {
          embedding: JSON.stringify(vector),
          model: descriptor?.model,
          dimensions: vector.length,
          status: 'ready' as const,
        }
      }
    } catch {
      // Fall through to background-compatible indexing.
    }
  }

  if (!allowFetch) {
    return {
      embedding: '',
      model: undefined,
      dimensions: undefined,
      status: 'pending' as const,
    }
  }

  const vector = await fetchEmbedding(content, { silent: true })
  if (!vector?.length) {
    return {
      embedding: '',
      model: undefined,
      dimensions: undefined,
      status: 'pending' as const,
    }
  }
  const descriptor = await getEmbeddingModelDescriptor()
  return {
    embedding: JSON.stringify(vector),
    model: descriptor?.model,
    dimensions: vector.length,
    status: 'ready' as const,
  }
}

export async function upsertMemory(
  input: MemoryWriteInput
): Promise<{ id: string; replaced: boolean; replacedId?: string; indexingStatus: MemoryIndexingStatus }> {
  const db = await getDb()
  const content = input.content.trim()
  if (!content) {
    throw new Error('记忆内容不能为空')
  }

  const category = input.category || (input.kind ? categoryForKind(input.kind) : categorizeMemory(content))
  const kind = input.kind || kindForCategory(category)
  const scopeType = input.scopeType || 'global'
  const scopeId = scopeType === 'workspace' ? input.scopeId?.trim() || undefined : undefined
  if (scopeType === 'workspace' && !scopeId) {
    throw new Error('工作区记忆缺少工作区标识')
  }

  const existing = (await getAllMemories({ includeInactive: true })).find(memory =>
    memory.scopeType === scopeType
    && (memory.scopeId || '') === (scopeId || '')
    && normalizeMemoryContent(memory.content) === normalizeMemoryContent(content)
    && memory.status !== 'archived'
  )

  if (existing) {
    invalidateMemoryCache()
    return {
      id: existing.id,
      replaced: false,
      indexingStatus: existing.indexingStatus,
    }
  }

  const indexed = await buildEmbedding(content, input.embedding)
  const id = generateUUID()
  const now = Date.now()
  const confidence = Math.max(0, Math.min(1, input.confidence ?? 1))
  await db.execute(
    `insert into memories (
      id, content, embedding, category, replaced_id, access_count,
      last_accessed_at, created_at, updated_at, kind, scope_type, scope_id,
      apply_mode, status, origin, confidence, conflict_key,
      embedding_model, embedding_dimensions, indexing_status, sensitivity,
      last_recall_reason, archived_at
    ) values (
      $1, $2, $3, $4, null, 0, 0, $5, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16, $17, null, null
    )`,
    [
      id,
      content,
      indexed.embedding,
      category,
      now,
      kind,
      scopeType,
      scopeId,
      input.applyMode || (category === 'preference' ? 'always' : 'relevant'),
      input.status || 'active',
      input.origin || 'manual',
      confidence,
      input.conflictKey?.trim() || undefined,
      indexed.model,
      indexed.dimensions,
      indexed.status,
      input.sensitivity || 'normal',
    ]
  )
  invalidateMemoryCache()
  void reindexPendingMemories()
  enqueueMemorySync('create')
  return { id, replaced: false, indexingStatus: indexed.status }
}

export async function getAllMemories(options?: {
  includeInactive?: boolean
  status?: MemoryStatus
}): Promise<Memory[]> {
  const db = await getDb()
  const where = options?.status
    ? 'where status = $1'
    : options?.includeInactive
      ? ''
      : "where status in ('active', 'pending')"
  const params = options?.status ? [options.status] : []
  return await db.select<Memory[]>(
    `${MEMORY_SELECT} ${where} order by updated_at desc`,
    params
  )
}

export async function getMemoriesByCategory(category: MemoryCategory): Promise<Memory[]> {
  const db = await getDb()
  return await db.select<Memory[]>(
    `${MEMORY_SELECT} where category = $1 and status in ('active', 'pending') order by updated_at desc`,
    [category]
  )
}

export async function getMemoryById(id: string): Promise<Memory | null> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `${MEMORY_SELECT} where id = $1`,
    [id]
  )
  return result[0] || null
}

export async function getSimilarMemories(
  embedding: number[],
  threshold = 0.85
): Promise<Array<{ memory: Memory; similarity: number }>> {
  const memories = await getAllMemories({ status: 'active' })
  const result: Array<{ memory: Memory; similarity: number }> = []
  for (const memory of memories) {
    if (!memory.embedding) continue
    try {
      const vector = JSON.parse(memory.embedding) as number[]
      if (vector.length !== embedding.length) continue
      let dot = 0
      let left = 0
      let right = 0
      for (let index = 0; index < vector.length; index += 1) {
        dot += vector[index] * embedding[index]
        left += vector[index] * vector[index]
        right += embedding[index] * embedding[index]
      }
      const similarity = left && right ? dot / (Math.sqrt(left) * Math.sqrt(right)) : 0
      if (similarity >= threshold) result.push({ memory, similarity })
    } catch {
      continue
    }
  }
  return result.sort((left, right) => right.similarity - left.similarity)
}

export async function updateMemoryAccess(
  id: string,
  reason = 'included in model context'
): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update memories
     set access_count = coalesce(access_count, 0) + 1,
         last_accessed_at = $1,
         last_recall_reason = $2
     where id = $3`,
    [Date.now(), reason.slice(0, 240), id]
  )
}

export async function updateMemory(id: string, updates: MemoryUpdateInput): Promise<void> {
  const current = await getMemoryById(id)
  if (!current) throw new Error('记忆不存在')
  const db = await getDb()

  const content = updates.content?.trim() || current.content
  const kind = updates.kind || current.kind
  const category = updates.category || (updates.kind ? categoryForKind(kind) : current.category)
  const scopeType = updates.scopeType || current.scopeType
  const scopeId = scopeType === 'workspace'
    ? updates.scopeId === undefined ? current.scopeId : updates.scopeId?.trim()
    : undefined
  if (scopeType === 'workspace' && !scopeId) {
    throw new Error('工作区记忆缺少工作区标识')
  }

  const contentChanged = content !== current.content
  const indexed = contentChanged || updates.embedding
    ? await buildEmbedding(content, updates.embedding)
    : {
        embedding: current.embedding,
        model: current.embeddingModel,
        dimensions: current.embeddingDimensions,
        status: current.indexingStatus,
      }

  await db.execute(
    `update memories set
      content = $1,
      embedding = $2,
      category = $3,
      kind = $4,
      scope_type = $5,
      scope_id = $6,
      apply_mode = $7,
      status = $8,
      origin = $9,
      confidence = $10,
      conflict_key = $11,
      embedding_model = $12,
      embedding_dimensions = $13,
      indexing_status = $14,
      sensitivity = $15,
      archived_at = case when $8 = 'archived' then coalesce(archived_at, $16) else null end,
      updated_at = $16
     where id = $17`,
    [
      content,
      indexed.embedding,
      category,
      kind,
      scopeType,
      scopeId,
      updates.applyMode || current.applyMode,
      updates.status || current.status,
      updates.origin || current.origin,
      Math.max(0, Math.min(1, updates.confidence ?? current.confidence)),
      updates.conflictKey === undefined ? current.conflictKey : updates.conflictKey?.trim() || undefined,
      indexed.model,
      indexed.dimensions,
      indexed.status,
      updates.sensitivity || current.sensitivity,
      Date.now(),
      id,
    ]
  )
  invalidateMemoryCache()
  if (indexed.status !== 'ready') void reindexPendingMemories()
  enqueueMemorySync('update')
}

export async function archiveMemory(id: string): Promise<void> {
  await updateMemory(id, { status: 'archived' })
}

export async function restoreMemory(id: string): Promise<void> {
  await updateMemory(id, { status: 'active' })
}

export async function undoMemoryChange(id: string): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    `update memories
     set status = 'archived', archived_at = $1, updated_at = $1
     where id = $2`,
    [now, id]
  )
  invalidateMemoryCache()
  enqueueMemorySync('undo')
}

export async function approveMemory(id: string): Promise<void> {
  const memory = await getMemoryById(id)
  if (!memory) throw new Error('记忆不存在')
  await updateMemory(id, { status: 'active', sensitivity: 'normal' })
  if (memory.conflictKey) {
    const conflicts = (await getAllMemories({ status: 'active' })).filter(candidate =>
      candidate.id !== id
      && candidate.conflictKey === memory.conflictKey
      && candidate.scopeType === memory.scopeType
      && (candidate.scopeId || '') === (memory.scopeId || '')
    )
    for (const conflict of conflicts) {
      await permanentlyDeleteMemory(conflict.id)
    }
  }
}

export async function deleteMemory(id: string): Promise<void> {
  await archiveMemory(id)
}

export async function permanentlyDeleteMemory(id: string): Promise<void> {
  const db = await getDb()
  await db.execute('delete from memories where id = $1', [id])
  invalidateMemoryCache()
  enqueueMemorySync('permanently-delete')
}

export async function clearAllMemories(): Promise<void> {
  const db = await getDb()
  await db.execute('delete from memories')
  invalidateMemoryCache()
  enqueueMemorySync('clear')
}

export async function getMemorySyncData(): Promise<MemorySyncData> {
  const [memories, policy] = await Promise.all([
    getAllMemories({ includeInactive: true }),
    getMemoryPolicy(),
  ])

  return {
    schemaVersion: 1,
    memories: memories.map(memory => Object.fromEntries(
      Object.entries(memory).filter(([key]) => !MEMORY_SYNC_EXCLUDED_FIELDS.has(key))
    ) as MemorySyncRecord),
    policy,
  }
}

export async function replaceMemorySyncData(data: MemorySyncData): Promise<void> {
  await initMemoryPolicyDb()
  const statements = [
    { sql: 'delete from memories', values: [] },
    ...data.memories.map(memory => ({
      sql: `insert into memories (
        id, content, embedding, category, replaced_id, access_count,
        last_accessed_at, created_at, updated_at, kind, scope_type, scope_id,
        apply_mode, status, origin, confidence, conflict_key,
        embedding_model, embedding_dimensions, indexing_status, sensitivity,
        last_recall_reason, archived_at
      ) values (
        $1, $2, '', $3, $4, 0, 0, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, null, null, 'pending', $15, null, $16
      )`,
      values: [
        memory.id,
        memory.content,
        memory.category,
        memory.replacedId ?? null,
        memory.createdAt,
        memory.updatedAt,
        memory.kind,
        memory.scopeType,
        memory.scopeId ?? null,
        memory.applyMode,
        memory.status,
        memory.origin,
        memory.confidence,
        memory.conflictKey ?? null,
        memory.sensitivity,
        memory.archivedAt ?? null,
      ],
    })),
    {
      sql: `update memory_global_policy
            set use_memories = 1, generate_memories = $1,
                exclude_external_context = 1, generation_started_at = $2,
                updated_at = $3 where id = 1`,
      values: [data.policy.generateMemories ? 1 : 0, data.policy.generationStartedAt, data.policy.updatedAt],
    },
  ]
  await executeRecordTransaction(statements)
  invalidateMemoryCache()
  void reindexPendingMemories()
}

export async function getMemoryStats(): Promise<{
  total: number
  preferences: number
  memories: number
  pending: number
  archived: number
  totalAccessCount: number
}> {
  const memories = await getAllMemories({ includeInactive: true })
  const active = memories.filter(memory => memory.status === 'active')
  const pending = memories.filter(memory => memory.status === 'pending')
  return {
    total: active.length + pending.length,
    preferences: active.filter(memory => memory.kind === 'preference').length,
    memories: active.filter(memory => memory.kind !== 'preference').length,
    pending: pending.length,
    archived: memories.filter(memory => memory.status === 'archived').length,
    totalAccessCount: memories.reduce((total, memory) => total + memory.accessCount, 0),
  }
}

export async function enqueueMemoryJob(conversationId: number, revision: number): Promise<MemoryJob> {
  const db = await getDb()
  const now = Date.now()
  await db.execute(
    `insert into memory_jobs
     (conversation_id, revision, status, attempt_count, created_at, updated_at)
     values ($1, $2, 'pending', 0, $3, $3)
     on conflict(conversation_id, revision) do nothing`,
    [conversationId, revision, now]
  )
  const result = await db.select<MemoryJob[]>(
    `select
      id,
      conversation_id as conversationId,
      revision,
      status,
      attempt_count as attemptCount,
      error,
      created_at as createdAt,
      updated_at as updatedAt
     from memory_jobs
     where conversation_id = $1 and revision = $2`,
    [conversationId, revision]
  )
  return result[0]
}

export async function getPendingMemoryJobs(limit = 3): Promise<MemoryJob[]> {
  const db = await getDb()
  return await db.select<MemoryJob[]>(
    `select
      id,
      conversation_id as conversationId,
      revision,
      status,
      attempt_count as attemptCount,
      error,
      created_at as createdAt,
      updated_at as updatedAt
     from memory_jobs
     where status in ('pending', 'failed') and attempt_count < 3
     order by updated_at asc
     limit $1`,
    [limit]
  )
}

export async function updateMemoryJob(
  id: number,
  status: MemoryJobStatus,
  error?: string
): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update memory_jobs
     set status = $1,
         attempt_count = case when $1 = 'running' then attempt_count + 1 else attempt_count end,
         error = $2,
         updated_at = $3
     where id = $4`,
    [status, error?.slice(0, 1000), Date.now(), id]
  )
}

export async function reconcileMemoryEmbeddingModel(): Promise<number> {
  const descriptor = await getEmbeddingModelDescriptor()
  if (!descriptor?.model) return 0
  const db = await getDb()
  const result = await db.execute(
    `update memories
     set embedding = '', embedding_model = $1, embedding_dimensions = null,
         indexing_status = 'pending'
     where status in ('active', 'pending')
       and coalesce(embedding_model, '') <> $1`,
    [descriptor.model]
  )
  if (result.rowsAffected > 0) invalidateMemoryCache()
  return result.rowsAffected
}

export async function reindexPendingMemories(limit = 20): Promise<number> {
  if (memoryReindexRunning) return 0
  memoryReindexRunning = true
  try {
    const db = await getDb()
    const memories = await db.select<Memory[]>(
      `${MEMORY_SELECT}
       where status in ('active', 'pending')
         and sensitivity = 'normal'
         and indexing_status <> 'ready'
       order by updated_at desc limit $1`,
      [limit]
    )
    let indexedCount = 0
    for (const memory of memories) {
      const indexed = await buildEmbedding(memory.content, undefined, true)
      await db.execute(
        `update memories
         set embedding = $1, embedding_model = $2, embedding_dimensions = $3,
             indexing_status = $4
         where id = $5`,
        [
          indexed.embedding,
          indexed.model,
          indexed.dimensions,
          indexed.status === 'pending' ? 'failed' : indexed.status,
          memory.id,
        ]
      )
      if (indexed.status === 'ready') indexedCount += 1
    }
    if (memories.length > 0) invalidateMemoryCache()
    if (indexedCount === limit) {
      setTimeout(() => {
        void reindexPendingMemories(limit)
      }, 0)
    }
    return indexedCount
  } finally {
    memoryReindexRunning = false
  }
}
