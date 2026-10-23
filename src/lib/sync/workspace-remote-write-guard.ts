import { Store } from '@tauri-apps/plugin-store'
import { readFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import type { SyncPlatform } from '@/types/sync'
import { isFileDeletionPending } from '@/stores/file-deletion'
import useSettingStore from '@/stores/setting'
import { getPendingWorkspacePathMoves, getWorkspacePathMoveContext } from './workspace-path-moves'
import { syncStaleError } from './sync-stale-error'
import { waitForRemoteWrites } from './remote-write-lock'

export async function waitForPendingFileUploads(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await waitForRemoteWrites()
}

async function contentDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function localDigest(path: string, baseDir?: Awaited<ReturnType<typeof getFilePathOptions>>['baseDir']): Promise<string> {
  return contentDigest(await readFile(path, { baseDir }))
}

/** Capture before queuing a transport write, then check again inside its lock.
 * The journal read below deliberately does not acquire the journal mutex. */
export async function captureWorkspaceRemoteWriteGuard(
  path: string, platform: SyncPlatform, includeLocalVersion = true, content?: string | Uint8Array,
): Promise<(() => Promise<void>) | undefined> {
  const validatedPath = includeLocalVersion ? path : path.replace(/\/+$/, '')
  if (!validatedPath || validatedPath.split('/').some(part => !part || part.startsWith('.'))) return undefined
  const workspacePath = useSettingStore.getState().workspacePath || ''
  const ensureNotDeleting = () => {
    if (includeLocalVersion && isFileDeletionPending(path, workspacePath)) {
      throw syncStaleError({ stage: 'apply', path, source: 'local', check: 'version' })
    }
  }
  ensureNotDeleting()
  const store = await Store.load('store.json')
  if ((await store.get<string>('primaryBackupMethod') || 'github') !== platform) {
    throw syncStaleError({ stage: 'apply', path, check: 'configuration' })
  }
  const context = await getWorkspacePathMoveContext()
  const options = await getFilePathOptions(path)
  const expectedDigest = !includeLocalVersion ? undefined : content === undefined
    ? await localDigest(options.path, options.baseDir)
    : await contentDigest(typeof content === 'string' ? new TextEncoder().encode(content) : content)
  return async () => {
    ensureNotDeleting()
    if ((await store.get<string>('primaryBackupMethod') || 'github') !== platform
      || await getWorkspacePathMoveContext() !== context || await store.get('platformSwitchRecovery')) {
      throw syncStaleError({ stage: 'apply', path, check: 'configuration' })
    }
    const moves = await getPendingWorkspacePathMoves()
    if (moves.some(move => [move.source, move.target].some(root => path === root
      || path.startsWith(`${root}/`) || root.startsWith(`${path}/`)))) {
      throw syncStaleError({ stage: 'apply', path, source: 'local', check: 'version' })
    }
    if (expectedDigest !== undefined && await localDigest(options.path, options.baseDir) !== expectedDigest) {
      throw syncStaleError({ stage: 'apply', path, source: 'local', check: 'content' })
    }
    ensureNotDeleting()
  }
}
