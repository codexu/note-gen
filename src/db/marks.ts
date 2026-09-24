import emitter from '@/lib/emitter'
import { getDb, executeRecordTransaction, type RecordStatement } from "./index"
import { normalizeTagName } from './tags'
import { BaseDirectory, exists, mkdir, remove } from "@tauri-apps/plugin-fs"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import {
  getMarkLocalAssetPath,
  getMarkLocalAssetPaths,
  queueRecordAssetRemoteDeletions,
} from '@/lib/sync/record-assets'
import { getRecordImageThumbnailPath } from '@/lib/record-image-thumbnail'
import { recordTagIds } from '@/lib/record-tags'

export { getMarkLocalAssetPath }

export interface Mark {
  id: number
  tagId: number
  /** The primary tag remains tagId for compatibility with chats and save targets. */
  tagIds?: number[]
  tagUpdatedAt?: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  content?: string
  desc?: string
  url: string
  deleted: 0 | 1
  createdAt: number
  sourceId?: string | null
}

const MARK_COLUMNS = 'id, tagId, type, content, url, desc, deleted, createdAt, sourceId'

// Match the exact tag or its descendants; substr avoids LIKE wildcard surprises.
export const RECORD_TAG_MATCH_SQL = `marks.tagId = $1 or exists (
  select 1 from tags candidate join tags parent on parent.id = $1
  where (candidate.id = parent.id or substr(candidate.name, 1, length(parent.name) + 1) = parent.name || '/')
  and (candidate.id = marks.tagId or exists (
    select 1 from record_tag_metadata metadata, json_each(metadata.tagIds) related
    where metadata.markId = marks.id and related.value = candidate.id
  ))
)`

export async function attachMarkTagIds(marks: Mark[]): Promise<Mark[]> {
  if (marks.length === 0) return marks
  const db = await getDb()
  const tagIdsByMark = new Map<number, number[]>()
  const tagUpdatedAtByMark = new Map<number, number>()
  // Stay below SQLite's bind parameter limit for large collections.
  for (let offset = 0; offset < marks.length; offset += 400) {
    const batch = marks.slice(offset, offset + 400)
    const rows = await db.select<Array<{ markId: number; tagIds: string; updatedAt: number }>>(
      `select markId, tagIds, updatedAt from record_tag_metadata where markId in (${batch.map((_, index) => `$${index + 1}`).join(',')})`,
      batch.map(mark => mark.id),
    )
    for (const row of rows) {
      tagUpdatedAtByMark.set(row.markId, row.updatedAt)
      try { tagIdsByMark.set(row.markId, JSON.parse(row.tagIds)) } catch { /* Legacy primary tag remains usable. */ }
    }
  }
  return marks.map(mark => ({ ...mark, tagIds: recordTagIds({ tagId: mark.tagId, tagIds: tagIdsByMark.get(mark.id) }), tagUpdatedAt: tagUpdatedAtByMark.get(mark.id) ?? 0 }))
}

/** Omitted metadata means preserve existing tags, not clear them. One statement is atomic. */
export async function saveMarkTagIds(markId: number, tagId: number, tagIds?: number[], updatedAt = 0) {
  if (!Array.isArray(tagIds)) return
  const db = await getDb()
  await db.execute(`
    insert into record_tag_metadata (markId, tagIds, updatedAt)
    select id, $2, $3 from marks where id = $1
    on conflict(markId) do update set tagIds = excluded.tagIds, updatedAt = excluded.updatedAt
  `, [markId, JSON.stringify(recordTagIds({ tagId, tagIds })), Number.isFinite(updatedAt) ? updatedAt : 0])
}

/** Tag-only edits never write a stale copy of the record's content. */
export async function updateRecordTags(id: number, tagIds: number[], expectedTagIds?: number[], newNames: string[] = [], expectedPrimary?: number) {
  const mark = await getMarkById(id)
  if (!mark || mark.deleted) throw new Error('Record not found')
  const db = await getDb()
  const tags = await db.select<Array<{ id: number }>>('select id from tags')
  const valid = new Set(tags.map(tag => tag.id))
  const next = recordTagIds({ tagId: mark.tagId, tagIds: tagIds.filter(tagId => valid.has(tagId)) })
  const expected = expectedTagIds || recordTagIds(mark)
  const names = [...new Set(newNames.map(normalizeTagName))]
  const statements: RecordStatement[] = [{
    sql: `update marks set sourceId = sourceId where id = $1 and deleted = 0 and tagId = $3 and
      coalesce((select tagIds from record_tag_metadata where markId = marks.id), json_array(tagId)) = $2`,
    values: [id, JSON.stringify([...expected].sort((a, b) => a - b)), expectedPrimary ?? mark.tagId],
    expectedRows: 1,
  }]
  for (const name of names) statements.push({
    sql: 'insert into tags (name) select $1 where not exists (select 1 from tags where name = $1)', values: [name],
  })
  statements.push({
    sql: `insert into record_tag_metadata (markId, tagIds, updatedAt)
      select id, (select json_group_array(value) from (
        select tags.id as value from tags where tags.id in (select value from json_each($2))
          or tags.name in (select value from json_each($3))
        union select marks.tagId order by value
      )), $4 from marks where id = $1
      on conflict(markId) do update set tagIds = excluded.tagIds, updatedAt = excluded.updatedAt`,
    values: [id, JSON.stringify(next), JSON.stringify(names), Date.now()], expectedRows: 1,
  })
  await executeRecordTransaction(statements)
  enqueueRecordsAutoSync('mark:update-tags')
  await invalidateMarkKnowledgeIndex(id).catch(error => console.error('Record index invalidation failed:', error))
  enqueueMarkKnowledgeIndex(id)
}

async function deleteMarkLocalAsset(assetPath: string) {
  const fileExists = await exists(assetPath, { baseDir: BaseDirectory.AppData })
  if (!fileExists) {
    return
  }

  await remove(assetPath, { baseDir: BaseDirectory.AppData })
}

async function deleteMarkLocalAssets(marks: Pick<Mark, 'type' | 'url' | 'content'>[]) {
  const assetPaths = Array.from(new Set(marks.flatMap(getMarkLocalAssetPaths)))
  for (const assetPath of assetPaths) {
    try {
      await deleteMarkLocalAsset(assetPath)
    } catch (error) {
      console.error('Error deleting mark local asset:', assetPath, error)
    }
  }
}

function enqueueRecordsAutoSync(reason: string) {
  enqueueAutoDataSync('records', reason)
  emitter.emit('plugin-records-changed')
}

function enqueueMarkKnowledgeIndex(id?: number | null) {
  if (!id) return
  void import('@/lib/knowledge-index').then(({ enqueueKnowledgeSourceIndex }) => {
    enqueueKnowledgeSourceIndex(`record:${id}`)
  })
}

async function invalidateMarkKnowledgeIndex(id: number) {
  const db = await getDb()
  try {
    await db.execute(
      "update knowledge_sources set status = 'pending', indexed_hash = null, error = null where source_key = $1",
      [`record:${id}`]
    )
  } catch {
    // 数据库首次初始化时来源注册表可能尚未创建。
  }
}

async function removeMarkKnowledgeIndex(id: number) {
  const { removeKnowledgeSourceIndex } = await import('@/lib/knowledge-index')
  await removeKnowledgeSourceIndex(`record:${id}`)
}

function reconcileRecordKnowledgeIndex() {
  void import('@/lib/knowledge-index').then(({ reconcileStructuredKnowledgeSources }) => {
    void reconcileStructuredKnowledgeSources()
  })
}


// 创建 marks 表
export async function initMarksDb() {
  const isExist = await exists('screenshot', { baseDir: BaseDirectory.AppData})
  if (!isExist) {
    await mkdir('screenshot', { baseDir: BaseDirectory.AppData})
  }
  const isImageDirExist = await exists('image', { baseDir: BaseDirectory.AppData })
  if (!isImageDirExist) {
    await mkdir('image', { baseDir: BaseDirectory.AppData })
  }
  const isRecordingDirExist = await exists('recordings', { baseDir: BaseDirectory.AppData })
  if (!isRecordingDirExist) {
    await mkdir('recordings', { baseDir: BaseDirectory.AppData })
  }
  const isTempScreenshotDirExist = await exists('temp_screenshot', { baseDir: BaseDirectory.AppData })
  if (isTempScreenshotDirExist) {
    await remove('temp_screenshot', { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

export async function getMarks(id: number) {
  const db = await getDb();
  const marks = await db.select<Mark[]>(`
    select ${MARK_COLUMNS} from marks
    where ${RECORD_TAG_MATCH_SQL}
    order by createdAt desc
  `, [id])
  return attachMarkTagIds(marks)
}

export async function getMarkPreviews(id?: number) {
  const db = await getDb()
  const marks = await db.select<Mark[]>(`
    select
      id,
      tagId,
      type,
      substr(content, 1, 500) as content,
      url,
      substr(desc, 1, 500) as desc,
      deleted,
      createdAt
    from marks
    where ($1 is null or ${RECORD_TAG_MATCH_SQL}) and deleted = 0
    order by createdAt desc
  `, [id ?? null])
  return attachMarkTagIds(marks)
}

export async function getTrashMarkPreviews() {
  const db = await getDb()
  const marks = await db.select<Mark[]>(`
    select
      id,
      tagId,
      type,
      substr(content, 1, 500) as content,
      url,
      substr(desc, 1, 500) as desc,
      deleted,
      createdAt
    from marks
    where deleted = 1
    order by createdAt desc
  `)
  return attachMarkTagIds(marks)
}

export async function getMarkById(id: number) {
  const db = await getDb()
  const marks = await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks where id = $1`, [id])
  return (await attachMarkTagIds(marks))[0]
}

export async function updateMarkTag(id: number, tagId: number) {
  const db = await getDb()
  const result = await db.execute("update marks set tagId = $1 where id = $2", [tagId, id])
  enqueueRecordsAutoSync('mark:update-tag')
  await invalidateMarkKnowledgeIndex(id)
  enqueueMarkKnowledgeIndex(id)
  return result
}

export async function insertMark(mark: Partial<Mark>, beforeWrite?: () => Promise<void>) {
  const db = await getDb();
  await beforeWrite?.()
  const createdAt = Date.now();
  const sourceId = mark.sourceId ?? crypto.randomUUID()
  const result = await db.execute(
    "insert into marks (tagId, type, content, url, desc, createdAt, deleted, sourceId) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [mark.tagId, mark.type, mark.content, mark.url, mark.desc, createdAt, 0, sourceId]
  )
  if (result.lastInsertId) await saveMarkTagIds(result.lastInsertId, mark.tagId!, mark.tagIds, Date.now())

  const localImagePath = mark.type && mark.url
    ? getMarkLocalAssetPath({ type: mark.type, url: mark.url })
    : null
  if (localImagePath) {
    await getRecordImageThumbnailPath(localImagePath, 96)
  }

  const preview = truncateActivityText(mark.desc || mark.content || mark.url || '', 140)

  await insertActivityEvent({
    source: 'record',
    title: preview || mark.type || 'record',
    description: preview || mark.type || '',
    tagId: mark.tagId ?? null,
    dedupeKey: result.lastInsertId ? `record:${result.lastInsertId}` : `record:${createdAt}:${mark.type || 'record'}`,
    createdAt,
  })

  enqueueRecordsAutoSync('mark:insert')
  enqueueMarkKnowledgeIndex(result.lastInsertId)

  return result
}

export async function insertExternalMark(mark: Partial<Mark> & { sourceId: string }) {
  const db = await getDb()
  const existing = await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks where sourceId = $1 limit 1`, [mark.sourceId])
  if (existing[0]) {
    return { mark: existing[0], duplicate: true }
  }

  try {
    const result = await insertMark(mark)
    const inserted = result.lastInsertId ? await getMarkById(result.lastInsertId) : undefined
    if (!inserted) {
      throw new Error('Failed to load the saved external record')
    }
    return { mark: inserted, duplicate: false }
  } catch (error) {
    const duplicate = await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks where sourceId = $1 limit 1`, [mark.sourceId])
    if (duplicate[0]) {
      return { mark: duplicate[0], duplicate: true }
    }
    throw error
  }
}

export async function getAllMarks() {
  const db = await getDb();
  return attachMarkTagIds(await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks order by createdAt desc`))
}

export async function updateMark(mark: Mark) {
  const db = await getDb();
  const previousMarks = await db.select<Mark[]>("select type, url, content from marks where id = $1", [mark.id])
  const res = await db.execute(
    "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5 where id = $6",
    [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.id]
  )
  const previousMark = previousMarks[0]
  if (
    previousMark &&
    JSON.stringify(getMarkLocalAssetPaths(previousMark).sort())
      !== JSON.stringify(getMarkLocalAssetPaths(mark).sort())
  ) {
    await queueRecordAssetRemoteDeletions([previousMark])
  }
  enqueueRecordsAutoSync('mark:update')
  await invalidateMarkKnowledgeIndex(mark.id)
  enqueueMarkKnowledgeIndex(mark.id)
  return res 
}

export async function restoreMark(id: number) {
  const db = await getDb();
  const createdAt = Date.now();
  const result = await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [0, createdAt, id]
  )
  enqueueRecordsAutoSync('mark:restore')
  enqueueMarkKnowledgeIndex(id)
  return result
}

export async function delMark(id: number) {
  const db = await getDb();
  // 判断有没有 deleted 列，没有就添加
  const res = await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks where id = $1`, [id])
  if (res[0].deleted === undefined) {
    await db.execute("alter table marks add column deleted integer default 0")
  }
  const createdAt = Date.now();
  const result = await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [1, createdAt, id]
  )
  enqueueRecordsAutoSync('mark:delete')
  await removeMarkKnowledgeIndex(id)
  return result
}

export async function deleteAllMarks() {
  const db = await getDb();
  const marks = await getAllMarks()
  const result = await db.execute("delete from marks")
  enqueueRecordsAutoSync('mark:delete-all')
  await Promise.all(marks.map(mark => removeMarkKnowledgeIndex(mark.id)))
  return result
}

export async function insertMarks(marks: Partial<Mark>[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      if (mark.id) {
        const exists = await db.select<Mark[]>(`select ${MARK_COLUMNS} from marks where id = $1`, [mark.id])
        if (exists.length > 0) {
          const sourceId = mark.sourceId ?? exists[0]!.sourceId ?? crypto.randomUUID()
          await db.execute(
            "update marks set tagId = $1, type = $2, content = $3, url = $4, desc = $5, createdAt = $6, deleted = $7, sourceId = $8 where id = $9",
            [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted, sourceId, mark.id]
          );
          await saveMarkTagIds(mark.id, mark.tagId!, mark.tagIds, mark.tagUpdatedAt)
          continue
        }

        const sourceId = mark.sourceId ?? crypto.randomUUID()
        await db.execute(
          "insert into marks (id, tagId, type, content, url, desc, createdAt, deleted, sourceId) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [mark.id, mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted, sourceId]
        );
        await saveMarkTagIds(mark.id, mark.tagId!, mark.tagIds, mark.tagUpdatedAt)
        continue
      }

      const sourceId = mark.sourceId ?? crypto.randomUUID()
      const result = await db.execute(
        "insert into marks (tagId, type, content, url, desc, createdAt, deleted, sourceId) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted, sourceId]
      );
      if (result.lastInsertId) await saveMarkTagIds(result.lastInsertId, mark.tagId!, mark.tagIds, mark.tagUpdatedAt)
    }
    enqueueRecordsAutoSync('mark:bulk-insert')
    reconcileRecordKnowledgeIndex()
  } catch (error) {
    console.error('Error inserting marks:', error);
    throw error;
  }
}

export async function delMarkForever(id: number) {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url, content from marks where id = $1", [id])
  await queueRecordAssetRemoteDeletions(marks)
  await deleteMarkLocalAssets(marks)
  const result = await db.execute("delete from marks where id = $1", [id])
  enqueueRecordsAutoSync('mark:delete-forever')
  await removeMarkKnowledgeIndex(id)
  return result
}

export async function clearTrash() {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select id, type, url, content from marks where deleted = $1", [1])
  await queueRecordAssetRemoteDeletions(marks)
  await deleteMarkLocalAssets(marks)
  const result = await db.execute("delete from marks where deleted = $1", [1])
  enqueueRecordsAutoSync('mark:clear-trash')
  await Promise.all(marks.map(mark => removeMarkKnowledgeIndex(mark.id)))
  return result
}

export async function updateMarks(marks: Mark[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      await db.execute(
        "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5 where id = $6",
        [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-update')
    for (const mark of marks) await invalidateMarkKnowledgeIndex(mark.id)
    reconcileRecordKnowledgeIndex()
  } catch (error) {
    console.error('Error updating marks:', error);
    throw error;
  }
}

export async function deleteMarks(ids: number[]) {
  const db = await getDb();
  const createdAt = Date.now();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, createdAt = $2 where id = $3",
        [1, createdAt, id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-delete')
    await Promise.all(ids.map(removeMarkKnowledgeIndex))
  } catch (error) {
    console.error('Error deleting marks:', error);
    throw error;
  }
}

export async function restoreMarks(ids: number[]) {
  const db = await getDb();
  const createdAt = Date.now();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, createdAt = $2 where id = $3",
        [0, createdAt, id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-restore')
    ids.forEach(enqueueMarkKnowledgeIndex)
  } catch (error) {
    console.error('Error restoring marks:', error);
    throw error;
  }
}

/** Compare the complete old row in SQL so a plugin cannot overwrite concurrent edits. */
export async function updatePluginTextRecord(previous: Mark, next: Mark, beforeWrite: () => Promise<void>) {
  const db = await getDb()
  await beforeWrite()
  const result = await db.execute(
    `update marks set tagId = $1, content = $2, desc = $3
     where id = $4 and deleted = 0 and type = $5 and tagId = $6
     and content is $7 and desc is $8 and url is $9 and createdAt = $10 and sourceId is $11
     and coalesce((select tagIds from record_tag_metadata where markId = marks.id), json_array(tagId)) = $12
     and exists (select 1 from tags where id = $1)`,
    [next.tagId, next.content, next.desc, previous.id, previous.type, previous.tagId,
      previous.content ?? null, previous.desc ?? null, previous.url, previous.createdAt, previous.sourceId ?? null, JSON.stringify(recordTagIds(previous))],
  )
  if (result.rowsAffected) {
    enqueueRecordsAutoSync('mark:plugin-update')
    await invalidateMarkKnowledgeIndex(previous.id)
    enqueueMarkKnowledgeIndex(previous.id)
  }
  return result.rowsAffected > 0
}
