import { Store } from '@tauri-apps/plugin-store'
import type { SyncPlatform } from '@/types/sync'
import { downloadRemoteBytesWithVersion, uploadRemoteBytes, getRemoteContentType, getRemoteFileMetadata } from './remote-library'
import { gitBlobVersion, normalizeRemoteVersion } from './remote-content-cache'
import { getSyncMetadataKey } from './sync-context'
import { syncStaleError, withSyncStaleContext, type SyncStaleDetails } from './sync-stale-error'
import { prepareWorkspacePathUpload } from './workspace-path-moves'
import { syncContentBytes } from './file-content'

export type WorkspaceRemotePlatform = Exclude<SyncPlatform, 'local' | 'selfHosted'>

/** Explicit overwrite captures a usable version before preparing the write. */
export async function getWorkspaceOverwriteVersion(path: string, platform: WorkspaceRemotePlatform): Promise<string | null> {
  const metadata = await getRemoteFileMetadata(path, 'workspace', platform)
  if (!metadata) return null
  if (normalizeRemoteVersion(metadata.version)) return metadata.version
  return (await readVersionedWorkspaceFile(path, platform)).version
}

/** Bind the accepted version to the bytes actually read, never a later HEAD. */
export async function readVersionedWorkspaceFile(path: string, platform: WorkspaceRemotePlatform, stage: SyncStaleDetails['stage'] = 'scan') {
  let file: Awaited<ReturnType<typeof downloadRemoteBytesWithVersion>>
  try { file = await downloadRemoteBytesWithVersion(path, 'workspace', platform) }
  catch (error) { throw withSyncStaleContext(error, { stage, path, source: 'remote' }, true) }
  // Apache can emit a weak ETag while the resource's mtime is within the
  // current second. Re-read the bytes with their version after that window;
  // never promote a weak validator into a strong If-Match condition.
  for (let attempt = 0; platform === 'webdav' && /^W\//i.test(file.version || '') && attempt < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1100))
    file = await downloadRemoteBytesWithVersion(path, 'workspace', platform)
  }
  if (['github', 'gitee', 'gitlab', 'gitea'].includes(platform)) {
    const version = await gitBlobVersion(file.content, file.version?.length === 64 ? 64 : 40)
    if (file.version && normalizeRemoteVersion(file.version) !== version) throw syncStaleError({
      stage, path, source: 'remote', check: 'content',
      expected: { sha: normalizeRemoteVersion(file.version) }, actual: { sha: version, size: file.content.length },
    })
    return { content: file.content, version }
  }
  if (!normalizeRemoteVersion(file.version)) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  return { content: file.content, version: file.version! }
}

/** Normal writes use the last accepted version; explicit overwrites pass a
 * freshly captured version. Transport retries must keep that same condition. */
export async function uploadGuardedWorkspaceFile(
  path: string, content: string | Uint8Array, platform: WorkspaceRemotePlatform,
  expectedVersion: string | null, message: string, expectedMetadataKey?: string,
  beforeWrite?: () => Promise<void>,
): Promise<string> {
  await beforeWrite?.()
  await prepareWorkspacePathUpload(path)
  const store = await Store.load('store.json')
  if (await store.get('primaryBackupMethod') !== platform || await store.get('platformSwitchRecovery')
    || (expectedMetadataKey && await getSyncMetadataKey(path, platform) !== expectedMetadataKey)) {
    throw syncStaleError({ stage: 'apply', path, check: 'configuration' })
  }
  if (expectedVersion === 'uploaded' || expectedVersion?.startsWith('uploaded:')) throw syncStaleError({ stage: 'apply', path, source: 'remote', check: 'version', expected: { sha: expectedVersion } })
  const assertBeforeWrite = async () => {
    await beforeWrite?.()
    if (await store.get('primaryBackupMethod') !== platform || await store.get('platformSwitchRecovery')
      || (expectedMetadataKey && await getSyncMetadataKey(path, platform) !== expectedMetadataKey)) {
      throw syncStaleError({ stage: 'apply', path, check: 'configuration' })
    }
    await beforeWrite?.()
  }
  await assertBeforeWrite()
  const bytes = syncContentBytes(content)
  let uploadedVersion: string
  try { uploadedVersion = await uploadRemoteBytes(path, bytes, message, getRemoteContentType(path), 'workspace', { version: expectedVersion }, platform, beforeWrite ? assertBeforeWrite : undefined) }
  catch (error) { throw withSyncStaleContext(error, { stage: 'apply', path, source: 'remote', check: 'version', expected: { sha: expectedVersion, exists: expectedVersion !== null } }) }
  // A version returned by the conditional write is already bound to our bytes.
  // Keep it even if another writer advances the remote immediately afterwards.
  if (normalizeRemoteVersion(uploadedVersion) && uploadedVersion !== 'uploaded'
    && uploadedVersion !== expectedVersion) {
    if (await store.get('primaryBackupMethod') !== platform
      || (expectedMetadataKey && await getSyncMetadataKey(path, platform) !== expectedMetadataKey)) throw syncStaleError({ stage: 'apply', path, check: 'configuration' })
    return uploadedVersion
  }
  // Some WebDAV servers omit ETag on PUT. Verify the bytes and bind their GET
  // version instead of recording a placeholder or accepting another writer's HEAD.
  const accepted = await readVersionedWorkspaceFile(path, platform, 'verify')
  if (accepted.content.length !== bytes.length || accepted.content.some((value, index) => value !== bytes[index])) {
    throw syncStaleError({
      stage: 'verify', path, source: 'remote', check: 'content',
      expected: { sha: await gitBlobVersion(bytes), size: bytes.length },
      actual: { sha: await gitBlobVersion(accepted.content), size: accepted.content.length },
    })
  }
  if (await store.get('primaryBackupMethod') !== platform
    || (expectedMetadataKey && await getSyncMetadataKey(path, platform) !== expectedMetadataKey)) throw syncStaleError({ stage: 'verify', path, check: 'configuration' })
  return accepted.version
}
