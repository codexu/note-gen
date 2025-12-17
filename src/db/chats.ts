import { getDb } from "./index"

export type Role = 'system' | 'user'
export type ChatType = 'chat' | 'note' | 'clipboard' | 'clear'

export interface Chat {
  id: number
  tagId: number
  content?: string
  role: Role
  type: ChatType
  image?: string
  inserted: boolean // 是否插入到 mark 中
  createdAt: number
  ragSources?: string // RAG引用的文件名，JSON字符串数组
  agentHistory?: string // Agent执行历史，JSON字符串
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
      inserted boolean default false,
      createdAt integer not null,
      ragSources text default null,
      agentHistory text default null
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
}

// 插入一条 chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  const createdAt = Date.now();
  return await db.execute(
    "insert into chats (tagId, content, role, type, image, inserted, createdAt, ragSources, agentHistory) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [chat.tagId, chat.content, chat.role, chat.type, chat.image, chat.inserted ? 1 : 0, createdAt, chat.ragSources, chat.agentHistory])
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
  for (const chat of chats) {
    await db.execute(
      "insert into chats (tagId, content, role, type, image, inserted, createdAt, ragSources) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [chat.tagId, chat.content, chat.role, chat.type, chat.image, chat.inserted ? 1 : 0, chat.createdAt, chat.ragSources]
    )
  }
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
  return await db.execute(
    "update chats set content = $1, role = $2, type = $3, image = $4, inserted = $5, ragSources = $6, agentHistory = $7 where id = $8",
    [chat.content, chat.role, chat.type, chat.image, chat.inserted ? 1 : 0, chat.ragSources, chat.agentHistory, chat.id])
}

// 清空 tagId 下的所有 chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where tagId = $1",
    [tagId])
}

// 已插入
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  return await db.execute(
    "update chats set inserted = $1 where id = $2",
    [true, id])
}

// 删除一条 chat
export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where id = $1",
    [id])
}