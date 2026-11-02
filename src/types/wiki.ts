import type { KnowledgeLocator, KnowledgeSourceType } from './knowledge'

export const WIKI_SCHEMA_VERSION = 1
export const WIKI_PIPELINE_VERSION = 'wiki-1'
export const WIKI_ROOT_FOLDER = 'Wiki'

export type WikiSyncDomain = 'library' | 'account-data'

export interface WikiContext {
  id: string
  workspaceKey: string
  provider: string
  remoteKey: string
}

export type WikiScopeKind = 'article-folder' | 'article' | 'record-tag' | 'record' | 'canvas' | 'source-type'

export interface WikiScope {
  key: string
  kind: WikiScopeKind
  id: string
  label: string
  enabled: boolean
  /** Active selection rule; disabled entries remain synchronization tombstones. */
  effect?: 'include' | 'exclude'
  /** Per-device causal clock. Concurrent removal wins. */
  clock: Record<string, number>
}

export interface WikiSettings {
  enabled: boolean
  semanticSearchEnabled: boolean
  started: boolean
  paused: boolean
  modelId: string | null
  language: string
  languageClock: Record<string, number>
  generation: number
  scopes: WikiScope[]
}

export interface WikiSourceReference {
  sourceKey: string
  stableId: string
  sourceType: KnowledgeSourceType
  title: string
  contentHash: string
  locator: KnowledgeLocator
  syncDomain: WikiSyncDomain
  /** Remote source version used to verify a snapshot without downloading the original. */
  remoteVersion?: string
  tagKeys?: string[]
}

export type WikiSourceStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'deleted' | 'excluded' | 'unavailable'

export interface WikiSourceState {
  contextId: string
  stableId: string
  sourceKey: string
  sourceType: KnowledgeSourceType
  source: WikiSourceReference
  contentHash: string
  status: WikiSourceStatus
  revisionId: string | null
  version: number
  updatedAt: number
  error: string | null
}

export interface WikiEvidence {
  quote: string
  nodeId?: string
}

export interface WikiContribution {
  topicKey: string
  title: string
  aliases: string[]
  content: string
  evidence: WikiEvidence[]
}

export interface WikiUsage {
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export interface WikiSourceRevision {
  id: string
  contextId: string
  inputHash: string
  outputHash: string
  pipelineVersion: string
  generation: number
  language: string
  source: WikiSourceReference
  summary: string
  contributions: WikiContribution[]
  createdAt: number
  modelId: string
  usage: WikiUsage
}

export interface WikiPage {
  id: string
  contextId: string
  kind: 'source' | 'topic'
  title: string
  aliases: string[]
  body: string
  sourceRefs: WikiSourceReference[]
  inputHash: string
  outputHash: string
  updatedAt: number
  status: 'ready' | 'stale' | 'archived'
  relatedPageIds: string[]
  topicKey?: string
  generation?: number
  /** Workspace-relative Markdown path. SQLite is only a rebuildable cache. */
  filePath?: string
}

export interface WikiJob {
  id: string
  contextId: string
  sourceKey: string
  kind: 'source' | 'topic'
  inputHash: string
  status: 'pending' | 'running' | 'failed' | 'paused'
  stage: string
  attempts: number
  readyAt: number
  updatedAt: number
  error: string | null
}

export interface WikiSegmentCache {
  summary: string
  contributions: WikiContribution[]
  usage: WikiUsage
}

export type WikiSharedSettings = Pick<WikiSettings,
  'enabled' | 'started' | 'language' | 'languageClock' | 'generation' | 'scopes'>

export interface WikiSearchResult {
  page: WikiPage
  score: number
  /** A view assembled exclusively from allowed, current source contributions. */
  content: string
  sourceRefs: WikiSourceReference[]
}
