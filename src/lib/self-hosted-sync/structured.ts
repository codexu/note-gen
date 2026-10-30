import { Store } from '@tauri-apps/plugin-store'
import { mergeSyncData, shouldExcludeFromSync } from '@/config/sync-exclusions'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { recordTagIds } from '@/lib/record-tags'
import { normalizeTagBoolean } from '@/lib/tag-sync'
import type { SyncObjectKind } from './protocol'
import { assertMarkIdentityUnambiguous, localizeCanvasRecords } from './references'

const DOMAIN_CONFIG = {
  tag: {
    table: 'tags', key: 'id', numeric: true,
    columns: ['name', 'isLocked', 'isPin', 'sortOrder'],
  },
  mark: {
    table: 'marks', key: 'id', numeric: true,
    columns: ['tagId', 'type', 'content', 'url', 'desc', 'deleted', 'createdAt', 'sourceId'],
  },
  note: {
    table: 'notes', key: 'id', numeric: true,
    columns: ['tagId', 'content', 'locale', 'count', 'createdAt'],
  },
  conversation: {
    table: 'conversations', key: 'syncId', numeric: false,
    columns: ['syncId', 'syncUpdatedAt', 'title', 'createdAt', 'updatedAt', 'messageCount', 'isPinned'],
  },
  message: {
    table: 'chats', key: 'syncId', numeric: false,
    columns: [
      'syncId', 'syncUpdatedAt', 'tagId', 'conversationId', 'content', 'role', 'type',
      'image', 'images', 'attachments', 'inserted', 'createdAt', 'quoteData',
      'uiBlocks', 'condensedContent', 'condensedFrom', 'condensedAt',
      'originalTokenCount', 'originalMessageCount',
    ],
  },
  memory: {
    table: 'memories', key: 'id', numeric: false,
    columns: [
      'id', 'content', 'category', 'replaced_id', 'created_at', 'updated_at', 'kind',
      'scope_type', 'scope_id', 'apply_mode', 'status', 'origin', 'confidence',
      'conflict_key', 'sensitivity', 'archived_at',
    ],
  },
  canvas: {
    table: 'canvases', key: 'id', numeric: false,
    columns: ['id', 'title', 'canvasType', 'schemaVersion', 'content', 'createdAt', 'updatedAt', 'pinnedAt', 'deletedAt'],
  },
} as const

type StructuredDomain = keyof typeof DOMAIN_CONFIG

// Match SQLite defaults used when an older payload omits a portable field.
// Other absent fields are nullable. Explicit nulls remain explicit nulls.
const COMPARABLE_DEFAULTS: Partial<Record<StructuredDomain, Record<string, unknown>>> = {
  tag: { isLocked: 0, isPin: 0, sortOrder: 0 },
  mark: { deleted: 0 },
  conversation: { messageCount: 0, isPinned: 0 },
  message: { inserted: 0 },
  memory: { kind: 'fact', scope_type: 'global', apply_mode: 'relevant', status: 'active', origin: 'manual', confidence: 1, sensitivity: 'normal' },
  canvas: { schemaVersion: 1 },
}

/** Compare the same portable fields that applyStructuredPayload can persist. */
export function getComparableStructuredValue(domain: string, source: Record<string, unknown>, localKey?: string) {
  if (!(domain in DOMAIN_CONFIG)) return { ...source }
  const typedDomain = domain as StructuredDomain
  const config = DOMAIN_CONFIG[typedDomain]
  const defaults = COMPARABLE_DEFAULTS[typedDomain] ?? {}
  const fields = new Set<string>([config.key, ...config.columns])
  if (config.numeric) fields.delete(config.key)
  const value: Record<string, unknown> = {}
  for (const field of fields) value[field] = source[field] === undefined ? defaults[field] ?? null : source[field]
  if (!config.numeric && value[config.key] == null && localKey !== undefined) value[config.key] = localKey
  normalizeStructuredBooleans(value)
  if (typedDomain === 'mark') {
    if (value.sourceId == null && localKey !== undefined) value.sourceId = localKey
    value.tagIds = recordTagIds({ tagId: typeof source.tagId === 'number' ? source.tagId : 0,
      tagIds: Array.isArray(source.tagIds) ? source.tagIds.filter((id): id is number => typeof id === 'number') : undefined })
    value.tagUpdatedAt = typeof source.tagUpdatedAt === 'number' && Number.isFinite(source.tagUpdatedAt) ? source.tagUpdatedAt : 0
  }
  return value
}

function normalizeStructuredBooleans(value: Record<string, unknown>) {
  for (const field of ['isLocked', 'isPin', 'isPinned', 'inserted']) {
    if (value[field] == null) continue
    const normalized = normalizeTagBoolean(value[field])
    if (normalized === undefined) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
    value[field] = normalized ? 1 : 0
  }
}

export async function applyStructuredPayload(
  workspaceId: string,
  objectId: string,
  kind: SyncObjectKind,
  payload: Record<string, unknown>,
) {
  const domain = String(payload.domain ?? '')
  if (domain === 'setting') {
    await applySettings(payload.value)
    const profiles = await (await getDb()).select<Array<{ toggles: string }>>(
      `select p.domain_toggles as toggles from self_hosted_workspace_bindings b
       join self_hosted_sync_profiles p on p.id = b.profile_id where b.workspace_id = $1 limit 1`, [workspaceId],
    )
    const toggles = JSON.parse(profiles[0]?.toggles ?? '{}') as Record<string, boolean>
    if (toggles.memories !== false && isRecord(payload.memoryPolicy)
      && typeof payload.memoryPolicy.generateMemories === 'boolean'
      && typeof payload.memoryPolicy.generationStartedAt === 'number'
      && typeof payload.memoryPolicy.updatedAt === 'number') {
      const { replaceMemoryPolicy } = await import('@/db/memory-policy')
      await replaceMemoryPolicy({
        useMemories: true,
        generateMemories: payload.memoryPolicy.generateMemories,
        excludeExternalContext: true,
        generationStartedAt: payload.memoryPolicy.generationStartedAt,
        updatedAt: payload.memoryPolicy.updatedAt,
      })
    }
    await upsertMapping(workspaceId, objectId, kind, `setting:${String(payload.localKey ?? 'snapshot')}`)
    return
  }
  if (!(domain in DOMAIN_CONFIG) || !isRecord(payload.value)) return
  const typedDomain = domain as StructuredDomain
  const config = DOMAIN_CONFIG[typedDomain]
  const database = await getDb()
  const row = { ...payload.value }
  normalizeStructuredBooleans(row)
  if (typedDomain === 'mark' && !row.sourceId) row.sourceId = objectId
  const references = isRecord(payload.references) ? payload.references : {}
  if (typedDomain === 'canvas' && typeof row.content === 'string') {
    row.content = await localizeCanvasRecords(workspaceId, row.content, references)
  }
  let relatedTagIds: number[] | undefined
  if (typedDomain === 'mark' && Array.isArray(row.tagIds)) {
    relatedTagIds = []
    for (const id of row.tagIds) {
      const reference = references[`tag:${id}`]
      if (typeof reference !== 'string') throw new Error('structured_dependency_missing:tag')
      relatedTagIds.push(await mappedNumericId(workspaceId, reference, 'tag'))
    }
  }
  let hasConversation = false
  if ('conversationId' in row && typeof references.conversation === 'string') {
    const syncId = await mappingLocalKey(workspaceId, references.conversation, 'conversation')
    if (!syncId) throw new Error('structured_dependency_missing:conversation')
    const conversations = await database.select<Array<{ id: number }>>(
      'select id from conversations where syncId = $1 limit 1',
      [syncId]
    )
    if (!conversations[0]) throw new Error('structured_dependency_missing:conversation')
    row.conversationId = conversations[0].id
    hasConversation = true
  }
  if ('tagId' in row && typeof references.tag === 'string') {
    const deletedTags = typedDomain === 'message' && hasConversation
      ? await database.select<Array<{ objectId: string }>>(
        `select object_id as objectId from self_hosted_object_mappings
         where workspace_id = $1 and object_id = $2 and kind = 'tag' and deleted_at is not null limit 1`,
        [workspaceId, references.tag],
      ) : []
    row.tagId = deletedTags.length ? 0 : await mappedNumericId(workspaceId, references.tag, 'tag')
  }

  const existing = await mappingLocalKey(workspaceId, objectId, typedDomain)
  let localKey: string | number
  let mappingKey: string
  if (typedDomain === 'mark') {
    const stableKey = String(row.sourceId)
    const match = await matchingMarkId(stableKey, existing)
    localKey = match ?? await nextNumericId(config.table, config.key)
    mappingKey = stableKey
    row.id = localKey
    row.sourceId = stableKey
  } else if (config.numeric) {
    localKey = numericKey(existing) ?? await nextNumericId(config.table, config.key, workspaceId, typedDomain)
    mappingKey = String(localKey)
    row[config.key] = localKey
  } else {
    localKey = String(row[config.key] ?? payload.localKey ?? objectId)
    mappingKey = String(localKey)
    row[config.key] = localKey
  }
  const columns = [config.key, ...config.columns.filter(column => column !== config.key)]
    .filter(column => row[column] !== undefined)
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const updates = columns.filter(column => column !== config.key)
    .map(column => `${column} = excluded.${column}`)
  await suppressSyncTriggers(async () => {
    await database.execute(
      `insert into ${config.table}(${columns.join(', ')}) values (${placeholders.join(', ')})
       on conflict(${config.key}) do update set ${updates.join(', ')}`,
      columns.map(column => row[column] ?? null)
    )
    if (typedDomain === 'mark' && relatedTagIds && typeof row.tagId === 'number') {
      const { saveMarkTagIds } = await import('@/db/marks')
      await saveMarkTagIds(Number(localKey), row.tagId, relatedTagIds, typeof row.tagUpdatedAt === 'number' ? row.tagUpdatedAt : 0)
    }
  })
  await upsertMapping(workspaceId, objectId, kind, `${domain}:${mappingKey}`)
  if (typedDomain === 'mark') {
    // Canvas legacy aliases refer to the source device's mark ID. Make the
    // successfully applied source payload available before importing canvases.
    await database.execute(
      `insert into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
       values ($1, $2, 'mark', '0', $3, $4)
       on conflict(workspace_id, object_id) do update set payload = excluded.payload, updated_at = excluded.updated_at`,
      [workspaceId, objectId, JSON.stringify(payload), Date.now()],
    )
  }
}

export async function deleteStructuredObject(workspaceId: string, objectId: string) {
  const objectMapping = await mapping(workspaceId, objectId)
  if (!objectMapping || objectMapping.relativePath) return false
  const separator = objectMapping.localIdentity.indexOf(':')
  if (separator < 1) return false
  const domain = objectMapping.localIdentity.slice(0, separator)
  if (!(domain in DOMAIN_CONFIG) || domain !== objectMapping.kind) return false
  const config = DOMAIN_CONFIG[domain as StructuredDomain]
  const localKey = objectMapping.localIdentity.slice(separator + 1)
  const database = await getDb()
  await suppressSyncTriggers(async () => {
    if (domain === 'tag') {
      const id = numericKey(localKey)
      if (id === null) return
      const { delTag } = await import('@/db/tags')
      await delTag(id, { sync: false })
      return
    }
    if (domain === 'mark') {
      const id = await matchingMarkId(localKey, localKey)
      if (id === undefined) return
      return database.execute(
        'update marks set deleted = 1, createdAt = $1 where id = $2',
        [Date.now(), id]
      ).then(() => undefined)
    }
    if (domain === 'canvas') {
      const { closeCanvasCollaboration } = await import('./canvas-collaboration')
      // Inbox application already owns the runtime run; awaiting another
      // wake here would wait on itself. Stop this deleted canvas's session.
      await closeCanvasCollaboration(localKey, { flush: false })
      return database.execute(
        `update canvases set deletedAt = $1, updatedAt = $1 where id = $2`,
        [Date.now(), localKey]
      ).then(() => undefined)
    }
    if (domain === 'conversation') {
      const conversations = await database.select<Array<{ id: number }>>(
        'select id from conversations where syncId = $1', [localKey],
      )
      const ids = JSON.stringify(conversations.map(conversation => conversation.id))
      const messages = await database.select<Array<{ syncId: string }>>(
        'select syncId from chats where conversationId in (select value from json_each($1)) and syncId is not null', [ids],
      )
      const keys = JSON.stringify(messages.map(message => message.syncId))
      const mappings = await database.select<Array<{ objectId: string }>>(
        `select object_id as objectId from self_hosted_object_mappings where workspace_id = $1 and kind = 'message'
         and local_identity in (select 'message:' || value from json_each($2))`, [workspaceId, keys],
      )
      const objectIds = JSON.stringify(mappings.map(message => message.objectId))
      const now = Date.now()
      const { getOptionalConversationCleanupTables } = await import('@/db/conversations')
      const statements: RecordStatement[] = (await getOptionalConversationCleanupTables()).map(table => ({
        sql: `delete from ${table.name} where ${table.column} in (select value from json_each($1))`, values: [ids],
      }))
      statements.push(
        { sql: `update self_hosted_local_changes set state = 'superseded', updated_at = $3
            where (workspace_id = $1 or workspace_id is null) and state in ('pending', 'queued')
              and ((domain = 'message' and local_key in (select value from json_each($2))) or (domain = 'conversation' and local_key = $4))`,
          values: [workspaceId, keys, now, localKey] },
        { sql: `update self_hosted_outbox set state = 'superseded', last_error_code = 'conversation-remote-deleted', updated_at = $3
            where workspace_id = $1 and state in ('pending', 'retry', 'blocked', 'failed')
              and json_extract(payload, '$.objectId') in (select value from json_each($2))`, values: [workspaceId, objectIds, now] },
        { sql: `update self_hosted_object_mappings set deleted_at = $3, updated_at = $3
            where workspace_id = $1 and object_id in (select value from json_each($2))`, values: [workspaceId, objectIds, now] },
        { sql: `delete from self_hosted_remote_objects where workspace_id = $1
            and (object_id in (select value from json_each($2)) or object_id = $3)`, values: [workspaceId, objectIds, objectId] },
        { sql: 'delete from chats where conversationId in (select value from json_each($1))', values: [ids] },
        { sql: 'delete from conversations where syncId = $1', values: [localKey] },
      )
      await executeRecordTransaction(statements)
      return
    }
    return database.execute(
      `delete from ${config.table} where ${config.key} = $1`,
      [localKey]
    ).then(() => undefined)
  })
  return true
}

async function applySettings(value: unknown) {
  if (!isRecord(value)) return
  const store = await Store.load('store.json')
  const local = Object.fromEntries(await store.entries()) as Record<string, unknown>
  const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
  const merged = mergeSyncData(local, value, { excludeSensitiveConfig })
  for (const [key, nextValue] of Object.entries(merged)) {
    if (shouldExcludeFromSync(key, { excludeSensitiveConfig })) continue
    if (local[key] !== nextValue) await store.set(key, nextValue)
  }
  await store.save()
  const { default: useSettingStore } = await import('@/stores/setting')
  await useSettingStore.getState().initSettingData({ hydrateOnly: true })
}

async function mappedNumericId(workspaceId: string, objectId: string, expectedDomain: string) {
  const localKey = await mappingLocalKey(workspaceId, objectId, expectedDomain)
  if (!localKey) throw new Error(`structured_dependency_missing:${expectedDomain}`)
  const value = numericKey(localKey)
  if (value === null) throw new Error(`structured_dependency_invalid:${expectedDomain}`)
  if (expectedDomain in DOMAIN_CONFIG) {
    const config = DOMAIN_CONFIG[expectedDomain as StructuredDomain]
    const database = await getDb()
    const rows = await database.select<Array<{ present: number }>>(`select 1 as present from ${config.table} where ${config.key} = $1 limit 1`, [value])
    if (!rows[0]) throw new Error(`structured_dependency_missing:${expectedDomain}`)
  }
  return value
}

function numericKey(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

async function matchingMarkId(stableKey: string, ownedKey: string | null) {
  await assertMarkIdentityUnambiguous(stableKey)
  if (ownedKey && ownedKey !== stableKey) await assertMarkIdentityUnambiguous(ownedKey)
  const database = await getDb()
  const matches = await database.select<Array<{ id: number }>>('select id from marks where sourceId = $1 limit 1', [stableKey])
  if (matches[0]) return matches[0].id
  if (ownedKey && ownedKey !== stableKey) {
    const owned = await database.select<Array<{ id: number }>>('select id from marks where sourceId = $1 limit 1', [ownedKey])
    if (owned[0]) return owned[0].id
  }
  // A numeric alias is evidence only when this exact server object already
  // owns it, and the local record has never acquired another source identity.
  const legacyId = numericKey(ownedKey)
  if (legacyId === null) return undefined
  const legacy = await database.select<Array<{ id: number }>>('select id from marks where id = $1 and sourceId is null limit 1', [legacyId])
  return legacy[0]?.id
}

async function nextNumericId(table: string, key: string, workspaceId?: string, domain?: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ nextId: number }>>(
    `select coalesce(max(${key}), 0) + 1 as nextId from ${table}`
  )
  let nextId = rows[0]?.nextId ?? 1
  if (workspaceId && domain) {
    // Tombstones keep their old identity. A restore receives a new free key
    // rather than recycling a key still owned by another historical object.
    const identities = await database.select<Array<{ identity: string }>>(
      'select local_identity as identity from self_hosted_object_mappings where workspace_id = $1 and kind = $2', [workspaceId, domain],
    )
    for (const { identity } of identities) {
      const old = identity.startsWith(`${domain}:`) ? numericKey(identity.slice(domain.length + 1)) : null
      if (old !== null) nextId = Math.max(nextId, old + 1)
    }
  }
  if (!Number.isSafeInteger(nextId) || nextId <= 0) throw new Error('structured_identity_invalid')
  return nextId
}

async function mappingLocalKey(workspaceId: string, objectId: string, expectedDomain: string) {
  const value = await mapping(workspaceId, objectId)
  if (!value || value.kind !== expectedDomain || value.deletedAt !== null || !value.localIdentity.startsWith(`${expectedDomain}:`)) return null
  return value.localIdentity.slice(expectedDomain.length + 1) || null
}

async function mapping(workspaceId: string, objectId: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ kind: string; localIdentity: string; relativePath: string | null; deletedAt: number | null }>>(
    `select kind, local_identity as localIdentity, relative_path as relativePath, deleted_at as deletedAt
     from self_hosted_object_mappings where workspace_id = $1 and object_id = $2 limit 1`,
    [workspaceId, objectId]
  )
  return rows[0] ?? null
}

async function upsertMapping(
  workspaceId: string,
  objectId: string,
  kind: SyncObjectKind,
  localIdentity: string,
) {
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, updated_at
     ) values ($1, $2, $3, $4, $5)
     on conflict(workspace_id, object_id) do update set
       kind = excluded.kind, local_identity = excluded.local_identity,
       deleted_at = null, updated_at = excluded.updated_at`,
    [workspaceId, objectId, kind, localIdentity, Date.now()]
  )
}

async function suppressSyncTriggers(action: () => Promise<void>) {
  const database = await getDb()
  await database.execute('update self_hosted_sync_context set suppress_triggers = suppress_triggers + 1 where id = 1')
  try {
    await action()
  } finally {
    await database.execute(
      'update self_hosted_sync_context set suppress_triggers = max(0, suppress_triggers - 1) where id = 1'
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
