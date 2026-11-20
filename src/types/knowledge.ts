export type KnowledgeSourceType = 'article' | 'record' | 'canvas'

export type KnowledgeIndexStatus = 'pending' | 'indexing' | 'ready' | 'failed'

export interface KnowledgeLocator {
  filePath?: string
  markId?: number
  tagId?: number
  tagIds?: number[]
  canvasId?: string
  nodeIds?: string[]
}

export interface KnowledgeSource {
  sourceKey: string
  sourceType: KnowledgeSourceType
  sourceId: string
  title: string
  contentHash: string
  indexedHash?: string | null
  updatedAt: number
  locator: KnowledgeLocator
  status: KnowledgeIndexStatus
  error?: string | null
}

export interface KnowledgeChunk {
  content: string
  nodeId?: string
}

export interface KnowledgeSourceDocument extends KnowledgeSource {
  /** Identity of the record in this exact snapshot. */
  stableId?: string
  content: string
  chunks: KnowledgeChunk[]
}

export interface KnowledgeSearchFragment {
  content: string
  nodeId?: string
}

export interface KnowledgeSearchCandidate {
  stableId?: string
  sourceKey: string
  sourceType: KnowledgeSourceType
  sourceId: string
  title: string
  fragments: KnowledgeSearchFragment[]
  relevanceScore: number
  updatedAt: number
  locator: KnowledgeLocator
  wikiPageIds?: string[]
  evidenceKind?: 'wiki' | 'source'
}

export interface KnowledgeWikiSearchScope {
  dateRange?: { start: number; end: number }
  sourceTypes?: KnowledgeSourceType[]
  sourceMode?: 'prefer' | 'only'
  folderPath?: string
  tagId?: number
  /** In-memory authorization only; never included in model-facing previews. */
  sourceFilter?: (source: KnowledgeSource) => boolean
}

/** Page evidence is authorized independently of the original-source budget. */
export interface KnowledgeWikiPageGrant {
  contextId: string
  sourceRefs: Array<{ sourceKey: string; stableId: string; contentHash: string }>
  scope: KnowledgeWikiSearchScope
}

export interface KnowledgeWikiPageCandidate extends KnowledgeWikiPageGrant {
  pageId: string
  title: string
  excerpt: string
  relevanceScore: number
  updatedAt: number
}

export interface KnowledgeWikiReadGrant {
  pageId: string
  viewHash: string
  sourceRefs: KnowledgeWikiPageGrant['sourceRefs']
  grants: KnowledgeWikiPageGrant[]
}

export interface KnowledgeOriginalGrant {
  contentHash?: string
  contextId: string
  stableId: string
  scope: KnowledgeWikiSearchScope
  wikiScoped: boolean
}

export interface KnowledgeSearchResults {
  sourceGrants: Record<string, KnowledgeOriginalGrant>
  sources: KnowledgeSearchCandidate[]
  wikiPages: KnowledgeWikiPageCandidate[]
}

export interface KnowledgeReadPage {
  contentHash?: string
  stableId?: string
  sourceKey: string
  sourceType: KnowledgeSourceType
  title: string
  content: string
  cursor?: string
  nextCursor?: string
  complete: boolean
  updatedAt: number
  locator: KnowledgeLocator
}

export function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return value === 'article' || value === 'record' || value === 'canvas'
}

export function isPortableRecordSourceId(value: unknown): value is string {
  return typeof value === 'string' && /^record:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

export function createKnowledgeSourceKey(type: KnowledgeSourceType, id: string | number): string {
  const normalizedId = String(id).replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return `${type}:${normalizedId}`
}

export function parseKnowledgeSourceKey(sourceKey: string): {
  sourceType: KnowledgeSourceType
  sourceId: string
} | null {
  const separatorIndex = sourceKey.indexOf(':')
  if (separatorIndex <= 0) return null
  const sourceType = sourceKey.slice(0, separatorIndex)
  const sourceId = sourceKey.slice(separatorIndex + 1)
  if (!isKnowledgeSourceType(sourceType) || !sourceId) return null
  return { sourceType, sourceId }
}

export interface WikiPageEvidence {
  pageVersion?: string
  viewHash?: string
  pageId: string
  title: string
  updatedAt?: number
  content: string
}

export interface RagSourceDetail {
  stableId?: string
  originalContentHash?: string
  filepath: string
  filename: string
  /** Original evidence from source reads. Old Wiki-only messages used this field for summaries. */
  content: string
  sourceKey?: string
  sourceType?: KnowledgeSourceType
  sourceId?: string
  locator?: KnowledgeLocator
  updatedAt?: number
  wikiEvidence?: WikiPageEvidence[]
  /** Kept for existing local chat history. */
  evidenceKind?: 'wiki' | 'source'
  wikiPageId?: string
}
