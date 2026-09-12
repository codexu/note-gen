import { PluginError, type PluginContext, type PluginPermissionName, type PluginRecord } from '@notegen/plugin-api'
import { z } from 'zod'
import { getDb } from '@/db'
import { getMarkById, insertMark, updatePluginTextRecord, type Mark } from '@/db/marks'
import emitter from '@/lib/emitter'
import useMarkStore from '@/stores/mark'

const idSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const textSchema = z.string().max(20_000)
const createSchema = z.object({ tagId: idSchema, type: z.enum(['text', 'todo']), content: textSchema, description: textSchema.optional(), completed: z.boolean().optional() }).strict()
const updateSchema = z.object({ id: idSchema, expectedRevision: z.string().length(64), tagId: idSchema.optional(), content: textSchema.optional(), description: textSchema.optional(), completed: z.boolean().optional() }).strict()
const listSchema = z.object({ tagId: idSchema.optional(), offset: z.number().int().min(0).max(100_000).optional(), limit: z.number().int().min(1).max(50).optional() }).strict()

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new PluginError('InvalidPath', 'Invalid record options')
  return result.data
}
function todo(mark: Mark): { title?: string; description?: string; completed?: boolean; priority?: string } {
  try { const value = JSON.parse(mark.content ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
async function snapshot(mark: Mark, preview = false): Promise<PluginRecord> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
    mark.id, mark.tagId, mark.type, mark.content ?? null, mark.desc ?? null, mark.url, mark.createdAt, mark.sourceId ?? null, mark.deleted,
  ])))
  const data = mark.type === 'todo' ? todo(mark) : undefined
  // Binary attachments and their app-private paths are not exposed by the record API.
  const content = data ? (typeof data.title === 'string' ? data.title : '') : ['text', 'link', 'scan', 'recording'].includes(mark.type) ? mark.content ?? '' : ''
  const description = data && typeof data.description === 'string' ? data.description : mark.desc ?? ''
  if (!preview && new TextEncoder().encode(content + description).length > 128 * 1024) throw new PluginError('QuotaExceeded', 'Record text exceeds the read limit')
  return {
    id: mark.id, tagId: mark.tagId, type: mark.type, createdAt: mark.createdAt,
    content: preview ? content.slice(0, 1000) : content,
    description: preview ? description.slice(0, 500) : description,
    revision: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    ...(data ? { completed: data.completed === true } : {}),
    ...(preview && (content.length > 1000 || description.length > 500) ? { truncated: true } : {}),
  }
}
async function existing(id: number): Promise<Mark> {
  const mark = await getMarkById(parse(idSchema, id))
  if (!mark || mark.deleted) throw new PluginError('NotFound', 'Record not found')
  return mark
}
async function assertTag(id: number) {
  const db = await getDb()
  if (!(await db.select<{ id: number }[]>('select id from tags where id = $1', [id])).length) throw new PluginError('NotFound', 'Record tag not found')
}
function refresh() {
  const store = useMarkStore.getState()
  void (store.trashState ? store.fetchTrashMarkPreviews() : store.fetchMarkPreviews()).catch(() => undefined)
}

export function createRecordsApi(guard: (permission: PluginPermissionName) => Promise<void>, track: (dispose: { dispose: () => void }) => void): PluginContext['records'] {
  return {
    async list(options = {}) {
      const input = parse(listSchema, options)
      await guard('records.read')
      const db = await getDb()
      const limit = input.limit ?? 20
      const rows = await db.select<Mark[]>('select * from marks where deleted = 0 and ($1 is null or tagId = $1) order by createdAt desc, id desc limit $2 offset $3', [input.tagId ?? null, limit + 1, input.offset ?? 0])
      const items = await Promise.all(rows.slice(0, limit).map(row => snapshot(row, true)))
      await guard('records.read')
      return { items, hasMore: rows.length > limit }
    },
    async read(id) { await guard('records.read'); const result = await snapshot(await existing(id)); await guard('records.read'); return result },
    async tags() {
      await guard('records.read')
      const db = await getDb()
      const result = await db.select<{ id: number; name: string }[]>('select id, name from tags order by sortOrder, id limit 1000')
      await guard('records.read')
      return result
    },
    async create(options) {
      const input = parse(createSchema, options)
      await guard('records.write')
      await assertTag(input.tagId)
      await guard('records.write')
      const result = await insertMark({ tagId: input.tagId, type: input.type, url: '', desc: input.description ?? '', content: input.type === 'todo' ? JSON.stringify({ title: input.content, description: input.description ?? '', completed: input.completed ?? false, priority: 'medium' }) : input.content }, () => guard('records.write'))
      refresh()
      if (!result.lastInsertId) throw new PluginError('RuntimeFailure', 'Record creation returned no ID')
      const record = await snapshot(await existing(result.lastInsertId))
      await guard('records.write')
      return record
    },
    async update(options) {
      const input = parse(updateSchema, options)
      await guard('records.read'); await guard('records.write')
      const previous = await existing(input.id)
      if (!['text', 'todo'].includes(previous.type)) throw new PluginError('ReadOnly', 'Only text and todo records support updates')
      if ((await snapshot(previous)).revision !== input.expectedRevision) throw new PluginError('StaleRevision', 'Record changed')
      if (input.tagId !== undefined) await assertTag(input.tagId)
      const next = { ...previous, tagId: input.tagId ?? previous.tagId, desc: input.description ?? previous.desc }
      if (previous.type === 'todo') {
        const data = todo(previous)
        next.content = JSON.stringify({ ...data, title: input.content ?? data.title ?? '', description: input.description ?? data.description ?? '', completed: input.completed ?? data.completed ?? false })
      } else {
        if (input.completed !== undefined) throw new PluginError('InvalidPath', 'Only todo records have completion state')
        next.content = input.content ?? previous.content
      }
      await guard('records.write')
      if (!await updatePluginTextRecord(previous, next, async () => { await guard('records.read'); await guard('records.write') })) throw new PluginError('StaleRevision', 'Record changed')
      refresh()
      const result = await snapshot(next)
      await guard('records.read')
      return result
    },
    onDidChange(listener) {
      const changed = () => { void guard('records.read').then(() => listener()).catch(() => undefined) }
      emitter.on('plugin-records-changed', changed)
      const disposable = { dispose: () => emitter.off('plugin-records-changed', changed) }
      track(disposable)
      return disposable
    },
  }
}
