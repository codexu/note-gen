import { appDataDir, join } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { copyFile, lstat } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { checkIsTauri, isMobileDevice } from '@/lib/check'
import { getWorkspacePath } from '@/lib/workspace'

export type ChatArtifactErrorCode =
  | 'INVALID_PATH'
  | 'NOT_ALLOWED'
  | 'WORKSPACE_CHANGED'
  | 'MISSING_FILE'
  | 'SYMLINK_BLOCKED'
  | 'UNSUPPORTED_PLATFORM'
  | 'SAVE_FAILED'
  | 'OPEN_FAILED'

export class ChatArtifactError extends Error {
  constructor(readonly code: ChatArtifactErrorCode) {
    super(code)
    this.name = 'ChatArtifactError'
  }
}

export interface ChatArtifactContext {
  /** Only paths reported by this reply's runtime output scan may authorize access. */
  allowedPaths: readonly string[]
  workspaceIdentity?: string
}

export interface ChatArtifactFile {
  name: string
  extension: string
  skillId: string
  relativePath: string
  absolutePath: string
  workspaceIdentity: string
}

function windowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith('//')
}

function absolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\//.test(path)
}

function pathIdentity(path: string): string {
  return windowsPath(path) ? path.toLowerCase() : path
}

function parsePath(value: string, decode: boolean): string | null {
  if (!value || value.length > 16_384 || /[\u0000-\u001f\u007f]/.test(value)) return null
  let path = value.trim()
  const sandbox = /^sandbox:/i.test(path)
  if (sandbox) path = path.slice('sandbox:'.length)
  if (decode || sandbox) {
    try { path = decodeURIComponent(path) } catch { return null }
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) return null
  path = path.replace(/\\/g, '/')
  // Device-prefixed Windows paths have the same identity as drive/UNC paths.
  if (/^\/\/\?\/UNC\//i.test(path)) path = `//${path.slice(8)}`
  else if (/^\/\/\?\/[a-zA-Z]:\//.test(path)) path = path.slice(4)
  if (sandbox && /^\/+[a-zA-Z]:\//.test(path)) path = path.replace(/^\/+/, '')
  else if (sandbox && path.startsWith('///')) path = `/${path.replace(/^\/+/, '')}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-zA-Z]:\//.test(path)) return null
  if (path.startsWith('./')) path = path.slice(2)
  if (path.startsWith('article/outputs/')) path = path.slice('article/'.length)

  const prefix = /^[a-zA-Z]:\//.test(path) ? path.slice(0, 3)
    : path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : ''
  const parts = path.slice(prefix.length).split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return null
  if (prefix === '//' && parts.length < 3) return null
  if (!prefix && (parts[0] !== 'outputs' || parts.length < 3)) return null
  return `${prefix}${parts.join('/')}`
}

/** Syntax recognition only. A parsed local href is never permission to open it. */
export function parseChatArtifactHref(href: string): string | null {
  return parsePath(href, true)
}

function requireDesktop(): void {
  if (!checkIsTauri() || isMobileDevice()) throw new ChatArtifactError('UNSUPPORTED_PLATFORM')
}

async function captureWorkspace() {
  const workspace = await getWorkspacePath()
  const path = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
  const markedPath = parsePath(`${path.replace(/[\\/]+$/, '')}/__workspace__`, false)
  let normalized = markedPath?.slice(0, -'/__workspace__'.length)
  if (normalized === '' && markedPath?.startsWith('/')) normalized = '/'
  if (normalized && /^[a-zA-Z]:$/.test(normalized)) normalized += '/'
  if (!normalized || !absolutePath(normalized)) throw new ChatArtifactError('INVALID_PATH')
  return {
    root: path,
    normalizedRoot: normalized,
    identity: `${workspace.isCustom ? 'custom' : 'default'}:${pathIdentity(normalized)}`,
  }
}

function relativeToWorkspace(path: string, workspaceRoot: string): string | null {
  if (!absolutePath(path)) return path
  const prefix = `${workspaceRoot.replace(/\/$/, '')}/`
  if (!pathIdentity(path).startsWith(pathIdentity(prefix))) return null
  return path.slice(prefix.length)
}

function artifactParts(path: string): string[] {
  const parts = path.split('/')
  if (parts.length < 3 || parts[0] !== 'outputs' || parts[1].length > 64
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1])) {
    throw new ChatArtifactError('NOT_ALLOWED')
  }
  return parts
}

async function checkDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isSymlink) throw new ChatArtifactError('SYMLINK_BLOCKED')
    if (!info.isDirectory) throw new ChatArtifactError('NOT_ALLOWED')
  } catch (error) {
    if (error instanceof ChatArtifactError) throw error
    throw new ChatArtifactError('MISSING_FILE')
  }
}

async function checkWorkspaceParents(root: string): Promise<void> {
  const normalized = root.replace(/\\/g, '/')
  const unc = normalized.startsWith('//') && !normalized.startsWith('//?/')
  const parts = normalized.split('/').filter(Boolean)
  let current: string
  let remaining: string[]
  if (unc) {
    current = `//${parts[0]}/${parts[1]}`
    remaining = parts.slice(2)
  } else if (/^[a-zA-Z]:\//.test(normalized)) {
    current = `${parts[0]}/`
    remaining = parts.slice(1)
  } else {
    current = '/'
    remaining = parts
  }
  await checkDirectory(current)
  for (const part of remaining) {
    current = await join(current, part)
    await checkDirectory(current)
  }
}

/** Revalidates the current workspace, historical allowlist, and every source component. */
export async function resolveChatArtifact(href: string, context: ChatArtifactContext): Promise<ChatArtifactFile> {
  requireDesktop()
  const workspace = await captureWorkspace()
  if (context.workspaceIdentity !== undefined && context.workspaceIdentity !== workspace.identity) {
    throw new ChatArtifactError('WORKSPACE_CHANGED')
  }
  const allowed = context.allowedPaths.map(path => parsePath(path, false)).filter((path): path is string => !!path)
  // Native paths supplied directly from the output map retain literal '%' in filenames.
  const candidate = context.allowedPaths.includes(href) ? parsePath(href, false) : parseChatArtifactHref(href)
  if (!candidate) throw new ChatArtifactError('INVALID_PATH')
  const relativePath = relativeToWorkspace(candidate, workspace.normalizedRoot)
  if (!relativePath) throw new ChatArtifactError('NOT_ALLOWED')
  const parts = artifactParts(relativePath)
  const rootPrefix = `${workspace.normalizedRoot.replace(/\/$/, '')}/`
  const normalizedAbsolute = `${rootPrefix}${relativePath}`
  const hasAbsoluteRecords = allowed.some(absolutePath)
  const authorized = allowed.some(path => {
    if (hasAbsoluteRecords && !absolutePath(path)) return false
    const target = absolutePath(path) ? path : `${rootPrefix}${path}`
    return pathIdentity(target) === pathIdentity(normalizedAbsolute)
  })
  if (!authorized) throw new ChatArtifactError('NOT_ALLOWED')

  await checkWorkspaceParents(workspace.normalizedRoot)
  let target = workspace.root
  for (let index = 0; index < parts.length; index += 1) {
    target = await join(target, parts[index])
    try {
      const info = await lstat(target)
      if (info.isSymlink) throw new ChatArtifactError('SYMLINK_BLOCKED')
      if (index === parts.length - 1 ? !info.isFile : !info.isDirectory) {
        throw new ChatArtifactError('NOT_ALLOWED')
      }
    } catch (error) {
      if (error instanceof ChatArtifactError) throw error
      throw new ChatArtifactError('MISSING_FILE')
    }
  }
  if ((await captureWorkspace()).identity !== workspace.identity) throw new ChatArtifactError('WORKSPACE_CHANGED')
  const name = parts[parts.length - 1]
  return {
    name,
    extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '',
    skillId: parts[1],
    relativePath,
    absolutePath: target,
    workspaceIdentity: workspace.identity,
  }
}

/** Call only from an explicit user action, never while rendering model output. */
export async function openChatArtifact(href: string, context: ChatArtifactContext): Promise<void> {
  const artifact = await resolveChatArtifact(href, context)
  try { await openPath(artifact.absolutePath) } catch { throw new ChatArtifactError('OPEN_FAILED') }
}

/** A native Save dialog grants the chosen destination; the source stays allowlisted. */
export async function saveChatArtifactAs(href: string, context: ChatArtifactContext): Promise<boolean> {
  const artifact = await resolveChatArtifact(href, context)
  let destination: string | null
  try {
    destination = await save({
      defaultPath: artifact.name,
      filters: /^[a-z0-9]{1,16}$/i.test(artifact.extension)
        ? [{ name: artifact.extension.toUpperCase(), extensions: [artifact.extension] }]
        : undefined,
    })
  } catch { throw new ChatArtifactError('SAVE_FAILED') }
  if (!destination) return false
  const current = await resolveChatArtifact(href, { ...context, workspaceIdentity: artifact.workspaceIdentity })
  if (pathIdentity(current.absolutePath.replace(/\\/g, '/')) === pathIdentity(destination.replace(/\\/g, '/'))) return true
  try { await copyFile(current.absolutePath, destination) } catch { throw new ChatArtifactError('SAVE_FAILED') }
  return true
}
