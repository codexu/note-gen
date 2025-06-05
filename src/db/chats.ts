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
      createdAt integer not null
    )
  `)
}

// 插入一条 chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  return await db.execute(`
    insert into chats (tagId, content, role, type, image, inserted, createdAt)
    values (?, ?, ?, ?, ?, ?, ?)
  `, [chat.tagId, chat.content, chat.role, chat.type, chat.image, chat.inserted ? 1 : 0, Date.now()])
}

// 获取所有 chats
export async function getChats(tagId: number) {
  const db = await getDb()
  return await db.select<Chat[]>(
    `select * from chats where tagId = ${tagId} order by createdAt`,
  )
}

// 更新一条 chat
export async function updateChat(chat: Chat) {
  const db = await getDb()
  return await db.execute(`
    update chats set content = ?, role = ?, type = ?, image = ?, inserted = ? where id = ?
  `, [chat.content, chat.role, chat.type, chat.image, chat.inserted ? 1 : 0, chat.id])
}

// 清空 tagId 下的所有 chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  return await db.execute(`
    delete from chats where tagId = ${tagId}
  `)
}

// 已插入
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  return await db.execute(`
    update chats set inserted = true where id = ${id}
  `)
}

// 删除一条 chat
export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute(`
    delete from chats where id = ${id}
  `)
}