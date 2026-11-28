import { readTextFile, stat, type FileInfo } from '@tauri-apps/plugin-fs'
import { createHash } from 'crypto'
import { getMarkById, getRecordLocatorBySourceId, type Mark } from '@/db/marks'
import { getTags, type Tag } from '@/db/tags'
import { getCanvasProject } from '@/db/canvases'
import { hashKnowledgeContent, serializeCanvasDocument } from '@/lib/knowledge-content'
import { parseKnowledgeSourceKey } from '@/types/knowledge'
import { getFilePathOptions, isAbsoluteFsPath } from '@/lib/workspace'
import { recordMatchesTag, recordTagIds } from '@/lib/record-tags'
import { Store } from '@tauri-apps/plugin-store'
import { getWikiGeneratedNotes, getWikiSettings, isWikiArticlePathSelected, isWikiSourceSelected, normalizeWikiScopeId } from './settings'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from '@/lib/rag-retrieval-policy'
import { getKnowledgeSettings } from '@/lib/knowledge-settings'
import { WIKI_ROOT_FOLDER, type WikiSettings, type WikiSourceReference, type WikiSourceRevision, type WikiSyncDomain } from '@/types/wiki'

export interface WikiSourceMetadata {
  source: WikiSourceReference
  derived?: boolean
  /** The knowledge registry preserves original line endings in its hash. */
  knowledgeContentHash?: string
}

export interface WikiSourceDocument extends WikiSourceMetadata {
  content: string
  /** Source-only evidence lookup; never persisted or sent as independent facts. */
  nodeTexts?: Array<{ id: string; text: string }>
}

export function wikiHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeWikiTopicName(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function compareWikiKeys(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function wikiTopicKey(title: string, domain: WikiSyncDomain): string {
  return wikiHash(`${domain}:${normalizeWikiTopicName(title)}`)
}

function normalizeSourceContent(content: string) {
  return content.replace(/\r\n?/g, '\n').trim()
}

async function readWikiRecord(mark: Mark, tags: Tag[]): Promise<WikiSourceDocument | null> {
  if (mark.deleted) return null
  const ids = recordTagIds(mark)
  const tagKeys = tags.filter(tag => ids.includes(tag.id)).map(tag => tag.name.normalize('NFKC')).sort()
  const portableUrl = mark.url && !/^(?:[A-Za-z]:[\\/]|[\\/]|file:)/i.test(mark.url) ? mark.url : ''
  const title = (mark.desc || mark.content || portableUrl || mark.type).trim().split('\n')[0].slice(0, 120)
  // Local numeric IDs, localized type labels and tag mappings never enter the cross-device fingerprint.
  const content = normalizeSourceContent([
    `# ${title}`,
    `Type: ${mark.type}`,
    mark.desc ? `Description:\n${mark.desc}` : '',
    mark.content ? `Content:\n${mark.content}` : '',
    portableUrl ? `Link: ${portableUrl}` : '',
  ].filter(Boolean).join('\n\n'))
  if (!content) return null
  const stableId = mark.sourceId || `legacy-${wikiHash(JSON.stringify([mark.createdAt, mark.type, content]))}`
  return {
    source: {
      sourceKey: `record:${mark.id}`,
      stableId: `record:${stableId}`,
      sourceType: 'record',
      title,
      contentHash: wikiHash(content),
      updatedAt: mark.createdAt,
      locator: { markId: mark.id, tagId: mark.tagId,
        tagIds: tags.filter(tag => recordMatchesTag(mark, tag.id, tags)).map(tag => tag.id) },
      tagKeys,
      syncDomain: 'account-data',
    },
    content,
  }
}

export async function getWikiSourceDocument(sourceKey: string): Promise<WikiSourceDocument | null> {
  const parsed = parseKnowledgeSourceKey(sourceKey)
  if (!parsed) return null
  if (parsed.sourceType === 'record') {
    const id = Number(parsed.sourceId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const [mark, tags] = await Promise.all([getMarkById(id), getTags()])
    return mark ? readWikiRecord(mark, tags) : null
  }
  if (parsed.sourceType === 'canvas') {
    const project = await getCanvasProject(parsed.sourceId)
    if (!project || project.deletedAt) return null
    const content = normalizeSourceContent(serializeCanvasDocument(project))
    const nodes = project.document.nodes.filter(node => node.type !== 'freehand'
      && Boolean(node.data.label || node.data.description || node.data.url || node.data.filePath))
    const nodeName = (id: string) => project.document.nodes.find(node => node.id === id)?.data.label || id
    const nodeTexts = nodes.map(node => ({ id: node.id, text: [
      `- [${node.id}] ${node.data.label || node.id}（${node.type}）${node.data.description ? `：${node.data.description}` : ''}`,
      ...project.document.edges.filter(edge => edge.source === node.id || edge.target === node.id)
        .map(edge => `- ${nodeName(edge.source)} --${edge.label || '连接'}--> ${nodeName(edge.target)}`),
    ].join('\n') }))
    return {
      source: {
        sourceKey,
        stableId: `canvas:${project.id}`,
        sourceType: 'canvas',
        title: project.title,
        contentHash: wikiHash(content),
        updatedAt: project.updatedAt,
        locator: { canvasId: project.id, nodeIds: nodes.map(node => node.id) },
        syncDomain: 'account-data',
      },
      content,
      nodeTexts,
    }
  }
  return (await readWikiArticle(parsed.sourceId))?.document ?? null
}

type FileOptions = Awaited<ReturnType<typeof getFilePathOptions>>

function fileSignature(info: FileInfo | null) {
  const modified = info?.mtime?.getTime()
  if (!info?.isFile || !modified || modified < 0 || !Number.isSafeInteger(info.size) || info.size < 0) return null
  return [modified, info.size, info.birthtime?.getTime(), info.dev, info.ino].join(':')
}

function isWikiArticlePath(path: string) {
  return Boolean(path) && !isAbsoluteFsPath(path) && !path.split('/').some(part => part.startsWith('.'))
}

async function readWikiArticle(filePath: string, options?: FileOptions) {
  const path = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!isWikiArticlePath(path)) return null
  try {
    const file = options ?? await getFilePathOptions(path)
    const raw = await readTextFile(file.path, { baseDir: file.baseDir })
    const info = await stat(file.path, { baseDir: file.baseDir }).catch(() => null)
    const content = normalizeSourceContent(raw)
    const contentHash = wikiHash(content)
    const document: WikiSourceDocument = {
      source: {
        sourceKey: `article:${path}`, stableId: `article:${path}`, sourceType: 'article',
        title: path.split('/').pop() || path, contentHash,
        updatedAt: info?.isFile ? Math.max(0, info.mtime?.getTime() || 0) || undefined : undefined,
        locator: { filePath: path }, syncDomain: 'library',
      },
      content,
      knowledgeContentHash: raw.includes('\r') ? hashKnowledgeContent(raw) : contentHash,
      derived: /^notegen-wiki-origin\s*:/m.test(content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] || ''),
    }
    return { document, signature: fileSignature(info) }
  } catch {
    return null
  }
}

export interface WikiArticleScan {
  metadata: WikiSourceMetadata
  signature: string | null
  verifyAfter: number
}

/** Keep only verified local metadata between scans. Never retain the article text. */
export async function scanWikiArticle(path: string, cached?: WikiArticleScan): Promise<WikiArticleScan | null> {
  if (!isWikiArticlePath(path)) return null
  const options = await getFilePathOptions(path).catch(() => null)
  if (!options) return null
  const before = fileSignature(await stat(options.path, { baseDir: options.baseDir }).catch(() => null))
  if (before && cached?.signature === before && performance.now() < cached.verifyAfter) return cached
  const result = await readWikiArticle(path, options)
  if (!result) return null
  const { source, derived, knowledgeContentHash } = result.document
  return {
    metadata: { source, derived, knowledgeContentHash },
    signature: before === result.signature ? before : null,
    // Periodically verify content even if an external writer preserved both time and size
    // and its notification was lost. Spread verification across ordinary reconciliations.
    verifyAfter: performance.now() + (10 + Math.random() * 10) * 60_000,
  }
}

export async function getWikiSourceAvailability(reference: WikiSourceReference): Promise<'available' | 'deleted' | 'unavailable'> {
  if (reference.sourceType === 'record') {
    const row = await getRecordLocatorBySourceId(reference.stableId.slice('record:'.length))
    return !row ? 'unavailable' : row.deleted ? 'deleted' : 'available'
  }
  if (reference.sourceType === 'canvas') {
    const canvas = await getCanvasProject(reference.stableId.slice('canvas:'.length))
    return !canvas ? 'unavailable' : canvas.deletedAt ? 'deleted' : 'available'
  }
  // An undownloaded remote article and an unreadable local file are not deletion evidence.
  return await resolveWikiSourceReference(reference) ? 'available' : 'unavailable'
}

/** A change event identifies a local row, while Wiki jobs and files identify a portable source. */
export async function getLocalWikiSourceStableId(sourceKey: string) {
  const parsed = parseKnowledgeSourceKey(sourceKey)
  if (!parsed) return null
  if (parsed.sourceType !== 'record') return sourceKey
  const id = Number(parsed.sourceId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const mark = await getMarkById(id)
  return mark?.sourceId ? `record:${mark.sourceId}` : null
}

/** Resolve portable sync references without trusting another device's local record ID. */
export async function resolveWikiSourceReference(reference: WikiSourceReference): Promise<WikiSourceDocument | null> {
  if (reference.sourceType === 'record') {
    const row = await getRecordLocatorBySourceId(reference.stableId.slice('record:'.length))
    if (!row || row.deleted) return null
    const document = await getWikiSourceDocument(`record:${row.id}`)
    return document?.source.stableId === reference.stableId ? document : null
  }
  if (reference.sourceType === 'canvas') {
    return getWikiSourceDocument(`canvas:${reference.stableId.replace(/^canvas:/, '')}`)
  }
  return getWikiSourceDocument(`article:${reference.stableId.replace(/^article:/, '')}`)
}

/** Snapshot the same exclusions for a whole discovery, compile or reconciliation pass. */
export async function getWikiSourcePolicy(contextId?: string, currentSettings?: WikiSettings) {
  const [generated, store, settings, knowledge] = await Promise.all([
    getWikiGeneratedNotes(contextId), Store.load('store.json'), currentSettings ?? getWikiSettings(contextId), getKnowledgeSettings(),
  ])
  const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
  const excludedFiles = new Set(await store.get<string[]>('vectorExcludedFiles') ?? [])
  const generatedPaths = new Set(generated)
  const explicitArticles = new Set(settings.scopes.filter(scope => scope.enabled && scope.effect !== 'exclude' && scope.kind === 'article').map(scope => scope.id))
  const allowsArticle = (filePath: string) => {
    const path = normalizeWikiScopeId(filePath)
    return knowledge.enabledSourceTypes.includes('article') && path !== WIKI_ROOT_FOLDER && !path.startsWith(`${WIKI_ROOT_FOLDER}/`)
      && (!generatedPaths.has(path) || explicitArticles.has(path)) && !excludedFiles.has(path)
      && isPathAllowedForRag(path, { excludedPaths })
  }
  return {
    settings, allowsArticle,
    allows(source: WikiSourceReference, derived = false) {
      return source.sourceType === 'article'
        ? !derived && allowsArticle(source.locator.filePath ?? source.stableId.slice('article:'.length))
        : knowledge.enabledSourceTypes.includes(source.sourceType)
    },
  }
}

export async function visitWikiArticleDocuments(
  paths: Iterable<string>, policy: Awaited<ReturnType<typeof getWikiSourcePolicy>>, isCurrent: () => boolean,
  visit?: (document: WikiSourceDocument) => void,
): Promise<number> {
  let count = 0
  for (const path of new Set(paths)) {
    if (!isCurrent()) break
    if (!isWikiArticlePathSelected(path, policy.settings) || !policy.allowsArticle(path)) continue
    const document = await getWikiSourceDocument(`article:${path}`)
    if (document && !document.derived && isCurrent()) {
      count++
      visit?.(document)
    }
  }
  return count
}

export async function isWikiSourceDocumentAllowed(document: WikiSourceMetadata, contextId?: string): Promise<boolean> {
  return document.source.sourceType === 'article'
    && (await getWikiSourcePolicy(contextId)).allows(document.source, document.derived)
}

/** Resolve a compiled revision against the current source, selection and exclusions before use. */
export async function resolveEligibleWikiRevision(
  revision: WikiSourceRevision, policy: Awaited<ReturnType<typeof getWikiSourcePolicy>>,
): Promise<WikiSourceRevision | null> {
  let source = revision.source
  if (!policy.allows(source)) return null
  const original = await resolveWikiSourceReference(source)
  if (original) {
    if (original.source.contentHash !== source.contentHash || !policy.allows(original.source, original.derived)
      || !isWikiSourceSelected(original.source, policy.settings)) return null
    source = original.source
  } else {
    if (!isWikiSourceSelected(source, policy.settings)) return null
    const { isWikiSourceCurrent } = await import('./sync')
    if (!await isWikiSourceCurrent(source)) return null
    if (source.sourceType === 'record') {
      source = { ...source, sourceKey: source.stableId,
        locator: { ...source.locator, markId: undefined, tagId: undefined, tagIds: undefined } }
    }
  }
  return { ...revision, source }
}
