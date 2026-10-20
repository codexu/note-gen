import { getVersion } from '@tauri-apps/api/app'
import { Store } from '@tauri-apps/plugin-store'
import {
  getAllVectorDocuments,
  replaceAllVectorDocuments,
  type VectorDocumentSnapshot,
} from '@/db/vector'
import { getCanvasProject } from '@/db/canvases'
import { getKnowledgeSources, upsertKnowledgeSource } from '@/db/knowledge'
import { getMarkById } from '@/db/marks'
import { downloadRemoteText, isLocalLibraryFile, uploadRemoteText } from '@/lib/sync/remote-library'
import {
  createKnowledgeSourceKey,
  parseKnowledgeSourceKey,
  type KnowledgeLocator,
  type KnowledgeSourceType,
} from '@/types/knowledge'

const RAG_SYNC_ROOT = '.data/rag'
const RAG_MANIFEST_PATH = `${RAG_SYNC_ROOT}/manifest.json`
const MAX_PAGE_BYTES = 750 * 1024
const RAG_SNAPSHOT_SCHEMA_VERSION = 2

type RagSourceFingerprint = {
  path: string
  sourceKey?: string
  sourceType?: KnowledgeSourceType
  sourceId?: string
  title?: string
  locator?: KnowledgeLocator
  contentHash: string
  indexedAt: number
}

export type RagSnapshotManifest = {
  schemaVersion: number
  appVersion: string
  generatedAt: number
  embeddingModel: string
  embeddingDimension: number
  chunkSize: number
  chunkOverlap: number
  documentCount: number
  vectorCount: number
  pages: Array<{ path: string; count: number; bytes: number; sourceType?: KnowledgeSourceType }>
  sources: RagSourceFingerprint[]
}

export type RagSnapshotDownloadResult = {
  manifest: RagSnapshotManifest
  missingSourceFiles: string[]
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function parseEmbedding(value: string): number[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('知识库包含无效的向量数据')
  }
  return parsed
}

function validateDocument(value: unknown): VectorDocumentSnapshot {
  if (!value || typeof value !== 'object') throw new Error('知识库分块格式无效')
  const document = value as Partial<VectorDocumentSnapshot>
  if (
    typeof document.filename !== 'string' || !document.filename ||
    typeof document.chunk_id !== 'number' || !Number.isInteger(document.chunk_id) || document.chunk_id < 0 ||
    typeof document.content !== 'string' ||
    typeof document.embedding !== 'string' ||
    typeof document.updated_at !== 'number'
  ) {
    throw new Error('知识库分块字段不完整')
  }
  parseEmbedding(document.embedding)
  return document as VectorDocumentSnapshot
}

function validateManifest(value: unknown): RagSnapshotManifest {
  if (!value || typeof value !== 'object') throw new Error('远端知识库清单格式无效')
  const manifest = value as Partial<RagSnapshotManifest>
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== RAG_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`不支持的知识库格式版本：${manifest.schemaVersion ?? 'unknown'}`)
  }
  if (
    typeof manifest.generatedAt !== 'number' ||
    typeof manifest.embeddingDimension !== 'number' ||
    typeof manifest.vectorCount !== 'number' ||
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.sources)
  ) {
    throw new Error('远端知识库清单字段不完整')
  }
  return manifest as RagSnapshotManifest
}

function splitDocumentsIntoPages(documents: VectorDocumentSnapshot[]): VectorDocumentSnapshot[][] {
  const pages: VectorDocumentSnapshot[][] = []
  let currentPage: VectorDocumentSnapshot[] = []
  let currentBytes = 2

  for (const document of documents) {
    const documentBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength + 1
    if (currentPage.length > 0 && currentBytes + documentBytes > MAX_PAGE_BYTES) {
      pages.push(currentPage)
      currentPage = []
      currentBytes = 2
    }
    currentPage.push(document)
    currentBytes += documentBytes
  }

  if (currentPage.length > 0) pages.push(currentPage)
  return pages
}

async function buildSources(documents: VectorDocumentSnapshot[]): Promise<RagSourceFingerprint[]> {
  const registeredSources = new Map(
    (await getKnowledgeSources()).map(source => [source.sourceKey, source])
  )
  const grouped = new Map<string, VectorDocumentSnapshot[]>()
  for (const document of documents) {
    const current = grouped.get(document.filename) || []
    current.push(document)
    grouped.set(document.filename, current)
  }

  const sources: RagSourceFingerprint[] = []
  for (const [path, chunks] of grouped.entries()) {
    chunks.sort((left, right) => left.chunk_id - right.chunk_id)
    const parsed = parseKnowledgeSourceKey(path)
    const sourceKey = parsed ? path : createKnowledgeSourceKey('article', path)
    const registered = registeredSources.get(sourceKey)
    sources.push({
      path,
      sourceKey,
      sourceType: registered?.sourceType || parsed?.sourceType || 'article',
      sourceId: registered?.sourceId || parsed?.sourceId || path,
      title: registered?.title || path.split('/').pop() || path,
      locator: registered?.locator || (parsed?.sourceType === 'article' || !parsed
        ? { filePath: parsed?.sourceId || path }
        : {}),
      contentHash: await sha256(chunks.map(chunk => chunk.content).join('\n\n')),
      indexedAt: Math.max(...chunks.map(chunk => chunk.updated_at)),
    })
  }
  return sources.sort((left, right) => left.path.localeCompare(right.path))
}

export async function uploadKnowledgeBaseSnapshot(
  onProgress?: (current: number, total: number, path: string) => void
): Promise<RagSnapshotManifest> {
  const documents = await getAllVectorDocuments()
  if (documents.length === 0) throw new Error('本地知识库为空，请先重新计算')

  const dimensions = new Set(documents.map(document => parseEmbedding(document.embedding).length))
  if (dimensions.size !== 1) throw new Error('本地知识库包含不同维度的向量，请先重新计算')

  const store = await Store.load('store.json')
  const pages = (['article', 'record', 'canvas'] as KnowledgeSourceType[]).flatMap(sourceType => (
    splitDocumentsIntoPages(documents.filter(document => (
      (parseKnowledgeSourceKey(document.filename)?.sourceType || 'article') === sourceType
    ))).map((page, index) => ({ sourceType, index, documents: page }))
  ))
  const pageMetadata: RagSnapshotManifest['pages'] = []

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]
    const pagePath = `${RAG_SYNC_ROOT}/pages/${page.sourceType}-${String(page.index + 1).padStart(5, '0')}.json`
    const content = JSON.stringify(page.documents)
    onProgress?.(index, pages.length + 1, pagePath)
    await uploadRemoteText(pagePath, content, `Upload RAG snapshot page ${index + 1}`)
    pageMetadata.push({
      path: pagePath,
      count: page.documents.length,
      bytes: new TextEncoder().encode(content).byteLength,
      sourceType: page.sourceType,
    })
  }

  const manifest: RagSnapshotManifest = {
    schemaVersion: RAG_SNAPSHOT_SCHEMA_VERSION,
    appVersion: await getVersion(),
    generatedAt: Date.now(),
    embeddingModel: await store.get<string>('embeddingModel') || '',
    embeddingDimension: Array.from(dimensions)[0],
    chunkSize: await store.get<number>('ragChunkSize') || 1000,
    chunkOverlap: await store.get<number>('ragChunkOverlap') || 100,
    documentCount: new Set(documents.map(document => document.filename)).size,
    vectorCount: documents.length,
    pages: pageMetadata,
    sources: await buildSources(documents),
  }

  onProgress?.(pages.length, pages.length + 1, RAG_MANIFEST_PATH)
  await uploadRemoteText(
    RAG_MANIFEST_PATH,
    JSON.stringify(manifest),
    `Publish RAG snapshot (${manifest.vectorCount} vectors)`
  )
  onProgress?.(pages.length + 1, pages.length + 1, RAG_MANIFEST_PATH)
  return manifest
}

export async function downloadKnowledgeBaseSnapshot(
  onProgress?: (current: number, total: number, path: string) => void
): Promise<RagSnapshotDownloadResult> {
  const manifest = validateManifest(JSON.parse(await downloadRemoteText(RAG_MANIFEST_PATH)))
  const documents: VectorDocumentSnapshot[] = []

  for (let index = 0; index < manifest.pages.length; index++) {
    const page = manifest.pages[index]
    onProgress?.(index, manifest.pages.length, page.path)
    const parsed: unknown = JSON.parse(await downloadRemoteText(page.path))
    if (!Array.isArray(parsed) || parsed.length !== page.count) {
      throw new Error(`知识库分页损坏：${page.path}`)
    }
    documents.push(...parsed.map(validateDocument))
  }

  if (documents.length !== manifest.vectorCount) {
    throw new Error(`知识库向量数量不匹配：预期 ${manifest.vectorCount}，实际 ${documents.length}`)
  }

  const dimensions = new Set(documents.map(document => parseEmbedding(document.embedding).length))
  if (dimensions.size !== 1 || Array.from(dimensions)[0] !== manifest.embeddingDimension) {
    throw new Error('知识库向量维度与清单不一致')
  }

  await replaceAllVectorDocuments(documents)
  const store = await Store.load('store.json')
  await store.set('lastVectorProcessTime', manifest.generatedAt)
  await store.set('lastDownloadedRagSnapshot', manifest)

  const missingSourceFiles: string[] = []
  for (const source of manifest.sources) {
    const parsed = source.sourceKey ? parseKnowledgeSourceKey(source.sourceKey) : parseKnowledgeSourceKey(source.path)
    const sourceType = source.sourceType || parsed?.sourceType || 'article'
    const sourceId = source.sourceId || parsed?.sourceId || source.path
    const sourceKey = source.sourceKey || createKnowledgeSourceKey(sourceType, sourceId)
    const locator = source.locator || (sourceType === 'article'
      ? { filePath: sourceId }
      : sourceType === 'record'
        ? { markId: Number(sourceId) }
        : { canvasId: sourceId })
    let exists = false
    if (sourceType === 'article') {
      exists = await isLocalLibraryFile(locator.filePath || sourceId)
    } else if (sourceType === 'record') {
      const mark = await getMarkById(locator.markId || Number(sourceId))
      exists = Boolean(mark && mark.deleted === 0)
    } else {
      const canvas = await getCanvasProject(locator.canvasId || sourceId)
      exists = Boolean(canvas && !canvas.deletedAt)
    }

    if (!exists) missingSourceFiles.push(sourceKey)
    await upsertKnowledgeSource({
      sourceKey,
      sourceType,
      sourceId,
      title: source.title || sourceId.split('/').pop() || sourceId,
      locator,
      contentHash: source.contentHash,
      indexedHash: exists ? source.contentHash : null,
      status: exists ? 'ready' : 'failed',
      error: exists ? null : 'SOURCE_NOT_FOUND',
      updatedAt: source.indexedAt,
    })
  }

  onProgress?.(manifest.pages.length, manifest.pages.length, RAG_MANIFEST_PATH)
  return { manifest, missingSourceFiles }
}

export async function getLastDownloadedKnowledgeBaseSnapshot(): Promise<RagSnapshotManifest | null> {
  const store = await Store.load('store.json')
  return await store.get<RagSnapshotManifest>('lastDownloadedRagSnapshot') || null
}
