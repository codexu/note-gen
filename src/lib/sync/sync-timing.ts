import { Store } from '@tauri-apps/plugin-store'

export type SyncTimingDetails = Record<string, unknown>

export interface SyncTimingEntry extends SyncTimingDetails {
  category: string
  operation: string
  elapsedMs: number
  timestamp: number
}

const MAX_SYNC_TIMING_ENTRIES = 1_000
let timingWriteQueue: Promise<void> = Promise.resolve()

async function persistSyncTiming(entry: SyncTimingEntry): Promise<void> {
  const store = await Store.load('sync_timing_logs.json')
  const entries = await store.get<SyncTimingEntry[]>('entries') || []
  entries.push(entry)
  await store.set('entries', entries.slice(-MAX_SYNC_TIMING_ENTRIES))
  await store.save()
}

export function recordSyncTiming(
  operation: string,
  startedAt: number,
  details: SyncTimingDetails = {},
  category = 'SyncTiming',
): void {
  const entry: SyncTimingEntry = {
    category,
    operation,
    elapsedMs: Date.now() - startedAt,
    timestamp: Date.now(),
    ...details,
  }
  console.info(`[${category}]`, JSON.stringify(entry))
  timingWriteQueue = timingWriteQueue
    .then(() => persistSyncTiming(entry))
    .catch(error => console.warn('Failed to persist sync timing:', error))
}
