import * as Y from 'yjs'
import { getDb } from '@/db'
import type { CanvasDocument } from '@/types/canvas'
import { enqueueCanvasSnapshot } from './outbox'
import { captureSelfHostedCollaboration, openCollaborativeObject } from './collaboration'
import { addCanvasRecordObjectIds, localizeCanvasRecords } from './references'
import { getSelfHostedSyncRuntime } from './runtime'

const LOCAL_ORIGIN = Symbol('notegen-canvas-local')
const REMOTE_ORIGIN = Symbol('notegen-canvas-remote')

interface CanvasSession {
  closed: boolean
  closing: boolean
  document: Y.Doc
  nodes: Y.Map<string>
  edges: Y.Map<string>
  metadata: Y.Map<string>
  transport: Awaited<ReturnType<typeof openCollaborativeObject>>
  unsubscribePresence: () => void
  knownNodeIds: Set<string>
  knownEdgeIds: Set<string>
  pendingRemoteMaterialization: boolean
  remoteApplyTimer: ReturnType<typeof setTimeout> | null
  fallbackTimer: ReturnType<typeof setInterval> | null
  consumeQueue: Promise<void>
  appendQueue: Promise<void>
}

const sessions = new Map<string, Promise<CanvasSession | null>>()
const localActivity = new Map<string, {
  interactions: Set<string>
  quietUntil: number
}>()

export function beginCanvasLocalInteraction(canvasId: string, interaction: string) {
  const activity = getLocalActivity(canvasId)
  activity.interactions.add(interaction)
}

export function endCanvasLocalInteraction(canvasId: string, interaction: string) {
  const activity = getLocalActivity(canvasId)
  activity.interactions.delete(interaction)
  activity.quietUntil = Math.max(activity.quietUntil, Date.now() + 600)
  void sessions.get(canvasId)?.then(session => {
    if (session?.pendingRemoteMaterialization) scheduleRemoteMaterialization(canvasId, session)
  })
}

export function markCanvasLocalActivity(canvasId: string) {
  const activity = getLocalActivity(canvasId)
  activity.quietUntil = Math.max(activity.quietUntil, Date.now() + 600)
  void sessions.get(canvasId)?.then(session => {
    if (session?.pendingRemoteMaterialization) scheduleRemoteMaterialization(canvasId, session)
  })
}

export async function syncCanvasDocument(
  canvasId: string,
  value: CanvasDocument,
  options: { flush?: boolean } = {},
) {
  const session = await getCanvasSession(canvasId, value)
  if (!session || session.closed || session.closing || !session.transport.isActive()) return
  await syncCanvasIntoSession(session, value)
  await persistCanvasUpdates(session)
  if (options.flush !== false) await session.transport.flush()
}

export async function openCanvasCollaboration(canvasId: string, initial: CanvasDocument) {
  await getCanvasSession(canvasId, initial)
}

export async function closeCanvasCollaboration(canvasId: string, options: { flush?: boolean } = {}) {
  const pending = sessions.get(canvasId)
  sessions.delete(canvasId)
  localActivity.delete(canvasId)
  if (options.flush === false) {
    // A session still opening may itself be waiting for the current runtime
    // run. Cancel it without making inbox deletion await that same run.
    void pending?.then(session => { if (session) disposeCanvasSession(session) })
      .catch(error => console.warn('[self-hosted-sync] Unable to close deleted canvas session', error))
    return
  }
  const session = await pending
  if (!session) return
  session.closing = true
  try {
    await persistCanvasUpdates(session)
    await session.transport.flush()
  } finally { disposeCanvasSession(session) }
}

function disposeCanvasSession(session: CanvasSession) {
  if (session.closed) return
  session.closed = true
  session.transport.close()
  session.unsubscribePresence()
  if (session.remoteApplyTimer) clearTimeout(session.remoteApplyTimer)
  if (session.fallbackTimer) clearInterval(session.fallbackTimer)
  session.document.destroy()
}

/** Close old sessions before replacing snapshots. Persist only already admitted
 * deltas; never serialize a stale Y.Doc or wake the sender during this drain. */
export async function closeAllCanvasCollaboration() {
  const pending = [...sessions.values()]
  sessions.clear()
  localActivity.clear()
  const results = await Promise.allSettled(pending)
  const closing: Promise<void>[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const session = result.value
    disposeCanvasSession(session)
    closing.push(session.transport.persistLocalUpdates(), session.consumeQueue)
  }
  await Promise.all(closing)
}

export async function updateCanvasDragPresence(
  canvasId: string,
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
) {
  const session = await sessions.get(canvasId)
  if (!session) return
  session.transport.updateCanvasPresence(
    nodes.slice(0, 100).map(node => ({ id: node.id, x: node.position.x, y: node.position.y })),
    'NoteGen',
  )
}

export async function clearCanvasDragPresence(canvasId: string) {
  const session = await sessions.get(canvasId)
  if (session) session.transport.updateCanvasPresence([], 'NoteGen')
}

async function getCanvasSession(canvasId: string, initial: CanvasDocument) {
  if (!captureSelfHostedCollaboration()()) return null
  const existing = sessions.get(canvasId)
  if (existing) {
    const session = await existing
    if (session && !session.closed && !session.closing && session.transport.isActive()) return session
    if (session) disposeCanvasSession(session)
    sessions.delete(canvasId)
  }
  const created: Promise<CanvasSession | null> = createCanvasSession(canvasId, initial).then(session => {
    if (sessions.get(canvasId) !== created) {
      if (session) disposeCanvasSession(session)
      return null
    }
    return session
  })
  sessions.set(canvasId, created)
  void created.catch(() => { if (sessions.get(canvasId) === created) sessions.delete(canvasId) })
  return created
}

async function createCanvasSession(canvasId: string, initial: CanvasDocument): Promise<CanvasSession | null> {
  const isActive = captureSelfHostedCollaboration()
  if (!isActive()) return null
  const workspaceId = await enqueueCanvasSnapshot(canvasId, 'upsert', { onlyIfMissing: true })
  if (!workspaceId || !isActive()) return null
  const database = await getDb()
  const mappings = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and kind = 'canvas' and local_identity = $2 limit 1`,
    [workspaceId, `canvas:${canvasId}`]
  )
  const objectId = mappings[0]?.objectId ?? crypto.randomUUID()
  if (!isActive()) return null
  if (!mappings[0]) {
    await database.execute(
      `insert into self_hosted_object_mappings(
         workspace_id, object_id, kind, local_identity, updated_at
       ) values ($1, $2, 'canvas', $3, $4)`,
      [workspaceId, objectId, `canvas:${canvasId}`, Date.now()]
    )
  }
  if (!isActive()) return null
  const accepted = await database.select<Array<{ found: number }>>(
    'select 1 as found from self_hosted_revisions where workspace_id=$1 and object_id=$2 limit 1',
    [workspaceId, objectId],
  )
  if (!accepted.length) {
    // A document update cannot precede creation of its owning object.
    await getSelfHostedSyncRuntime().wake('canvas-object-activation')
    if (!isActive()) return null
    const activated = await database.select<Array<{ found: number }>>(
      'select 1 as found from self_hosted_revisions where workspace_id=$1 and object_id=$2 limit 1',
      [workspaceId, objectId],
    )
    if (!activated.length) throw new Error('Canvas object activation is pending')
  }
  const transport = await openCollaborativeObject(workspaceId, objectId, objectId, 'canvas')
  if (!isActive()) { transport.close(); return null }
  const document = new Y.Doc()
  const session: CanvasSession = {
    closed: false,
    closing: false,
    document,
    nodes: document.getMap('nodes'),
    edges: document.getMap('edges'),
    metadata: document.getMap('metadata'),
    transport,
    unsubscribePresence: () => {},
    knownNodeIds: new Set(initial.nodes.map(node => node.id)),
    knownEdgeIds: new Set(initial.edges.map(edge => edge.id)),
    pendingRemoteMaterialization: false,
    remoteApplyTimer: null,
    fallbackTimer: null,
    consumeQueue: Promise.resolve(),
    appendQueue: Promise.resolve(),
  }
  document.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || session.closed || session.closing || !transport.isActive()) return
    session.appendQueue = transport.appendUpdate(update)
      .catch(error => {
        console.warn('[self-hosted-sync] canvas.local-update-failed', { canvasId, error })
      })
  })
  let receivedRemoteState = false
  try {
    await transport.consume(update => {
      receivedRemoteState = true
      Y.applyUpdate(document, update, REMOTE_ORIGIN)
    })
  } catch (error) {
    disposeCanvasSession(session)
    if (!isActive()) return null
    throw error
  }
  if (!isActive()) { disposeCanvasSession(session); return null }
  if (!receivedRemoteState) {
    try {
      await syncCanvasIntoSession(session, initial)
    } catch (error) {
      disposeCanvasSession(session)
      throw error
    }
  }
  const applyRemote = () => queueRemoteUpdates(canvasId, session, initial)
  session.unsubscribePresence = transport.subscribePresence(message => {
    if (message.type === 'inbox.applied' || message.type === 'workspace.changed') applyRemote()
  })
  session.fallbackTimer = setInterval(applyRemote, 2000)
  session.pendingRemoteMaterialization = true
  scheduleRemoteMaterialization(canvasId, session, initial)
  return session
}

async function syncCanvasIntoSession(session: CanvasSession, value: CanvasDocument) {
  if (session.closed || session.closing || !session.transport.isActive()) return
  const portable = JSON.parse(await addCanvasRecordObjectIds(session.transport.workspaceId, JSON.stringify(value))) as CanvasDocument
  if (session.closed || session.closing || !session.transport.isActive()) return
  session.document.transact(() => {
    reconcileMap(session.nodes, portable.nodes.map(node => [node.id, JSON.stringify(node)]), session.knownNodeIds)
    reconcileMap(session.edges, value.edges.map(edge => [edge.id, JSON.stringify(edge)]), session.knownEdgeIds)
    session.metadata.set('schemaVersion', String(value.schemaVersion))
    session.metadata.set('viewport', JSON.stringify(value.viewport))
    session.metadata.set('settings', JSON.stringify(value.settings))
  }, LOCAL_ORIGIN)
  session.knownNodeIds = new Set(value.nodes.map(node => node.id))
  session.knownEdgeIds = new Set(value.edges.map(edge => edge.id))
}

function queueRemoteUpdates(canvasId: string, session: CanvasSession, fallback: CanvasDocument) {
  if (session.closed || !session.transport.isActive()) return
  session.consumeQueue = session.consumeQueue.then(async () => {
    await session.transport.consume(update => Y.applyUpdate(session.document, update, REMOTE_ORIGIN))
    if (session.closed || !session.transport.isActive()) return
    session.pendingRemoteMaterialization = true
    scheduleRemoteMaterialization(canvasId, session, fallback)
  }).catch(error => {
    console.warn('[self-hosted-sync] canvas.remote-update-failed', { canvasId, error })
  })
}

function scheduleRemoteMaterialization(
  canvasId: string,
  session: CanvasSession,
  fallback?: CanvasDocument,
) {
  if (session.closed || !session.transport.isActive()) return
  if (session.remoteApplyTimer) clearTimeout(session.remoteApplyTimer)
  const activity = getLocalActivity(canvasId)
  const delay = activity.interactions.size > 0
    ? 250
    : Math.max(0, activity.quietUntil - Date.now())
  session.remoteApplyTimer = setTimeout(() => {
    session.remoteApplyTimer = null
    if (session.closed || !session.transport.isActive()) return
    const latestActivity = getLocalActivity(canvasId)
    if (latestActivity.interactions.size > 0 || latestActivity.quietUntil > Date.now()) {
      scheduleRemoteMaterialization(canvasId, session, fallback)
      return
    }
    if (!session.pendingRemoteMaterialization) return
    void materializeRemoteCanvas(canvasId, session, fallback).catch(error => {
      // Leave the previous local canvas intact when a record cannot be
      // identified unambiguously; a later inbox application can retry it.
      console.warn('[self-hosted-sync] canvas.remote-reference-failed', { canvasId, error })
    })
  }, Math.max(delay, 25))
}

async function materializeRemoteCanvas(
  canvasId: string,
  session: CanvasSession,
  fallback?: CanvasDocument,
) {
  const { default: useCanvasStore } = await import('@/stores/canvas')
  if (session.closed || !session.transport.isActive()) return
  const current = useCanvasStore.getState().documents[canvasId]
  const activity = getLocalActivity(canvasId)
  if (activity.interactions.size > 0 || activity.quietUntil > Date.now()) {
    scheduleRemoteMaterialization(canvasId, session, fallback ?? current)
    return
  }
  const base = fallback ?? current
  if (!base) return
  const next = JSON.parse(await localizeCanvasRecords(session.transport.workspaceId,
    JSON.stringify(materializeCanvas(session, base)))) as CanvasDocument
  if (session.closed || !session.transport.isActive()) return
  const latestActivity = getLocalActivity(canvasId)
  if (latestActivity.interactions.size > 0 || latestActivity.quietUntil > Date.now()
    || useCanvasStore.getState().documents[canvasId] !== current) {
    scheduleRemoteMaterialization(canvasId, session, fallback)
    return
  }
  session.pendingRemoteMaterialization = false
  session.knownNodeIds = new Set(next.nodes.map(node => node.id))
  session.knownEdgeIds = new Set(next.edges.map(edge => edge.id))
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    await useCanvasStore.getState().applyRemoteDocument(canvasId, next)
  }
}

function materializeCanvas(session: CanvasSession, fallback: CanvasDocument): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [...session.nodes.values()].map(value => JSON.parse(value)),
    edges: [...session.edges.values()].map(value => JSON.parse(value)),
    viewport: JSON.parse(session.metadata.get('viewport') ?? JSON.stringify(fallback.viewport)),
    settings: JSON.parse(session.metadata.get('settings') ?? JSON.stringify(fallback.settings)),
  }
}

function reconcileMap(target: Y.Map<string>, values: Array<[string, string]>, knownKeys: Set<string>) {
  const keys = new Set(values.map(([key]) => key))
  for (const key of knownKeys) if (!keys.has(key)) target.delete(key)
  for (const [key, value] of values) if (target.get(key) !== value) target.set(key, value)
}

function getLocalActivity(canvasId: string) {
  const existing = localActivity.get(canvasId)
  if (existing) return existing
  const created = { interactions: new Set<string>(), quietUntil: 0 }
  localActivity.set(canvasId, created)
  return created
}

async function persistCanvasUpdates(session: CanvasSession) {
  let pending: Promise<void>
  do {
    pending = session.appendQueue
    await pending
  } while (pending !== session.appendQueue)
  await session.transport.persistLocalUpdates()
}
