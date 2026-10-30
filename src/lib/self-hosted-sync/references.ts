import { getDb } from '@/db'
import type { SelfHostedSnapshotObject } from './snapshot'

type CanvasRecordResolver = (id: number, objectId?: string) => number | string
const missingReference = () => new Error('SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING')
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Old records use their numeric ID as an alias until they have a source ID.
 * That alias cannot also identify a different record's released source ID. */
export async function assertMarkIdentityUnambiguous(localKey: string) {
  if (!/^[1-9]\d*$/.test(localKey)) return
  const database = await getDb()
  const rows = await database.select<Array<{ id: number }>>(
    `select id from marks where sourceId = $1
       or (cast(id as text) = $1 and sourceId is null) limit 2`, [localKey],
  )
  if (rows.length > 1) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
}

function canvasValue(content: string) {
  const value: unknown = JSON.parse(content)
  if (!isRecord(value) || !Array.isArray(value.nodes)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  return value
}

function recordReferences(content: string) {
  const result: Array<{ id: number; objectId?: string }> = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!isRecord(value)) return
    if (typeof value.recordId === 'number') {
      if (!Number.isSafeInteger(value.recordId) || value.recordId <= 0) throw missingReference()
      result.push({ id: value.recordId, objectId: typeof value.recordObjectId === 'string' ? value.recordObjectId : undefined })
    }
    Object.values(value).forEach(walk)
  }
  walk(canvasValue(content))
  return result
}

export function canvasRecordIds(content: string) {
  return [...new Set(recordReferences(content).map(reference => reference.id))]
}

/** Keep record identity separate from the device-local database primary key. */
export function mapCanvasRecordIds(content: string, resolve: CanvasRecordResolver, stripObjectIds = false) {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !stripObjectIds || key !== 'recordObjectId').map(([key, item]) => [
      key, key === 'recordId' && typeof item === 'number'
        ? resolve(item, typeof value.recordObjectId === 'string' ? value.recordObjectId : undefined) : walk(item),
    ]))
  }
  return JSON.stringify(walk(canvasValue(content)))
}

/** Normalize complete, decrypted snapshots before review and before applying.
 * A legacy source number is usable only when exactly one server object owns it. */
export function normalizeStructuredReferences<T extends SelfHostedSnapshotObject>(entries: T[]): T[] {
  const deletedTags = new Set(entries.filter(entry => entry.object.kind === 'tag' && entry.object.deletedAt !== null)
    .map(entry => entry.object.objectId))
  const liveConversations = new Set(entries.filter(entry => entry.object.kind === 'conversation' && entry.object.deletedAt === null)
    .map(entry => entry.object.objectId))
  const records = new Map<number, string[]>()
  const liveRecordIds = new Set<string>()
  for (const entry of entries) {
    if (entry.object.kind !== 'mark' || entry.object.deletedAt !== null || !isRecord(entry.payload.value)) continue
    liveRecordIds.add(entry.object.objectId)
    const id = entry.payload.value.id
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) records.set(id, [...new Set([...(records.get(id) ?? []), entry.object.objectId])])
  }
  return entries.map(entry => {
    if (!isRecord(entry.payload.value)) return entry
    // Conversation messages may retain a legacy tag after that tag was
    // deleted. Only an explicit tombstone and a live conversation make this
    // optional association safe to remove; unknown missing parents still fail.
    if (entry.object.kind === 'message' && entry.object.deletedAt === null && isRecord(entry.payload.references)) {
      const { tag, conversation, ...references } = entry.payload.references
      if (typeof tag === 'string' && deletedTags.has(tag)
        && typeof conversation === 'string' && liveConversations.has(conversation)) {
        return { ...entry, payload: { ...entry.payload, references: { ...references, conversation },
          value: { ...entry.payload.value, tagId: 0 } } }
      }
    }
    if (entry.object.kind === 'mark' && !entry.payload.value.sourceId) {
      return { ...entry, payload: { ...entry.payload, value: { ...entry.payload.value, sourceId: entry.object.objectId } } }
    }
    if (entry.object.kind !== 'canvas' || entry.object.deletedAt !== null || typeof entry.payload.value.content !== 'string') return entry
    const previous = isRecord(entry.payload.references) ? entry.payload.references : {}
    const references: Record<string, unknown> = Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('record:') && !key.startsWith('record-object:')))
    const numeric = new Map<number, string>()
    const ambiguous = new Set<number>()
    for (const reference of recordReferences(entry.payload.value.content)) {
      const old = previous[`record:${reference.id}`]
      const candidates = records.get(reference.id) ?? []
      const objectId = reference.objectId ?? (typeof old === 'string' ? old : candidates.length === 1 ? candidates[0] : undefined)
      if (!objectId || !liveRecordIds.has(objectId)) throw missingReference()
      references[`record-object:${objectId}`] = objectId
      if (numeric.has(reference.id) && numeric.get(reference.id) !== objectId) ambiguous.add(reference.id)
      numeric.set(reference.id, objectId)
    }
    for (const [id, objectId] of numeric) if (!ambiguous.has(id)) references[`record:${id}`] = objectId
    return { ...entry, payload: { ...entry.payload, references } }
  })
}

export async function localRecordObjectId(workspaceId: string, id: number) {
  const database = await getDb()
  const rows = await database.select<Array<{ sourceId: string | null }>>('select sourceId from marks where id = $1 limit 1', [id])
  if (!rows[0]) throw missingReference()
  await assertMarkIdentityUnambiguous(rows[0].sourceId || String(id))
  const { resolveStructuredObjectId } = await import('./outbox')
  return resolveStructuredObjectId(workspaceId, 'mark', rows[0].sourceId || String(id))
}

async function localRecordId(workspaceId: string, objectId: string) {
  const database = await getDb()
  const mappings = await database.select<Array<{ identity: string }>>(
    `select local_identity as identity from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 and kind = 'mark' and deleted_at is null limit 1`, [workspaceId, objectId],
  )
  const identity = mappings[0]?.identity
  if (!identity?.startsWith('mark:')) throw missingReference()
  const key = identity.slice(5)
  await assertMarkIdentityUnambiguous(key)
  const rows = await database.select<Array<{ id: number }>>('select id from marks where sourceId = $1 limit 1', [key])
  if (rows[0]) return rows[0].id
  // This fallback is supported only by the explicit object mapping, and may
  // never claim an unrelated row that already has another stable identity.
  if (/^[1-9]\d*$/.test(key) && Number.isSafeInteger(Number(key))) {
    const legacy = await database.select<Array<{ id: number }>>('select id from marks where id = $1 and sourceId is null limit 1', [Number(key)])
    if (legacy[0]) return legacy[0].id
  }
  throw missingReference()
}

export async function addCanvasRecordObjectIds(workspaceId: string, content: string, supplied: Record<string, unknown> = {}) {
  const references = new Map<number, string>()
  for (const id of canvasRecordIds(content)) {
    const objectId = supplied[`record:${id}`]
    references.set(id, typeof objectId === 'string' ? objectId : await localRecordObjectId(workspaceId, id))
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!isRecord(value)) return value
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]))
    if (typeof value.recordId === 'number') result.recordObjectId = references.get(value.recordId)
    return result
  }
  return JSON.stringify(walk(canvasValue(content)))
}

/** Resolve modern references, or a unique legacy server-side numeric alias. */
export async function localizeCanvasRecords(workspaceId: string, content: string, supplied: Record<string, unknown> = {}) {
  const references = { ...supplied }
  const missing = recordReferences(content).filter(reference => !reference.objectId && typeof references[`record:${reference.id}`] !== 'string')
  if (missing.length) {
    const database = await getDb()
    const rows = await database.select<Array<{ objectId: string; payload: string }>>(
      `select r.object_id as objectId, r.payload from self_hosted_remote_objects r
       join self_hosted_object_mappings m on m.workspace_id = r.workspace_id and m.object_id = r.object_id
       where r.workspace_id = $1 and r.kind = 'mark' and m.deleted_at is null`, [workspaceId],
    )
    for (const reference of missing) {
      const matches = rows.filter(row => {
        const payload: unknown = JSON.parse(row.payload)
        return isRecord(payload) && isRecord(payload.value) && payload.value.id === reference.id
      })
      if (matches.length !== 1) throw missingReference()
      references[`record:${reference.id}`] = matches[0].objectId
    }
  }
  const localIds = new Map<string, number>()
  for (const reference of recordReferences(content)) {
    const objectId = reference.objectId ?? references[`record:${reference.id}`]
    if (typeof objectId !== 'string') throw missingReference()
    if (!localIds.has(objectId)) localIds.set(objectId, await localRecordId(workspaceId, objectId))
  }
  return mapCanvasRecordIds(content, (id, objectId) => {
    const resolved = objectId ?? references[`record:${id}`]
    if (typeof resolved !== 'string' || !localIds.has(resolved)) throw missingReference()
    return localIds.get(resolved)!
  })
}
