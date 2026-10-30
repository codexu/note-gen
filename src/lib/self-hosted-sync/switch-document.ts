import * as Y from 'yjs'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import type { SelfHostedClient } from './client'
import { decryptPackedJson, encryptJson, objectAssociatedData } from './crypto'
import type { SyncBootstrapPage, SyncObjectKind } from './protocol'
import { addCanvasRecordObjectIds } from './references'

type SwitchObject = SyncBootstrapPage['objects'][number]

export interface SwitchDocumentState {
  document: Y.Doc
  sequence: string
}

function staleDocument(object: SwitchObject) {
  return syncStaleError({ stage: 'apply', source: 'remote', path: object.objectId, check: 'version' })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  return value as Record<string, unknown>
}

function decodeUpdate(value: unknown) {
  const envelope = record(value)
  if (envelope.format !== 'yjs-v1' || typeof envelope.update !== 'string') throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  const binary = atob(envelope.update.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function encodeUpdate(update: Uint8Array) {
  let binary = ''
  for (const byte of update) binary += String.fromCharCode(byte)
  return { format: 'yjs-v1', update: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') }
}

function initializeRoots(document: Y.Doc, kind: SyncObjectKind) {
  if (kind === 'note') {
    document.getText('markdown')
    document.getMap<Y.Text>('markdown-v2')
    document.getText('markdown-v3')
    document.getMap('markdown-v3-meta')
  } else {
    document.getMap<string>('nodes')
    document.getMap<string>('edges')
    document.getMap<string>('metadata')
  }
}

/** Read the complete collaborative state belonging to the reviewed object snapshot. */
export async function readSwitchDocument(
  client: SelfHostedClient,
  workspaceId: string,
  object: SwitchObject,
  syncEpoch: string,
  keyForVersion: (version: number) => Promise<string>,
  assertActive: () => void = () => {},
  onProgress?: (progress: { current: string; total: string }) => void,
): Promise<SwitchDocumentState | null> {
  if (!object.document || object.deletedAt || !['note', 'canvas'].includes(object.kind)) return null
  const document = new Y.Doc()
  initializeRoots(document, object.kind)
  const expected = BigInt(object.document.latestDocumentSequence)
  let through = BigInt(0)
  let after = '0'
  const aad = objectAssociatedData(workspaceId, object.objectId, object.kind)
  const apply = async (ciphertext: string, keyVersion: number) => {
    assertActive()
    const value = await decryptPackedJson<unknown>(await keyForVersion(keyVersion), ciphertext, aad)
    Y.applyUpdate(document, decodeUpdate(value))
  }
  try {
    let lastReportedAt = 0
    const reportProgress = (force = false) => {
      if (!onProgress) return
      const now = Date.now()
      if (!force && now - lastReportedAt < 100) return
      lastReportedAt = now
      onProgress({ current: through.toString(), total: expected.toString() })
    }
    reportProgress(true)
    for (;;) {
      assertActive()
      const page = await client.documentUpdates(workspaceId, object.document.documentId, after, syncEpoch)
      if (page.syncEpoch !== syncEpoch) throw staleDocument(object)
      const checkpoint = page.checkpoint
      if (checkpoint && BigInt(checkpoint.documentSequence) > through) {
        if (checkpoint.objectId !== object.objectId || BigInt(checkpoint.documentSequence) > expected) throw staleDocument(object)
        await apply(checkpoint.ciphertext, checkpoint.keyVersion)
        through = BigInt(checkpoint.documentSequence)
        reportProgress(true)
      }
      for (const update of page.updates) {
        const sequence = BigInt(update.documentSequence)
        if (sequence > expected) throw staleDocument(object)
        if (sequence <= through) continue
        if (sequence !== through + BigInt(1)) throw staleDocument(object)
        await apply(update.ciphertext, update.keyVersion)
        through = sequence
        reportProgress()
      }
      reportProgress(true)
      if (!page.hasMore) break
      // A checkpoint may have pruned every update covered by this page.
      const next = BigInt(page.nextDocumentSequence) > through ? BigInt(page.nextDocumentSequence) : through
      if (next <= BigInt(after)) throw staleDocument(object)
      after = next.toString()
    }
    if (through !== expected) throw staleDocument(object)
    reportProgress(true)
    return { document, sequence: through.toString() }
  } catch (error) {
    document.destroy()
    throw error
  }
}

function markdownText(document: Y.Doc) {
  if (document.getMap('markdown-v3-meta').get('initialized') === true) return document.getText('markdown-v3')
  const legacy = document.getMap<Y.Text>('markdown-v2').get('content')
  return legacy instanceof Y.Text ? legacy : document.getText('markdown')
}

function canvasContent(payload: Record<string, unknown>) {
  const content = record(payload.value).content
  if (typeof content !== 'string') throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  const value = record(JSON.parse(content) as unknown)
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  record(value.viewport)
  record(value.settings)
  return value
}

export function materializeSwitchDocument(
  state: SwitchDocumentState | null,
  kind: SyncObjectKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!state || state.sequence === '0') return payload
  if (kind === 'note') {
    const result: Record<string, unknown> = { ...payload, content: markdownText(state.document).toString() }
    // Inline collaborative content is newer than any materialized blob.
    delete result.blobId
    return result
  }
  if (kind !== 'canvas') return payload
  const fallback = canvasContent(payload)
  const metadata = state.document.getMap<string>('metadata')
  const content = {
    ...fallback,
    nodes: [...state.document.getMap<string>('nodes').values()].map(value => JSON.parse(value) as unknown),
    edges: [...state.document.getMap<string>('edges').values()].map(value => JSON.parse(value) as unknown),
    viewport: metadata.has('viewport') ? JSON.parse(metadata.get('viewport')!) as unknown : fallback.viewport,
    settings: metadata.has('settings') ? JSON.parse(metadata.get('settings')!) as unknown : fallback.settings,
  }
  return { ...payload, value: { ...record(payload.value), content: JSON.stringify(content) } }
}

export interface OverwriteSwitchDocumentInput {
  client: SelfHostedClient
  workspaceId: string
  object: SwitchObject
  syncEpoch: string
  state: SwitchDocumentState
  payload: Record<string, unknown>
  keyVersion: number
  key: string
  materializedRevision: string | null
  assertActive?: () => void
  onApplied?: (sequence: string) => void
}

/** Replace known CRDT values, retaining their causal history so old content stays deleted. */
export async function overwriteSwitchDocument(input: OverwriteSwitchDocumentInput): Promise<string> {
  const { client, workspaceId, object, syncEpoch, state, payload, keyVersion, key, materializedRevision } = input
  const assertActive = input.assertActive ?? (() => {})
  if (!object.document || !['note', 'canvas'].includes(object.kind)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  assertActive()
  const latest = await client.documentUpdates(workspaceId, object.document.documentId, state.sequence, syncEpoch, 1)
  if (latest.syncEpoch !== syncEpoch || latest.updates.length || latest.hasMore
    || (latest.checkpoint && (latest.checkpoint.objectId !== object.objectId
      || BigInt(latest.checkpoint.documentSequence) > BigInt(state.sequence)))) throw staleDocument(object)
  const canvas = object.kind === 'canvas' ? canvasContent({ ...payload, value: {
    ...record(payload.value), content: await addCanvasRecordObjectIds(workspaceId,
      String(record(payload.value).content), record(payload.references)),
  } }) : null
  assertActive()
  const before = Y.encodeStateVector(state.document)
  state.document.transact(() => {
    if (object.kind === 'note') {
      if (typeof payload.content !== 'string') throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      if (state.sequence === '0') state.document.getMap('markdown-v3-meta').set('initialized', true)
      const text = markdownText(state.document)
      text.delete(0, text.length)
      if (payload.content) text.insert(0, payload.content)
    } else {
      const value = canvas!
      for (const name of ['nodes', 'edges'] as const) {
        const target = state.document.getMap<string>(name)
        const values = value[name] as unknown[]
        target.clear()
        for (const item of values) {
          const row = record(item)
          if (typeof row.id !== 'string') throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
          target.set(row.id, JSON.stringify(row))
        }
      }
      const metadata = state.document.getMap<string>('metadata')
      metadata.set('schemaVersion', String(value.schemaVersion ?? 1))
      metadata.set('viewport', JSON.stringify(value.viewport))
      metadata.set('settings', JSON.stringify(value.settings))
    }
  })
  const aad = objectAssociatedData(workspaceId, object.objectId, object.kind)
  const encrypted = await encryptJson(key, encodeUpdate(Y.encodeStateAsUpdate(state.document, before)), aad)
  const commandId = crypto.randomUUID()
  assertActive()
  const appended = await client.pushCommands(workspaceId, [{
    commandId, type: 'append-update', updateId: crypto.randomUUID(), documentId: object.document.documentId,
    objectId: object.objectId, kind: object.kind, keyVersion,
    ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash,
  }], syncEpoch)
  const result = appended.results[0]
  if (appended.syncEpoch !== syncEpoch || appended.results.length !== 1 || result?.commandId !== commandId
    || result.status !== 'applied' || !result.sequence || !/^\d+$/.test(result.sequence)
    || result.documentSequence !== (BigInt(state.sequence) + BigInt(1)).toString()) throw staleDocument(object)
  input.onApplied?.(result.sequence)
  const checkpoint = await encryptJson(key, encodeUpdate(Y.encodeStateAsUpdate(state.document)), aad)
  const checkpointCommandId = crypto.randomUUID()
  assertActive()
  const committed = await client.pushCommands(workspaceId, [{
    commandId: checkpointCommandId, type: 'commit-checkpoint', checkpointId: crypto.randomUUID(),
    documentId: object.document.documentId, objectId: object.objectId, kind: object.kind,
    coversDocumentSequence: result.documentSequence, materializedRevision, keyVersion,
    ciphertext: checkpoint.packedCiphertext, ciphertextHash: checkpoint.packedCiphertextHash,
  }], syncEpoch)
  const checkpointResult = committed.results[0]
  if (committed.syncEpoch !== syncEpoch || committed.results.length !== 1 || checkpointResult?.commandId !== checkpointCommandId
    || checkpointResult.status !== 'applied' || !checkpointResult.sequence || !/^\d+$/.test(checkpointResult.sequence)
    || checkpointResult.documentSequence !== result.documentSequence) throw staleDocument(object)
  input.onApplied?.(checkpointResult.sequence)
  state.sequence = result.documentSequence
  return state.sequence
}
