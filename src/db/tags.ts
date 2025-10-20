import { getDb } from "./index"
import { Store } from '@tauri-apps/plugin-store';

export interface Tag {
  id: number
  name: string
  isLocked?: boolean
  isPin?: boolean
  sortOrder?: number
  total?: number
}

// 创建 tags 表
export async function initTagsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists tags (
      id integer primary key autoincrement,
      name text not null,
      isLocked boolean DEFAULT false,
      isPin boolean DEFAULT false,
      sortOrder integer DEFAULT 0
    )
  `)
  
  // 检查 sortOrder 列是否存在，如果不存在则添加
  try {
    await db.execute("select sortOrder from tags limit 1")
  } catch {
    // sortOrder 列不存在，添加该列
    console.log('Adding sortOrder column to tags table')
    await db.execute("alter table tags add column sortOrder integer DEFAULT 0")
    
    // 为现有标签设置初始排序值
    const existingTags = await db.select<Tag[]>("select id from tags order by id asc")
    for (let i = 0; i < existingTags.length; i++) {
      await db.execute("update tags set sortOrder = $1 where id = $2", [i, existingTags[i].id])
    }
  }
  
  const hasDefaultTag = (await db.select<Tag[]>("select * from tags")).length === 0
  if (hasDefaultTag) {
    await db.execute(
      "insert into tags (name, isLocked, isPin) values ($1, $2, $3)",
      ['Idea', true, true]
    )
    const tag = (await db.select<Tag[]>("select * from tags where name = $1", ['Idea']))[0]
    const store = await Store.load('store.json');
    await store.set('currentTagId', tag.id)
    await store.save()
  }
}

export async function getTags() {
  const db = await getDb();
  const tags = await db.select<Tag[]>("select * from tags order by sortOrder asc, id asc")

  // 获取 tags 对应的 marks 数量
  for (const tag of tags) {
    // deleted = 0  
    const res = await db.select<{ total: number }[]>("select count(*) as total from marks where tagId = $1 and deleted = $2", [tag.id, 0])
    tag.total = res[0].total
  }

  return tags
}

export async function insertTag(tag: Partial<Tag>) {
  const db = await getDb();
  return await db.execute(
    "insert into tags (name) values ($1)",
    [tag.name]
  )
}

export async function updateTag(tag: Tag) {
  const db = await getDb();
  return await db.execute(
    "update tags set name = $1, isLocked = $2, isPin = $3, sortOrder = $4 where id = $5",
    [tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.id]
  )
}

export async function delTag(id: number) {
  const db = await getDb();
  return await db.execute("delete from tags where id = $1", [id])
}

export async function deleteAllTags() {
  const db = await getDb();
  return await db.execute("delete from tags where isLocked = false")
}

export async function insertTags(tags: Tag[]) {
  const db = await getDb();
  for (const tag of tags) {
    if (tag.isLocked) continue;
    const exists = await db.select<Tag[]>("select * from tags where id = $1", [tag.id])
    if (exists.length > 0) {
      await db.execute(
        "update tags set name = $1, isLocked = $2, isPin = $3, sortOrder = $4 where id = $5",
        [tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.id]
      )
    } else {
      await db.execute(
        "insert into tags (id, name, isLocked, isPin, sortOrder) values ($1, $2, $3, $4, $5)",
        [tag.id, tag.name, tag.isLocked, tag.isPin, tag.sortOrder]
      )
    }
  }
  return true;
}

export async function updateTagsOrder(tags: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  for (const tag of tags) {
    await db.execute(
      "update tags set sortOrder = $1 where id = $2",
      [tag.sortOrder, tag.id]
    )
  }
  return true;
}