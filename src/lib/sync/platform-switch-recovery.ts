import type { Store } from '@tauri-apps/plugin-store'
import { SYNC_PLATFORMS, type SyncPlatform, type CloudFolderConfig } from '@/types/sync'
import { sanitizeSyncErrorMessage } from './remote-file'

export interface PlatformSwitchRecovery {
  platform: SyncPlatform
  originalPlatform?: SyncPlatform
  commitPlatform?: SyncPlatform
  backupPath?: string
  backupPaths?: string[]
  selfHostedBackupPath?: string
  selfHostedSafetyBackupPath?: string
  selfHostedSafetyBackupPaths?: string[]
  startedAt?: number
  workspace?: string
  targetFingerprint?: string
  mutated?: boolean
  error?: string
  failedAt?: number
  resolution?: 'cancelled' | 'skipped'
  skippedFromPlatform?: SyncPlatform
  workspaceSetup?: { path: string; config: CloudFolderConfig; originalPath?: string; originalConfig?: CloudFolderConfig }
}

let primaryPlatformCommit = Promise.resolve()

/** Serialize startup repair and final commits, including their UI hydration. */
export function withPrimaryPlatformLock<T>(action: () => Promise<T>): Promise<T> {
  const pending = primaryPlatformCommit.then(action)
  primaryPlatformCommit = pending.then(() => undefined, () => undefined)
  return pending
}

export async function restoreInterruptedPrimaryPlatform(store: Store) {
  return withPrimaryPlatformLock(async () => {
    const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    if (!recovery || !SYNC_PLATFORMS.includes(recovery.platform)) return null
    // An explicit skip has durably selected the target but keeps its unresolved
    // marker to pause sync. Other markers mean final verification did not commit.
    // Older versions could persist the target early; repair before hydration.
    const original = recovery.resolution === 'skipped' ? recovery.platform : recovery.originalPlatform
    if (original && SYNC_PLATFORMS.includes(original)) {
      if (await store.get('primaryBackupMethod') !== original) {
        await store.set('primaryBackupMethod', original)
        await store.save()
      }
    } else {
      // Legacy markers without an original provider cannot safely infer one.
      recovery.originalPlatform = undefined
    }
    if (recovery.error) {
      const sanitized = sanitizeSyncErrorMessage(recovery.error)
      if (sanitized !== recovery.error) {
        recovery.error = sanitized
        // Redaction must not block startup repair or displaying the protected
        // recovery state if this optional migration cannot be saved.
        try {
          await store.set('platformSwitchRecovery', recovery)
          await store.save()
        } catch { console.warn('Could not save the redacted sync recovery error') }
      }
    }
    return recovery
  })
}
