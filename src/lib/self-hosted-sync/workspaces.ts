import { invoke } from '@tauri-apps/api/core'
import { exists, mkdir, readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb, initAllDatabases } from '@/db'
import { decryptText } from './crypto'
import { SelfHostedApiError } from './client'
import { authenticatedClient, secureGet, secureSet, workspaceSecretKey } from './profile'
import { enqueueAssetSnapshot, enqueueFileSnapshot, enqueueFolderSnapshot } from './outbox'
import { bytesToBase64Url } from './blob'
import type { WorkspaceSummary } from './protocol'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { ensureWorkspaceDirectory, managedWorkspaceLocation, resolveManagedWorkspacePath } from '@/lib/managed-workspace'
import { getWorkspaceFolderName } from '@/lib/workspace-name'
import { withSelfHostedPrepareLock } from './prepare-lock'
import { normalizeWorkspaceNamePath, useWorkspaceNamesStore } from '@/stores/workspace-names'

interface EncryptedName {
  nonce: string
  ciphertext: string
}

const DEFAULT_LIBRARY_IDEMPOTENCY_KEY = 'notegen.default-library.v1'
const LEGACY_DEFAULT_LIBRARY_NAME = '我的资料库'

function displayLibraryName(name: string) {
  return name === LEGACY_DEFAULT_LIBRARY_NAME ? '我的工作区' : name
}

async function nameFromWorkspaceFolder(localRoot: string, fallback: string) {
  // Managed folders are generated from the cloud name or ID. Reading them
  // back as a new name would make that naming process circular.
  if (await managedWorkspaceLocation(localRoot) !== null) return fallback
  return getWorkspaceFolderName(localRoot, fallback)
}

async function synchronizeLibraryFolderName(
  profileId: string, workspace: WorkspaceSummary, localRoot: string | null, name: string,
) {
  if (!localRoot || name !== '我的工作区' || !workspace.owner
    || !workspace.capabilities.includes('workspace.rename')) return { workspace, name }
  const folderName = await nameFromWorkspaceFolder(localRoot, name)
  if (folderName === name) return { workspace, name }
  try {
    const key = await loadManagedWorkspaceKey(profileId, workspace.id, workspace.latestKeyVersion)
    const encrypted = await invoke<EncryptedName>('self_hosted_encrypt', {
      key, plaintext: folderName, associatedData: 'workspace-name:v1',
    })
    const { client } = await authenticatedClient(profileId)
    const updated = await client.renameWorkspace(workspace.id, JSON.stringify(encrypted))
    return { workspace: { ...workspace, ...updated }, name: folderName }
  } catch (error) {
    // A metadata update must not prevent content synchronization. Keep showing
    // the shared name until the update succeeds on a subsequent refresh.
    console.warn('[workspace] Unable to synchronize folder name', { workspaceId: workspace.id, error })
    return { workspace, name }
  }
}

async function decryptLibraryName(profileId: string, workspace: WorkspaceSummary) {
  const key = await loadManagedWorkspaceKey(profileId, workspace.id, workspace.latestKeyVersion)
  const encrypted = JSON.parse(workspace.nameCiphertext) as EncryptedName
  return displayLibraryName(await decryptText(key, encrypted.nonce, encrypted.ciphertext, 'workspace-name:v1'))
}

async function cacheLibraryName(workspace: WorkspaceSummary) {
  await (await getDb()).execute(
    `insert into self_hosted_workspace_names(workspace_id, name_ciphertext, key_version)
     select $1, $2, $3 where exists (select 1 from self_hosted_workspace_bindings where workspace_id = $1)
     on conflict(workspace_id) do update set name_ciphertext = excluded.name_ciphertext, key_version = excluded.key_version`,
    [workspace.id, workspace.nameCiphertext, workspace.latestKeyVersion],
  )
}

let nameRefreshGeneration = 0

/** Cached ciphertext and locally stored keys allow names to resolve while offline. */
export async function refreshCachedWorkspaceNames() {
  const generation = ++nameRefreshGeneration
  const rows = await (await getDb()).select<Array<{
    workspaceId: string; localRoot: string; nameCiphertext: string; keyVersion: number
  }>>(
    `select b.workspace_id as workspaceId, b.local_root as localRoot,
       n.name_ciphertext as nameCiphertext, n.key_version as keyVersion
     from self_hosted_workspace_bindings b join self_hosted_workspace_names n on n.workspace_id = b.workspace_id
     where b.workspace_type = 'library' and b.local_root is not null`,
  )
  const defaultRoot = normalizeWorkspaceNamePath(await getDefaultArticleAbsolutePath(''))
  const names: Record<string, string> = {}
  await Promise.all(rows.map(async row => {
    try {
      const key = await secureGet(workspaceSecretKey(row.workspaceId, row.keyVersion))
      if (!key) return
      const encrypted = JSON.parse(row.nameCiphertext) as EncryptedName
      const name = displayLibraryName(await decryptText(key, encrypted.nonce, encrypted.ciphertext, 'workspace-name:v1'))
      const root = normalizeWorkspaceNamePath(row.localRoot)
      names[root] = name
      if (root === defaultRoot) names[''] = name
    } catch (error) {
      console.warn('[workspace] Unable to decrypt cached workspace name', { workspaceId: row.workspaceId, error })
    }
  }))
  if (generation === nameRefreshGeneration) useWorkspaceNamesStore.getState().setNames(names)
}

export interface SelfHostedLibrary extends WorkspaceSummary {
  name: string
  default: boolean
  localRoot: string | null
  bindingState: string | null
  accessMode: 'read-write' | 'read-only'
}

export async function listLibraries(profileId: string): Promise<SelfHostedLibrary[]> {
  await initAllDatabases()
  const { client } = await authenticatedClient(profileId)
  const [workspaceRows, defaultCreation] = await Promise.all([
    client.workspaces(),
    client.workspaceCreationRequest(DEFAULT_LIBRARY_IDEMPOTENCY_KEY).catch(error => {
      if (error instanceof SelfHostedApiError && error.status === 404) return null
      throw error
    }),
  ])
  const workspaces = workspaceRows.filter(workspace => workspace.type === 'library')
  const database = await getDb()
  const bindings = await database.select<Array<{
    workspaceId: string
    localRoot: string | null
    bindingState: string
    accessMode: 'read-write' | 'read-only'
  }>>(
    `select workspace_id as workspaceId, local_root as localRoot,
       binding_state as bindingState, access_mode as accessMode
     from self_hosted_workspace_bindings where profile_id = $1`,
    [profileId]
  )
  const libraries = await Promise.all(workspaces.map(async (workspace): Promise<SelfHostedLibrary> => {
    const binding = bindings.find(item => item.workspaceId === workspace.id)
    const synchronized = await synchronizeLibraryFolderName(
      profileId, workspace, binding?.localRoot ?? null, await decryptLibraryName(profileId, workspace),
    )
    workspace = synchronized.workspace
    const name = synchronized.name
    await cacheLibraryName(workspace)
    return {
      ...workspace,
      name,
      default: workspace.id === defaultCreation?.id,
      localRoot: binding?.localRoot ?? null,
      bindingState: binding?.bindingState ?? null,
      accessMode: binding?.accessMode ?? (workspace.capabilities.includes('content.update') ? 'read-write' : 'read-only'),
    }
  }))
  await refreshCachedWorkspaceNames()
  return libraries
}

export async function createLibrary(
  profileId: string,
  name: string,
  localRoot: string | null,
  idempotencyKey = crypto.randomUUID(),
) {
  await initAllDatabases()
  const resolvedName = name.trim() || (localRoot ? await nameFromWorkspaceFolder(localRoot, '我的工作区') : '')
  if (!resolvedName) throw new Error('工作区名称不能为空')
  const workspaceId = await createRemoteLibrary(profileId, resolvedName, idempotencyKey)
  const resolvedLocalRoot = localRoot ?? await getManagedLibraryWorkspacePath(workspaceId, resolvedName)
  if (localRoot === null) await mkdir(resolvedLocalRoot, { recursive: true })
  await bindLibrary(profileId, workspaceId, resolvedLocalRoot, localRoot !== null)
  return workspaceId
}

async function createRemoteLibrary(profileId: string, name: string, idempotencyKey: string) {
  const { client } = await authenticatedClient(profileId)
  const key = await invoke<string>('self_hosted_generate_workspace_key')
  const encryptedName = await invoke<EncryptedName>('self_hosted_encrypt', {
    key,
    plaintext: name.trim(),
    associatedData: 'workspace-name:v1',
  })
  const workspace = await client.createLibrary(
    JSON.stringify(encryptedName),
    key,
    idempotencyKey,
  )
  if (workspace.created) await secureSet(workspaceSecretKey(workspace.id, 1), key)
  return workspace.id
}

export async function getManagedLibraryWorkspacePath(workspaceId: string, name: string) {
  const bindings = await (await getDb()).select<Array<{ localRoot: string | null }>>(
    'select local_root as localRoot from self_hosted_workspace_bindings where workspace_id = $1', [workspaceId],
  )
  if (bindings[0]?.localRoot) return bindings[0].localRoot
  const parent = await join(await appDataDir(), 'workspaces', 'self-hosted')
  const legacy = await join(parent, workspaceId)
  if (await exists(legacy)) return legacy
  // Keep Unicode names, remove cross-platform forbidden characters, and bound
  // component length even for multi-byte UTF-8 names. Never rename an existing root.
  let label = Array.from(name.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-').trim())
    .slice(0, 48).join('').replace(/[. ]+$/, '') || 'workspace'
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(label)) label = `_${label}`
  const identity = workspaceId.replace(/-/g, '').toLowerCase()
  const reservedRoots = await (await getDb()).select<Array<{ localRoot: string }>>(
    'select local_root as localRoot from self_hosted_workspace_bindings where local_root is not null',
  )
  const reserved = new Set(reservedRoots.map(row => normalizeWorkspaceNamePath(row.localRoot).toLowerCase()))
  await mkdir(parent, { recursive: true })
  for (let length = 8; length <= identity.length; length += 4) {
    const directory = `${label}--${identity.slice(0, length)}`
    const root = await join(parent, directory)
    if (reserved.has(normalizeWorkspaceNamePath(root).toLowerCase())) continue
    const entries = await readDir(parent)
    if (entries.some(entry => entry.name?.toLowerCase() === directory.toLowerCase())) continue
    try {
      // Exclusive creation also handles a collision with another window.
      await mkdir(root)
      return root
    } catch (error) {
      if (!await exists(root)) throw error
    }
  }
  throw new Error('Unable to allocate a unique workspace directory')
}

/** Discover new libraries without changing existing or explicitly removed bindings. */
export async function discoverLibraryWorkspaces(
  profileId: string,
  isActive: () => boolean,
  onError: (workspaceId: string, error: unknown) => void,
) {
  let discovered = 0
  const { client } = await authenticatedClient(profileId)
  const workspaces = await client.workspaces()
  if (!isActive()) return discovered
  const database = await getDb()
  // Include inactive bindings: an explicit unbind/revocation must not be undone.
  const bindings = await database.select<Array<{ workspaceId: string; profileId: string; bindingState: string; localRoot: string | null }>>(
    'select workspace_id as workspaceId, profile_id as profileId, binding_state as bindingState, local_root as localRoot from self_hosted_workspace_bindings',
  )
  const known = new Map(bindings.map(binding => [binding.workspaceId, binding]))
  for (const workspace of workspaces) {
    if (!isActive()) return discovered
    if (workspace.type !== 'library' || workspace.deletedAt !== null) continue
    const existing = known.get(workspace.id)
    if (existing && (existing.profileId !== profileId
      || !['bound', 'bootstrapping', 'epoch-changed'].includes(existing.bindingState))) continue
    try {
      const name = await decryptLibraryName(profileId, workspace)
      if (!isActive()) return discovered
      if (known.has(workspace.id)) {
        const synchronized = await synchronizeLibraryFolderName(profileId, workspace, existing?.localRoot ?? null, name)
        if (!isActive()) return discovered
        await cacheLibraryName(synchronized.workspace)
        continue
      }
      const root = await getManagedLibraryWorkspacePath(workspace.id, name)
      if (!isActive()) return discovered
      await ensureWorkspaceDirectory(root)
      if (!isActive()) return discovered
      const now = Date.now()
      // A user can bind a custom directory while discovery awaits the server.
      // Never overwrite that binding or import local files into a new library.
      const result = await database.execute(
        `insert into self_hosted_workspace_bindings(
           workspace_id, profile_id, workspace_type, local_root, binding_state,
           access_mode, created_at, updated_at
         ) select $1, $2, 'library', $3, 'bootstrapping', $4, $5, $5
           where exists (select 1 from self_hosted_sync_profiles where id = $2 and state = 'connected')
             and not exists (select 1 from self_hosted_workspace_bindings where workspace_id = $1 or local_root = $3)
         on conflict do nothing`,
        [workspace.id, profileId, root,
          workspace.capabilities.includes('content.update') ? 'read-write' : 'read-only', now],
      )
      discovered += result.rowsAffected
      await cacheLibraryName(workspace)
    } catch (error) {
      onError(workspace.id, error)
    }
  }
  await refreshCachedWorkspaceNames()
  return discovered
}

export async function ensureLibraryLocalWorkspace(profileId: string, workspaceId: string) {
  await initAllDatabases()
  const database = await getDb()
  const bindings = await database.select<Array<{ localRoot: string | null; bindingState: string }>>(
    `select local_root as localRoot, binding_state as bindingState
     from self_hosted_workspace_bindings
     where profile_id = $1 and workspace_id = $2 limit 1`,
    [profileId, workspaceId]
  )
  const existing = bindings[0]
  if (existing?.localRoot && ['bound', 'bootstrapping', 'epoch-changed'].includes(existing.bindingState)) {
    await ensureWorkspaceDirectory(existing.localRoot)
    return existing.localRoot
  }

  const { client } = await authenticatedClient(profileId)
  const workspace = (await client.workspaces()).find(item => item.id === workspaceId && item.type === 'library')
  if (!workspace) throw new Error('工作区不存在或当前账号无权访问')
  const localRoot = await getManagedLibraryWorkspacePath(workspaceId, await decryptLibraryName(profileId, workspace))
  await mkdir(localRoot, { recursive: true })
  await bindLibrary(profileId, workspaceId, localRoot, false)
  return localRoot
}

const defaultLibraryTasks = new Map<string, Promise<string | null>>()

export async function ensureDefaultLibraryForCurrentWorkspace(profileId: string, defaultName: string) {
  const workspaceLocation = await getWorkspacePath()
  const taskKey = JSON.stringify([profileId, workspaceLocation.isCustom ? normalizeLocalRoot(workspaceLocation.path) : ''])
  const current = defaultLibraryTasks.get(taskKey)
  if (current) return current
  const task = ensureDefaultLibrary(profileId, defaultName, workspaceLocation).finally(() => {
    defaultLibraryTasks.delete(taskKey)
  })
  defaultLibraryTasks.set(taskKey, task)
  return task
}

async function ensureDefaultLibrary(
  profileId: string,
  defaultName: string,
  workspaceLocation: Awaited<ReturnType<typeof getWorkspacePath>>,
) {
  const defaultLocalRoot = await getDefaultArticleAbsolutePath('')
  // "Default" is a logical workspace identity, not a filesystem path. Every
  // platform resolves it to its own app-data directory.
  const isDefaultLocalWorkspace = !workspaceLocation.isCustom
    || normalizeLocalRoot(workspaceLocation.path) === normalizeLocalRoot(defaultLocalRoot)
    || normalizeLocalRoot(workspaceLocation.path) === 'article'
  const localRoot = isDefaultLocalWorkspace
    ? defaultLocalRoot
    : workspaceLocation.path
  const libraryName = await nameFromWorkspaceFolder(localRoot, defaultName)
  await ensureWorkspaceDirectory(localRoot)
  console.info('[self-hosted-sync] workspace.ensure-started', { profileId, localRoot })
  const database = await getDb()
  console.info('[self-hosted-sync] workspace.database-ready', { profileId })
  const existing = await database.select<Array<{ workspaceId: string }>>(
    `select workspace_id as workspaceId from self_hosted_workspace_bindings
     where profile_id = $1 and workspace_type = 'library'
       and local_root = $2
       and binding_state in ('bound', 'bootstrapping', 'epoch-changed') limit 1`,
    [profileId, localRoot]
  )
  console.info('[self-hosted-sync] workspace.binding-checked', {
    profileId, existing: existing.length > 0,
  })
  if (isDefaultLocalWorkspace) {
    const canonicalWorkspaceId = await createRemoteLibrary(
      profileId,
      defaultName,
      DEFAULT_LIBRARY_IDEMPOTENCY_KEY,
    )
    if (existing[0]?.workspaceId === canonicalWorkspaceId) {
      console.info('[self-hosted-sync] workspace.default-binding-reused', {
        profileId, workspaceId: canonicalWorkspaceId, localRoot,
      })
      return canonicalWorkspaceId
    }
    console.info('[self-hosted-sync] workspace.default-binding-converging', {
      profileId,
      previousWorkspaceId: existing[0]?.workspaceId ?? null,
      workspaceId: canonicalWorkspaceId,
      localRoot,
    })
    await bindLibrary(profileId, canonicalWorkspaceId, localRoot, true)
    return canonicalWorkspaceId
  }
  if (existing[0]) {
    console.info('[self-hosted-sync] workspace.binding-reused', {
      profileId, workspaceId: existing[0].workspaceId, localRoot,
    })
    return existing[0].workspaceId
  }

  console.info('[self-hosted-sync] workspace.library-list-started', { profileId })
  const libraries = await listLibraries(profileId)
  console.info('[self-hosted-sync] workspace.library-list-completed', {
    profileId, total: libraries.length,
  })
  const owned = libraries.filter(library => library.owner)
  if (owned.length === 0) {
    console.info('[self-hosted-sync] workspace.default-library-creating', { profileId, localRoot })
    return createLibrary(profileId, libraryName, localRoot, DEFAULT_LIBRARY_IDEMPOTENCY_KEY)
  }

  const unboundOwned = owned.filter(library => !library.localRoot)
  if (unboundOwned.length === 1) {
    console.info('[self-hosted-sync] workspace.unbound-library-selected', {
      profileId, workspaceId: unboundOwned[0]!.id, localRoot,
    })
    await bindLibrary(profileId, unboundOwned[0]!.id, localRoot, true)
    return unboundOwned[0]!.id
  }
  if (unboundOwned.length === 0) {
    console.info('[self-hosted-sync] workspace.local-library-creating', { profileId, localRoot })
    return createLibrary(profileId, libraryName, localRoot)
  }
  console.warn('[self-hosted-sync] workspace.selection-required', {
    profileId, localRoot, candidates: unboundOwned.length,
  })
  return null
}

function normalizeLocalRoot(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export async function getCurrentWorkspaceRoot() {
  const workspace = await getWorkspacePath()
  return workspace.isCustom ? workspace.path : getDefaultArticleAbsolutePath('')
}

export async function bindLibrary(
  profileId: string,
  workspaceId: string,
  localRoot: string,
  scanLocal: boolean,
) {
  localRoot = await resolveManagedWorkspacePath(localRoot)
  console.info('[self-hosted-sync] workspace.bind-started', { profileId, workspaceId, localRoot, scanLocal })
  await ensureWorkspaceDirectory(localRoot)
  const { client } = await authenticatedClient(profileId)
  const workspace = (await client.workspaces()).find(item => item.id === workspaceId && item.type === 'library')
  if (!workspace) throw new Error('工作区不存在或当前账号无权访问')
  const session = await client.syncSession(workspaceId, '0')
  const now = Date.now()
  // Releasing the previous owner and claiming the root must use the same
  // SQLite transaction. Discovery and another window can bind concurrently.
  await executeRecordTransaction([
    {
      sql: `update self_hosted_workspace_bindings
        set local_root = null, binding_state = 'unbound', updated_at = $1
        where local_root = $2 and workspace_id <> $3`,
      values: [now, localRoot, workspaceId],
    },
    {
      sql: `insert into self_hosted_workspace_bindings(
         workspace_id, profile_id, workspace_type, local_root, binding_state,
         access_mode, sync_epoch, created_at, updated_at
       ) values ($1, $2, 'library', $3, 'bound', $4, $5, $6, $6)
       on conflict(workspace_id) do update set
         profile_id = excluded.profile_id, local_root = excluded.local_root,
         binding_state = 'bound', access_mode = excluded.access_mode,
         sync_epoch = excluded.sync_epoch, updated_at = excluded.updated_at`,
      values: [
        workspaceId,
        profileId,
        localRoot,
        workspace.capabilities.includes('content.update') ? 'read-write' : 'read-only',
        session.syncEpoch,
        now,
      ],
    },
  ])
  await ensureManagedWorkspaceKey(profileId, workspaceId, workspace.latestKeyVersion)
  await cacheLibraryName(workspace)
  await refreshCachedWorkspaceNames()
  const store = await Store.load('store.json')
  const deferred = await store.get<string[]>('selfHostedDeferredWorkspacePaths') ?? []
  if (deferred.includes(localRoot)) {
    await store.set('selfHostedDeferredWorkspacePaths', deferred.filter(path => path !== localRoot))
    await store.save()
  }
  if (scanLocal && workspace.capabilities.includes('content.create')) {
    for (const entry of await scanPortableEntries(localRoot, workspaceId)) {
      if (entry.kind === 'folder') await enqueueFolderSnapshot(entry.relativePath, 'upsert', workspaceId, 'import')
      else if (entry.kind === 'markdown') await enqueueFileSnapshot(entry.relativePath, 'upsert', workspaceId, 'import')
      else await enqueueAssetSnapshot(entry.relativePath, 'upsert', workspaceId, 'import')
    }
  }
  console.info('[self-hosted-sync] workspace.bind-completed', { profileId, workspaceId, localRoot })
}

export async function unbindLibrary(workspaceId: string) {
  const database = await getDb()
  await database.execute(
    `update self_hosted_workspace_bindings
     set binding_state = 'unbound', local_root = null, updated_at = $1 where workspace_id = $2`,
    [Date.now(), workspaceId]
  )
  await refreshCachedWorkspaceNames()
}

export async function markLibraryRemoteDeleted(workspaceId: string) {
  const database = await getDb()
  await database.execute(
    `update self_hosted_workspace_bindings
     set binding_state = 'remote-deleted', access_mode = 'read-only', updated_at = $1
     where workspace_id = $2`,
    [Date.now(), workspaceId]
  )
}

export async function reconcileLibraryFiles(
  workspaceId: string,
  localRoot: string,
  writable = true,
  onProgress?: (progress: { path: string; current: number; total: number }) => void,
) {
  return withSelfHostedPrepareLock(workspaceId, () => reconcileLibraryFilesRaw(workspaceId, localRoot, writable, onProgress))
}

async function reconcileLibraryFilesRaw(
  workspaceId: string,
  localRoot: string,
  writable: boolean,
  onProgress?: (progress: { path: string; current: number; total: number }) => void,
) {
  onProgress?.({ path: localRoot, current: 0, total: 0 })
  const database = await getDb()
  const location = await getWorkspacePath()
  const currentRoot = location.isCustom ? location.path : await getDefaultArticleAbsolutePath('')
  const pendingMoves = normalizeLocalRoot(localRoot) === normalizeLocalRoot(currentRoot)
    && await (await Store.load('store.json')).get<string>('primaryBackupMethod') === 'selfHosted'
    ? await (await import('@/lib/sync/workspace-path-moves')).getPendingWorkspacePathMoves()
    : []
  const entries = await scanPortableEntries(localRoot, workspaceId)
  onProgress?.({ path: localRoot, current: 0, total: entries.length })
  const mapped = await database.select<Array<{ relativePath: string; contentHash: string | null; kind: string }>>(
    `select relative_path as relativePath, content_hash as contentHash, kind
     from self_hosted_object_mappings
     where workspace_id = $1 and relative_path is not null and deleted_at is null`,
    [workspaceId]
  )
  const mappedByPath = new Map(mapped.map(item => [item.relativePath, item]))
  const localPaths = new Set(entries.map(entry => entry.relativePath))
  for (const [index, entry] of entries.entries()) {
    const absolutePath = await join(localRoot, entry.relativePath)
    onProgress?.({ path: absolutePath, current: index, total: entries.length })
    // A pending remote rename already owns these identities. In particular,
    // do not infer A→C by hash while an offline A→B→C journal is replaying.
    if (pendingMoves.some(move => [move.source, move.target].some(root => (
      entry.relativePath === root || entry.relativePath.startsWith(`${root}/`)
      || (entry.kind === 'folder' && root.startsWith(`${entry.relativePath}/`))
    )))) continue
    let content: string | null
    let hash: string | null
    try {
      content = entry.kind === 'markdown' ? await readTextFile(absolutePath) : null
      hash = entry.kind === 'folder' ? null : entry.kind === 'markdown'
        ? await invoke<string>('self_hosted_sha256', { value: content! })
        : await hashFileBytes(await readFile(absolutePath))
    } catch (error) {
      if (isMissingPathError(error)) {
        console.info('[Self-hosted sync] Skipped library entry removed during reconciliation', {
          workspaceId, relativePath: entry.relativePath,
        })
        localPaths.delete(entry.relativePath)
      } else {
        // Keep the path in localPaths: an unreadable file still exists and must
        // never be used as evidence of a deletion or inferred rename.
        if (writable) {
          const domain = entry.kind === 'markdown' ? 'file' : 'asset'
          if (domain === 'file') await enqueueFileSnapshot(entry.relativePath, 'upsert', workspaceId)
          else await enqueueAssetSnapshot(entry.relativePath, 'upsert', workspaceId)
          await database.execute(
            `update self_hosted_local_changes set last_error_code = $1, updated_at = $2
             where workspace_id = $3 and domain = $4 and local_key = $5 and state = 'pending'`,
            [String(error instanceof Error ? error.message : error).slice(0, 120), Date.now(), workspaceId, domain, entry.relativePath],
          )
        } else await recordViewerConflict(workspaceId, entry.relativePath, null)
        console.warn('[self-hosted-sync] Library entry could not be read; continuing other files', {
          workspaceId, relativePath: entry.relativePath, error,
        })
      }
      continue
    }
    const expectedKind = entry.kind === 'markdown' ? 'note' : entry.kind === 'folder' ? 'folder' : 'asset'
    let current = mappedByPath.get(entry.relativePath)
    let identityMoved = false
    if (!current && hash && entry.kind !== 'folder') {
      const moved = [...mappedByPath.entries()].filter(([oldPath, candidate]) => (
        !localPaths.has(oldPath) && candidate.kind === expectedKind && candidate.contentHash === hash
      ))
      if (moved.length === 1) {
        const [oldPath, candidate] = moved[0]!
        const portable = await invoke<{ normalized: string; caseFolded: string }>(
          'self_hosted_portable_path', { relativePath: entry.relativePath },
        )
        const domain = expectedKind === 'note' ? 'file' : 'asset'
        await database.execute(
          `update self_hosted_object_mappings set local_identity = $1, relative_path = $2,
             path_casefold = $3, updated_at = $4 where workspace_id = $5 and relative_path = $6`,
          [
            `${domain}:${portable.normalized}`, portable.normalized, portable.caseFolded,
            Date.now(), workspaceId, oldPath,
          ]
        )
        mappedByPath.delete(oldPath)
        current = candidate
        identityMoved = true
      }
    }
    // Folders have no content digest. Older switch baselines stored an empty
    // string instead of null, which must not create a new upsert every round.
    if (!current || current.kind !== expectedKind || (entry.kind !== 'folder' && current.contentHash !== hash) || identityMoved) {
      if (writable) {
        if (entry.kind === 'folder') await enqueueFolderSnapshot(entry.relativePath, 'upsert', workspaceId)
        else if (entry.kind === 'markdown') await enqueueFileSnapshot(entry.relativePath, 'upsert', workspaceId)
        else await enqueueAssetSnapshot(entry.relativePath, 'upsert', workspaceId)
      } else await recordViewerConflict(workspaceId, entry.relativePath, content)
    }
    mappedByPath.delete(entry.relativePath)
  }
  onProgress?.({ path: localRoot, current: entries.length, total: entries.length })
  // A missing local path is not evidence of a user deletion. Another device
  // may not have hydrated the remote tree yet, or the workspace may have been
  // temporarily unavailable while scanning. Deletions are journaled by the
  // explicit file-manager operation instead of being inferred here.
}

async function recordViewerConflict(workspaceId: string, relativePath: string, localSnapshot: string | null) {
  const database = await getDb()
  const existing = await database.select<Array<{ id: string }>>(
    `select id from self_hosted_conflicts where workspace_id = $1
       and conflict_type = 'viewer-local-edit' and local_copy_path = $2 and state = 'unresolved' limit 1`,
    [workspaceId, relativePath]
  )
  if (existing.length > 0) return
  await database.execute(
    `insert into self_hosted_conflicts(
       id, workspace_id, conflict_type, local_snapshot, local_copy_path, state, created_at
     ) values ($1, $2, 'viewer-local-edit', $3, $4, 'unresolved', $5)`,
    [crypto.randomUUID(), workspaceId, localSnapshot, relativePath, Date.now()]
  )
}

export async function connectedProfileId() {
  const database = await getDb()
  const rows = await database.select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' order by updated_at desc limit 1"
  )
  return rows[0]?.id ?? null
}

export async function ensureManagedWorkspaceKey(profileId: string, workspaceId: string, keyVersion: number) {
  const managedKey = await loadManagedWorkspaceKey(profileId, workspaceId, keyVersion)
  const secureStorageKey = workspaceSecretKey(workspaceId, keyVersion)
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_workspace_keys(workspace_id, key_version, secure_storage_key, created_at)
     values ($1, $2, $3, $4)
     on conflict(workspace_id, key_version) do update set secure_storage_key = excluded.secure_storage_key`,
    [workspaceId, keyVersion, secureStorageKey, Date.now()]
  )
  return managedKey
}

async function loadManagedWorkspaceKey(profileId: string, workspaceId: string, keyVersion: number) {
  const secureStorageKey = workspaceSecretKey(workspaceId, keyVersion)
  const existing = await secureGet(secureStorageKey)
  if (existing) return existing
  const { client } = await authenticatedClient(profileId)
  const keys = await client.workspaceKeys(workspaceId)
  const managedKey = keys.find(item => item.keyVersion === keyVersion)?.envelopes
    .find(envelope => envelope.type === 'managed')?.wrappedKey
  if (!managedKey) throw new Error('该工作区没有可用的 managed key')
  await secureSet(secureStorageKey, managedKey)
  return managedKey
}

export async function ensureManagedWorkspaceKeys(
  profileId: string,
  workspaceId: string,
  keyVersions: number[],
) {
  for (const keyVersion of keyVersions) {
    await ensureManagedWorkspaceKey(profileId, workspaceId, keyVersion)
  }
}

async function scanPortableEntries(root: string, workspaceId: string) {
  const result: Array<{ relativePath: string; kind: 'folder' | 'markdown' | 'asset' }> = []
  const caseFoldedPaths = new Map<string, string>()
  async function visit(absolute: string, prefix: string) {
    let entries: Awaited<ReturnType<typeof readDir>>
    try {
      entries = await readDir(absolute)
    } catch (error) {
      if (prefix && isMissingPathError(error)) return
      throw error
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymlink) {
        await recordIgnoredSymlink(workspaceId, relative)
        continue
      }
      if (entry.name === '.notegen' || entry.name === '.DS_Store' || entry.name.endsWith('.tmp')) continue
      if (entry.isDirectory) {
        const portable = await portablePath(relative, caseFoldedPaths)
        result.push({ relativePath: portable, kind: 'folder' })
        await visit(await join(absolute, entry.name), relative)
      } else if (entry.isFile) {
        const portable = await portablePath(relative, caseFoldedPaths)
        result.push({
          relativePath: portable,
          kind: portable.toLowerCase().endsWith('.md') ? 'markdown' : 'asset',
        })
      }
    }
  }
  await visit(root, '')
  return result
}

function isMissingPathError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('(os error 2)')
}

async function recordIgnoredSymlink(workspaceId: string, relativePath: string) {
  const database = await getDb()
  const existing = await database.select<Array<{ id: string }>>(
    `select id from self_hosted_conflicts where workspace_id = $1
       and conflict_type = 'symlink-ignored' and local_copy_path = $2 and state = 'unresolved' limit 1`,
    [workspaceId, relativePath]
  )
  if (existing.length > 0) return
  await database.execute(
    `insert into self_hosted_conflicts(
       id, workspace_id, conflict_type, local_copy_path, state, created_at
     ) values ($1, $2, 'symlink-ignored', $3, 'unresolved', $4)`,
    [crypto.randomUUID(), workspaceId, relativePath, Date.now()]
  )
}

async function portablePath(relativePath: string, seen: Map<string, string>) {
  const portable = await invoke<{ normalized: string; caseFolded: string }>(
    'self_hosted_portable_path', { relativePath },
  )
  const duplicate = seen.get(portable.caseFolded)
  if (duplicate && duplicate !== portable.normalized) {
    throw new Error(`同一目录存在跨平台重名路径：${duplicate} / ${portable.normalized}`)
  }
  seen.set(portable.caseFolded, portable.normalized)
  return portable.normalized
}

async function hashFileBytes(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))
  return bytesToBase64Url(digest)
}
