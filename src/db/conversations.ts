import { getDb } from "./index"
import { v4 as uuid, v5 as uuidv5 } from 'uuid'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import {
  nextConversationSyncTimestamp,
  upsertConversationSyncTombstone,
} from './conversation-sync-state'

const LEGACY_CONVERSATION_SYNC_NAMESPACE = 'da62245d-39f7-4135-936f-792b8da63706'

function enqueueConversationAutoSync(reason: string) {
  enqueueAutoDataSync('conversations', reason)
}

export interface Conversation {
  id: number
  syncId: string
  syncUpdatedAt: number
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  isPinned: boolean
}

// 创建 conversations 表
export async function initConversationsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists conversations (
      id integer primary key autoincrement,
      title text not null,
      createdAt integer not null,
      updatedAt integer not null,
      messageCount integer default 0,
      isPinned integer default 0
    )
  `)

  // 创建索引
  await db.execute(`
    create index if not exists idx_conversations_created on conversations(createdAt desc)
  `)
  await db.execute(`
    create index if not exists idx_conversations_updated on conversations(updatedAt desc)
  `)

  // 检查并添加 conversationId 列到 chats 表
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  try {
    await db.execute(`alter table conversations add column syncId text default null`)
  } catch {
    // Idempotent migration.
  }
  try {
    await db.execute(`alter table conversations add column syncUpdatedAt integer default null`)
  } catch {
    // Idempotent migration.
  }

  // 先创建兼容旧数据的默认会话，再为所有会话补齐同步标识。
  await migrateExistingChats()

  const legacyConversations = await db.select<Array<{
    id: number
    title: string
    createdAt: number
  }>>(
    `select id, title, createdAt
     from conversations where syncId is null or syncUpdatedAt is null`,
    []
  )
  for (const conversation of legacyConversations) {
    const syncId = uuidv5(
      JSON.stringify(['conversation', conversation.id, conversation.createdAt]),
      LEGACY_CONVERSATION_SYNC_NAMESPACE,
    )
    await db.execute(
      `update conversations
       set syncId = coalesce(syncId, $1), syncUpdatedAt = coalesce(syncUpdatedAt, updatedAt)
       where id = $2`,
      [syncId, conversation.id]
    )
  }
  await db.execute(
    `create unique index if not exists idx_conversations_sync_id on conversations(syncId)`
  )

}

// 迁移现有聊天记录到默认会话
async function migrateExistingChats() {
  const db = await getDb()

  // 获取所有现有聊天记录
  const allChats = await db.select<{ createdAt: number }[]>(
    "select createdAt from chats order by createdAt",
    []
  )

  // 如果没有聊天记录，不需要迁移
  if (allChats.length === 0) {
    return
  }

  // 检查是否有聊天记录没有 conversationId
  const chatsWithoutConversation = await db.select<{ id: number }[]>(
    "select id from chats where conversationId is null limit 1",
    []
  )

  // 如果所有聊天记录都已经有 conversationId，不需要迁移
  if (chatsWithoutConversation.length === 0) {
    return
  }

  // 检查是否已经有默认会话
  const existingConversations = await db.select<Conversation[]>(
    "select * from conversations where title = '历史对话' limit 1",
    []
  )

  let defaultConversationId: number

  if (existingConversations.length === 0) {
    // 创建历史会话
    const firstChat = allChats[0]
    const lastChat = allChats[allChats.length - 1]
    const result = await db.execute(
      "insert into conversations (title, createdAt, updatedAt, messageCount, isPinned) values ($1, $2, $3, $4, $5)",
      ['历史对话', firstChat.createdAt, lastChat.createdAt, allChats.length, 0]
    )
    defaultConversationId = result.lastInsertId as number

    // 更新所有现有聊天记录的 conversationId
    await db.execute(
      "update chats set conversationId = $1 where conversationId is null",
      [defaultConversationId]
    )
  } else {
    defaultConversationId = existingConversations[0].id
    // 更新所有没有 conversationId 的聊天记录
    await db.execute(
      "update chats set conversationId = $1 where conversationId is null",
      [defaultConversationId]
    )
  }
}

// 创建新会话
export async function createConversation(title: string): Promise<number> {
  const db = await getDb()
  const now = Date.now()
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  const result = await db.execute(
    "insert into conversations (syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned) values ($1, $2, $3, $4, $5, $6, $7)",
    [uuid(), syncUpdatedAt, title, now, now, 0, 0]
  )
  enqueueConversationAutoSync('conversation-created')
  return result.lastInsertId as number
}

// 获取所有会话
export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    "select * from conversations order by isPinned desc, updatedAt desc",
    []
  )
  return result
}

// 获取单个会话
export async function getConversation(id: number): Promise<Conversation | null> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    "select * from conversations where id = $1",
    [id]
  )
  return result[0] || null
}

export async function getConversationBySyncId(syncId: string): Promise<Conversation | null> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    "select * from conversations where syncId = $1",
    [syncId]
  )
  return result[0] || null
}

// 更新会话标题
export async function updateConversationTitle(id: number, title: string): Promise<void> {
  const db = await getDb()
  const now = await nextConversationSyncTimestamp()
  await db.execute(
    "update conversations set title = $1, updatedAt = $2, syncUpdatedAt = $2 where id = $3",
    [title, now, id]
  )
  enqueueConversationAutoSync('conversation-title-updated')
}

// 更新会话消息数量
export async function updateConversationMessageCount(id: number, delta: number): Promise<void> {
  const db = await getDb()
  const now = await nextConversationSyncTimestamp()
  await db.execute(
    "update conversations set messageCount = messageCount + $1, updatedAt = $2, syncUpdatedAt = $2 where id = $3",
    [delta, now, id]
  )
  enqueueConversationAutoSync('conversation-messages-updated')
}

// 更新会话的最后更新时间
export async function updateConversationTime(id: number): Promise<void> {
  const db = await getDb()
  const now = await nextConversationSyncTimestamp()
  await db.execute(
    "update conversations set updatedAt = $1, syncUpdatedAt = $1 where id = $2",
    [now, id]
  )
  enqueueConversationAutoSync('conversation-updated')
}

// 删除会话及其相关聊天记录
export async function deleteConversation(id: number): Promise<void> {
  const db = await getDb()
  const conversation = await getConversation(id)
  if (!conversation) return
  const messages = await db.select<Array<{ syncId: string }>>(
    'select syncId from chats where conversationId = $1 and syncId is not null',
    [id]
  )
  const deletedAt = await nextConversationSyncTimestamp()
  await upsertConversationSyncTombstone({
    entityType: 'conversation',
    syncId: conversation.syncId,
    conversationSyncId: conversation.syncId,
    deletedAt,
  })
  for (const message of messages) {
    await upsertConversationSyncTombstone({
      entityType: 'message',
      syncId: message.syncId,
      conversationSyncId: conversation.syncId,
      deletedAt,
    })
  }
  const optionalTables = await db.select<{ name: string }[]>(
    `select name from sqlite_master
     where type = 'table'
       and name in ('memory_conversation_policy', 'memory_jobs', 'conversation_compactions')`,
    []
  )
  const existingOptionalTables = new Set(optionalTables.map(table => table.name))

  // 这些关联表由可选功能在不同版本中引入，旧数据库中可能尚不存在。
  if (existingOptionalTables.has('memory_conversation_policy')) {
    await db.execute(
      "delete from memory_conversation_policy where conversation_id = $1",
      [id]
    )
  }
  if (existingOptionalTables.has('memory_jobs')) {
    await db.execute(
      "delete from memory_jobs where conversation_id = $1",
      [id]
    )
  }
  if (existingOptionalTables.has('conversation_compactions')) {
    await db.execute(
      "delete from conversation_compactions where conversationId = $1",
      [id]
    )
  }
  // 先删除会话的所有聊天记录
  await db.execute(
    "delete from chats where conversationId = $1",
    [id]
  )
  // 再删除会话
  await db.execute(
    "delete from conversations where id = $1",
    [id]
  )
  enqueueConversationAutoSync('conversation-deleted')
}

// 切换会话置顶状态
export async function toggleConversationPin(id: number): Promise<boolean> {
  const db = await getDb()
  const conv = await getConversation(id)
  if (!conv) return false

  const newPinState = conv.isPinned ? 0 : 1
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  await db.execute(
    "update conversations set isPinned = $1, syncUpdatedAt = $2 where id = $3",
    [newPinState, syncUpdatedAt, id]
  )
  enqueueConversationAutoSync('conversation-pin-updated')
  return !conv.isPinned
}

// 同步会话的消息数量（从实际消息重新统计）
export async function syncConversationMessageCount(conversationId: number): Promise<void> {
  const db = await getDb()
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from chats where conversationId = $1",
    [conversationId]
  )
  const actualCount = result[0]?.count || 0

  await db.execute(
    "update conversations set messageCount = $1 where id = $2 and messageCount <> $1",
    [actualCount, conversationId]
  )
}
