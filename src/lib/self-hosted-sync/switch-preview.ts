import { invoke } from '@tauri-apps/api/core'
import { readDir, readFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getDb } from '@/db'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { ensureWorkspaceDirectory } from '@/lib/managed-workspace'
import { stableSyncValue, type SwitchModule, type SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import { authenticatedClient, secureGet } from './profile'
import { SelfHostedApiError } from './client'
import { decryptPackedJson, objectAssociatedData } from './crypto'
import { hashBytes } from './blob'
import { isDomainEnabled, resolveStructuredObjectId, STRUCTURED_DOMAINS, structuredPayload } from './outbox'
import type { SyncBootstrapPage, WorkspaceSummary } from './protocol'
import { materializeSwitchDocument, readSwitchDocument } from './switch-document'
import { applyConversationTombstones } from './snapshot'
import { getComparableStructuredValue } from './structured'
import { normalizeStructuredReferences } from './references'
import { personalAssetIdentity, personalAssetManifest, personalAssetPaths, readPersonalAsset } from './personal-assets'

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
export interface SelfHostedSwitchLocalObject {
  workspaceId: string | null
  localRoot: string | null
  domain: string
  localKey: string
  objectId: string | null
  payload: Record<string, unknown>
  hash: string
}
export interface SelfHostedSwitchWorkspace {
  workspace: WorkspaceSummary
  workspaceId: string
  workspaceType: 'library' | 'account-data'
  localRoot: string | null
  sequence: string
  objects: Array<{ object: SyncBootstrapPage['objects'][number]; payload: Record<string, unknown> }>
}
export interface SelfHostedSwitchSnapshot {
  profileId: string
  syncEpoch: string
  workspaces: SelfHostedSwitchWorkspace[]
  localObjects: SelfHostedSwitchLocalObject[]
  enabledDomains: string[]
  attachmentsEnabled: boolean
  personalAssets: Array<{ path: string; hash: string }>
}
const snapshots = new WeakMap<SelfHostedSwitchPreview, SelfHostedSwitchSnapshot>()
export function getSelfHostedSwitchSnapshot(preview: SelfHostedSwitchPreview) {
  const snapshot = snapshots.get(preview)
  if (!snapshot) throw syncStaleError({ stage: 'validate', path: 'selfHosted', check: 'content' })
  return snapshot
}
const domainModules: Record<string, SwitchModule> = {
  file: 'notes', asset: 'assets', mark: 'records', tag: 'tags', canvas: 'canvases',
  conversation: 'conversations', message: 'conversations', memory: 'memories', setting: 'settings',
}

export function comparableSelfHostedPayload(payload: Record<string, unknown>) {
  const domain = String(payload.domain)
  const value = getComparableStructuredValue(domain, record(payload.value), typeof payload.localKey === 'string' ? payload.localKey : undefined)
  const references = record(payload.references)
  // Numeric database IDs and foreign keys are device-local. Object references
  // and sync IDs are the identities actually shared by the protocol.
  const primaryTagId = value.tagId
  if (references.tag) value.tagId = references.tag
  if (references.conversation) value.conversationId = references.conversation
  if (Array.isArray(value.tagIds)) value.tagIds = value.tagIds.map(id => references[`tag:${id}`]
    ?? (id === primaryTagId ? references.tag : undefined) ?? id).sort()
  if (domain === 'canvas' && typeof value.content === 'string') {
    const normalizeRecords = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(normalizeRecords)
      if (!item || typeof item !== 'object') return item
      const row = record(item)
      return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'recordObjectId').map(([key, child]) => {
        if (key !== 'recordId' || typeof child !== 'number') return [key, normalizeRecords(child)]
        const objectId = typeof row.recordObjectId === 'string' ? row.recordObjectId : references[`record:${child}`]
        if (typeof objectId !== 'string') throw new Error('SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING')
        return [key, objectId]
      }))
    }
    const content = record(normalizeRecords(JSON.parse(value.content) as unknown))
    const ordered = (items: unknown) => Array.isArray(items) ? [...items].sort((a, b) => String(record(a).id).localeCompare(String(record(b).id))) : items
    value.content = { ...content, nodes: ordered(content.nodes), edges: ordered(content.edges) }
  }
  return { domain, value, ...(domain === 'setting' ? { memoryPolicy: payload.memoryPolicy } : {}) }
}

// Compare the same payloads used by the outbox, without creating object mappings,
// applying snapshots, or moving sync cursors during inspection.
export async function inspectSelfHostedSwitch(
  assertActive: () => void = () => {},
  onProgress?: (progress: SwitchOperationProgress) => void,
  phase: 'scan' | 'validate' | 'verify' = 'scan',
): Promise<SelfHostedSwitchPreview> {
  const report = (value: Omit<SwitchOperationProgress, 'phase' | 'kind'>) => {
    onProgress?.({ phase, kind: 'item', ...value })
  }
  report({ source: 'remote', current: 0, total: 0 })
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
  const localObjects: SelfHostedSwitchLocalObject[] = []
  const remoteWorkspaces: SelfHostedSwitchWorkspace[] = []
  const enabledDomains = [...Object.keys(STRUCTURED_DOMAINS), 'setting'].filter(domain => isDomainEnabled(domain, profile.domainToggles))
  const sequences: Array<[string, string]> = []
  const fingerprint = async (value: unknown) => hashBytes(new TextEncoder().encode(stableSyncValue(value)))
  const fileId = async (relativePath: string) => {
    const portable = await invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', { relativePath })
    return portable.caseFolded
  }
  const localPaths = new Map<string, Map<string, 'file' | 'folder'>>()
  let scannedLocalEntries = 0
  async function scan(directory: string, scope: string, prefix = '') {
    if (!prefix) await ensureWorkspaceDirectory(directory)
    for (const entry of await readDir(directory)) {
      assertActive()
      if (entry.isSymlink || entry.name === '.notegen' || entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = await join(directory, entry.name)
      if (!entry.isDirectory && !entry.isFile) continue
      const moduleId = entry.isDirectory ? undefined : path.toLowerCase().endsWith('.md') ? 'notes' : 'assets'
      report({ source: 'local', module: moduleId, path: absolute, current: scannedLocalEntries, total: 0 })
      const normalized = await fileId(path)
      const paths = localPaths.get(scope) ?? new Map<string, 'file' | 'folder'>()
      localPaths.set(scope, paths)
      if (paths.has(normalized)) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      const segments = normalized.split('/')
      for (let length = 1; length < segments.length; length++) {
        if (paths.get(segments.slice(0, length).join('/')) !== 'folder') throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      }
      paths.set(normalized, entry.isDirectory ? 'folder' : 'file')
      if (entry.isDirectory) {
        localObjects.push({ workspaceId: scope === 'new' ? null : scope, localRoot: libraries.find(item => (item.workspaceId ?? 'new') === scope)!.localRoot,
          domain: 'folder', localKey: path, objectId: null, payload: { version: 1, domain: 'folder', relativePath: path }, hash: '' })
        scannedLocalEntries++
        report({ source: 'local', path: absolute, current: scannedLocalEntries, total: 0 })
        await scan(absolute, scope, path)
      } else if (entry.isFile) {
        const domain = path.toLowerCase().endsWith('.md') ? 'file' : 'asset'
        const hash = await hashBytes(await readFile(absolute))
        local.push({ id: `library:${scope}:${normalized}`, module: domain === 'file' ? 'notes' : 'assets', label: path, hash })
        localObjects.push({ workspaceId: scope === 'new' ? null : scope, localRoot: libraries.find(item => (item.workspaceId ?? 'new') === scope)!.localRoot,
          domain, localKey: path, objectId: null, payload: { version: 1, domain, relativePath: path }, hash })
        scannedLocalEntries++
        report({ source: 'local', module: moduleId, path: absolute, current: scannedLocalEntries, total: 0 })
      }
    }
  }
  for (const library of libraries) {
    report({ source: 'local', path: library.localRoot, current: scannedLocalEntries, total: 0 })
    await scan(library.localRoot, library.workspaceId ?? 'new')
  }
  report({ source: 'local', current: scannedLocalEntries, total: scannedLocalEntries })
  const personalId = personal?.id ?? '00000000-0000-4000-8000-000000000000'
  const objectId = (domain: string, localKey: string) => resolveStructuredObjectId(personalId, domain, localKey)
  const labelFor = (payload: Record<string, unknown>, fallback: string) => {
    const value = record(payload.value)
    return String(value.title ?? value.name ?? payload.localKey ?? fallback)
  }
  for (const [domain, config] of Object.entries(STRUCTURED_DOMAINS)) {
    if (!enabledDomains.includes(domain)) continue
    const rows = (await database.select<Array<Record<string, unknown>>>(`select * from ${config.table}`))
      .filter(row => !(domain === 'mark' && row.deleted === 1 || domain === 'canvas' && row.deletedAt != null))
    let processed = 0
    report({ source: 'local', module: domainModules[domain], current: 0, total: rows.length })
    for (const row of rows) {
      assertActive()
      const key = String(row[config.keyColumn] ?? row.id)
      const path = labelFor({ value: row }, key)
      report({ source: 'local', module: domainModules[domain], path, current: processed, total: rows.length })
      const payload = await structuredPayload(personalId, domain, key, true)
      if (payload) {
        const id = await objectId(domain, key)
        const hash = await fingerprint(comparableSelfHostedPayload(payload))
        local.push({ id: `personal:${id}`, module: domainModules[domain], label: labelFor(payload, key), hash })
        localObjects.push({ workspaceId: personal?.id ?? null, localRoot: null, domain, localKey: key, objectId: id, payload, hash })
      }
      report({ source: 'local', module: domainModules[domain], path, current: ++processed, total: rows.length })
    }
  }
  if (profile.domainToggles.settings !== false) {
    report({ source: 'local', module: 'settings', current: 0, total: 1 })
    const payload = await structuredPayload(personalId, 'setting', 'all', true)
    if (payload) {
      const id = await objectId('setting', 'all')
      const hash = await fingerprint(comparableSelfHostedPayload(payload))
      local.push({ id: `personal:${id}`, module: 'settings', label: 'settings', hash })
      localObjects.push({ workspaceId: personal?.id ?? null, localRoot: null, domain: 'setting', localKey: 'all', objectId: id, payload, hash })
    }
    report({ source: 'local', module: 'settings', current: 1, total: 1 })
  }
  const attachmentsEnabled = profile.domainToggles.attachments !== false
  const personalAssets: SelfHostedSwitchSnapshot['personalAssets'] = []
  if (attachmentsEnabled) {
    const paths = [...new Set(localObjects.flatMap(item => personalAssetPaths(item.payload)))]
    let processed = 0
    for (const path of paths) {
      assertActive()
      report({ source: 'local', module: 'dataAssets', path, current: processed, total: paths.length })
      const bytes = await readPersonalAsset(path)
      if (bytes) {
        const hash = await hashBytes(bytes)
        if (personalAssets.some(asset => personalAssetIdentity(asset.path) === personalAssetIdentity(path) && asset.hash !== hash)) {
          throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
        }
        personalAssets.push({ path, hash })
        local.push({ id: `personal-asset:${path}`, module: 'dataAssets', label: path, hash })
      }
      report({ source: 'local', module: 'dataAssets', path, current: ++processed, total: paths.length })
    }
  }
  async function inspectRemote(workspace: WorkspaceSummary) {
    const workspacePath = libraries.find(item => item.workspaceId === workspace.id)?.localRoot
    let processed = 0
    report({ source: 'remote', path: workspacePath, current: 0, total: 0 })
    const keys = await client.workspaceKeys(workspace.id)
    const decryptedKeys = new Map<number, string>()
    const keyForVersion = async (version: number) => {
      const managedKey = keys.find(key => key.keyVersion === version)?.envelopes.find(envelope => envelope.type === 'managed')?.wrappedKey
      const key = decryptedKeys.get(version) ?? (workspace.encryptionMode === 'managed' ? managedKey : await secureGet(`workspace.${workspace.id}.key.${version}`))
      if (!key) throw new Error('SELF_HOSTED_PREVIEW_KEY_REQUIRED')
      decryptedKeys.set(version, key)
      return key
    }
    const state: SelfHostedSwitchWorkspace = { workspace, workspaceId: workspace.id, workspaceType: workspace.type,
      localRoot: libraries.find(item => item.workspaceId === workspace.id)?.localRoot ?? null, sequence: '0', objects: [] }
    const remotePaths = new Map<string, string>()
    remoteWorkspaces.push(state)
    await client.withBootstrapSnapshot(workspace.id, capabilities.syncEpoch, async readPage => {
      let bootstrapId: string | undefined
      let after: string | undefined
      do {
        assertActive()
        report({ source: 'remote', path: workspacePath, current: processed, total: 0 })
        const page = await readPage(bootstrapId, after)
        bootstrapId = page.bootstrapId
        if (!after) { sequences.push([workspace.id, page.snapshotSequence]); state.sequence = page.snapshotSequence }
        const objects = page.objects.filter(object => !['yjs-update', 'yjs-checkpoint'].includes(object.kind)
          && (workspace.type !== 'account-data' || enabledDomains.includes(object.kind)))
        // Earlier pages do not tell us the final object count. Only show a
        // denominator once the last page has arrived.
        const total = page.nextObjectId ? 0 : processed + objects.length
        for (const object of objects) {
          assertActive()
          const moduleId = object.kind === 'note' ? 'notes' : domainModules[object.kind]
          report({ source: 'remote', module: moduleId, current: processed, total })
          // Managed workspaces use this server's authoritative key. A cached key
          // may belong to an older connection or a restored server snapshot.
          const key = await keyForVersion(object.keyVersion)
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
          const path = typeof payload.relativePath === 'string' ? payload.relativePath : labelFor(payload, object.objectId)
          report({ source: 'remote', module: moduleId, path, current: processed, total })
          // Older clients placed canvases in libraries; those objects are outside
          // the file switch scope and must not be deleted by an overwrite.
          if (workspace.type === 'library' && !['file', 'asset', 'folder'].includes(domain)) {
            report({ source: 'remote', module: moduleId, path, current: ++processed, total })
            continue
          }
          const expectedKind = domain === 'file' ? 'note' : domain
          if (object.kind !== expectedKind) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
          if (workspace.type === 'library' && !object.deletedAt) {
            const path = await fileId(String(payload.relativePath ?? ''))
            if (remotePaths.has(path)) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
            remotePaths.set(path, domain)
          }
          if (!object.deletedAt && object.document) {
            const document = await readSwitchDocument(client, workspace.id, object, capabilities.syncEpoch, keyForVersion, assertActive,
              onProgress ? documentProgress => report({ source: 'remote', module: moduleId, path, current: processed, total, documentProgress }) : undefined)
            if (document) {
              try {
                if (document.sequence !== object.document.latestDocumentSequence) throw syncStaleError({ stage: 'scan', path: 'selfHosted', check: 'version' })
                payload = materializeSwitchDocument(document, object.kind, payload)
              } finally { document.document.destroy() }
            }
          }
          state.objects.push({ object, payload })
          report({ source: 'remote', module: moduleId, path, current: ++processed, total })
        }
        after = page.nextObjectId ?? undefined
        report({ source: 'remote', path: workspacePath, current: processed, total: after ? 0 : processed })
      } while (after)
    })
    // A deleted conversation also removes its messages from the active view.
    // Historic servers may retain those message objects after deleting the
    // parent; compare, import and verify the same effective snapshot.
    state.objects = applyConversationTombstones(normalizeStructuredReferences(state.objects))
    const contentObjects = state.objects.filter(({ payload }) => payload.domain !== 'folder')
    for (const [index, { object, payload }] of contentObjects.entries()) {
      const domain = String(payload.domain)
      const moduleId = domainModules[domain]
      if (!moduleId) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      const isFile = workspace.type === 'library' && (domain === 'file' || domain === 'asset')
      if (workspace.type === 'library' && !isFile) continue
      const path = String(payload.relativePath ?? '')
      const progressPath = isFile ? path : labelFor(payload, object.objectId)
      report({ source: 'remote', module: moduleId, path: progressPath, current: index, total: contentObjects.length })
      const id = isFile ? `library:${workspace.id}:${await fileId(path)}` : `personal:${object.objectId}`
      const hash = isFile
        ? typeof payload.content === 'string' ? await hashBytes(new TextEncoder().encode(payload.content)) : String(payload.plaintextHash ?? '')
        : await fingerprint(comparableSelfHostedPayload(payload))
      if (isFile && !object.deletedAt && !hash) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      remote.push({ id, module: moduleId, label: isFile ? path : labelFor(payload, object.objectId), hash, deleted: object.deletedAt !== null })
      if (workspace.type === 'account-data' && attachmentsEnabled && object.deletedAt === null) {
        for (const asset of personalAssetManifest(payload, workspace.id)) {
          const id = `personal-asset:${asset.path}`
          const previous = remote.find(entry => entry.id === id)
          if (previous && previous.hash !== asset.plaintextHash) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
          if (remote.some(entry => entry.module === 'dataAssets' && personalAssetIdentity(entry.label) === personalAssetIdentity(asset.path)
            && entry.hash !== asset.plaintextHash)) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
          if (!previous) remote.push({ id, module: 'dataAssets', label: asset.path, hash: asset.plaintextHash })
        }
      }
      report({ source: 'remote', module: moduleId, path: progressPath, current: index + 1, total: contentObjects.length })
    }
    for (const path of remotePaths.keys()) {
      const segments = path.split('/')
      for (let length = 1; length < segments.length; length++) {
        const parent = remotePaths.get(segments.slice(0, length).join('/'))
        if (parent && parent !== 'folder') throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      }
    }
  }
  for (const source of libraries) {
    const workspace = workspaces.find(workspace => workspace.id === source.workspaceId)
    if (workspace) await inspectRemote(workspace)
  }
  if (personal) await inspectRemote(personal)
  if (attachmentsEnabled) {
    let checkedAssets = 0
    for (const workspace of remoteWorkspaces.filter(item => item.workspaceType === 'account-data')) {
      for (const entry of workspace.objects.filter(item => item.object.deletedAt === null)) {
        const manifest = personalAssetManifest(entry.payload, workspace.workspaceId)
        for (const path of personalAssetPaths(entry.payload)) {
          let asset = personalAssets.find(item => item.path === path)
          if (!asset) {
            report({ source: 'local', module: 'dataAssets', path, current: checkedAssets, total: 0 })
            const bytes = await readPersonalAsset(path)
            if (bytes) {
              asset = { path, hash: await hashBytes(bytes) }
              personalAssets.push(asset)
              local.push({ id: `personal-asset:${path}`, module: 'dataAssets', label: path, hash: asset.hash })
            }
            report({ source: 'local', module: 'dataAssets', path, current: ++checkedAssets, total: 0 })
          }
          // Legacy payloads can reuse a verified local copy. Missing legacy
          // bytes are rejected by the download preflight before any mutation.
          if (asset && !manifest.some(item => item.path === path) && !remote.some(item => item.id === `personal-asset:${path}`)) {
            remote.push({ id: `personal-asset:${path}`, module: 'dataAssets', label: path, hash: asset.hash })
          }
        }
      }
    }
  }
  const modules = [...new Set<SwitchModule>(['notes', 'assets', ...local.map(entry => entry.module), ...remote.map(entry => entry.module)])]
    .map(id => ({ id, local: 0, remote: 0, same: 0, localOnly: 0, remoteOnly: 0, changed: 0, deleted: 0 }))
  const details: SelfHostedSwitchPreview['details'] = []
  const localMap = uniqueEntries(local)
  const remoteMap = uniqueEntries(remote)
  let differenceCount = 0
  const identities = [...new Set([...localMap.keys(), ...remoteMap.keys()])]
  report({ source: 'remote', current: 0, total: identities.length })
  for (const [index, id] of identities.entries()) {
    assertActive()
    const left = localMap.get(id), right = remoteMap.get(id)
    const entry = right ?? left!
    report({ source: 'remote', module: entry.module, path: entry.label, current: index, total: identities.length })
    const row = modules.find(row => row.id === entry.module)!
    if (left) row.local++
    if (right && !right.deleted) row.remote++
    // Historical tombstones without a local counterpart have no local impact.
    if (!right?.deleted || left) {
      const difference: Difference = right?.deleted ? 'deleted' : !left ? 'remoteOnly' : !right ? 'localOnly' : left.hash === right.hash ? 'same' : 'changed'
      row[difference]++
      if (difference !== 'same') {
        differenceCount++
        details.push({ module: entry.module, label: entry.label, difference })
      }
    }
    report({ source: 'remote', module: entry.module, path: entry.label, current: index + 1, total: identities.length })
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
  const preview: SelfHostedSwitchPreview = { profileId: profile.id, serverUrl: profile.serverUrl, libraries, modules, details: details.slice(0, 100), differenceCount, settingsPaused: profile.domainToggles.settings === false,
    fingerprint: await fingerprint({ profileId: profile.id, accountId: profile.accountId, instanceId: capabilities.instanceId,
      epoch: capabilities.syncEpoch, libraries, toggles: profile.domainToggles, sequences, pendingChanges, pendingCommands,
      local: [...localMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
      folders: localObjects.filter(item => item.domain === 'folder').map(item => [item.workspaceId, item.localRoot, item.localKey]),
      remote: [...remoteMap.values()].sort((a, b) => a.id.localeCompare(b.id)) }) }
  snapshots.set(preview, { profileId: profile.id, syncEpoch: capabilities.syncEpoch, workspaces: remoteWorkspaces, localObjects,
    enabledDomains, attachmentsEnabled, personalAssets })
  return preview
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
  const { captureSelfHostedSwitchBackup } = await import('./switch-backup')
  return captureSelfHostedSwitchBackup({
    ...preview, assertActive, onProgress,
    personalAssets: getSelfHostedSwitchSnapshot(preview).personalAssets,
    validate: () => revalidateSelfHostedSwitch(preview, assertActive),
  })
}
