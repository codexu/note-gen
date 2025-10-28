import { getDb } from "./index"
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"

export interface Mark {
  id: number
  tagId: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording'
  content?: string
  desc?: string
  url: string
  deleted: 0 | 1
  createdAt: number
}


// 创建 marks 表
export async function initMarksDb() {
  const isExist = await exists('screenshot', { baseDir: BaseDirectory.AppData})
  if (!isExist) {
    await mkdir('screenshot', { baseDir: BaseDirectory.AppData})
  }
  const db = await getDb()
  await db.execute(`
    create table if not exists marks (
      id integer primary key autoincrement,
      tagId integer not null,
      type text not null,
      content text default null,
      url text default null,
      desc text default null,
      deleted integer default 0,
      createdAt integer
    )
  `)
}

export async function getMarks(id: number) {
  const db = await getDb();
  // 根据 tagId 获取 marks，根据 createdAt 倒序
  return await db.select<Mark[]>("select * from marks where tagId = $1 order by createdAt desc", [id])
}

export async function insertMark(mark: Partial<Mark>) {
  const db = await getDb();
  const createdAt = Date.now();
  return await db.execute(
    "insert into marks (tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7)",
    [mark.tagId, mark.type,  mark.content, mark.url, mark.desc, createdAt, 0]
  )
}

export async function getAllMarks() {
  const db = await getDb();
  return await db.select<Mark[]>("select * from marks order by createdAt desc")
}

export async function updateMark(mark: Mark) {
  const db = await getDb();
  const res = await db.execute(
    "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5 where id = $6",
    [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.id]
  )
  return res 
}

export async function restoreMark(id: number) {
  const db = await getDb();
  const createdAt = Date.now();
  return await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [0, createdAt, id]
  )
}

export async function delMark(id: number) {
  const db = await getDb();
  // 判断有没有 deleted 列，没有就添加
  const res = await db.select<Mark[]>("select * from marks where id = $1", [id])
  if (res[0].deleted === undefined) {
    await db.execute("alter table marks add column deleted integer default 0")
  }
  const createdAt = Date.now();
  return await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [1, createdAt, id]
  )
}

export async function deleteAllMarks() {
  const db = await getDb();
  return await db.execute("delete from marks")
}

export async function insertMarks(marks: Partial<Mark>[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      await db.execute(
        "insert into marks (tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7)",
        [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted]
      );
    }
  } catch (error) {
    console.error('Error inserting marks:', error);
    throw error;
  }
}

export async function delMarkForever(id: number) {
  const db = await getDb();
  return await db.execute("delete from marks where id = $1", [id])
}

export async function clearTrash() {
  const db = await getDb();
  return await db.execute("delete from marks where deleted = $1", [1])
}