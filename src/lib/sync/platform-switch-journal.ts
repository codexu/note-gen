import { BaseDirectory, readFile, rename, writeFile } from '@tauri-apps/plugin-fs'

export interface SwitchJournalOperation {
  id: number
  side: 'local' | 'remote'
  action: 'write' | 'delete' | 'module'
  path: string
  scope?: 'workspace' | 'data'
  before?: string
  after?: string
  completed: boolean
}
export interface SwitchJournalData {
  version: 1
  workspace: string
  operations: SwitchJournalOperation[]
  status: 'applying' | 'verified' | 'restoring' | 'restored'
  recoveryPending?: boolean
}
export function assertSwitchBackupPath(path: string) {
  if (!/^sync-platform-backups\/\d+-[a-f0-9-]+$/.test(path)) throw new Error('Invalid sync recovery backup')
}
export async function readSwitchJournal(path: string): Promise<SwitchJournalData> {
  assertSwitchBackupPath(path)
  const raw: unknown = JSON.parse(new TextDecoder().decode(await readFile(`${path}/journal.json`, { baseDir: BaseDirectory.AppData })))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid sync recovery journal')
  const value = raw as SwitchJournalData
  if (value.version !== 1 || !['applying', 'verified', 'restoring', 'restored'].includes(value.status) || typeof value.workspace !== 'string' || !Array.isArray(value.operations)
    || (value.recoveryPending !== undefined && typeof value.recoveryPending !== 'boolean')
    || value.operations.some((op, i) => !op || typeof op !== 'object' || Array.isArray(op) || op.id !== i || !['local', 'remote'].includes(op.side)
      || !['write', 'delete', 'module'].includes(op.action) || typeof op.path !== 'string' || typeof op.completed !== 'boolean'
      || (op.scope !== undefined && !['workspace', 'data'].includes(op.scope))
      || (op.before !== undefined && typeof op.before !== 'string') || (op.after !== undefined && typeof op.after !== 'string'))) {
    throw new Error('Invalid sync recovery journal')
  }
  return value
}
async function saveSwitchJournal(path: string, data: SwitchJournalData): Promise<void> {
  assertSwitchBackupPath(path)
  const options = { baseDir: BaseDirectory.AppData }
  await writeFile(`${path}/journal.tmp`, new TextEncoder().encode(JSON.stringify(data)), options)
  await rename(`${path}/journal.tmp`, `${path}/journal.json`, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData })
}

/** Settle only after the primary-platform commit, or a proven mutation-free cancellation. */
export async function settleSwitchBackupRecovery(path: string, requireNoOperations = false): Promise<boolean> {
  const data = await readSwitchJournal(path)
  if (requireNoOperations && (data.operations.length || data.status === 'restoring')) return false
  if (data.recoveryPending === false) return true
  await saveSwitchJournal(path, { ...data, recoveryPending: false })
  return true
}

export async function openSwitchJournal(path: string, workspace: string, existing?: SwitchJournalData) {
  assertSwitchBackupPath(path)
  const data: SwitchJournalData = existing || { version: 1, workspace, operations: [], status: 'applying', recoveryPending: true }
  const save = () => saveSwitchJournal(path, data)
  if (!existing) await save()
  return {
    data,
    async run<T>(operation: Omit<SwitchJournalOperation, 'id' | 'completed'>, task: () => Promise<T>): Promise<T> {
      data.recoveryPending = true
      const entry = { ...operation, id: data.operations.length, completed: false }
      data.operations.push(entry)
      await save() // Write-ahead: a crash after mutation leaves a recoverable pending entry.
      const result = await task()
      entry.completed = true
      await save()
      return result
    },
    async status(status: SwitchJournalData['status']) {
      data.status = status
      if (status === 'applying' || status === 'restoring') data.recoveryPending = true
      await save()
    },
  }
}
