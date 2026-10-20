import { getDb } from './index'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import {
  DEFAULT_CANVAS_DOCUMENT,
  normalizeCanvasDocument,
  type CanvasDocument,
  type CanvasHistorySnapshot,
  type CanvasHistoryState,
  type CanvasProject,
  type CanvasProjectRow,
  type CanvasProjectType,
} from '@/types/canvas'

function parseHistoryStack(value?: string | null): CanvasHistorySnapshot[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((snapshot): snapshot is CanvasHistorySnapshot => (
        Boolean(snapshot)
        && typeof snapshot === 'object'
        && Array.isArray((snapshot as CanvasHistorySnapshot).nodes)
        && Array.isArray((snapshot as CanvasHistorySnapshot).edges)
      ))
      .slice(-50)
  } catch {
    return []
  }
}

function rowToProject(row: CanvasProjectRow): CanvasProject {
  let parsed: unknown = DEFAULT_CANVAS_DOCUMENT
  try {
    parsed = JSON.parse(row.content)
  } catch {
    parsed = DEFAULT_CANVAS_DOCUMENT
  }

  return {
    id: row.id,
    title: row.title,
    canvasType: row.canvasType,
    schemaVersion: row.schemaVersion,
    document: normalizeCanvasDocument(parsed),
    history: {
      undo: parseHistoryStack(row.undoStack),
      redo: parseHistoryStack(row.redoStack),
    },
    thumbnailPath: row.thumbnailPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pinnedAt: row.pinnedAt,
    deletedAt: row.deletedAt,
  }
}

function enqueueCanvasSync(reason: string) {
  enqueueAutoDataSync('records', reason)
}

async function recordCanvasProjectActivity(id: string, title: string, createdAt: number) {
  const { recordCanvasActivity } = await import('./activity')
  await recordCanvasActivity({ id, title, createdAt })
}

function enqueueCanvasKnowledgeIndex(id: string) {
  void import('@/lib/knowledge-index').then(({ enqueueKnowledgeSourceIndex }) => {
    enqueueKnowledgeSourceIndex(`canvas:${id}`)
  })
}

async function invalidateCanvasKnowledgeIndex(id: string) {
  const db = await getDb()
  try {
    await db.execute(
      "update knowledge_sources set status = 'pending', indexed_hash = null, error = null where source_key = $1",
      [`canvas:${id}`]
    )
  } catch {
    // 数据库首次初始化时来源注册表可能尚未创建。
  }
}

async function removeCanvasKnowledgeIndex(id: string) {
  const { removeKnowledgeSourceIndex } = await import('@/lib/knowledge-index')
  await removeKnowledgeSourceIndex(`canvas:${id}`)
}

function reconcileCanvasKnowledgeIndex() {
  void import('@/lib/knowledge-index').then(({ reconcileStructuredKnowledgeSources }) => {
    void reconcileStructuredKnowledgeSources()
  })
}

export async function initCanvasesDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists canvases (
      id text primary key,
      title text not null,
      canvasType text not null,
      schemaVersion integer not null default 1,
      content text not null,
      undoStack text not null default '[]',
      redoStack text not null default '[]',
      thumbnailPath text default null,
      createdAt integer not null,
      updatedAt integer not null,
      pinnedAt integer default null,
      deletedAt integer default null
    )
  `)
  const canvasColumns = await db.select<Array<{ name: string }>>('pragma table_info(canvases)')
  if (!canvasColumns.some(column => column.name === 'pinnedAt')) {
    await db.execute('alter table canvases add column pinnedAt integer default null')
  }
  if (!canvasColumns.some(column => column.name === 'undoStack')) {
    await db.execute("alter table canvases add column undoStack text not null default '[]'")
  }
  if (!canvasColumns.some(column => column.name === 'redoStack')) {
    await db.execute("alter table canvases add column redoStack text not null default '[]'")
  }
}

export async function getCanvasProjects(options: { includeDeleted?: boolean } = {}) {
  const db = await getDb()
  const where = options.includeDeleted ? '' : 'where deletedAt is null'
  const rows = await db.select<CanvasProjectRow[]>(`
    select * from canvases ${where} order by updatedAt desc
  `)
  return rows.map(rowToProject)
}

export async function getCanvasProject(id: string) {
  const db = await getDb()
  const rows = await db.select<CanvasProjectRow[]>(
    'select * from canvases where id = $1 limit 1',
    [id]
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function insertCanvasProject(input: {
  id: string
  title: string
  canvasType: CanvasProjectType
  document?: CanvasDocument
  createdAt?: number
  updatedAt?: number
}) {
  const db = await getDb()
  const now = Date.now()
  const createdAt = input.createdAt ?? now
  const updatedAt = input.updatedAt ?? now
  await db.execute(
    `insert into canvases
      (id, title, canvasType, schemaVersion, content, createdAt, updatedAt)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.title,
      input.canvasType,
      1,
      JSON.stringify(input.document || DEFAULT_CANVAS_DOCUMENT),
      createdAt,
      updatedAt,
    ]
  )
  enqueueCanvasSync('canvas-created')
  enqueueCanvasKnowledgeIndex(input.id)
  await recordCanvasProjectActivity(input.id, input.title, updatedAt)
  return getCanvasProject(input.id)
}

export async function updateCanvasDocument(id: string, document: CanvasDocument) {
  const db = await getDb()
  const updatedAt = Date.now()
  const content = JSON.stringify(document)
  await db.execute(
    'update canvases set content = $1, schemaVersion = $2, updatedAt = $3 where id = $4',
    [content, document.schemaVersion, updatedAt, id]
  )
  enqueueCanvasSync('canvas-updated')
  await invalidateCanvasKnowledgeIndex(id)
  enqueueCanvasKnowledgeIndex(id)
  const project = await getCanvasProject(id)
  await recordCanvasProjectActivity(id, project?.title || id, updatedAt)
  return updatedAt
}

export async function updateCanvasHistory(id: string, history: CanvasHistoryState) {
  const db = await getDb()
  await db.execute(
    'update canvases set undoStack = $1, redoStack = $2 where id = $3',
    [JSON.stringify(history.undo), JSON.stringify(history.redo), id]
  )
}

export async function renameCanvasProject(id: string, title: string) {
  const db = await getDb()
  const updatedAt = Date.now()
  await db.execute(
    'update canvases set title = $1, updatedAt = $2 where id = $3',
    [title, updatedAt, id]
  )
  enqueueCanvasSync('canvas-renamed')
  await invalidateCanvasKnowledgeIndex(id)
  enqueueCanvasKnowledgeIndex(id)
  await recordCanvasProjectActivity(id, title, updatedAt)
  return updatedAt
}

export async function updateCanvasThumbnailPath(id: string, thumbnailPath: string | null) {
  const db = await getDb()
  await db.execute('update canvases set thumbnailPath = $1 where id = $2', [thumbnailPath, id])
}

export async function setCanvasPinnedAt(id: string, pinnedAt: number | null) {
  const db = await getDb()
  const updatedAt = Date.now()
  await db.execute(
    'update canvases set pinnedAt = $1, updatedAt = $2 where id = $3',
    [pinnedAt, updatedAt, id]
  )
  enqueueCanvasSync(pinnedAt ? 'canvas-pinned' : 'canvas-unpinned')
  return updatedAt
}

export async function softDeleteCanvasProject(
  id: string,
  options: { enqueueSync?: boolean } = {}
) {
  const db = await getDb()
  const deletedAt = Date.now()
  await db.execute(
    'update canvases set deletedAt = $1, updatedAt = $1 where id = $2',
    [deletedAt, id]
  )
  if (options.enqueueSync !== false) enqueueCanvasSync('canvas-deleted')
  await removeCanvasKnowledgeIndex(id)
  return deletedAt
}

export async function restoreCanvasProject(id: string) {
  const db = await getDb()
  const updatedAt = Date.now()
  await db.execute(
    'update canvases set deletedAt = null, updatedAt = $1 where id = $2',
    [updatedAt, id]
  )
  enqueueCanvasSync('canvas-restored')
  enqueueCanvasKnowledgeIndex(id)
  return getCanvasProject(id)
}

export async function permanentlyDeleteCanvasProject(id: string) {
  const db = await getDb()
  await db.execute('delete from canvases where id = $1', [id])
  await removeCanvasKnowledgeIndex(id)
}

export async function clearCanvasProjects() {
  const db = await getDb()
  await db.execute('delete from canvases')
  enqueueCanvasSync('canvases-cleared')
  reconcileCanvasKnowledgeIndex()
}

export async function replaceAllCanvasProjects(projects: CanvasProject[]) {
  const db = await getDb()
  for (const project of projects) {
    await db.execute(
      `insert into canvases
        (id, title, canvasType, schemaVersion, content, undoStack, redoStack, thumbnailPath, createdAt, updatedAt, pinnedAt, deletedAt)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict(id) do update set
         title = excluded.title,
         canvasType = excluded.canvasType,
         schemaVersion = excluded.schemaVersion,
         content = excluded.content,
         thumbnailPath = excluded.thumbnailPath,
         createdAt = excluded.createdAt,
         updatedAt = excluded.updatedAt,
         pinnedAt = excluded.pinnedAt,
         deletedAt = excluded.deletedAt`,
      [
        project.id,
        project.title,
        project.canvasType,
        project.schemaVersion,
        JSON.stringify(project.document),
        JSON.stringify(project.history?.undo || []),
        JSON.stringify(project.history?.redo || []),
        project.thumbnailPath || null,
        project.createdAt,
        project.updatedAt,
        project.pinnedAt || null,
        project.deletedAt || null,
      ]
    )
  }
  if (projects.length === 0) {
    await db.execute('delete from canvases')
  } else {
    const placeholders = projects.map((_, index) => `$${index + 1}`).join(', ')
    const projectIds = projects.map(project => project.id)
    await db.execute(
      `delete from canvases where id not in (${placeholders})`,
      projectIds
    )
  }
  reconcileCanvasKnowledgeIndex()
}
