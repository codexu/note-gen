import { lstat } from '@tauri-apps/plugin-fs'
import { z } from 'zod'
import { getFilePathOptions, getWorkspacePath, normalizeWorkspaceRelativePath } from '@/lib/workspace'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { fingerprintWorkspaceIdentity } from './workspace'
import { isResponseNotePath } from './response-catalog'

const sourceSchema = z.object({
  sourceKey: z.string().min(1), filename: z.string().optional(), filepath: z.string().optional(),
  sourceType: z.enum(['article', 'record', 'canvas']).optional(),
  locator: z.object({
    filePath: z.string().optional(), markId: z.number().int().positive().optional(),
    tagId: z.number().int().positive().optional(), canvasId: z.string().optional(),
    nodeIds: z.array(z.string()).optional(),
  }).optional(),
})
export type ChatResponseSource = z.infer<typeof sourceSchema>

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

/** Recover exact cited keys when synchronization retained only display text in ragSourceDetails. */
export function getChatResponseCitedSources(history: unknown, ...details: unknown[]): ChatResponseSource[] {
  const sources = new Map(getChatResponseSources(...details).map(source => [source.sourceKey, source]))
  const calls = responseHistory(history)?.toolCalls
  if (!Array.isArray(calls)) return [...sources.values()]
  for (const value of calls) {
    const call = responseHistory(value)
    const result = responseHistory(call?.result)
    if (call?.toolName !== 'knowledge_cite_sources' || (result?.success !== true && result?.ok !== true)) continue
    const keys = responseHistory(result.data)?.sourceKeys
    if (!Array.isArray(keys)) continue
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith('article:') || sources.has(key)) continue
      const path = key.slice('article:'.length)
      if (isResponseNotePath(path)) sources.set(key, { sourceKey: key, sourceType: 'article', locator: { filePath: path } })
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
