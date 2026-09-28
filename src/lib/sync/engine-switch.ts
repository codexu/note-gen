import { getDb } from '@/db'
import { getSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/runtime'
import type { SyncPlatform } from '@/types/sync'

export interface SyncEngineSwitchReview {
  current: SyncPlatform
  next: SyncPlatform
  pendingLocalChanges: number
  pendingCommands: number
  currentRemoteObjects: number
  nextRemoteObjects: number
  requiresReview: boolean
}

export async function inspectSyncEngineSwitch(
  current: SyncPlatform,
  next: SyncPlatform,
): Promise<SyncEngineSwitchReview> {
  if (current === next) {
    return {
      current, next, pendingLocalChanges: 0, pendingCommands: 0,
      currentRemoteObjects: 0, nextRemoteObjects: 0, requiresReview: false,
    }
  }
  const database = await getDb()
  const [changes] = await database.select<Array<{ total: number }>>(
    "select count(*) as total from self_hosted_local_changes where state in ('pending', 'queued')"
  )
  const [commands] = await database.select<Array<{ total: number }>>(
    "select count(*) as total from self_hosted_outbox where state in ('pending', 'retry')"
  )
  const remoteObjectCount = async (platform: SyncPlatform) => {
    if (platform === 'local') return 0
    if (platform === 'selfHosted') {
      const [row] = await database.select<Array<{ total: number }>>(
        `select count(*) as total from self_hosted_object_mappings
         where deleted_at is null and workspace_id in (
           select workspace_id from self_hosted_workspace_bindings where binding_state = 'bound'
         )`
      )
      return row?.total ?? 0
    }
    try {
      const { listRemoteLibraryFiles } = await import('./remote-library')
      return (await listRemoteLibraryFiles({ includeStaticAssets: true, platform })).length
    } catch {
      return -1
    }
  }
  const [currentRemoteObjects, nextRemoteObjects] = await Promise.all([
    remoteObjectCount(current), remoteObjectCount(next),
  ])
  return {
    current,
    next,
    pendingLocalChanges: changes?.total ?? 0,
    pendingCommands: commands?.total ?? 0,
    currentRemoteObjects,
    nextRemoteObjects,
    // A connected remote may contain data even when the local queues are empty.
    // Every cross-engine switch therefore requires an explicit difference review.
    requiresReview: true,
  }
}

export function pauseSyncEngine(platform: SyncPlatform) {
  if (platform === 'selfHosted') getSelfHostedSyncRuntime().stop()
}
