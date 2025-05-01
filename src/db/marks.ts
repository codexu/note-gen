import { getDb } from "./index"
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"

export interface Mark {
  id: number
  tagId: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file'
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
  return await db.select<Mark[]>(`select * from marks where tagId = ${id} order by createdAt desc`)
}

export async function insertMark(mark: Partial<Mark>) {
  const db = await getDb();
  return await db.execute(`insert into marks (tagId, type, content, url, desc, createdAt, deleted) values (
      '${mark.tagId}',
      ${mark.type ? `'${mark.type}'`: null},
      ${mark.content ? `"${encodeURIComponent(mark?.content)}"`: null},
      ${mark.url ? `'${mark.url}'`: null},
      ${mark.desc ? `'${mark.desc}'`: null},
      ${Date.now()},
      0
    )
  `)
}

export async function getAllMarks() {
  const db = await getDb();
  return await db.select<Mark[]>(`select * from marks order by createdAt desc`)
}

export async function updateMark(mark: Mark) {
  const db = await getDb();
  return await db.execute(`
    update marks set 
    tagId = ${mark.tagId},
    url = "${mark.url}",
    desc = "${mark.desc}",
    content = ${mark.content ? `"${encodeURIComponent(mark?.content)}"`: null},
    createdAt = ${mark.createdAt}
    where id = ${mark.id}`
  )
}

export async function restoreMark(id: number) {
  const db = await getDb();
  return await db.execute(`update marks set deleted = 0, createdAt = ${Date.now()} where id = ${id}`)
}

export async function delMark(id: number) {
  const db = await getDb();
  // 判断有没有 deleted 列，没有就添加
  const res = await db.select<Mark[]>(`select * from marks where id = ${id}`)
  if (res[0].deleted === undefined) {
    await db.execute(`alter table marks add column deleted integer default 0`)
  }
  return await db.execute(`update marks set deleted = 1, createdAt = ${Date.now()} where id = ${id}`)
}

export async function delMarkForever(id: number) {
  const db = await getDb();
  return await db.execute(`delete from marks where id = ${id}`)
}

export async function clearTrash() {
  const db = await getDb();
  return await db.execute(`delete from marks where deleted = 1`)
}