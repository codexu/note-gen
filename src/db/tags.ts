import emitter from '@/lib/emitter'
import { getDb, executeRecordTransaction } from "./index"
import { Store } from '@tauri-apps/plugin-store';
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import { tagPathMatches } from '@/lib/record-tags'

export interface Tag {
  id: number
  name: string
  isLocked?: boolean
  isPin?: boolean
  sortOrder?: number
  total?: number
}

function enqueueRecordsAutoSync(reason: string) {
  enqueueAutoDataSync('records', reason)
  emitter.emit('plugin-records-changed')
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
  return db.select<Tag[]>(`
    with membership as (
      select id as markId, tagId from marks where deleted = 0
      union
      select marks.id, related.value from marks
      join record_tag_metadata metadata on metadata.markId = marks.id
      join json_each(metadata.tagIds) related
      where marks.deleted = 0
    ), totals as (
      select parent.id, count(distinct membership.markId) as total from tags parent
      join tags child on child.id = parent.id or substr(child.name, 1, length(parent.name) + 1) = parent.name || '/'
      join membership on membership.tagId = child.id
      group by parent.id
    )
    select tags.*, coalesce(totals.total, 0) as total from tags
    left join totals on totals.id = tags.id order by tags.sortOrder, tags.id
  `)
}

export async function insertTag(tag: Partial<Tag>) {
  const db = await getDb();
  const name = normalizeTagName(tag.name)
  const existing = await db.select<Tag[]>('select id from tags where name = $1', [name])
  if (existing[0]) return { rowsAffected: 0, lastInsertId: existing[0].id }
  const result = await db.execute('insert into tags (name) values ($1)', [name])
  enqueueRecordsAutoSync('tag:insert')
  return result
}

export async function updateTag(tag: Tag) {
  const db = await getDb();
  const allTags = await db.select<Tag[]>('select * from tags')
  const previous = allTags.find(item => item.id === tag.id)
  if (!previous) throw new Error('Tag not found')
  const name = tag.name === previous.name ? previous.name : normalizeTagName(tag.name)
  const affected = allTags.filter(item => tagPathMatches(item.name, previous.name))
  if (name !== previous.name) {
    if (previous.isLocked) throw new Error('Cannot rename the default tag')
    const affectedIds = new Set(affected.map(item => item.id))
    const remainingNames = new Set(allTags.filter(item => !affectedIds.has(item.id)).map(item => item.name))
    if (affected.some(item => remainingNames.has(name + item.name.slice(previous.name.length)))) {
      throw new Error('A tag with this path already exists')
    }
  }
  const result = await db.execute(
    `update tags set
      name = case when id = $5 then $1 else $1 || substr(name, length($6) + 1) end,
      isLocked = case when id = $5 then $2 else isLocked end,
      isPin = case when id = $5 then $3 else isPin end,
      sortOrder = case when id = $5 then $4 else sortOrder end
      where id = $5 or ($1 != $6 and substr(name, 1, length($6) + 1) = $6 || '/')`,
    [name, previous.isLocked ?? false, tag.isPin ?? previous.isPin ?? false, tag.sortOrder ?? previous.sortOrder ?? 0, tag.id, previous.name]
  )
  enqueueRecordsAutoSync('tag:update')
  void import('@/lib/knowledge-index').then(({ enqueueKnowledgeSourceIndex }) => {
    void getDb().then(async database => {
      const marks = await database.select<Array<{ id: number }>>(`select id from marks where deleted = 0 and (
        tagId in (select value from json_each($1)) or exists (
          select 1 from record_tag_metadata metadata, json_each(metadata.tagIds) related
          where metadata.markId = marks.id and related.value in (select value from json_each($1))
        ))`, [JSON.stringify(affected.map(item => item.id))])
      for (const mark of marks) {
        await database.execute(
          "update knowledge_sources set status = 'pending', indexed_hash = null, error = null where source_key = $1",
          [`record:${mark.id}`]
        )
      }
      marks.forEach(mark => enqueueKnowledgeSourceIndex(`record:${mark.id}`))
    })
  })
  return result
}

export async function delTag(id: number, options: { sync?: boolean } = {}) {
  const db = await getDb();
  const tags = await db.select<Tag[]>('select * from tags order by isLocked desc, id')
  const target = tags.find(tag => tag.id === id)
  if (!target) return { rowsAffected: 0 }
  if (target.isLocked || tags.length < 2) throw new Error('Cannot delete the default or last tag')
  const fallback = tags.find(tag => tag.id !== id)!
  // Move records first, including trash, so removing a tag never hides content.
  await executeRecordTransaction([{
    sql: `update tags set name = name where id = $1 and isLocked = false
      and exists (select 1 from tags where id = $2)`, values: [id, fallback.id], expectedRows: 1,
  }, { sql: `update marks set tagId = coalesce((
    select cast(related.value as integer) from record_tag_metadata metadata, json_each(metadata.tagIds) related
    join tags available on available.id = related.value
    where metadata.markId = marks.id and related.value != $1 order by available.id limit 1
  ), $2) where tagId = $1`, values: [id, fallback.id] }, {
    sql: `update record_tag_metadata set tagIds = (
    select json_group_array(value) from json_each(tagIds) where value != $1
  ), updatedAt = $2 where exists (select 1 from json_each(tagIds) where value = $1)`, values: [id, Date.now()] }, {
    sql: 'delete from tags where id = $1', values: [id], expectedRows: 1,
  }])
  const store = await Store.load('store.json')
  if (await store.get<number>('currentTagId') === id) {
    await store.set('currentTagId', fallback.id)
    await store.save()
  }
  if (options.sync !== false) enqueueRecordsAutoSync('tag:delete')
  void import('@/lib/knowledge-index').then(({ reconcileStructuredKnowledgeSources }) => reconcileStructuredKnowledgeSources())
  return { rowsAffected: 1 }
}

export function normalizeTagName(value?: string): string {
  const name = (value || '').trim().replace(/^#/, '').split('/').map(part => part.trim()).join('/')
  if (!name || name.split('/').some(part => !part)) throw new Error('Tag paths must have non-empty segments')
  return name
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
  enqueueRecordsAutoSync('tag:bulk-insert')
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
  enqueueRecordsAutoSync('tag:reorder')
  return true;
}
