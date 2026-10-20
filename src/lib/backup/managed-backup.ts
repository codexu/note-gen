import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'

export type ManagedBackupSchedule = 'disabled' | 'daily' | 'weekly'

export interface ManagedBackupSettings {
  directory: string
  schedule: ManagedBackupSchedule
  retention: number
  lastSuccessAt: number | null
  lastError: string | null
}

export interface ManagedBackupInfo {
  path: string
  name: string
  createdAt: number
  size: number
  appVersion: string
  reason: string
  workspaceIncluded: boolean
  valid: boolean
  error: string | null
}

export interface ManagedBackupRestoreResult {
  recoveredWorkspacePath: string | null
}

const SETTINGS_CHANGED_EVENT = 'notegen-managed-backup-settings-changed'
const RUNTIME_CHECK_INTERVAL = 30 * 60 * 1000
const INITIAL_CHECK_DELAY = 10 * 1000
const DEFAULT_RETENTION = 10

let runtimeTimer: ReturnType<typeof setTimeout> | null = null
let runtimeInterval: ReturnType<typeof setInterval> | null = null
let runtimeListener: (() => void) | null = null
let backupInProgress = false

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRetention(value: unknown): number {
  const retention = typeof value === 'number' ? Math.round(value) : DEFAULT_RETENTION
  return Math.min(100, Math.max(1, retention))
}

export async function loadManagedBackupSettings(): Promise<ManagedBackupSettings> {
  const store = await Store.load('store.json')
  return {
    directory: (await store.get<string>('managedBackupDirectory')) ?? '',
    schedule: (await store.get<ManagedBackupSchedule>('managedBackupSchedule')) ?? 'disabled',
    retention: normalizeRetention(await store.get<number>('managedBackupRetention')),
    lastSuccessAt: (await store.get<number>('managedBackupLastSuccessAt')) ?? null,
    lastError: (await store.get<string>('managedBackupLastError')) ?? null,
  }
}

export async function saveManagedBackupSettings(
  settings: Pick<ManagedBackupSettings, 'directory' | 'schedule' | 'retention'>,
): Promise<void> {
  const store = await Store.load('store.json')
  await store.set('managedBackupDirectory', settings.directory)
  await store.set('managedBackupSchedule', settings.schedule)
  await store.set('managedBackupRetention', normalizeRetention(settings.retention))
  if (!settings.directory) {
    await store.set('managedBackupLastSuccessAt', null)
    await store.set('managedBackupLastError', null)
  }
  await store.save()
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
}

async function updateBackupResult(successAt: number | null, error: string | null): Promise<void> {
  const store = await Store.load('store.json')
  if (successAt !== null) {
    await store.set('managedBackupLastSuccessAt', successAt)
  }
  await store.set('managedBackupLastError', error)
  await store.save()
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
}

export async function createManagedBackup(
  reason: 'manual' | 'scheduled' | 'pre-restore',
  settings?: ManagedBackupSettings,
): Promise<ManagedBackupInfo> {
  if (backupInProgress) {
    throw new Error('A backup is already in progress')
  }

  const current = settings ?? await loadManagedBackupSettings()
  if (!current.directory) {
    throw new Error('Backup directory is not configured')
  }

  backupInProgress = true
  try {
    const store = await Store.load('store.json')
    const workspacePath = (await store.get<string>('workspacePath')) ?? ''
    const backup = await invoke<ManagedBackupInfo>('create_managed_backup', {
      backupDir: current.directory,
      workspacePath,
      retention: current.retention,
      reason,
    })
    await updateBackupResult(backup.createdAt, null)
    return backup
  } catch (error) {
    await updateBackupResult(null, normalizeError(error))
    throw error
  } finally {
    backupInProgress = false
  }
}

export async function listManagedBackups(directory: string): Promise<ManagedBackupInfo[]> {
  if (!directory) return []
  return invoke<ManagedBackupInfo[]>('list_managed_backups', { backupDir: directory })
}

export async function restoreManagedBackup(
  backupPath: string,
  currentWorkspacePath: string,
): Promise<ManagedBackupRestoreResult> {
  return invoke<ManagedBackupRestoreResult>('restore_managed_backup', {
    backupPath,
    currentWorkspacePath,
  })
}

function scheduleInterval(schedule: ManagedBackupSchedule): number | null {
  if (schedule === 'daily') return 24 * 60 * 60 * 1000
  if (schedule === 'weekly') return 7 * 24 * 60 * 60 * 1000
  return null
}

async function runScheduledBackupIfDue(): Promise<void> {
  const settings = await loadManagedBackupSettings()
  const interval = scheduleInterval(settings.schedule)
  if (!settings.directory || interval === null || backupInProgress) return

  if (settings.lastSuccessAt === null || Date.now() - settings.lastSuccessAt >= interval) {
    try {
      await createManagedBackup('scheduled', settings)
    } catch (error) {
      console.error('Scheduled backup failed:', error)
    }
  }
}

function restartManagedBackupRuntime(): void {
  if (runtimeTimer !== null) clearTimeout(runtimeTimer)
  if (runtimeInterval !== null) clearInterval(runtimeInterval)

  runtimeTimer = setTimeout(() => {
    void runScheduledBackupIfDue()
  }, INITIAL_CHECK_DELAY)
  runtimeInterval = setInterval(() => {
    void runScheduledBackupIfDue()
  }, RUNTIME_CHECK_INTERVAL)
}

export function initManagedBackupRuntime(): () => void {
  stopManagedBackupRuntime()
  runtimeListener = restartManagedBackupRuntime
  window.addEventListener(SETTINGS_CHANGED_EVENT, runtimeListener)
  restartManagedBackupRuntime()
  return stopManagedBackupRuntime
}

export function stopManagedBackupRuntime(): void {
  if (runtimeTimer !== null) clearTimeout(runtimeTimer)
  if (runtimeInterval !== null) clearInterval(runtimeInterval)
  if (runtimeListener !== null) {
    window.removeEventListener(SETTINGS_CHANGED_EVENT, runtimeListener)
  }
  runtimeTimer = null
  runtimeInterval = null
  runtimeListener = null
}
