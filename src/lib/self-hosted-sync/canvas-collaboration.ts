import * as Y from 'yjs'
import { getDb } from '@/db'
import type { CanvasDocument } from '@/types/canvas'
import { enqueueCanvasSnapshot } from './outbox'
import { openCollaborativeObject } from './collaboration'

const LOCAL_ORIGIN = Symbol('notegen-canvas-local')
const REMOTE_ORIGIN = Symbol('notegen-canvas-remote')

interface CanvasSession {
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
  appendError: unknown
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
  if (!session) return
  session.document.transact(() => {
    reconcileMap(session.nodes, value.nodes.map(node => [node.id, JSON.stringify(node)]), session.knownNodeIds)
    reconcileMap(session.edges, value.edges.map(edge => [edge.id, JSON.stringify(edge)]), session.knownEdgeIds)
    session.metadata.set('schemaVersion', String(value.schemaVersion))
    session.metadata.set('viewport', JSON.stringify(value.viewport))
    session.metadata.set('settings', JSON.stringify(value.settings))
  }, LOCAL_ORIGIN)
  session.knownNodeIds = new Set(value.nodes.map(node => node.id))
  session.knownEdgeIds = new Set(value.edges.map(edge => edge.id))
  await session.appendQueue
  if (session.appendError) throw session.appendError
  if (options.flush !== false) await session.transport.flush()
}

export async function closeCanvasCollaboration(canvasId: string) {
  const session = await sessions.get(canvasId)
  sessions.delete(canvasId)
  if (!session) return
  await session.appendQueue
  if (session.appendError) throw session.appendError
  await session.transport.flush()
  session.transport.close()
  session.unsubscribePresence()
  if (session.remoteApplyTimer) clearTimeout(session.remoteApplyTimer)
  if (session.fallbackTimer) clearInterval(session.fallbackTimer)
  session.document.destroy()
  localActivity.delete(canvasId)
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
  const existing = sessions.get(canvasId)
  if (existing) return existing
  const created = createCanvasSession(canvasId, initial)
  sessions.set(canvasId, created)
  return created
}

async function createCanvasSession(canvasId: string, initial: CanvasDocument): Promise<CanvasSession | null> {
  const workspaceId = await enqueueCanvasSnapshot(canvasId)
  if (!workspaceId) return null
  const database = await getDb()
  const mappings = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and kind = 'canvas' and local_identity = $2 limit 1`,
    [workspaceId, `canvas:${canvasId}`]
  )
  const objectId = mappings[0]?.objectId ?? crypto.randomUUID()
  if (!mappings[0]) {
    await database.execute(
      `insert into self_hosted_object_mappings(
         workspace_id, object_id, kind, local_identity, updated_at
       ) values ($1, $2, 'canvas', $3, $4)`,
      [workspaceId, objectId, `canvas:${canvasId}`, Date.now()]
    )
  }
  const transport = await openCollaborativeObject(workspaceId, objectId, objectId, 'canvas')
  const document = new Y.Doc()
  const session: CanvasSession = {
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
    appendError: null,
  }
  document.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return
    session.appendQueue = session.appendQueue
      .then(() => transport.appendUpdate(update))
      .catch(error => {
        session.appendError = error
        console.warn('[self-hosted-sync] canvas.local-update-failed', { canvasId, error })
      })
  })
  await transport.consume(update => Y.applyUpdate(document, update, REMOTE_ORIGIN))
  if (session.nodes.size === 0 && session.edges.size === 0) {
    await syncCanvasIntoSession(session, initial)
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
  session.document.transact(() => {
    reconcileMap(session.nodes, value.nodes.map(node => [node.id, JSON.stringify(node)]), session.knownNodeIds)
    reconcileMap(session.edges, value.edges.map(edge => [edge.id, JSON.stringify(edge)]), session.knownEdgeIds)
    session.metadata.set('schemaVersion', String(value.schemaVersion))
    session.metadata.set('viewport', JSON.stringify(value.viewport))
    session.metadata.set('settings', JSON.stringify(value.settings))
  }, LOCAL_ORIGIN)
  session.knownNodeIds = new Set(value.nodes.map(node => node.id))
  session.knownEdgeIds = new Set(value.edges.map(edge => edge.id))
}

function queueRemoteUpdates(canvasId: string, session: CanvasSession, fallback: CanvasDocument) {
  session.consumeQueue = session.consumeQueue.then(async () => {
    await session.transport.consume(update => Y.applyUpdate(session.document, update, REMOTE_ORIGIN))
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
  if (session.remoteApplyTimer) clearTimeout(session.remoteApplyTimer)
  const activity = getLocalActivity(canvasId)
  const delay = activity.interactions.size > 0
    ? 250
    : Math.max(0, activity.quietUntil - Date.now())
  session.remoteApplyTimer = setTimeout(() => {
    session.remoteApplyTimer = null
    const latestActivity = getLocalActivity(canvasId)
    if (latestActivity.interactions.size > 0 || latestActivity.quietUntil > Date.now()) {
      scheduleRemoteMaterialization(canvasId, session, fallback)
      return
    }
    if (!session.pendingRemoteMaterialization) return
    void materializeRemoteCanvas(canvasId, session, fallback)
  }, Math.max(delay, 25))
}

async function materializeRemoteCanvas(
  canvasId: string,
  session: CanvasSession,
  fallback?: CanvasDocument,
) {
  const { default: useCanvasStore } = await import('@/stores/canvas')
  const current = useCanvasStore.getState().documents[canvasId]
  const activity = getLocalActivity(canvasId)
  if (activity.interactions.size > 0 || activity.quietUntil > Date.now()) {
    scheduleRemoteMaterialization(canvasId, session, fallback ?? current)
    return
  }
  const base = fallback ?? current
  if (!base) return
  const next = materializeCanvas(session, base)
  session.pendingRemoteMaterialization = false
  session.knownNodeIds = new Set(next.nodes.map(node => node.id))
  session.knownEdgeIds = new Set(next.edges.map(edge => edge.id))
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    useCanvasStore.getState().updateDocument(canvasId, next)
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
