import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs'
import { createHash } from 'crypto'
import { getDb } from '@/db'
import { getAllMarks, getMarkById, type Mark } from '@/db/marks'
import { getTags, type Tag } from '@/db/tags'
import { getCanvasProject, getCanvasProjects } from '@/db/canvases'
import { getAllMarkdownFiles } from '@/lib/files'
import { serializeCanvasDocument } from '@/lib/knowledge-content'
import { parseKnowledgeSourceKey } from '@/types/knowledge'
import { getFilePathOptions } from '@/lib/workspace'
import { recordMatchesTag, recordTagIds } from '@/lib/record-tags'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import { Store } from '@tauri-apps/plugin-store'
import { getWikiGeneratedNotes, getWikiSettings, isWikiArticlePathSelected, normalizeWikiScopeId } from './settings'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from '@/lib/rag-retrieval-policy'
import { getKnowledgeSettings } from '@/lib/knowledge-settings'
import { WIKI_ROOT_FOLDER, type WikiSourceReference, type WikiSyncDomain } from '@/types/wiki'

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

async function recordStableId(mark: Mark): Promise<string> {
  if (mark.sourceId) return mark.sourceId
  const database = await getDb()
  await database.execute("update marks set sourceId = $1 where id = $2 and coalesce(sourceId, '') = ''", [crypto.randomUUID(), mark.id])
  const rows = await database.select<Array<{ sourceId: string }>>('select sourceId from marks where id = $1', [mark.id])
  if (!rows[0]?.sourceId) throw new Error('WIKI_SOURCE_NOT_FOUND')
  enqueueAutoDataSync('records', 'wiki:stable-record-id')
  return rows[0].sourceId
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

export async function getWikiSourceAvailability(sourceKey: string): Promise<'available' | 'deleted' | 'unavailable'> {
  const parsed = parseKnowledgeSourceKey(sourceKey)
  if (!parsed) return 'unavailable'
  if (parsed.sourceType === 'record') {
    const id = Number(parsed.sourceId)
    if (!Number.isSafeInteger(id) || id <= 0) return 'unavailable'
    const mark = await getMarkById(id)
    return !mark ? 'unavailable' : mark.deleted ? 'deleted' : 'available'
  }
  if (parsed.sourceType === 'canvas') {
    const canvas = await getCanvasProject(parsed.sourceId)
    return !canvas ? 'unavailable' : canvas.deletedAt ? 'deleted' : 'available'
  }
  // An undownloaded remote article and an unreadable local file are not deletion evidence.
  return await getWikiSourceDocument(sourceKey) ? 'available' : 'unavailable'
}

/** Only selected sources acquire a legacy synchronization identity; discovery stays read-only. */
export async function ensureWikiSourceIdentity(document: WikiSourceDocument): Promise<WikiSourceDocument> {
  if (document.source.sourceType !== 'record') return document
  const mark = await getMarkById(document.source.locator.markId ?? Number(document.source.sourceKey.replace(/^record:/, '')))
  if (!mark || mark.deleted) return document
  if (!mark.sourceId) await recordStableId(mark)
  return await getWikiSourceDocument(document.source.sourceKey) || document
}

/** Resolve portable sync references without trusting another device's local record ID. */
export async function resolveWikiSourceReference(reference: WikiSourceReference): Promise<WikiSourceDocument | null> {
  if (reference.sourceType === 'record') {
    const database = await getDb()
    const stableId = reference.stableId.replace(/^record:/, '')
    const rows = await database.select<Array<{ id: number }>>('select id from marks where sourceId = $1 limit 1', [stableId])
    return rows[0] ? getWikiSourceDocument(`record:${rows[0].id}`) : null
  }
  if (reference.sourceType === 'canvas') {
    return getWikiSourceDocument(`canvas:${reference.stableId.replace(/^canvas:/, '')}`)
  }
  return getWikiSourceDocument(`article:${reference.stableId.replace(/^article:/, '')}`)
}

/** Shared by source discovery and folder statistics, including derived-document exclusions. */
export async function collectWikiArticleSourceDocuments(paths: string[], contextId?: string): Promise<WikiSourceDocument[]> {
  const [generated, store, settings, knowledge] = await Promise.all([
    getWikiGeneratedNotes(contextId), Store.load('store.json'), getWikiSettings(contextId), getKnowledgeSettings(),
  ])
  if (!knowledge.enabledSourceTypes.includes('article')) return []
  const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
  const excludedFiles = await store.get<string[]>('vectorExcludedFiles') ?? []
  const explicitArticles = new Set(settings.scopes.filter(scope => scope.enabled && scope.effect !== 'exclude' && scope.kind === 'article').map(scope => scope.id))
  const documents: WikiSourceDocument[] = []
  for (const filePath of new Set(paths)) {
    if (filePath === WIKI_ROOT_FOLDER || filePath.startsWith(`${WIKI_ROOT_FOLDER}/`)) continue
    const path = normalizeWikiScopeId(filePath)
    if (!isWikiArticlePathSelected(path, settings)) continue
    if ((generated.includes(filePath) && !explicitArticles.has(path)) || excludedFiles.includes(filePath)
      || !isPathAllowedForRag(filePath, { excludedPaths })) continue
    const document = await getWikiSourceDocument(`article:${filePath}`)
    if (document && !document.derived) documents.push(document)
  }
  return documents
}

export async function collectWikiSourceDocuments(): Promise<WikiSourceDocument[]> {
  const [files, marks, canvases, tags] = await Promise.all([
    getAllMarkdownFiles(), getAllMarks(), getCanvasProjects(), getTags(),
  ])
  const documents = await collectWikiArticleSourceDocuments(files.map(file => file.relativePath))
  for (const mark of marks) {
    const document = await readWikiRecord(mark, tags)
    if (document) documents.push(document)
  }
  for (const canvas of canvases) {
    const document = await getWikiSourceDocument(`canvas:${canvas.id}`)
    if (document) documents.push(document)
  }
  return documents
}

export async function isWikiSourceDocumentAllowed(document: WikiSourceDocument, contextId?: string): Promise<boolean> {
  if (!(await getKnowledgeSettings()).enabledSourceTypes.includes(document.source.sourceType)) return false
  if (document.source.sourceType !== 'article') return true
  const path = document.source.locator.filePath || document.source.sourceKey.replace(/^article:/, '')
  if (document.derived || path === WIKI_ROOT_FOLDER || path.startsWith(`${WIKI_ROOT_FOLDER}/`)) return false
  const [store, generated, settings] = await Promise.all([Store.load('store.json'), getWikiGeneratedNotes(contextId), getWikiSettings(contextId)])
  const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
  const excludedFiles = await store.get<string[]>('vectorExcludedFiles') ?? []
  const explicitlySelected = settings.scopes.some(scope => scope.enabled && scope.effect !== 'exclude' && scope.kind === 'article' && scope.id === normalizeWikiScopeId(path))
  return (!(generated.includes(path) || document.derived) || explicitlySelected)
    && !excludedFiles.includes(path) && isPathAllowedForRag(path, { excludedPaths })
}
