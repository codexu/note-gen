import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, lstat, mkdir } from '@tauri-apps/plugin-fs'
import type { Store } from '@tauri-apps/plugin-store'
import type { PlatformSwitchRecovery } from '@/lib/sync/platform-switch-recovery'

// iOS exposes the same app container through both /var/mobile and
// /private/var/mobile. Compare those aliases as one path, while retaining the
// container UUID so a genuinely stale container still requires rebasing.
export const normalizeManagedWorkspacePath = (path: string) => path
  .replace(/\\/g, '/')
  .replace(/^\/private(?=\/var\/mobile\/Containers\/Data\/Application\/)/, '')
  .replace(/\/+$/, '')
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const namedWorkspace = '[^/\\\\]+--[a-f0-9]{8}(?:[a-f0-9]{4}){0,6}'
const managedLocation = new RegExp(`^(?:article|workspaces/self-hosted/(?:${uuid}|${namedWorkspace})|restored-workspaces/(?:\\d+|self-hosted-\\d+-${uuid}(?:/\\d+)?))$`, 'i')
// Match only this app's data-container layout, never a document-provider URL.
const iosContainer = new RegExp(`^(?:(?:/private)?/var/mobile|/Users/[^/]+/Library/Developer/CoreSimulator/Devices/${uuid}/data)/Containers/Data/Application/${uuid}/(.+)$`, 'i')

/** Managed roots have a stable location relative to the current app-data root. */
export async function managedWorkspaceLocation(path: string): Promise<string | null> {
  const root = normalizeManagedWorkspacePath(await appDataDir())
  let candidate = normalizeManagedWorkspacePath(path)
  const currentIOS = root.match(iosContainer)
  const savedIOS = candidate.match(iosContainer)
  if (currentIOS && savedIOS) {
    // Strip only the container identity; the app-data suffix must still match.
    candidate = savedIOS[1]
    const prefix = `${currentIOS[1]}/`
    if (!candidate.startsWith(prefix)) return null
    candidate = candidate.slice(prefix.length)
  } else {
    if (!candidate.startsWith(`${root}/`)) return null
    candidate = candidate.slice(root.length + 1)
  }
  return managedLocation.test(candidate) ? candidate : null
}

export async function resolveManagedWorkspacePath(path: string): Promise<string> {
  const location = await managedWorkspaceLocation(path)
  return location === null ? path : join(await appDataDir(), location)
}

/** Only app-owned roots may be created automatically. External roots need re-selection. */
export async function ensureWorkspaceDirectory(path: string): Promise<void> {
  const location = await managedWorkspaceLocation(path)
  if (location !== null && normalizeManagedWorkspacePath(path) !== normalizeManagedWorkspacePath(await join(await appDataDir(), location))) {
    throw new Error('Workspace directory is unavailable: the saved workspace location must be refreshed')
  }
  if (!await exists(path)) {
    if (location === null) {
      throw new Error('Workspace directory is unavailable: please select the workspace folder again')
    }
    await mkdir(path, { recursive: true })
  }
  const metadata = await lstat(path)
  if (metadata.isSymlink) throw new Error('Symbolic-link workspace roots are not synchronized')
  if (!metadata.isDirectory) throw new Error('Workspace root is not a directory')
}

/** Refresh device-local path caches before hydrating settings or starting sync. */
export async function restoreManagedWorkspaceSettings(store: Store): Promise<void> {
  let changed = false
  const migrate = async (path: string) => {
    const resolved = await resolveManagedWorkspacePath(path)
    if (resolved !== path) changed = true
    return resolved
  }
  const workspace = await store.get<string>('workspacePath')
  if (workspace) await store.set('workspacePath', await migrate(workspace))
  for (const key of ['workspaceHistory', 'selfHostedDeferredWorkspacePaths']) {
    const paths = await store.get<string[]>(key)
    if (paths) await store.set(key, [...new Set(await Promise.all(paths.map(migrate)))])
  }
  const repos = await store.get<Record<string, unknown>>('workspaceSyncRepos')
  if (repos) {
    const entries = await Promise.all(Object.entries(repos).map(async ([path, value]) => [await migrate(path), value] as const))
    await store.set('workspaceSyncRepos', Object.fromEntries(entries))
  }
  const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
  if (recovery?.workspace) {
    await store.set('platformSwitchRecovery', { ...recovery, workspace: await migrate(recovery.workspace) })
  }
  if (changed) await store.save()
}
