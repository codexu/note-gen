import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs'
import { createHash } from 'crypto'
import { getMarkById, getRecordLocatorBySourceId, type Mark } from '@/db/marks'
import { getTags, type Tag } from '@/db/tags'
import { getCanvasProject } from '@/db/canvases'
import { getAllMarkdownFiles } from '@/lib/files'
import { getArticleKnowledgeUpdatedAt, serializeCanvasDocument } from '@/lib/knowledge-content'
import { parseKnowledgeSourceKey } from '@/types/knowledge'
import { getFilePathOptions } from '@/lib/workspace'
import { recordMatchesTag, recordTagIds } from '@/lib/record-tags'
import { Store } from '@tauri-apps/plugin-store'
import { getWikiGeneratedNotes, getWikiSettings, isWikiArticlePathSelected, isWikiSourceSelected, normalizeWikiScopeId } from './settings'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from '@/lib/rag-retrieval-policy'
import { getKnowledgeSettings } from '@/lib/knowledge-settings'
import { WIKI_ROOT_FOLDER, type WikiSettings, type WikiSourceReference, type WikiSourceRevision, type WikiSyncDomain } from '@/types/wiki'

export interface WikiSourceDocument {
  source: WikiSourceReference
  content: string
  derived?: boolean
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
  const path = parsed.sourceId.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || path.startsWith('/') || path.split('/').some(part => part === '..' || part.startsWith('.'))) return null
  try {
    const options = await getFilePathOptions(path)
    const content = normalizeSourceContent(options.baseDir === undefined
      ? await readTextFile(options.path)
      : await readTextFile(options.path, { baseDir: options.baseDir || BaseDirectory.AppData }))
    return {
      source: {
        sourceKey: `article:${path}`,
        stableId: `article:${path}`,
        sourceType: 'article',
        title: path.split('/').pop() || path,
        contentHash: wikiHash(content),
        updatedAt: await getArticleKnowledgeUpdatedAt(options) || undefined,
        locator: { filePath: path },
        syncDomain: 'library',
      },
      content,
      derived: /^notegen-wiki-origin\s*:/m.test(content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] || ''),
    }
  } catch {
    return null
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

/** Shared by source discovery and folder statistics, including derived-document exclusions. */
export async function collectWikiArticleSourceDocuments(paths: string[], contextId?: string): Promise<WikiSourceDocument[]> {
  const policy = await getWikiSourcePolicy(contextId)
  const documents: WikiSourceDocument[] = []
  for (const filePath of new Set(paths)) {
    if (!isWikiArticlePathSelected(filePath, policy.settings) || !policy.allowsArticle(filePath)) continue
    const document = await getWikiSourceDocument(`article:${filePath}`)
    if (document && !document.derived) documents.push(document)
  }
  return documents
}

export async function collectWikiSourceDocuments(contextId?: string): Promise<WikiSourceDocument[]> {
  const files = await getAllMarkdownFiles()
  return collectWikiArticleSourceDocuments(files.map(file => file.relativePath), contextId)
}

export async function isWikiSourceDocumentAllowed(document: WikiSourceDocument, contextId?: string): Promise<boolean> {
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
