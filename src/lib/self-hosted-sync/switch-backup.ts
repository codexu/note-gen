import { invoke } from '@tauri-apps/api/core'
import { ensureWorkspaceDirectory } from '@/lib/managed-workspace'
import { appDataDir, dirname, join } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import type { SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import { bytesToBase64Url, hashBytes } from './blob'
import { isManagedPersonalAssetPath, readPersonalAsset } from './personal-assets'

type Scalar = string | number | boolean | null
type Row = Record<string, Scalar>
interface Library { workspaceId: string | null; localRoot: string }
interface BackupManifest {
  version: 2
  profileId: string
  serverUrl: string
  fingerprint: string
  libraries: Library[]
  files: Array<{ library: number; path: string; hash: string }>
  directories: Array<{ library: number; path: string }>
  personalHash: string
  personalAssets?: Array<{ path: string; hash: string }>
  excludeSensitiveConfig?: boolean
}
interface PersonalSnapshot { tables: Record<string, Row[]>; settings: Record<string, unknown> }

// Keep the allowlist independent from remote payloads. Local recovery preserves
// full rows, including device-local IDs and the mappings which own those IDs.
const tables = [
  'tags', 'self_hosted_tag_identities', 'notes', 'marks', 'conversations', 'chats', 'memories', 'canvases',
  'record_tag_metadata', 'conversation_compactions', 'conversation_sync_tombstones',
  'memory_jobs', 'memory_global_policy',
  'self_hosted_workspace_bindings', 'self_hosted_workspace_keys', 'self_hosted_object_mappings', 'self_hosted_revisions',
  'self_hosted_remote_objects', 'self_hosted_yjs_updates', 'self_hosted_outbox',
  'self_hosted_inbox', 'self_hosted_local_changes', 'self_hosted_conflicts', 'self_hosted_cursors',
] as const
const options = { baseDir: BaseDirectory.AppData }
const encoder = new TextEncoder()
const excluded = (name: string) => name === '.notegen' || name === '.DS_Store' || name.endsWith('.tmp')
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

async function localPersonalAssets(assertActive: () => void) {
  const assets: Array<{ path: string; hash: string }> = []
  async function scan(path: string) {
    if (!await exists(path, options)) return
    for (const entry of await readDir(path, options)) {
      assertActive()
      if (entry.isSymlink || excluded(entry.name)) continue
      const relative = `${path}/${entry.name}`
      if (entry.isDirectory) await scan(relative)
      else if (entry.isFile) {
        if (!isManagedPersonalAssetPath(relative)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
        const bytes = await readPersonalAsset(relative)
        if (!bytes) throw new Error('SELF_HOSTED_BACKUP_INVALID')
        assets.push({ path: relative, hash: await hashBytes(bytes) })
      }
    }
  }
  for (const root of ['image', 'screenshot', 'recordings', 'link-assets', 'conversation-assets']) await scan(root)
  return assets
}

function assertBackupPath(path: string) {
  if (!/^self-hosted-switch-backups\/\d+-[a-f0-9-]+$/.test(path)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
}
async function portable(path: string) {
  return (await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: path })).normalized
}

export async function captureSelfHostedSwitchBackup(input: {
  profileId: string; serverUrl: string; fingerprint: string; libraries: Library[]
  assertActive: () => void; onProgress: (progress: SwitchOperationProgress) => void
  validate?: () => Promise<void>
  personalAssets?: Array<{ path: string; hash: string }>
}) {
  const path = `self-hosted-switch-backups/${Date.now()}-${crypto.randomUUID()}`
  const absolute = (await join(await appDataDir(), path)).replaceAll('\\', '/').toLowerCase()
  for (const library of input.libraries) {
    const root = library.localRoot.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
    if (absolute === root || absolute.startsWith(`${root}/`)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  await mkdir(`${path}/files`, { ...options, recursive: true })
  const files: BackupManifest['files'] = []
  const directories: BackupManifest['directories'] = []
  async function copy(root: string, library: number, prefix = '') {
    if (!prefix) await ensureWorkspaceDirectory(root)
    for (const entry of await readDir(root)) {
      input.assertActive()
      if (entry.isSymlink || excluded(entry.name)) continue
      const relative = await portable(prefix ? `${prefix}/${entry.name}` : entry.name)
      const source = await join(root, entry.name)
      const destination = `${path}/files/${library}/${relative}`
      if (entry.isDirectory) {
        directories.push({ library, path: relative })
        await mkdir(destination, { ...options, recursive: true })
        await copy(source, library, relative)
      } else if (entry.isFile) {
        const bytes = await readFile(source)
        await writeFile(destination, bytes, options)
        const hash = await hashBytes(bytes)
        if (await hashBytes(await readFile(destination, options)) !== hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
        files.push({ library, path: relative, hash })
        input.onProgress({ phase: 'backup', source: 'local', kind: 'file', path: relative, current: files.length, total: 0 })
      }
    }
  }
  for (const [index, library] of input.libraries.entries()) {
    await mkdir(`${path}/files/${index}`, { ...options, recursive: true })
    await copy(library.localRoot, index)
  }
  const database = await getDb()
  const existing = new Set((await database.select<Array<{ name: string }>>('select name from sqlite_master where type = \'table\''))
    .map(table => table.name))
  const personal: PersonalSnapshot = { tables: {}, settings: {} }
  for (const table of tables) {
    input.assertActive()
    if (existing.has(table)) personal.tables[table] = await database.select<Row[]>(`select * from ${table}`)
  }
  const settingsStore = await Store.load('store.json')
  const excludeSensitiveConfig = await settingsStore.get<boolean>('excludeSensitiveConfig') !== false
  for (const [key, value] of await settingsStore.entries()) {
    if (!shouldExcludeFromSync(key, { excludeSensitiveConfig })) personal.settings[key] = value
  }
  const bytes = encoder.encode(JSON.stringify(personal))
  await writeFile(`${path}/personal-data.json`, bytes, options)
  const personalHash = await hashBytes(bytes)
  if (await hashBytes(await readFile(`${path}/personal-data.json`, options)) !== personalHash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  const personalAssets = await localPersonalAssets(input.assertActive)
  if (input.personalAssets?.some(expected => !personalAssets.some(asset => asset.path === expected.path && asset.hash === expected.hash))) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  for (const asset of personalAssets) {
    input.assertActive()
    const contents = await readPersonalAsset(asset.path)
    if (!contents || await hashBytes(contents) !== asset.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    const destination = `${path}/personal-assets/${asset.path}`
    await mkdir(destination.slice(0, destination.lastIndexOf('/')), { ...options, recursive: true })
    await writeFile(destination, contents, options)
    if (await hashBytes(await readFile(destination, options)) !== asset.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  await input.validate?.()
  const manifest: BackupManifest = { version: 2, profileId: input.profileId, serverUrl: input.serverUrl,
    fingerprint: input.fingerprint, libraries: input.libraries, files, directories, personalHash,
    personalAssets, excludeSensitiveConfig }
  input.assertActive()
  await writeFile(`${path}/manifest.json`, encoder.encode(JSON.stringify(manifest)), options)
  await invoke('self_hosted_flush_switch_data', { relativePath: path })
  input.assertActive()
  return path
}

/** Validate every artifact before restoring any personal row. Files are restored
 * into fresh directories, so the workspace present at failure is kept intact. */
export async function readSelfHostedSwitchBackup(path: string) {
  assertBackupPath(path)
  const value: unknown = JSON.parse(new TextDecoder().decode(await readFile(`${path}/manifest.json`, options)))
  if (record(value) && value.version === 1) throw new Error('SELF_HOSTED_BACKUP_LEGACY')
  if (!record(value) || value.version !== 2 || typeof value.profileId !== 'string'
    || typeof value.serverUrl !== 'string' || typeof value.personalHash !== 'string'
    || !Array.isArray(value.libraries) || value.libraries.length === 0 || !Array.isArray(value.files)
    || !Array.isArray(value.directories)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  const manifest = value as unknown as BackupManifest
  if (manifest.excludeSensitiveConfig !== undefined && typeof manifest.excludeSensitiveConfig !== 'boolean') throw new Error('SELF_HOSTED_BACKUP_INVALID')
  for (const library of manifest.libraries) {
    if (!record(library) || typeof library.localRoot !== 'string'
      || (library.workspaceId !== null && typeof library.workspaceId !== 'string')) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  const identities = new Set<string>()
  for (const directory of manifest.directories) {
    if (!record(directory) || !Number.isInteger(directory.library) || directory.library < 0 || directory.library >= manifest.libraries.length
      || typeof directory.path !== 'string' || await portable(directory.path) !== directory.path) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  for (const file of manifest.files) {
    if (!record(file) || !Number.isInteger(file.library) || file.library < 0 || file.library >= manifest.libraries.length
      || typeof file.path !== 'string' || typeof file.hash !== 'string'
      || await portable(file.path) !== file.path) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    const identity = `${file.library}:${file.path.normalize('NFC').toLowerCase()}`
    if (identities.has(identity)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    identities.add(identity)
    if (await hashBytes(await readFile(`${path}/files/${file.library}/${file.path}`, options)) !== file.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  const bytes = await readFile(`${path}/personal-data.json`, options)
  if (await hashBytes(bytes) !== manifest.personalHash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  const personal: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!record(personal) || !record(personal.tables) || !record(personal.settings)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  if (personal.tables.self_hosted_workspace_bindings && !Array.isArray(personal.tables.self_hosted_workspace_keys)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  if (manifest.personalAssets !== undefined && !Array.isArray(manifest.personalAssets)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  const assetPaths = new Set<string>()
  for (const asset of manifest.personalAssets ?? []) {
    if (!record(asset) || typeof asset.path !== 'string' || !isManagedPersonalAssetPath(asset.path)
      || assetPaths.has(asset.path) || typeof asset.hash !== 'string') throw new Error('SELF_HOSTED_BACKUP_INVALID')
    assetPaths.add(asset.path)
    if (await hashBytes(await readFile(`${path}/personal-assets/${asset.path}`, options)) !== asset.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  for (const table of Object.keys(personal.tables)) {
    const rows = personal.tables[table]
    if (!tables.includes(table as typeof tables[number]) || !Array.isArray(rows)
      || rows.some(row => !record(row) || Object.values(row).some(value => value !== null
        && typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))))) throw new Error('SELF_HOSTED_BACKUP_INVALID')
  }
  return { manifest, personal: personal as unknown as PersonalSnapshot }
}

function assertUnchangedTable(table: typeof tables[number], columns: string[], rows: Row[]): RecordStatement {
  if (rows.some(row => Object.keys(row).length !== columns.length || columns.some(column => !Object.hasOwn(row, column)))) {
    throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
  }
  const actual = columns.map(column => `"${column}"`).join(', ')
  const expected = columns.map(column => `json_extract(snapshot.value, '$."${column}"')`).join(', ')
  // Compare multisets, including duplicate counts, rather than relying on row
  // order or on a particular table having a primary key. This noop UPDATE is
  // the transaction's first write and acquires the same write lock as DELETE.
  return {
    sql: `update self_hosted_sync_context set suppress_triggers = suppress_triggers
      where id = 1 and (select count(*) from ${table}) = $1
        and not exists (
          select ${actual}, count(*) from ${table} group by ${actual}
          except
          select ${expected}, count(*) from json_each($2) snapshot group by ${expected}
        ) and not exists (
          select ${expected}, count(*) from json_each($2) snapshot group by ${expected}
          except
          select ${actual}, count(*) from ${table} group by ${actual}
        )`,
    values: [rows.length, JSON.stringify(rows)], expectedRows: 1,
  }
}

export async function restoreSelfHostedSwitchBackup(
  path: string, safetyPath: string, assertActive: () => void, onProgress: (progress: SwitchOperationProgress) => void,
) {
  const { manifest, personal } = await readSelfHostedSwitchBackup(path)
  const { personal: currentSnapshot } = await readSelfHostedSwitchBackup(safetyPath)
  const restoredRelative = `restored-workspaces/self-hosted-${Date.now()}-${crypto.randomUUID()}`
  const restoredRoot = await join(await appDataDir(), restoredRelative)
  const roots = await Promise.all(manifest.libraries.map((_, index) => join(restoredRoot, String(index))))
  const database = await getDb()
  const statements: RecordStatement[] = []
  const deletions: RecordStatement[] = []
  // Inspect all columns before any restore. Never turn a backup identifier into SQL.
  for (const table of [...tables].reverse()) {
    const rows = personal.tables[table]
    if (!rows) continue
    const columnNames = (await database.select<Array<{ name: string }>>(`pragma table_info(${table})`)).map(column => column.name)
    const columns = new Set(columnNames)
    if (!columns.size || columnNames.some(column => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column))) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    const expected = currentSnapshot.tables[table]
    if (!expected) throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
    statements.push(assertUnchangedTable(table, columnNames, expected))
    deletions.push({ sql: `delete from ${table}`, values: [] })
    for (const row of rows) {
      const keys = Object.keys(row)
      if (!keys.length || keys.some(key => !columns.has(key) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    }
  }
  // Validate every replacement against the durable current safety snapshot
  // before the first DELETE, on the same native transaction/connection. A
  // background write after capture must roll back the entire replacement.
  statements.push({ sql: 'update self_hosted_sync_context set suppress_triggers = suppress_triggers + 1 where id = 1', values: [] }, ...deletions)
  for (const table of tables) {
    // Restoring tags fires their identity trigger. Replace those generated IDs
    // with the original identities before restoring dependent records.
    if (table === 'self_hosted_tag_identities' && personal.tables[table]) statements.push({ sql: `delete from ${table}`, values: [] })
    for (const row of personal.tables[table] ?? []) {
      const libraryIndex = table === 'self_hosted_workspace_bindings'
        ? manifest.libraries.findIndex(library => library.workspaceId !== null && library.workspaceId === row.workspace_id) : -1
      const restoredRow: Row = libraryIndex >= 0 ? { ...row, local_root: roots[libraryIndex] } : row
      const keys = Object.keys(restoredRow)
      statements.push({ sql: `insert into ${table} (${keys.map(key => `"${key}"`).join(',')}) values (${keys.map((_, index) => `$${index + 1}`).join(',')})`, values: keys.map(key => restoredRow[key]) })
    }
  }
  statements.push({ sql: 'update self_hosted_sync_context set suppress_triggers = max(0, suppress_triggers - 1) where id = 1', values: [] })
  for (const root of roots) await mkdir(root, { recursive: true })
  for (const directory of manifest.directories) await mkdir(await join(roots[directory.library], directory.path), { recursive: true })
  for (const [index, file] of manifest.files.entries()) {
    assertActive()
    const destination = await join(roots[file.library], file.path)
    const parent = file.path.includes('/') ? await join(roots[file.library], file.path.slice(0, file.path.lastIndexOf('/'))) : roots[file.library]
    await mkdir(parent, { recursive: true })
    const bytes = await readFile(`${path}/files/${file.library}/${file.path}`, options)
    if (await hashBytes(bytes) !== file.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    await writeFile(destination, bytes)
    if (await hashBytes(await readFile(destination)) !== file.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    onProgress({ phase: 'apply', source: 'local', kind: 'file', path: file.path, current: index + 1, total: manifest.files.length })
  }
  for (const asset of manifest.personalAssets ?? []) {
    assertActive()
    const bytes = await readFile(`${path}/personal-assets/${asset.path}`, options)
    if (await hashBytes(bytes) !== asset.hash) throw new Error('SELF_HOSTED_BACKUP_INVALID')
    const current = await readPersonalAsset(asset.path)
    if (current && await hashBytes(current) !== asset.hash) {
      const retained = await join(restoredRoot, 'current-personal-assets', asset.path)
      await mkdir(await dirname(retained), { recursive: true })
      await writeFile(retained, current)
    }
    await invoke('self_hosted_atomic_write', { workspaceId: manifest.libraries[0].workspaceId ?? manifest.profileId,
      workspaceRoot: await appDataDir(), relativePath: asset.path, contents: bytesToBase64Url(bytes), expectedHash: asset.hash })
  }
  assertActive()
  await invoke('self_hosted_flush_switch_data', { relativePath: restoredRelative })
  assertActive()
  try {
    await executeRecordTransaction(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The native scalar transaction API uses one shared expectedRows error.
    // Only the snapshot assertions above set expectedRows in this transaction.
    if (message.includes('Record tags changed. Reopen the tag editor and try again.')) throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
    throw error
  }
  const store = await Store.load('store.json')
  const excludeSensitiveConfig = manifest.excludeSensitiveConfig !== false
    || (await store.get<boolean>('excludeSensitiveConfig')) !== false
  for (const [key] of await store.entries()) {
    if (!shouldExcludeFromSync(key, { excludeSensitiveConfig }) && !(key in personal.settings)) await store.delete(key)
  }
  for (const [key, value] of Object.entries(personal.settings)) {
    if (!shouldExcludeFromSync(key, { excludeSensitiveConfig })) await store.set(key, value)
  }
  await store.set('selfHostedConnectionReviewProfileId', manifest.profileId)
  await store.save()
  return { root: roots[0], roots }
}
