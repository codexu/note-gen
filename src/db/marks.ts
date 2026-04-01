import { getDb } from "./index"
import { BaseDirectory, exists, mkdir, remove } from "@tauri-apps/plugin-fs"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'

export interface Mark {
  id: number
  tagId: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  content?: string
  desc?: string
  url: string
  deleted: 0 | 1
  createdAt: number
}

const HTTP_URL_PATTERN = /^https?:\/\//i

function isHttpUrl(path?: string): boolean {
  return !!path && HTTP_URL_PATTERN.test(path)
}

function normalizeStoredPath(path: string): string {
  return path.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

function getStoredFileName(path: string): string {
  const normalizedPath = normalizeStoredPath(path)
  const segments = normalizedPath.split('/')

  return segments[segments.length - 1] || ''
}

export function getMarkLocalAssetPath(mark: Pick<Mark, 'type' | 'url'>): string | null {
  if (!mark.url || isHttpUrl(mark.url)) {
    return null
  }

  if (mark.type === 'scan') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `screenshot/${fileName}` : null
  }

  if (mark.type === 'image') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `image/${fileName}` : null
  }

  if (mark.type === 'recording') {
    const relativePath = normalizeStoredPath(mark.url)
    return relativePath || null
  }

  return null
}

async function deleteMarkLocalAsset(mark: Pick<Mark, 'type' | 'url'>) {
  const assetPath = getMarkLocalAssetPath(mark)
  if (!assetPath) {
    return
  }

  const fileExists = await exists(assetPath, { baseDir: BaseDirectory.AppData })
  if (!fileExists) {
    return
  }

  await remove(assetPath, { baseDir: BaseDirectory.AppData })
}

async function deleteMarkLocalAssets(marks: Pick<Mark, 'type' | 'url'>[]) {
  for (const mark of marks) {
    try {
      await deleteMarkLocalAsset(mark)
    } catch (error) {
      console.error('Error deleting mark local asset:', mark.url, error)
    }
  }
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
  const result = await db.execute(
    "insert into marks (tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7)",
    [mark.tagId, mark.type,  mark.content, mark.url, mark.desc, createdAt, 0]
  )

  const preview = truncateActivityText(mark.desc || mark.content || mark.url || '', 140)

  await insertActivityEvent({
    source: 'record',
    title: preview || mark.type || 'record',
    description: preview || mark.type || '',
    tagId: mark.tagId ?? null,
    dedupeKey: result.lastInsertId ? `record:${result.lastInsertId}` : `record:${createdAt}:${mark.type || 'record'}`,
    createdAt,
  })

  return result
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
  const marks = await db.select<Mark[]>("select type, url from marks where id = $1", [id])
  await deleteMarkLocalAssets(marks)
  return await db.execute("delete from marks where id = $1", [id])
}

export async function clearTrash() {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url from marks where deleted = $1", [1])
  await deleteMarkLocalAssets(marks)
  return await db.execute("delete from marks where deleted = $1", [1])
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
  } catch (error) {
    console.error('Error restoring marks:', error);
    throw error;
  }
}
