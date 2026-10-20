import { getDb } from './index'

export type ConversationSyncTombstoneType = 'conversation' | 'message'

export interface ConversationSyncTombstone {
  entityType: ConversationSyncTombstoneType
  syncId: string
  conversationSyncId: string | null
  deletedAt: number
}

export async function initConversationSyncStateDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists conversation_sync_tombstones (
      entityType text not null,
      syncId text not null,
      conversationSyncId text default null,
      deletedAt integer not null,
      primary key (entityType, syncId)
    )
  `)
  await db.execute(`
    create index if not exists idx_conversation_sync_tombstones_conversation
    on conversation_sync_tombstones(conversationSyncId)
  `)
  await db.execute(`
    create table if not exists conversation_sync_clock (
      id integer primary key check (id = 1),
      value integer not null
    )
  `)
  await db.execute(
    'insert or ignore into conversation_sync_clock (id, value) values (1, 0)',
    []
  )
}

/**
 * Generates a timestamp that is monotonic for this database even when the
 * system clock moves backwards. Remote timestamps are observed during import,
 * so the next local edit also advances beyond data already seen from peers.
 */
export async function nextConversationSyncTimestamp() {
  const db = await getDb()
  await db.execute(
    'update conversation_sync_clock set value = max(value + 1, $1) where id = 1',
    [Date.now()]
  )
  const rows = await db.select<Array<{ value: number }>>(
    'select value from conversation_sync_clock where id = 1',
    []
  )
  return rows[0]?.value || Date.now()
}

export async function observeConversationSyncTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) return
  const db = await getDb()
  await db.execute(
    `insert into conversation_sync_clock (id, value) values (1, $1)
     on conflict(id) do update set value = max(conversation_sync_clock.value, excluded.value)`,
    [value]
  )
}

export async function upsertConversationSyncTombstone(
  tombstone: ConversationSyncTombstone
) {
  const db = await getDb()
  await db.execute(
    `insert into conversation_sync_tombstones (
       entityType, syncId, conversationSyncId, deletedAt
     ) values ($1, $2, $3, $4)
     on conflict(entityType, syncId) do update set
       conversationSyncId = excluded.conversationSyncId,
       deletedAt = max(conversation_sync_tombstones.deletedAt, excluded.deletedAt)`,
    [
      tombstone.entityType,
      tombstone.syncId,
      tombstone.conversationSyncId,
      tombstone.deletedAt,
    ]
  )
}

export async function getConversationSyncTombstones() {
  const db = await getDb()
  return await db.select<ConversationSyncTombstone[]>(
    `select entityType, syncId, conversationSyncId, deletedAt
     from conversation_sync_tombstones`,
    []
  )
}

export async function getConversationSyncTombstonesByConversation(
  conversationSyncId: string
) {
  const db = await getDb()
  return await db.select<ConversationSyncTombstone[]>(
    `select entityType, syncId, conversationSyncId, deletedAt
     from conversation_sync_tombstones
     where conversationSyncId = $1 or (entityType = 'conversation' and syncId = $1)`,
    [conversationSyncId]
  )
}
