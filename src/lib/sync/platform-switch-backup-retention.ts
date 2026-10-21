import { BaseDirectory, exists, lstat, readDir, readFile, remove } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'

import { assertSwitchBackupPath, readSwitchJournal } from './platform-switch-journal'
import { withPrimaryPlatformLock } from './platform-switch-recovery'

export const DEFAULT_SWITCH_BACKUP_RETENTION = {
  maxCount: 3,
  maxBytes: 512 * 1024 * 1024,
} as const

const BACKUP_ROOT = 'sync-platform-backups'
const options = { baseDir: BaseDirectory.AppData }
const activeBackups = new Map<string, number>()
let retentionLock = Promise.resolve()
let pendingPrune: Promise<void> | null = null

interface BackupDirectory {
  path: string
  timestamp: number
  bytes: number | null
  removable: boolean
}

function withRetentionLock<T>(action: () => Promise<T>): Promise<T> {
  const pending = retentionLock.then(action)
  retentionLock = pending.then(() => undefined, () => undefined)
  return pending
}

function assertRetentionPath(path: string): void {
  assertSwitchBackupPath(path)
  // JavaScript's end anchor also accepts a trailing newline; generated backup
  // paths never contain whitespace, including at their boundary.
  if (path.trim() !== path) throw new Error('Invalid sync recovery backup')
}

/** Acquire before creating or opening a backup; release after its last use. */
export async function acquireActiveSwitchBackup(path: string): Promise<() => Promise<void>> {
  assertRetentionPath(path)
  await withRetentionLock(async () => {
    activeBackups.set(path, (activeBackups.get(path) || 0) + 1)
  })
  let released = false
  return async () => {
    if (released) return
    released = true
    await withRetentionLock(async () => {
      const count = activeBackups.get(path) || 0
      if (count > 1) activeBackups.set(path, count - 1)
      else activeBackups.delete(path)
    })
  }
}

export async function withActiveSwitchBackup<T>(path: string, action: () => Promise<T>): Promise<T> {
  const release = await acquireActiveSwitchBackup(path)
  try {
    return await action()
  } finally {
    await release()
  }
}

function protectRecoveryBackupPaths(recovery: unknown, protectedPaths: Set<string>): void {
  if (recovery === undefined || recovery === null) return
  if (typeof recovery !== 'object' || Array.isArray(recovery)) throw new Error('Invalid sync recovery marker')
  const value = recovery as Record<string, unknown>
  if (value.backupPath !== undefined && typeof value.backupPath !== 'string') throw new Error('Invalid sync recovery backup path')
  if (value.backupPaths !== undefined && (!Array.isArray(value.backupPaths) || value.backupPaths.some(path => typeof path !== 'string'))) {
    throw new Error('Invalid sync recovery backup paths')
  }
  const paths = [
    ...(typeof value.backupPath === 'string' ? [value.backupPath] : []),
    ...(Array.isArray(value.backupPaths) ? value.backupPaths as string[] : []),
  ]
  for (const path of paths) {
    assertRetentionPath(path)
    protectedPaths.add(path)
  }
}

async function protectedBackupPaths(): Promise<Set<string>> {
  const protectedPaths = new Set(activeBackups.keys())
  // Store.load() can silently initialize an empty cache after a disk read or
  // JSON parse failure. Validate the durable marker independently before any
  // deletion, and protect both versions while a save is still in progress.
  const info = await lstat('store.json', options)
  if (info.isSymlink || !info.isFile) throw new Error('Sync settings are not a regular file')
  const disk: unknown = JSON.parse(new TextDecoder().decode(await readFile('store.json', options)))
  if (!disk || typeof disk !== 'object' || Array.isArray(disk)) throw new Error('Invalid sync settings file')
  protectRecoveryBackupPaths((disk as Record<string, unknown>).platformSwitchRecovery, protectedPaths)
  const store = await Store.load('store.json')
  protectRecoveryBackupPaths(await store.get<unknown>('platformSwitchRecovery'), protectedPaths)
  return protectedPaths
}

async function assertBackupRoot(): Promise<void> {
  const info = await lstat(BACKUP_ROOT, options)
  if (info.isSymlink || !info.isDirectory) throw new Error('Sync backup root is not a regular directory')
}

function assertEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new Error('Invalid sync backup entry')
}

/** Never follows links or paths taken from a manifest's workspace/file entries. */
async function directoryBytes(path: string): Promise<number> {
  const info = await lstat(path, options)
  if (info.isSymlink) throw new Error('Sync backup contains a symbolic link')
  if (info.isFile) {
    if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('Invalid sync backup file size')
    return info.size
  }
  if (!info.isDirectory) throw new Error('Sync backup contains an unsupported file type')
  let bytes = 0
  for (const entry of await readDir(path, options)) {
    assertEntryName(entry.name)
    if (entry.isSymlink) throw new Error('Sync backup contains a symbolic link')
    bytes += await directoryBytes(`${path}/${entry.name}`)
    if (!Number.isSafeInteger(bytes)) throw new Error('Invalid sync backup directory size')
  }
  return bytes
}

async function hasValidManifest(path: string): Promise<boolean> {
  // Reject a manifest link as well as links seen in the size inspection.
  const info = await lstat(`${path}/manifest.json`, options)
  if (info.isSymlink || !info.isFile) return false
  const manifest: unknown = JSON.parse(new TextDecoder().decode(await readFile(`${path}/manifest.json`, options)))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const value = manifest as Record<string, unknown>
  return value.version === 1 && value.backupPath === path
}

async function recoveryStillPending(path: string): Promise<boolean> {
  const info = await lstat(`${path}/journal.json`, options)
  if (info.isSymlink || !info.isFile) throw new Error('Sync backup journal is not a regular file')
  const journal = await readSwitchJournal(path)
  if (journal.recoveryPending !== undefined) return journal.recoveryPending
  // Legacy journals cannot prove that the final primary-platform commit
  // completed: verified/restored only describe the data phase. Keep any
  // journal with mutations until the owning recovery chain is settled.
  return journal.operations.length > 0 || journal.status === 'restoring'
}

function oldestFirst(left: BackupDirectory, right: BackupDirectory): number {
  return left.timestamp - right.timestamp || left.path.localeCompare(right.path)
}

function removals(backups: BackupDirectory[], protectedPaths: Set<string>): Set<string> {
  const history = backups.filter(backup => backup.removable && !protectedPaths.has(backup.path))
    .sort((left, right) => oldestFirst(right, left))
  const removed = new Set(history.slice(DEFAULT_SWITCH_BACKUP_RETENTION.maxCount).map(backup => backup.path))
  // Unknown sizes are retained conservatively. Enforce the count limit, but
  // do not guess how much additional history must go to meet a byte limit.
  if (backups.some(backup => backup.bytes === null)) return removed
  let bytes = backups.reduce((total, backup) => total + (removed.has(backup.path) ? 0 : backup.bytes || 0), 0)
  for (const backup of history.slice(0, DEFAULT_SWITCH_BACKUP_RETENTION.maxCount).reverse()) {
    if (bytes <= DEFAULT_SWITCH_BACKUP_RETENTION.maxBytes) break
    removed.add(backup.path)
    bytes -= backup.bytes || 0
  }
  return removed
}

async function pruneBackups(): Promise<void> {
  // An unreadable recovery marker must never be treated as an empty marker.
  await protectedBackupPaths()
  if (!await exists(BACKUP_ROOT, options)) return
  await assertBackupRoot()
  const backups: BackupDirectory[] = []
  for (const entry of await readDir(BACKUP_ROOT, options)) {
    const path = `${BACKUP_ROOT}/${entry.name}`
    try {
      assertRetentionPath(path)
    } catch {
      continue
    }
    // Only directories matching our own generated backup path may be pruned.
    const info = await lstat(path, options)
    if (info.isSymlink || !info.isDirectory || entry.isSymlink) continue
    const timestamp = Number(entry.name.slice(0, entry.name.indexOf('-')))
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) continue
    const backup: BackupDirectory = { path, timestamp, bytes: null, removable: false }
    backups.push(backup)
    try {
      backup.bytes = await directoryBytes(path)
      if (await hasValidManifest(path)) backup.removable = !await recoveryStillPending(path)
      else console.warn('Keeping sync backup with an invalid manifest', path)
    } catch (error) {
      console.warn('Keeping sync backup that could not be safely inspected', path, error)
    }
  }

  for (const backup of [...backups].sort(oldestFirst)) {
    // Lock order is retention -> primary. Callers must acquire/release a lease
    // outside withPrimaryPlatformLock so final commits cannot invert the order.
    await withPrimaryPlatformLock(async () => {
      let protectedPaths = await protectedBackupPaths()
      if (!removals(backups, protectedPaths).has(backup.path)) return
      try {
        await assertBackupRoot()
        assertRetentionPath(backup.path)
        const info = await lstat(backup.path, options)
        if (info.isSymlink || !info.isDirectory) throw new Error('Sync backup is no longer a regular directory')
        backup.bytes = await directoryBytes(backup.path)
        if (!await hasValidManifest(backup.path)) throw new Error('Sync backup manifest changed')
        if (await recoveryStillPending(backup.path)) throw new Error('Sync backup recovery is still pending')
      } catch (error) {
        backup.removable = false
        console.warn('Keeping sync backup that changed during cleanup', backup.path, error)
        return
      }
      // Re-read after filesystem inspection; no new lease can register until
      // this serialized cleanup finishes, and final commits share this lock.
      protectedPaths = await protectedBackupPaths()
      if (!removals(backups, protectedPaths).has(backup.path)) return
      try {
        await remove(backup.path, { ...options, recursive: true })
        backups.splice(backups.indexOf(backup), 1)
      } catch (error) {
        backup.removable = false
        console.warn('Failed to remove historical sync backup', backup.path, error)
      }
    })
  }
}

/** Shared across workspaces; cleanup errors never abort switching or syncing. */
export function prunePlatformSwitchBackups(): Promise<void> {
  if (pendingPrune) return pendingPrune
  const pending = withRetentionLock(pruneBackups).catch(error => {
    console.warn('Failed to prune historical sync backups', error)
  })
  pendingPrune = pending
  void pending.finally(() => {
    if (pendingPrune === pending) pendingPrune = null
  })
  return pending
}
