import { getDb } from "./index"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'
import { v4 as uuid, v5 as uuidv5 } from 'uuid'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import {
  nextConversationSyncTimestamp,
  upsertConversationSyncTombstone,
} from './conversation-sync-state'

const LEGACY_CHAT_SYNC_NAMESPACE = '50fe78e8-9e50-4ef0-b7fb-7274bf2dd454'

function enqueueConversationAutoSync(reason: string) {
  enqueueAutoDataSync('conversations', reason)
}

async function touchConversationSyncVersion(conversationId?: number | null, at = Date.now()) {
  if (!conversationId) return
  const db = await getDb()
  await db.execute(
    'update conversations set syncUpdatedAt = $1 where id = $2',
    [at, conversationId]
  )
}

async function invalidateConversationCompactions(conversationIds: Iterable<number | null | undefined>) {
  const ids = Array.from(new Set(Array.from(conversationIds).filter(
    (id): id is number => typeof id === 'number' && id > 0
  )))
  if (ids.length === 0) return
  const db = await getDb()
  for (const conversationId of ids) {
    await db.execute(
      'delete from conversation_compactions where conversationId = $1',
      [conversationId]
    ).catch(() => undefined)
  }
}

export type Role = 'system' | 'user'
export type ChatType = 'chat' | 'note' | 'clipboard' | 'clear' | 'condensed' | 'model_change'

export interface Chat {
  id: number
  syncId?: string
  syncUpdatedAt?: number
  tagId?: number // 可选，用于兼容过渡期
  conversationId?: number // 关联的会话 ID
  content?: string
  role: Role
  type: ChatType
  image?: string
  images?: string // 多张图片，JSON字符串数组
  imageAnalyses?: string // 图片识别结果，JSON 字符串数组
  attachments?: string // 不含本地绝对路径的附件展示信息，JSON 字符串数组
  inserted: boolean // 是否插入到 mark 中
  createdAt: number
  ragSources?: string // RAG引用的文件名，JSON字符串数组
  ragSourceDetails?: string // RAG引用的详细信息，JSON字符串数组（包含文件路径和文本片段）
  agentHistory?: string // Agent执行历史，JSON字符串
  thinking?: string // AI 思考过程
  quoteData?: string // 引用信息，JSON字符串
  // 压缩相关字段
  condensedContent?: string    // 压缩后的摘要内容（存储在本条消息上）
  condensedAt?: number         // 压缩时间戳
}

// 创建 chats 表
export async function initChatsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists chats (
      id integer primary key autoincrement,
      tagId integer not null,
      content text default null,
      role text not null,
      type text not null,
      image text default null,
      images text default null,
      imageAnalyses text default null,
      attachments text default null,
      inserted boolean default false,
      createdAt integer not null,
      ragSources text default null,
      agentHistory text default null,
      thinking text default null,
      quoteData text default null
    )
  `)
  
  // 迁移：为现有表添加 ragSources 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSources text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
    // SQLite 会抛出 "duplicate column name" 错误
  }
  
  // 迁移：为现有表添加 agentHistory 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column agentHistory text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 images 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column images text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：保存图片识别状态和结果，供多轮对话继续引用
  try {
    await db.execute(`
      alter table chats add column imageAnalyses text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：附件历史只保存可同步的展示信息，不保存本地路径
  try {
    await db.execute(`
      alter table chats add column attachments text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 thinking 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column thinking text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }
  
  // 迁移：为现有表添加 quoteData 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column quoteData text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 ragSourceDetails 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSourceDetails text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedFrom 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedFrom text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 originalTokenCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalTokenCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 originalMessageCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalMessageCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedAt 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedAt integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 condensedContent 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedContent text default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // 迁移：为现有表添加 conversationId 列（如果不存在）
  // 注意：这个迁移已移到 conversations.ts 的 initConversationsDb 中执行
  // 这里保留是为了向后兼容，如果 conversations 初始化失败，这里会确保列存在
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  try {
    await db.execute(`alter table chats add column syncId text default null`)
  } catch {
    // Idempotent migration.
  }
  try {
    await db.execute(`alter table chats add column syncUpdatedAt integer default null`)
  } catch {
    // Idempotent migration.
  }

  const legacyChats = await db.select<Array<{
    id: number
    conversationId: number | null
    createdAt: number
    role: Role
    type: ChatType
    content: string | null
  }>>(
    `select id, conversationId, createdAt, role, type, content
     from chats where syncId is null or syncUpdatedAt is null`,
    []
  )
  for (const chat of legacyChats) {
    const syncId = uuidv5(
      JSON.stringify([
        'chat',
        chat.conversationId,
        chat.id,
        chat.createdAt,
        chat.role,
        chat.type,
      ]),
      LEGACY_CHAT_SYNC_NAMESPACE,
    )
    await db.execute(
      `update chats
       set syncId = coalesce(syncId, $1), syncUpdatedAt = coalesce(syncUpdatedAt, createdAt)
       where id = $2`,
      [syncId, chat.id]
    )
  }
  await db.execute(`create unique index if not exists idx_chats_sync_id on chats(syncId)`)
}

// 插入一条 chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  const createdAt = Date.now();
  const syncId = chat.syncId || uuid()
  const syncUpdatedAt = chat.syncUpdatedAt || await nextConversationSyncTimestamp()
  const result = await db.execute(
    "insert into chats (syncId, syncUpdatedAt, tagId, conversationId, content, role, type, image, images, imageAnalyses, attachments, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)",
    [syncId, syncUpdatedAt, chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
  )

  if (chat.role === 'user' && chat.content?.trim()) {
    await insertActivityEvent({
      source: 'chat',
      title: truncateActivityText(chat.content, 64),
      description: truncateActivityText(chat.content, 140),
      tagId: chat.tagId ?? null,
      dedupeKey: result.lastInsertId ? `chat:${result.lastInsertId}` : `chat:${createdAt}`,
      createdAt,
    })
  }

  await touchConversationSyncVersion(chat.conversationId, syncUpdatedAt)
  enqueueConversationAutoSync('chat-created')

  return result
}

// 获取所有 chats
export async function getChats(tagId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where tagId = $1 order by createdAt",
    [tagId]
  )
  return result
}

// 根据会话 ID 获取聊天记录（新方式）
export async function getChatsByConversation(conversationId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where conversationId = $1 order by createdAt",
    [conversationId]
  )
  return result
}

// 获取所有 chats（用于同步）
export async function getAllChats() {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats order by createdAt",
    []
  )
  return result
}

// 插入多条 chat（用于同步）
export async function insertChats(chats: Chat[]) {
  const db = await getDb()
  let fallbackConversationId: number | undefined
  if (chats.some(chat => !chat.conversationId)) {
    const now = Date.now()
    const syncUpdatedAt = await nextConversationSyncTimestamp()
    const result = await db.execute(
      `insert into conversations (
         syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), syncUpdatedAt, '新对话', now, now, 0, 0]
    )
    fallbackConversationId = result.lastInsertId as number
  }

  await db.execute('BEGIN TRANSACTION')
  try {
    for (const chat of chats) {
      const syncId = chat.syncId || uuid()
      const syncUpdatedAt = chat.syncUpdatedAt || await nextConversationSyncTimestamp()
      const conversationId = chat.conversationId || fallbackConversationId
      await db.execute(
        "insert into chats (syncId, syncUpdatedAt, tagId, conversationId, content, role, type, image, images, imageAnalyses, attachments, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)",
        [syncId, syncUpdatedAt, chat.tagId, conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, chat.createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  const conversationIds = new Set(chats.map(chat => chat.conversationId || fallbackConversationId))
  for (const conversationId of conversationIds) {
    await touchConversationSyncVersion(conversationId, syncUpdatedAt)
    if (conversationId) {
      const counts = await db.select<Array<{ count: number }>>(
        'select count(*) as count from chats where conversationId = $1',
        [conversationId]
      )
      await db.execute(
        'update conversations set messageCount = $1 where id = $2',
        [counts[0]?.count || 0, conversationId]
      )
    }
  }
  enqueueConversationAutoSync('chats-created')
}

// 删除所有 chats（用于同步）
export async function deleteAllChats() {
  const db = await getDb()
  return await db.execute(
    "delete from chats",
    []
  )
}

// 更新一条 chat
export async function updateChat(chat: Chat) {
  const db = await getDb()
  const existing = await db.select<Array<{ conversationId: number | null }>>(
    'select conversationId from chats where id = $1',
    [chat.id]
  )
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  const result = await db.execute(
    "update chats set tagId = $1, conversationId = $2, content = $3, role = $4, type = $5, image = $6, images = $7, imageAnalyses = $8, attachments = $9, inserted = $10, ragSources = $11, ragSourceDetails = $12, agentHistory = $13, thinking = $14, quoteData = $15, condensedContent = $16, condensedAt = $17, syncUpdatedAt = $18 where id = $19",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt, syncUpdatedAt, chat.id])
  await invalidateConversationCompactions([existing[0]?.conversationId, chat.conversationId])
  await touchConversationSyncVersion(chat.conversationId, syncUpdatedAt)
  enqueueConversationAutoSync('chat-updated')
  return result
}

// 清空 tagId 下的所有 chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  const chats = await db.select<Array<{ syncId: string; conversationId: number | null; conversationSyncId: string | null }>>(
    `select chats.syncId, chats.conversationId, conversations.syncId as conversationSyncId
     from chats left join conversations on conversations.id = chats.conversationId
     where chats.tagId = $1 and chats.syncId is not null`,
    [tagId]
  )
  const deletedAt = await nextConversationSyncTimestamp()
  for (const chat of chats) {
    await upsertConversationSyncTombstone({
      entityType: 'message',
      syncId: chat.syncId,
      conversationSyncId: chat.conversationSyncId,
      deletedAt,
    })
  }
  const result = await db.execute(
    "delete from chats where tagId = $1",
    [tagId])
  await invalidateConversationCompactions(chats.map(chat => chat.conversationId))
  for (const conversationId of new Set(chats.map(chat => chat.conversationId))) {
    await touchConversationSyncVersion(conversationId, deletedAt)
  }
  enqueueConversationAutoSync('messages-cleared')
  return result
}

export async function clearChatsByConversationId(conversationId: number) {
  const db = await getDb()
  const conversation = await db.select<Array<{ syncId: string }>>(
    'select syncId from conversations where id = $1',
    [conversationId]
  )
  const chats = await db.select<Array<{ syncId: string }>>(
    'select syncId from chats where conversationId = $1 and syncId is not null',
    [conversationId]
  )
  const deletedAt = await nextConversationSyncTimestamp()
  for (const chat of chats) {
    await upsertConversationSyncTombstone({
      entityType: 'message',
      syncId: chat.syncId,
      conversationSyncId: conversation[0]?.syncId || null,
      deletedAt,
    })
  }
  const result = await db.execute(
    'delete from chats where conversationId = $1',
    [conversationId]
  )
  await invalidateConversationCompactions([conversationId])
  await touchConversationSyncVersion(conversationId, deletedAt)
  enqueueConversationAutoSync('messages-cleared')
  return result
}

// 已插入
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  const chats = await db.select<Array<{ conversationId: number | null }>>(
    'select conversationId from chats where id = $1',
    [id]
  )
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  const result = await db.execute(
    "update chats set inserted = $1, syncUpdatedAt = $2 where id = $3",
    [true, syncUpdatedAt, id])
  await touchConversationSyncVersion(chats[0]?.conversationId, syncUpdatedAt)
  enqueueConversationAutoSync('chat-updated')
  return result
}

// 删除一条 chat
export async function deleteChat(id: number) {
  const db = await getDb()
  const chats = await db.select<Array<{ syncId: string; conversationId: number | null; conversationSyncId: string | null }>>(
    `select chats.syncId, chats.conversationId, conversations.syncId as conversationSyncId
     from chats left join conversations on conversations.id = chats.conversationId
     where chats.id = $1`,
    [id]
  )
  const chat = chats[0]
  const deletedAt = await nextConversationSyncTimestamp()
  if (chat?.syncId) {
    await upsertConversationSyncTombstone({
      entityType: 'message',
      syncId: chat.syncId,
      conversationSyncId: chat.conversationSyncId,
      deletedAt,
    })
  }
  const result = await db.execute(
    "delete from chats where id = $1",
    [id])
  await invalidateConversationCompactions([chat?.conversationId])
  await touchConversationSyncVersion(chat?.conversationId, deletedAt)
  enqueueConversationAutoSync('message-deleted')
  return result
}

export async function updateChats(chats: Chat[]) {
  try {
    for (const chat of chats) {
      await updateChat(chat)
    }
  } catch (error) {
    console.error('Error updating chats:', error);
    throw error;
  }
}

export async function deleteChats(ids: number[]) {
  try {
    for (const id of ids) {
      await deleteChat(id)
    }
  } catch (error) {
    console.error('Error deleting chats:', error);
    throw error;
  }
}

/**
 * 更新消息的压缩摘要内容
 * @param chatId 消息 ID
 * @param condensedContent 压缩摘要内容
 */
export async function updateChatCondensedContent(chatId: number, condensedContent: string) {
  const db = await getDb()
  try {
    await db.execute(
      "update chats set condensedContent = $1, condensedAt = $2 where id = $3",
      [condensedContent, Date.now(), chatId]
    )
  } catch (error) {
    console.error('Error updating chat condensed content:', error);
    throw error;
  }
}
