import type { OpenTabInfo } from '@/stores/article'
import { checkIsTauri } from '@/lib/check'
import { getDefaultArticleAbsolutePath, getWorkspacePath, isAbsoluteFsPath } from '@/lib/workspace'
import { editorPathsCouldReferToSameFile, editorPathsReferToSameFile, isEditorPathMutationLocked } from '@/lib/editor-deactivation'

export const EDITOR_WINDOW_STORE = 'editor-windows.json'
const openingEditorWindowPaths = new Set<string>()

export interface EditorWindowSession {
  version: 1
  id: string
  tab: OpenTabInfo
  absolutePath: string
  workspaceRoot: string
  workspaceIsCustom?: boolean
}

const EDITOR_WINDOW_EXTENSIONS = new Set([
  'md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less',
  'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go',
  'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg',
  'gitignore', 'env', 'example', 'template',
])

function normalizePath(path: string) {
  const slashPath = path.normalize('NFC').replaceAll('\\', '/')
  const isUncPath = slashPath.startsWith('//')
  const normalized = `${isUncPath ? '//' : ''}${slashPath
    .slice(isUncPath ? 2 : 0)
    .replace(/\/{2,}/g, '/')}`
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/$/, '')
}

function validSession(value: unknown): value is EditorWindowSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<EditorWindowSession>
  return session.version === 1
    && typeof session.id === 'string'
    && typeof session.absolutePath === 'string'
    && typeof session.workspaceRoot === 'string'
    && Boolean(session.tab && typeof session.tab.id === 'string' && typeof session.tab.path === 'string')
}

export function canOpenInEditorWindow(tab: OpenTabInfo) {
  if (tab.kind === 'record' || tab.kind === 'canvas' || tab.kind === 'blank' || tab.isFolder) return false
  const extension = tab.path.split('.').pop()?.toLowerCase()
  return Boolean(extension && EDITOR_WINDOW_EXTENSIONS.has(extension))
}

async function resolveEditorWindowPath(tab: OpenTabInfo) {
  const { join } = await import('@tauri-apps/api/path')
  const workspace = await getWorkspacePath()
  const workspaceRoot = workspace.isCustom
    ? workspace.path
    : await getDefaultArticleAbsolutePath('')
  const absolutePath = isAbsoluteFsPath(tab.path)
    ? tab.path
    : workspace.isCustom
      ? await join(workspace.path, tab.path)
      : await getDefaultArticleAbsolutePath(tab.path)
  return {
    absolutePath: normalizePath(absolutePath),
    workspaceRoot: normalizePath(workspaceRoot),
    workspaceIsCustom: workspace.isCustom,
  }
}

export async function loadEditorWindowSession(id: string) {
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load(EDITOR_WINDOW_STORE)
  const session = await store.get<unknown>(id)
  if (!validSession(session)) return null
  if (typeof session.workspaceIsCustom === 'boolean') return session

  // Sessions created before workspaceIsCustom was added only stored an absolute
  // workspace root. Recover their original workspace kind so the editor window
  // shares the same permission scope and plugin storage as the main window.
  const defaultWorkspaceRoot = normalizePath(await getDefaultArticleAbsolutePath(''))
  return {
    ...session,
    workspaceIsCustom: normalizePath(session.workspaceRoot) !== defaultWorkspaceRoot,
  }
}

export async function removeEditorWindowSession(id: string) {
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load(EDITOR_WINDOW_STORE)
  await store.delete(id)
  await store.save()
}

export async function focusEditorWindowForPath(
  path: string,
  options?: { shouldFocus?: () => boolean },
) {
  if (!checkIsTauri()) return false
  const tab = { id: '', path, name: '', isFolder: false }
  const absolutePath = isAbsoluteFsPath(path)
    ? normalizePath(path)
    : (await resolveEditorWindowPath(tab)).absolutePath
  const [{ getAllWebviewWindows }, { Store }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/plugin-store'),
  ])
  const store = await Store.load(EDITOR_WINDOW_STORE)
  const session = (await store.values<unknown>())
    .filter(validSession)
    .find(item => normalizePath(item.absolutePath) === absolutePath)
  if (!session) return false
  const editorWindow = (await getAllWebviewWindows())
    .find(window => window.label === `editor-${session.id}`)
  if (!editorWindow) {
    await store.delete(session.id)
    await store.save()
    return false
  }
  if (options?.shouldFocus && !options.shouldFocus()) return true
  await editorWindow.show()
  if (options?.shouldFocus && !options.shouldFocus()) return true
  await editorWindow.unminimize()
  if (options?.shouldFocus && !options.shouldFocus()) return true
  await editorWindow.setFocus()
  return true
}

export async function hasEditorWindowForPaths(paths: readonly string[], workspaceRoot: string): Promise<boolean> {
  if (!checkIsTauri()) return false
  const isAffected = (path: string) => paths.some(candidate => (
    editorPathsCouldReferToSameFile(candidate, path, workspaceRoot)
  ))
  if ([...openingEditorWindowPaths].some(isAffected)) return true
  const [{ getAllWebviewWindows }, { Store }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/plugin-store'),
  ])
  const store = await Store.load(EDITOR_WINDOW_STORE)
  const [sessions, windows] = await Promise.all([store.values<unknown>(), getAllWebviewWindows()])
  const sessionsByLabel = new Map<string, EditorWindowSession>(sessions.filter(validSession).map(session => [`editor-${session.id}`, session] as const))
  return [...openingEditorWindowPaths].some(isAffected)
    || windows.some(window => {
      if (!window.label.startsWith('editor-')) return false
      const session = sessionsByLabel.get(window.label)
      // A closing or malformed session is not proof that its save queue has
      // stopped. Wait until that window is gone before mutating note files.
      return !session || isAffected(session.absolutePath)
    })
}

export async function openEditorWindow(tab: OpenTabInfo) {
  if (!checkIsTauri() || !canOpenInEditorWindow(tab)) return false

  const resolved = await resolveEditorWindowPath(tab)
  if (isEditorPathMutationLocked(resolved.absolutePath, resolved.workspaceRoot)) return false
  if ([...openingEditorWindowPaths].some(path => editorPathsReferToSameFile(path, resolved.absolutePath))) return false
  openingEditorWindowPaths.add(resolved.absolutePath)
  try {
    return await createEditorWindow(tab, resolved)
  } finally {
    openingEditorWindowPaths.delete(resolved.absolutePath)
  }
}

async function createEditorWindow(
  tab: OpenTabInfo,
  { absolutePath, workspaceRoot, workspaceIsCustom }: Awaited<ReturnType<typeof resolveEditorWindowPath>>,
) {
  const [{ WebviewWindow, getAllWebviewWindows }, { Store }, { exists }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/plugin-store'),
    import('@tauri-apps/plugin-fs'),
  ])
  if (!await exists(absolutePath)) return false
  const store = await Store.load(EDITOR_WINDOW_STORE)
  const sessions = (await store.values<unknown>()).filter(validSession)
  const existingSession = sessions.find(session => normalizePath(session.absolutePath) === absolutePath)
  if (existingSession) {
    const existingWindow = (await getAllWebviewWindows())
      .find(window => window.label === `editor-${existingSession.id}`)
    if (existingWindow) {
      await existingWindow.show()
      await existingWindow.unminimize()
      await existingWindow.setFocus()
      return true
    }
  }

  const id = existingSession?.id ?? crypto.randomUUID()
  const session: EditorWindowSession = {
    version: 1,
    id,
    tab,
    absolutePath,
    workspaceRoot,
    workspaceIsCustom,
  }
  await store.set(id, session)
  await store.save()

  const editorWindow = new WebviewWindow(`editor-${id}`, {
    url: `/editor-window?session=${encodeURIComponent(id)}`,
    title: tab.name,
    width: 920,
    height: 720,
    center: true,
    dragDropEnabled: false,
    titleBarStyle: 'overlay',
  })

  return await new Promise<boolean>((resolve) => {
    void editorWindow.once('tauri://created', () => resolve(true))
    void editorWindow.once('tauri://error', async () => {
      await store.delete(id)
      await store.save()
      resolve(false)
    })
  })
}

export async function restoreEditorWindows() {
  if (!checkIsTauri()) return
  const [{ WebviewWindow, getAllWebviewWindows }, { Store }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/plugin-store'),
  ])
  const openLabels = new Set((await getAllWebviewWindows()).map(window => window.label))
  const store = await Store.load(EDITOR_WINDOW_STORE)
  const sessions = (await store.values<unknown>()).filter(validSession)

  for (const session of sessions) {
    const label = `editor-${session.id}`
    if (openLabels.has(label)) continue
    if (isEditorPathMutationLocked(session.absolutePath, session.workspaceRoot)) continue
    if ([...openingEditorWindowPaths].some(path => editorPathsReferToSameFile(path, session.absolutePath))) continue
    openingEditorWindowPaths.add(session.absolutePath)
    const editorWindow = new WebviewWindow(label, {
      url: `/editor-window?session=${encodeURIComponent(session.id)}`,
      title: session.tab.name,
      width: 920,
      height: 720,
      dragDropEnabled: false,
      titleBarStyle: 'overlay',
    })
    const releaseOpeningPath = () => { openingEditorWindowPaths.delete(session.absolutePath) }
    void editorWindow.once('tauri://created', releaseOpeningPath)
    void editorWindow.once('tauri://error', releaseOpeningPath)
  }
}
