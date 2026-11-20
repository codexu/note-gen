import { lstat } from '@tauri-apps/plugin-fs'
import { z } from 'zod'
import { getFilePathOptions, getWorkspacePath, normalizeWorkspaceRelativePath } from '@/lib/workspace'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { isPortableRecordSourceId } from '@/types/knowledge'
import { fingerprintWorkspaceIdentity } from './workspace'
import { isResponseNotePath } from './response-catalog'

const sourceSchema = z.object({
  sourceKey: z.string().min(1), stableId: z.string().optional(), filename: z.string().optional(), filepath: z.string().optional(),
  content: z.string().optional(), originalContentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  evidenceKind: z.enum(['source', 'wiki']).optional(),
  sourceType: z.enum(['article', 'record', 'canvas']).optional(),
  locator: z.object({
    filePath: z.string().optional(), markId: z.number().int().positive().optional(),
    tagId: z.number().int().positive().optional(), canvasId: z.string().optional(),
    nodeIds: z.array(z.string()).optional(),
  }).optional(),
})
export type ChatResponseSource = z.infer<typeof sourceSchema> & {
  /** Set only from a successful source read followed by a successful citation in this run. */
  verifiedPortableRecord?: true
  /** A relative article key reconstructed from chat history also needs matching file contents. */
  requiresArticleEvidence?: true
}

export function getChatResponseSources(...inputs: unknown[]): ChatResponseSource[] {
  const sources = new Map<string, ChatResponseSource>()
  for (let input of inputs) {
    if (typeof input === 'string') {
      try { input = JSON.parse(input) as unknown } catch { continue }
    }
    if (!Array.isArray(input)) continue
    for (const item of input) {
      const parsed = sourceSchema.safeParse(item)
      if (parsed.success) sources.set(parsed.data.sourceKey, parsed.data)
    }
  }
  return [...sources.values()]
}

function responseHistory(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === 'string') {
    try { input = JSON.parse(input) as unknown } catch { return undefined }
  }
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined
}

export function getChatResponseWorkspaceFingerprint(history: unknown): string | undefined {
  const value = responseHistory(history)?.workspaceFingerprint
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : undefined
}

function rememberRecordRead(records: Map<string, ChatResponseSource | null>, record: Record<string, unknown>) {
  const { sourceKey } = record
  if (typeof sourceKey !== 'string') return
  const stableId = record.stableId ?? sourceKey
  if (!isPortableRecordSourceId(stableId) || (sourceKey !== stableId && !/^record:[1-9]\d*$/.test(sourceKey))) {
    records.set(sourceKey, null)
    return
  }
  const previous = records.get(sourceKey)
  if (previous === undefined) {
    records.set(sourceKey, { sourceKey, stableId, sourceType: 'record', filename: typeof record.title === 'string' ? record.title : undefined })
  } else if (previous?.stableId !== stableId) {
    // Reused sender row numbers cannot identify the record a historical citation meant.
    records.set(sourceKey, null)
  }
}

function articleReadEvidence(source: Record<string, unknown>, kind: 'wiki' | 'source'): ChatResponseSource | null {
  const key = source.sourceKey
  if (typeof key !== 'string' || !key.startsWith('article:') || !isResponseNotePath(key.slice('article:'.length))
    || (source.sourceType && source.sourceType !== 'article') || (source.stableId && source.stableId !== key)) return null
  const hash = typeof source.contentHash === 'string' && /^[a-f0-9]{64}$/.test(source.contentHash) ? source.contentHash : undefined
  // Older source reads have no hash. Only their literal original text is suitable for comparison.
  const content = !hash && kind === 'source' && typeof source.content === 'string' ? source.content.trim() : undefined
  if (!hash && !content) return null
  return { sourceKey: key, sourceType: 'article', originalContentHash: hash, content, evidenceKind: kind, requiresArticleEvidence: true }
}

/** Recover exact cited keys when synchronization retained only display text in ragSourceDetails. */
export function getChatResponseCitedSources(history: unknown, ...details: unknown[]): ChatResponseSource[] {
  const sources = new Map(getChatResponseSources(...details).map(source => [source.sourceKey, source]))
  const readArticles = new Map<string, ChatResponseSource>()
  for (const source of sources.values()) {
    if (source.sourceKey.startsWith('article:') && source.locator?.filePath !== source.sourceKey.slice('article:'.length)) {
      source.requiresArticleEvidence = true
      readArticles.set(source.sourceKey, source)
    }
  }
  const calls = responseHistory(history)?.toolCalls
  if (!Array.isArray(calls)) return [...sources.values()]
  const readRecords = new Map<string, ChatResponseSource | null>()
  const citedRecords = new Set<string>()
  function rememberRead(value: unknown, kind: 'wiki' | 'source') {
    const source = responseHistory(value)
    if (!source) return
    if (source.sourceType === 'record') {
      rememberRecordRead(readRecords, source)
      return
    }
    const evidence = articleReadEvidence(source, kind)
    if (!evidence) return
    const previous = readArticles.get(evidence.sourceKey)
    // Prefer an original hash, then a Wiki source hash, then one contiguous excerpt.
    if (previous?.originalContentHash && (!evidence.originalContentHash || (previous.evidenceKind !== 'wiki' && kind === 'wiki'))) return
    if (!evidence.originalContentHash && previous?.evidenceKind !== 'wiki'
      && (previous?.content?.length ?? 0) >= (evidence.content?.length ?? 0)) return
    readArticles.set(evidence.sourceKey, evidence)
  }
  for (const value of calls) {
    const call = responseHistory(value)
    const result = responseHistory(call?.result)
    if (!call || (call.status !== undefined && call.status !== 'success') || (result?.success !== true && result?.ok !== true)) continue
    if (call.toolName === 'knowledge_read_sources' && Array.isArray(result.data)) {
      for (const page of result.data) rememberRead(page, 'source')
    }
    if (call.toolName === 'knowledge_read_wiki' && Array.isArray(result.data)) {
      for (const page of result.data) {
        const references = responseHistory(page)?.sourceRefs
        if (!Array.isArray(references)) continue
        for (const reference of references) rememberRead(reference, 'wiki')
      }
    }
    if (call.toolName !== 'knowledge_cite_sources') continue
    const keys = responseHistory(result.data)?.sourceKeys
    if (!Array.isArray(keys)) continue
    for (const key of keys) {
      if (typeof key === 'string' && readRecords.get(key)) citedRecords.add(key)
      if (typeof key !== 'string' || !key.startsWith('article:')) continue
      const path = key.slice('article:'.length)
      if (!isResponseNotePath(path)) continue
      const stored = sources.get(key)
      if (stored && !stored.requiresArticleEvidence) continue
      const evidence = readArticles.get(key)
      sources.set(key, {
        ...stored, ...evidence, filename: stored?.filename, sourceKey: key, sourceType: 'article', requiresArticleEvidence: true,
      })
    }
  }
  for (const key of citedRecords) {
    const record = readRecords.get(key)
    const stored = sources.get(key)
    if (record && (!stored?.stableId || stored.stableId === record.stableId)) {
      sources.set(key, { ...record, filename: stored?.filename ?? record.filename, verifiedPortableRecord: true })
    }
  }
  return [...sources.values()]
}

export async function assertResponseWorkspace(fingerprint?: string): Promise<void> {
  if (!fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('RESPONSE_WORKSPACE_UNAVAILABLE')
  const identity = getSkillWorkspaceIdentity(await getWorkspacePath())
  if (await fingerprintWorkspaceIdentity(identity) !== fingerprint.toLowerCase()) throw new Error('RESPONSE_WORKSPACE_CHANGED')
}

/** Check every path component before exposing a note-opening action. */
export async function verifyResponseNote(path: string): Promise<string> {
  if (!isResponseNotePath(path)) throw new Error('RESPONSE_NOTE_INVALID')
  const normalized = await normalizeWorkspaceRelativePath(path)
  if (!isResponseNotePath(normalized)) throw new Error('RESPONSE_NOTE_INVALID')
  const parts = normalized.split('/')
  for (let index = 0; index <= parts.length; index += 1) {
    const options = await getFilePathOptions(parts.slice(0, index).join('/'))
    const info = await lstat(options.path, options.baseDir ? { baseDir: options.baseDir } : undefined)
    if (info.isSymlink || (index === parts.length ? !info.isFile : !info.isDirectory)) throw new Error('RESPONSE_NOTE_UNAVAILABLE')
  }
  return normalized
}
