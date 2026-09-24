import { Store } from '@tauri-apps/plugin-store'
import { mergeSyncData } from '@/config/sync-exclusions'
import { getDb } from '@/db'
import type { SyncObjectKind } from './protocol'

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
      'condensedContent', 'condensedAt',
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

export async function applyStructuredPayload(
  workspaceId: string,
  objectId: string,
  kind: SyncObjectKind,
  payload: Record<string, unknown>,
) {
  const domain = String(payload.domain ?? '')
  if (domain === 'setting') {
    await applySettings(payload.value)
    await upsertMapping(workspaceId, objectId, kind, `setting:${String(payload.localKey ?? 'snapshot')}`)
    return
  }
  if (!(domain in DOMAIN_CONFIG) || !isRecord(payload.value)) return
  const typedDomain = domain as StructuredDomain
  const config = DOMAIN_CONFIG[typedDomain]
  const database = await getDb()
  const row = { ...payload.value }
  if (typedDomain === 'mark' && (row.sourceId === null || row.sourceId === undefined)) {
    row.sourceId = String(payload.localKey ?? objectId)
  }
  const references = isRecord(payload.references) ? payload.references : {}
  let relatedTagIds: number[] | undefined
  if (typedDomain === 'mark' && Array.isArray(row.tagIds)) {
    relatedTagIds = []
    for (const id of row.tagIds) {
      const reference = references[`tag:${id}`]
      if (typeof reference !== 'string') throw new Error('structured_dependency_missing:tag')
      relatedTagIds.push(await mappedNumericId(workspaceId, reference, 'tag'))
    }
  }
  if ('tagId' in row && typeof references.tag === 'string') {
    row.tagId = await mappedNumericId(workspaceId, references.tag, 'tag')
  }
  if ('conversationId' in row && typeof references.conversation === 'string') {
    const syncId = await mappingLocalKey(workspaceId, references.conversation)
    if (!syncId) throw new Error('structured_dependency_missing:conversation')
    const conversations = await database.select<Array<{ id: number }>>(
      'select id from conversations where syncId = $1 limit 1',
      [syncId]
    )
    if (!conversations[0]) throw new Error('structured_dependency_missing:conversation')
    row.conversationId = conversations[0].id
  }

  const existing = await mappingLocalKey(workspaceId, objectId)
  let localKey: string | number
  let mappingKey: string
  if (typedDomain === 'mark') {
    const stableKey = String(row.sourceId ?? payload.localKey ?? existing ?? objectId)
    const matches = await database.select<Array<{ id: number }>>(
      `select id from marks where sourceId = $1 or cast(id as text) = $1 limit 1`,
      [stableKey]
    )
    localKey = matches[0]?.id ?? await nextNumericId(config.table, config.key)
    mappingKey = stableKey
    row.id = localKey
    row.sourceId = stableKey
  } else if (config.numeric) {
    localKey = existing ? Number(existing) : await nextNumericId(config.table, config.key)
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
}

export async function deleteStructuredObject(workspaceId: string, objectId: string) {
  const objectMapping = await mapping(workspaceId, objectId)
  if (!objectMapping || objectMapping.relativePath) return false
  const separator = objectMapping.localIdentity.indexOf(':')
  if (separator < 1) return false
  const domain = objectMapping.localIdentity.slice(0, separator)
  if (!(domain in DOMAIN_CONFIG)) return false
  const config = DOMAIN_CONFIG[domain as StructuredDomain]
  const localKey = objectMapping.localIdentity.slice(separator + 1)
  const database = await getDb()
  await suppressSyncTriggers(async () => {
    if (domain === 'tag') {
      const { delTag } = await import('@/db/tags')
      await delTag(Number(localKey), { sync: false })
      return
    }
    if (domain === 'mark') {
      return database.execute(
        `update marks set deleted = 1, createdAt = $1
         where sourceId = $2 or cast(id as text) = $2`,
        [Date.now(), localKey]
      ).then(() => undefined)
    }
    if (domain === 'canvas') {
      return database.execute(
        `update canvases set deletedAt = $1, updatedAt = $1 where id = $2`,
        [Date.now(), localKey]
      ).then(() => undefined)
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
    if (local[key] !== nextValue) await store.set(key, nextValue)
  }
  await store.save()
}

async function mappedNumericId(workspaceId: string, objectId: string, expectedDomain: string) {
  const localKey = await mappingLocalKey(workspaceId, objectId)
  if (!localKey) throw new Error(`structured_dependency_missing:${expectedDomain}`)
  const value = Number(localKey)
  if (!Number.isInteger(value)) throw new Error(`structured_dependency_invalid:${expectedDomain}`)
  return value
}

async function nextNumericId(table: string, key: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ nextId: number }>>(
    `select coalesce(max(${key}), 0) + 1 as nextId from ${table}`
  )
  return rows[0]?.nextId ?? 1
}

async function mappingLocalKey(workspaceId: string, objectId: string) {
  const value = await mapping(workspaceId, objectId)
  if (!value) return null
  const separator = value.localIdentity.indexOf(':')
  return separator < 0 ? value.localIdentity : value.localIdentity.slice(separator + 1)
}

async function mapping(workspaceId: string, objectId: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ localIdentity: string; relativePath: string | null }>>(
    `select local_identity as localIdentity, relative_path as relativePath
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
