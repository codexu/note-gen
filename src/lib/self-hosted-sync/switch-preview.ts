import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { getDb } from '@/db'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { stableSyncValue, type SwitchModule, type SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import { authenticatedClient, secureGet } from './profile'
import { SelfHostedApiError } from './client'
import { decryptPackedJson, objectAssociatedData } from './crypto'
import { hashBytes } from './blob'
import { resolveStructuredObjectId, STRUCTURED_DOMAINS, structuredPayload } from './outbox'
import type { WorkspaceSummary } from './protocol'

type Difference = 'same' | 'localOnly' | 'remoteOnly' | 'changed' | 'deleted'
export interface SelfHostedPreviewModule {
  id: SwitchModule
  local: number
  remote: number
  same: number
  localOnly: number
  remoteOnly: number
  changed: number
  deleted: number
}
export interface SelfHostedSwitchPreview {
  profileId: string
  serverUrl: string
  libraries: Array<{ workspaceId: string | null; localRoot: string }>
  modules: SelfHostedPreviewModule[]
  details: Array<{ module: SwitchModule; label: string; difference: Exclude<Difference, 'same'> }>
  differenceCount: number
  settingsPaused: boolean
  fingerprint: string
}
interface Entry {
  id: string
  module: SwitchModule
  label: string
  hash: string
  deleted?: boolean
}
const domainModules: Record<string, SwitchModule> = {
  file: 'notes', asset: 'assets', mark: 'records', tag: 'tags', canvas: 'canvases',
  conversation: 'conversations', message: 'conversations', memory: 'memories', setting: 'settings',
}

// Compare the same payloads used by the outbox, without creating object mappings,
// applying snapshots, or moving sync cursors during inspection.
export async function inspectSelfHostedSwitch(assertActive: () => void = () => {}): Promise<SelfHostedSwitchPreview> {
  const database = await getDb()
  const profiles = await database.select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' order by updated_at desc limit 1",
  )
  if (!profiles[0]) throw new Error('SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED')
  const { profile, client } = await authenticatedClient(profiles[0].id)
  const capabilities = await client.capabilities()
  if (profile.instanceId !== capabilities.instanceId) throw new Error('SELF_HOSTED_PREVIEW_INSTANCE_CHANGED')
  const workspaces = await client.workspaces()
  const location = await getWorkspacePath()
  const defaultRoot = await getDefaultArticleAbsolutePath('')
  const normalize = (path: string) => path.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  const isDefault = !location.isCustom || normalize(location.path) === normalize(defaultRoot) || normalize(location.path) === 'article'
  const root = isDefault ? defaultRoot : location.path
  const bindings = await database.select<Array<{ workspaceId: string; localRoot: string | null }>>(
    `select workspace_id as workspaceId, local_root as localRoot from self_hosted_workspace_bindings
     where profile_id = $1 and workspace_type = 'library'
       and binding_state in ('bound', 'bootstrapping', 'epoch-changed') order by workspace_id`,
    [profile.id],
  )
  let libraryId: string | undefined
  if (isDefault) {
    try { libraryId = (await client.workspaceCreationRequest('notegen.default-library.v1')).id }
    catch (error) {
      if (!(error instanceof SelfHostedApiError && error.status === 404)) throw error
    }
  } else {
    libraryId = bindings.find(binding => binding.localRoot === root)?.workspaceId
    if (!libraryId) {
      const unbound = workspaces.filter(workspace => workspace.type === 'library' && workspace.owner
        && !bindings.some(binding => binding.workspaceId === workspace.id && binding.localRoot))
      if (unbound.length > 1) throw new Error('SELF_HOSTED_PREVIEW_LIBRARY_REQUIRED')
      libraryId = unbound[0]?.id
    }
  }
  const library = workspaces.find(workspace => workspace.id === libraryId)
  if (libraryId && !library) throw new Error('SELF_HOSTED_PREVIEW_LIBRARY_REQUIRED')
  const personal = workspaces.find(workspace => workspace.type === 'account-data' && workspace.owner)
  const libraries: SelfHostedSwitchPreview['libraries'] = [{ workspaceId: libraryId ?? null, localRoot: root }]
  for (const binding of bindings) {
    if (!binding.localRoot || binding.localRoot === root) continue
    if (!workspaces.some(workspace => workspace.id === binding.workspaceId)) throw new Error('SELF_HOSTED_PREVIEW_LIBRARY_REQUIRED')
    libraries.push({ workspaceId: binding.workspaceId, localRoot: binding.localRoot })
  }
  const local: Entry[] = []
  const remote: Entry[] = []
  const sequences: Array<[string, string]> = []
  const fingerprint = async (value: unknown) => hashBytes(new TextEncoder().encode(stableSyncValue(value)))
  const fileId = async (relativePath: string) => {
    const portable = await invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', { relativePath })
    return portable.caseFolded
  }
  async function scan(directory: string, scope: string, prefix = '') {
    if (!prefix && !await exists(directory)) return
    for (const entry of await readDir(directory)) {
      assertActive()
      if (entry.isSymlink || entry.name === '.notegen' || entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = await join(directory, entry.name)
      if (entry.isDirectory) await scan(absolute, scope, path)
      else if (entry.isFile) local.push({
        id: `library:${scope}:${await fileId(path)}`, module: path.toLowerCase().endsWith('.md') ? 'notes' : 'assets',
        label: path, hash: await hashBytes(await readFile(absolute)),
      })
    }
  }
  for (const library of libraries) await scan(library.localRoot, library.workspaceId ?? 'new')
  const personalId = personal?.id ?? '00000000-0000-4000-8000-000000000000'
  const objectId = (domain: string, localKey: string) => resolveStructuredObjectId(personalId, domain, localKey)
  const labelFor = (payload: Record<string, unknown>, fallback: string) => {
    const value = record(payload.value)
    return String(value.title ?? value.name ?? payload.localKey ?? fallback)
  }
  const comparable = (payload: Record<string, unknown>) => {
    const domain = String(payload.domain)
    const value = { ...record(payload.value) }
    const references = record(payload.references)
    // Numeric database IDs and foreign keys are device-local. Object references
    // and sync IDs are the identities actually shared by the protocol.
    if (['tag', 'mark', 'conversation', 'message'].includes(domain)) delete value.id
    if (references.tag) value.tagId = references.tag
    if (references.conversation) value.conversationId = references.conversation
    if (Array.isArray(value.tagIds)) value.tagIds = value.tagIds.map(id => references[`tag:${id}`] ?? id).sort()
    return { domain, value, ...(domain === 'setting' ? { memoryPolicy: payload.memoryPolicy } : {}) }
  }
  for (const [domain, config] of Object.entries(STRUCTURED_DOMAINS)) {
    const rows = await database.select<Array<Record<string, unknown>>>(`select * from ${config.table}`)
    for (const row of rows) {
      assertActive()
      if (domain === 'mark' && row.deleted === 1 || domain === 'canvas' && row.deletedAt != null) continue
      const key = String(row[config.keyColumn] ?? row.id)
      const payload = await structuredPayload(personalId, domain, key, true)
      if (!payload) continue
      local.push({ id: `personal:${await objectId(domain, key)}`, module: domainModules[domain],
        label: labelFor(payload, key), hash: await fingerprint(comparable(payload)) })
    }
  }
  if (profile.domainToggles.settings !== false) {
    const payload = await structuredPayload(personalId, 'setting', 'all', true)
    if (payload) local.push({ id: `personal:${await objectId('setting', 'all')}`, module: 'settings',
      label: 'settings', hash: await fingerprint(comparable(payload)) })
  }
  async function inspectRemote(workspace: WorkspaceSummary) {
    const keys = await client.workspaceKeys(workspace.id)
    const decryptedKeys = new Map<number, string>()
    await client.withBootstrapSnapshot(workspace.id, capabilities.syncEpoch, async readPage => {
      let bootstrapId: string | undefined
      let after: string | undefined
      do {
        assertActive()
        const page = await readPage(bootstrapId, after)
        bootstrapId = page.bootstrapId
        if (!after) sequences.push([workspace.id, page.snapshotSequence])
        for (const object of page.objects) {
          assertActive()
          if (['folder', 'yjs-update', 'yjs-checkpoint'].includes(object.kind)) continue
          if (workspace.type === 'account-data' && object.kind === 'setting' && profile.domainToggles.settings === false) continue
          const managedKey = keys.find(key => key.keyVersion === object.keyVersion)?.envelopes
            .find(envelope => envelope.type === 'managed')?.wrappedKey
          // Managed workspaces use this server's authoritative key. A cached key
          // may belong to an older connection or a restored server snapshot.
          const key = decryptedKeys.get(object.keyVersion) ?? (workspace.encryptionMode === 'managed'
            ? managedKey : await secureGet(`workspace.${workspace.id}.key.${object.keyVersion}`))
          if (!key) throw new Error('SELF_HOSTED_PREVIEW_KEY_REQUIRED')
          decryptedKeys.set(object.keyVersion, key)
          let payload: Record<string, unknown>
          try {
            payload = await decryptPackedJson<Record<string, unknown>>(key, object.ciphertext,
              objectAssociatedData(workspace.id, object.objectId, object.kind))
          } catch (error) {
            console.warn('[self-hosted-sync] Platform switch preview could not decrypt a server object', {
              workspaceId: workspace.id, objectId: object.objectId, kind: object.kind,
              keyVersion: object.keyVersion, encryptionMode: workspace.encryptionMode,
            })
            if (String(error).toLowerCase().includes('decryption failed')) {
              if (object.kind === 'setting') throw new Error('SELF_HOSTED_PREVIEW_SETTING_DECRYPTION_FAILED')
              throw new Error('SELF_HOSTED_PREVIEW_DECRYPTION_FAILED')
            }
            throw error
          }
          const domain = String(payload.domain)
          const moduleId = domainModules[domain]
          if (!moduleId) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
          const isFile = workspace.type === 'library' && (domain === 'file' || domain === 'asset')
          if (workspace.type === 'library' && !isFile) continue
          const path = String(payload.relativePath ?? '')
          const id = isFile ? `library:${workspace.id}:${await fileId(path)}` : `personal:${object.objectId}`
          const hash = isFile
            ? typeof payload.content === 'string' ? await hashBytes(new TextEncoder().encode(payload.content)) : String(payload.plaintextHash ?? '')
            : await fingerprint(comparable(payload))
          if (isFile && !object.deletedAt && !hash) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
          remote.push({ id, module: moduleId, label: isFile ? path : labelFor(payload, object.objectId), hash, deleted: object.deletedAt !== null })
        }
        after = page.nextObjectId ?? undefined
      } while (after)
    })
  }
  for (const source of libraries) {
    const workspace = workspaces.find(workspace => workspace.id === source.workspaceId)
    if (workspace) await inspectRemote(workspace)
  }
  if (personal) await inspectRemote(personal)
  const modules = [...new Set<SwitchModule>(['notes', 'assets', ...local.map(entry => entry.module), ...remote.map(entry => entry.module)])]
    .map(id => ({ id, local: 0, remote: 0, same: 0, localOnly: 0, remoteOnly: 0, changed: 0, deleted: 0 }))
  const details: SelfHostedSwitchPreview['details'] = []
  const localMap = uniqueEntries(local)
  const remoteMap = uniqueEntries(remote)
  let differenceCount = 0
  for (const id of new Set([...localMap.keys(), ...remoteMap.keys()])) {
    const left = localMap.get(id), right = remoteMap.get(id)
    const entry = right ?? left!
    const row = modules.find(row => row.id === entry.module)!
    if (left) row.local++
    if (right && !right.deleted) row.remote++
    // Historical tombstones without a local counterpart have no local impact.
    if (right?.deleted && !left) continue
    const difference: Difference = right?.deleted ? 'deleted' : !left ? 'remoteOnly' : !right ? 'localOnly' : left.hash === right.hash ? 'same' : 'changed'
    row[difference]++
    if (difference !== 'same') {
      differenceCount++
      details.push({ module: entry.module, label: entry.label, difference })
    }
  }
  const priority = { deleted: 0, changed: 1, localOnly: 2, remoteOnly: 3 }
  details.sort((a, b) => priority[a.difference] - priority[b.difference] || a.label.localeCompare(b.label))
  const pendingChanges = await database.select<Array<Record<string, unknown>>>(
    `select c.* from self_hosted_local_changes c
     left join self_hosted_workspace_bindings b on b.workspace_id = c.workspace_id
     where c.state in ('pending', 'queued') and (b.profile_id = $1 or c.workspace_id is null) order by c.id`,
    [profile.id],
  )
  const pendingCommands = await database.select<Array<Record<string, unknown>>>(
    `select o.* from self_hosted_outbox o
     join self_hosted_workspace_bindings b on b.workspace_id = o.workspace_id
     where b.profile_id = $1 and o.state in ('pending', 'retry', 'blocked') order by o.command_id`,
    [profile.id],
  )
  return { profileId: profile.id, serverUrl: profile.serverUrl, libraries, modules, details: details.slice(0, 100), differenceCount, settingsPaused: profile.domainToggles.settings === false,
    fingerprint: await fingerprint({ profileId: profile.id, accountId: profile.accountId, instanceId: capabilities.instanceId,
      epoch: capabilities.syncEpoch, libraries, toggles: profile.domainToggles, sequences, pendingChanges, pendingCommands,
      local: [...localMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
      remote: [...remoteMap.values()].sort((a, b) => a.id.localeCompare(b.id)) }) }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function uniqueEntries(entries: Entry[]) {
  const result = new Map<string, Entry>()
  for (const entry of entries) {
    const previous = result.get(entry.id)
    // A path can have historical tombstones and a newer live object.
    if (previous && entry.deleted) continue
    if (previous && !previous.deleted) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
    result.set(entry.id, entry)
  }
  return result
}

export async function revalidateSelfHostedSwitch(preview: SelfHostedSwitchPreview, assertActive: () => void) {
  const latest = await inspectSelfHostedSwitch(assertActive)
  if (latest.fingerprint !== preview.fingerprint) throw syncStaleError({ stage: 'validate', path: 'selfHosted', check: 'content' })
}

export async function backupSelfHostedSwitch(
  preview: SelfHostedSwitchPreview,
  assertActive: () => void,
  onProgress: (progress: SwitchOperationProgress) => void,
) {
  const backupPath = `self-hosted-switch-backups/${Date.now()}-${crypto.randomUUID()}`
  const absoluteBackupPath = (await join(await appDataDir(), backupPath)).replaceAll('\\', '/').toLowerCase()
  for (const library of preview.libraries) {
    const root = library.localRoot.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
    if (absoluteBackupPath.startsWith(`${root}/`)) throw syncStaleError({ stage: 'backup', source: 'local', path: library.localRoot, check: 'configuration' })
  }
  const options = { baseDir: BaseDirectory.AppData }
  await mkdir(`${backupPath}/files`, { ...options, recursive: true })
  let copied = 0
  async function copy(directory: string, destination: string, prefix = '') {
    if (!prefix && !await exists(directory)) return
    for (const entry of await readDir(directory)) {
      assertActive()
      if (entry.isSymlink || entry.name === '.notegen' || entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = await join(directory, entry.name)
      if (entry.isDirectory) {
        await mkdir(`${destination}/${relative}`, { ...options, recursive: true })
        await copy(absolute, destination, relative)
      } else if (entry.isFile) {
        onProgress({ phase: 'backup', source: 'local', kind: 'file', path: relative, current: copied, total: 0 })
        await writeFile(`${destination}/${relative}`, await readFile(absolute), options)
        copied++
      }
    }
  }
  for (let index = 0; index < preview.libraries.length; index++) {
    const destination = `${backupPath}/files/${index}`
    await mkdir(destination, { ...options, recursive: true })
    await copy(preview.libraries[index].localRoot, destination)
  }
  const database = await getDb()
  const personal: Record<string, unknown> = {}
  for (const [domain, config] of Object.entries(STRUCTURED_DOMAINS)) {
    assertActive()
    personal[domain] = await database.select<Array<Record<string, unknown>>>(`select * from ${config.table}`)
  }
  personal.recordTagMetadata = await database.select<Array<Record<string, unknown>>>('select * from record_tag_metadata')
  personal.settings = await structuredPayload('backup', 'setting', 'all', true)
  await writeFile(`${backupPath}/personal-data.json`, new TextEncoder().encode(JSON.stringify(personal)), options)
  // Leave incomplete copies unmarked. Only a completed, revalidated snapshot
  // gets a manifest and can be presented as this switch's backup.
  await revalidateSelfHostedSwitch(preview, assertActive)
  await writeFile(`${backupPath}/manifest.json`, new TextEncoder().encode(JSON.stringify({
    version: 1, createdAt: new Date().toISOString(), libraries: preview.libraries, serverUrl: preview.serverUrl,
    profileId: preview.profileId, fingerprint: preview.fingerprint, files: copied,
  })), options)
  return backupPath
}
