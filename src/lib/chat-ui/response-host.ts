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
