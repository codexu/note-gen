import { invalidateKnowledgeLexicalCache } from '@/lib/knowledge-lexical-cache'
import { Store } from '@tauri-apps/plugin-store'
import {
  acknowledgeStructuredKnowledgeChange,
  deleteKnowledgeSource,
  listStructuredKnowledgeChanges,
  removeDeletedStructuredKnowledgeSource,
  getCanvasRegistryInventory,
  getKnowledgeSource,
  getKnowledgeSources,
  updateKnowledgeSourceIndexState,
  upsertKnowledgeSource,
} from '@/db/knowledge'
import {
  deleteVectorDocumentsByFilename,
  checkVectorDocumentExists,
  replaceVectorDocumentsByFilename,
} from '@/db/vector'
import { fetchEmbeddings } from '@/lib/ai'
import { invalidateWorkspaceBM25 } from '@/lib/bm25-workspace-index'
import {
  collectCanvasKnowledgeDocuments,
  collectRecordKnowledgeDocuments,
  getKnowledgeSourceDocument,
} from '@/lib/knowledge-content'
import { getKnowledgeSettings, isKnowledgeSourceEnabled } from '@/lib/knowledge-settings'
import type { KnowledgeSourceDocument, KnowledgeSourceType } from '@/types/knowledge'

const pendingKeys = new Set<string>()
let drainPromise: Promise<void> | null = null

async function isAutoIndexEnabled() {
  const store = await Store.load('store.json')
  return (await getKnowledgeSettings()).semanticSearchEnabled
    && (await store.get<boolean>('autoVectorEnabled') ?? true)
}

async function hasStructuredIndexConsent() {
  const store = await Store.load('store.json')
  return await store.get<boolean>('ragStructuredKnowledgeConsent') ?? false
}

async function registerDocument(document: KnowledgeSourceDocument, sourceRevision?: string) {
  const existing = await getKnowledgeSource(document.sourceKey)
  const unchanged = existing?.contentHash === document.contentHash
    && existing.indexedHash === document.contentHash
    && existing.status === 'ready'
  await upsertKnowledgeSource({
    ...document,
    indexedHash: unchanged ? existing.indexedHash : null,
    status: unchanged ? 'ready' : 'pending',
    error: null,
  }, sourceRevision)
  if (existing?.contentHash !== document.contentHash) invalidateWorkspaceBM25(document.sourceKey)
  return !unchanged
}

/** Refresh only saved changes requested by this search, without starting embeddings. */
export async function refreshChangedKnowledgeRegistry(types: KnowledgeSourceType[], assertCurrent: () => Promise<void>) {
  const first = await listStructuredKnowledgeChanges(types)
  if (!first.length) return
  const keys = new Set(first.map(change => change.sourceKey))
  async function refresh(changes: typeof first) {
    for (const { sourceKey, revision } of changes) {
      await assertCurrent()
      const document = await getKnowledgeSourceDocument(sourceKey)
      await assertCurrent()
      if (document) await registerDocument(document, revision)
      else {
        await removeDeletedStructuredKnowledgeSource(sourceKey)
        await acknowledgeStructuredKnowledgeChange(sourceKey, revision)
      }
      invalidateKnowledgeLexicalCache(sourceKey)
    }
  }
  await refresh(first)
  // A source edited while being read gets one retry. A continuously changing
  // document remains queued for the next search without holding up this one.
  const remaining = await listStructuredKnowledgeChanges(types)
  await refresh(remaining.filter(change => keys.has(change.sourceKey)))
}

export async function indexKnowledgeDocument(document: KnowledgeSourceDocument): Promise<boolean> {
  const needsIndex = await registerDocument(document)
  if (!needsIndex) return true
  await updateKnowledgeSourceIndexState(document.sourceKey, {
    status: 'indexing',
    indexedHash: null,
  })
  try {
    const embeddings: Array<number[] | null> = []
    for (let offset = 0; offset < document.chunks.length; offset += 16) {
      embeddings.push(...await fetchEmbeddings(
        document.chunks.slice(offset, offset + 16).map(chunk => chunk.content)
      ))
    }
    if (embeddings.length !== document.chunks.length || embeddings.some(item => !item)) {
      throw new Error('Embedding 返回不完整')
    }
    await replaceVectorDocumentsByFilename(
      document.sourceKey,
      document.chunks.flatMap((chunk, index) => {
        const embedding = embeddings[index]
        return embedding ? [{
        filename: document.sourceKey,
        chunk_id: index,
        content: chunk.content,
        embedding: JSON.stringify(embedding),
        updated_at: document.updatedAt,
        }] : []
      })
    )
    await updateKnowledgeSourceIndexState(document.sourceKey, {
      status: 'ready',
      indexedHash: document.contentHash,
    })
    return true
  } catch (error) {
    await updateKnowledgeSourceIndexState(document.sourceKey, {
      status: 'failed',
      indexedHash: null,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function drainQueue() {
  if (drainPromise) return drainPromise
  drainPromise = (async () => {
    while (pendingKeys.size > 0) {
      const settings = await getKnowledgeSettings()
      if (settings.indexPaused || !await isAutoIndexEnabled() || !await hasStructuredIndexConsent()) break
      const sourceKey = pendingKeys.values().next().value as string | undefined
      if (!sourceKey) break
      pendingKeys.delete(sourceKey)
      const document = await getKnowledgeSourceDocument(sourceKey)
      if (!document) {
        if (sourceKey.startsWith('article:')) {
          await deleteVectorDocumentsByFilename(sourceKey)
          await deleteKnowledgeSource(sourceKey)
        } else {
          await removeDeletedStructuredKnowledgeSource(sourceKey)
        }
        continue
      }
      if (!isKnowledgeSourceEnabled(document, settings)) {
        await registerDocument(document)
        continue
      }
      await indexKnowledgeDocument(document)
    }
  })().finally(() => {
    drainPromise = null
  })
  return drainPromise
}

export function enqueueKnowledgeSourceIndex(sourceKey: string) {
  invalidateKnowledgeLexicalCache(sourceKey)
  void import('@/lib/wiki/queue').then(({ enqueueWikiSource }) => enqueueWikiSource(sourceKey))
    .catch(error => console.error('Failed to schedule Wiki source:', error))
  pendingKeys.add(sourceKey)
  void drainQueue()
}

export async function removeKnowledgeSourceIndex(sourceKey: string, wikiStableId?: string | null) {
  invalidateKnowledgeLexicalCache(sourceKey)
  pendingKeys.delete(sourceKey)
  const { removeWikiSource } = await import('@/lib/wiki/queue')
  await removeWikiSource(sourceKey, 'deleted', undefined, wikiStableId)
  await removeDeletedStructuredKnowledgeSource(sourceKey)
}

export async function resumeKnowledgeIndexQueue() {
  // An app exit can leave a source in `indexing` after the in-memory task was lost.
  // Treat it as resumable work on the next startup instead of leaving progress stuck forever.
  const sources = await getKnowledgeSources({ statuses: ['pending', 'failed', 'indexing'] })
  sources.forEach(source => pendingKeys.add(source.sourceKey))
  await drainQueue()
}

export async function processStructuredKnowledgeSources(
  onProgress?: (current: number, total: number, title: string) => void
) {
  const documents = [
    ...await collectRecordKnowledgeDocuments(),
    ...await collectCanvasKnowledgeDocuments(),
  ]
  let success = 0
  let failed = 0
  let paused = false
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index]
    const settings = await getKnowledgeSettings()
    if (settings.indexPaused) {
      paused = true
      break
    }
    onProgress?.(index + 1, documents.length, document.title)
    if (!isKnowledgeSourceEnabled(document, settings)) {
      await registerDocument(document)
      continue
    }
    if (await indexKnowledgeDocument(document)) success++
    else failed++
  }
  return { total: documents.length, success, failed, paused }
}

// Opening the workspace reads metadata for previously registered canvases. New or
// changed bodies are hashed one at a time, without their undo and redo histories.
async function registerCanvasSources(queuePending: boolean) {
  const inventory = await getCanvasRegistryInventory()
  for (const source of inventory) {
    if (source.registered) {
      if (queuePending && source.status !== 'ready') pendingKeys.add(source.sourceKey)
      continue
    }
    const document = await getKnowledgeSourceDocument(source.sourceKey)
    if (document && await registerDocument(document, source.revision) && queuePending) pendingKeys.add(source.sourceKey)
  }
  return inventory
}

export async function bootstrapStructuredKnowledgeRegistry() {
  const records = await collectRecordKnowledgeDocuments()
  for (const document of records) await registerDocument(document)
  const canvases = await registerCanvasSources(false)
  const store = await Store.load('store.json')
  const consent = await store.get<boolean>('ragStructuredKnowledgeConsent')
  if (consent === undefined) {
    await store.set('ragStructuredKnowledgeConsent', !records.length && !canvases.length)
  }
}

export async function reconcileStructuredKnowledgeSources() {
  invalidateKnowledgeLexicalCache()
  const records = await collectRecordKnowledgeDocuments()
  const canvases = await registerCanvasSources(true)
  const currentKeys = new Set([...records, ...canvases].map(source => source.sourceKey))
  const registered = await getKnowledgeSources({ sourceTypes: ['record', 'canvas'] })
  for (const source of registered) {
    if (!currentKeys.has(source.sourceKey)) await removeKnowledgeSourceIndex(source.sourceKey)
  }
  for (const document of records) {
    if (await registerDocument(document)) pendingKeys.add(document.sourceKey)
  }
  await drainQueue()
}

export async function retryKnowledgeSource(sourceKey: string) {
  const document = await getKnowledgeSourceDocument(sourceKey)
  return document ? indexKnowledgeDocument(document) : false
}

export async function purgeDisabledKnowledgeVectors() {
  const settings = await getKnowledgeSettings()
  const sources = await getKnowledgeSources()
  for (const source of sources) {
    if (!isKnowledgeSourceEnabled(source, settings)) {
      await deleteVectorDocumentsByFilename(source.sourceKey)
      await updateKnowledgeSourceIndexState(source.sourceKey, {
        status: 'pending',
        indexedHash: null,
      })
    }
  }
}

export async function getReadyKnowledgeVectorKeys(sourceTypes?: readonly KnowledgeSourceType[]) {
  const settings = await getKnowledgeSettings()
  const sources = await getKnowledgeSources({ sourceTypes, statuses: ['ready'] })
  return new Set(sources
    .filter(source => source.indexedHash === source.contentHash && isKnowledgeSourceEnabled(source, settings))
    .map(source => source.sourceKey))
}

export async function hydrateArticleKnowledgeRegistry() {
  const sources = await getKnowledgeSources({ sourceTypes: ['article'] })
  for (const source of sources) {
    if (source.status === 'ready' && !await checkVectorDocumentExists(source.sourceKey)) {
      await updateKnowledgeSourceIndexState(source.sourceKey, { status: 'pending', indexedHash: null })
    }
  }
}
