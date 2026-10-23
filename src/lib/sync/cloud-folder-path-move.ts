import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { getWorkspacePath } from '@/lib/workspace'
import type { CloudFolderConfig } from '@/types/sync'
import { isOneDriveConfig, oneDriveMovePath, type OneDrivePathMoveOptions } from './onedrive'
import type { PathMoveRemoteVersion } from './path-move-metadata'
import { getAndroidCloudFolderWorkspaceWriteIdentity } from './cloud-folder'
import { withRemotePathWriteLock } from './remote-write-lock'

interface AndroidPathMoveSnapshot {
  identity: string
  fingerprint?: string
  files: Array<{ path: string; hash: string }>
}

function validPath(path: string): boolean {
  return Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && !part.startsWith('.'))
}

function physicalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLocaleLowerCase() : normalized
}

/** Workspace objects live directly in the selected cloud root. `.notegen`
 * contains application data and must never be mistaken for a second workspace. */
export async function moveCloudFolderPath(
  config: CloudFolderConfig, source: string, target: string, options: OneDrivePathMoveOptions,
): Promise<{ status: 'moved' | 'missing'; files?: PathMoveRemoteVersion[] }> {
  if (!validPath(source) || !validPath(target) || source === target
    || target.startsWith(`${source}/`) || source.startsWith(`${target}/`)) throw new Error('Invalid cloud folder rename paths')
  if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
  if (isOneDriveConfig(config)) return oneDriveMovePath(config, source, target, options)
  if (platform() !== 'android' || !config.path.startsWith('content://')) {
    const workspace = await getWorkspacePath()
    if (!workspace.isCustom || physicalPath(workspace.path) !== physicalPath(config.path)) {
      throw new Error('Cloud folder rename requires the selected folder to be the current workspace')
    }
    // The completed local fsRename already changed the actual provider folder.
    // iCloud / the desktop sync client propagates that operation itself.
    return { status: 'moved' }
  }
  return withRemotePathWriteLock(getAndroidCloudFolderWorkspaceWriteIdentity(config), [source, target], async () => {
    if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    const payload = { rootUri: config.path.trim(), source, target }
    let expected = options.expected
    if (!expected) {
      const snapshot = await invoke<AndroidPathMoveSnapshot | null>('snapshot_android_cloud_folder_path', payload)
      if (!snapshot) return { status: 'missing' }
      expected = JSON.stringify(snapshot)
      await options.rememberSource(expected)
    }
    if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    const snapshot = JSON.parse(expected) as AndroidPathMoveSnapshot
    if (!snapshot || typeof snapshot.identity !== 'string' || !snapshot.identity || !Array.isArray(snapshot.files)
      || (snapshot.fingerprint !== undefined && (typeof snapshot.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint)))
      || snapshot.files.some(file => !validPath(file.path) || !/^[a-f0-9]{64}$/.test(file.hash)
        || (file.path !== source && !file.path.startsWith(`${source}/`)))
      || new Set(snapshot.files.map(file => file.path)).size !== snapshot.files.length) {
      throw new Error('Invalid Android cloud folder rename snapshot')
    }
    const moved = await invoke<AndroidPathMoveSnapshot>('move_android_cloud_folder_path', {
      ...payload, expectedIdentity: snapshot.identity, expectedSnapshotJson: expected,
    })
    const after = new Map(moved.files.map(file => [file.path, file.hash]))
    const files = snapshot.files.flatMap(file => {
      if (file.path !== source && !file.path.startsWith(`${source}/`)) throw new Error('Invalid Android rename snapshot path')
      const newPath = `${target}${file.path.slice(source.length)}`
      const targetHash = after.get(newPath)
      return targetHash === file.hash ? [{ source: file.path, target: newPath, sourceVersion: file.hash,
        targetVersion: targetHash, sourceHash: file.hash, targetHash }] : []
    })
    if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    return { status: 'moved', files }
  })
}
