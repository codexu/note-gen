import { Store } from '@tauri-apps/plugin-store'
import useSettingStore from '@/stores/setting'
import type { SyncPlatform } from '@/types/sync'
import { syncContentBytes } from './file-content'
import { getPathMoveConfiguration } from './path-move-configuration'
import { getSyncMetadataKey } from './sync-context'

interface FileSyncProof {
  hash: string
  version?: string
  updatedAt: number
}

let writes: Promise<void> = Promise.resolve()
let workspaceRevision = 0
let observingWorkspace = false

/** Returning to the same workspace must not revive an earlier transfer. */
export function captureFileSyncWorkspaceGuard(): () => boolean {
  if (!observingWorkspace) {
    observingWorkspace = true
    useSettingStore.subscribe((state, previous) => {
      if (state.workspacePath !== previous.workspacePath) workspaceRevision++
    })
  }
  const revision = workspaceRevision
  const path = useSettingStore.getState().workspacePath
  return () => revision === workspaceRevision && path === useSettingStore.getState().workspacePath
}

export async function fileSyncContentHash(content: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(syncContentBytes(content)).buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Bind a receipt to the actual provider target, never merely a relative path. */
export async function getFileSyncProofKey(path: string, platform: SyncPlatform): Promise<string | null> {
  const target = await getPathMoveConfiguration()
  if (!target || target.provider !== platform) return null
  const metadataKey = await getSyncMetadataKey(path, platform)
  return fileSyncContentHash(JSON.stringify([metadataKey, target.identity]))
}

export async function getFileSyncProof(key: string): Promise<FileSyncProof | null> {
  const store = await Store.load('sync_file_proofs.json')
  const proof = await store.get<FileSyncProof>(key)
    ?? (await store.get<Record<string, FileSyncProof>>('entries'))?.[key]
  return proof && /^[a-f0-9]{64}$/.test(proof.hash) && Number.isFinite(proof.updatedAt) ? proof : null
}

/** Record the accepted upload/download bytes, not a later local disk snapshot. */
export async function recordFileSyncProof(
  key: string | null, content: string | Uint8Array, version?: string, isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!key || !isCurrent()) return
  const hash = await fileSyncContentHash(content)
  const operation = writes.then(async () => {
    if (!isCurrent()) return
    const store = await Store.load('sync_file_proofs.json')
    if (!isCurrent()) return
    await store.set(key, { hash, version, updatedAt: Date.now() } satisfies FileSyncProof)
    await store.save()
  })
  writes = operation.catch(() => undefined)
  return operation
}
