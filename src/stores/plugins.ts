import { getPluginDisplayLocations, pluginDisplayKey, type PluginDisplayLocation } from '@/lib/plugins/display-preferences'
import { getPluginRevocation } from '@/lib/plugins/internal-types'
import { emit, listen } from '@tauri-apps/api/event'
import { isPluginError, PluginError } from '@notegen/plugin-api'
import { create } from 'zustand'
import { getWorkspacePath } from '@/lib/workspace'
import {
  confirmPluginPackageActivation,
  commitPluginHostState,
  fetchPluginMarketCatalog,
  importDevelopmentPlugin,
  installPluginFromMarket,
  listInstalledPluginPackages,
  readPluginHostState,
  rollbackPluginPackage,
  uninstallPluginPackage,
} from '@/lib/plugins/backend'
import { getPluginSourceIdentity, isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import type {
  InstalledPlugin,
  PluginEnablement,
  PluginErrorCode,
  PluginFailureRecord,
  PluginLogEntry,
  PluginMarketCatalog,
  PluginPermissionGrant,
  PluginPermissionName,
  PluginRuntimeState,
  PluginSettingValue,
  PluginStatusBarState,
  PluginWorkspaceBinding,
  PluginWorkspaceState,
} from '@/lib/plugins/types'
import { getPluginManifestFingerprint } from '@/lib/plugins/types'
import useSettingStore from '@/stores/setting'

const MAX_LOG_ENTRIES = 300
const PLUGIN_STATE_CHANGED_EVENT = 'notegen://plugin-state-changed'
const STATE_SYNC_POLL_INTERVAL_MS = 2_000
const STATE_SYNC_RETRY_INTERVAL_MS = 5_000

interface PluginStateChangedPayload {
  sourceId: string
  packagesChanged: boolean
  state: PersistedPluginsStateV1
}

interface PendingPluginUpdate {
  version: string
  previousVersion: string
  installedAt: string
}

interface PersistedPluginsStateV1 {
  schemaVersion: 1
  revision: number
  packageRevision: number
  workspaceIds: Record<string, string>
  workspaces: Record<string, Record<string, PluginWorkspaceState>>
  deviceSettings: Record<string, Record<string, PluginSettingValue>>
  failures: Record<string, PluginFailureRecord>
  developerSources: Record<string, string>
  pendingUpdates: Record<string, PendingPluginUpdate>
  allWorkspacePlugins: Record<string, boolean>
}

interface PluginStoreState {
  initialized: boolean
  initializing: boolean
  currentWorkspaceId: string | null
  currentWorkspaceKey: string | null
  installed: InstalledPlugin[]
  workspaceStates: Record<string, Record<string, PluginWorkspaceState>>
  deviceSettings: Record<string, Record<string, PluginSettingValue>>
  runtimeStates: Record<string, PluginRuntimeState>
  statusBar: Record<string, PluginStatusBarState>
  failures: Record<string, PluginFailureRecord>
  logs: PluginLogEntry[]
  catalog: PluginMarketCatalog | null
  marketLoading: boolean
  marketError: string | null
  operationPluginId: string | null

  initialize: () => Promise<void>
  refreshWorkspace: () => Promise<void>
  refreshInstalled: () => Promise<void>
  refreshMarket: (force?: boolean) => Promise<void>
  setEnablement: (pluginId: string, enablement: PluginEnablement) => Promise<void>
  setPermissionGrant: (
    pluginId: string,
    permission: PluginPermissionName,
    grant: Omit<PluginPermissionGrant, 'permission' | 'manifestFingerprint'>,
  ) => Promise<void>
  setPermissionGrants: (
    pluginId: string,
    updates: ReadonlyArray<{
      permission: PluginPermissionName
      grant: Omit<PluginPermissionGrant, 'permission' | 'manifestFingerprint'>
    }>,
  ) => Promise<void>
  revokePermission: (pluginId: string, permission: PluginPermissionName) => Promise<void>
  setDisplayVisibility: (pluginId: string, location: PluginDisplayLocation, visible: boolean) => Promise<void>
  setSetting: (pluginId: string, key: string, value: PluginSettingValue) => Promise<void>
  installFromMarket: (pluginId: string, version?: string) => Promise<void>
  importDevelopment: (path: string, expectedPluginId?: string) => Promise<string>
  uninstall: (pluginId: string, removeData?: boolean) => Promise<void>
  rollback: (pluginId: string) => Promise<void>
  hasPendingUpdate: (pluginId: string, version: string) => boolean
  confirmPendingUpdate: (pluginId: string, version: string) => Promise<void>
  setRuntimeState: (pluginId: string, state: PluginRuntimeState) => void
  setStatusBarState: (pluginId: string, itemId: string, state: PluginStatusBarState) => void
  clearStatusBar: (pluginId: string) => void
  recordFailure: (pluginId: string, code: PluginErrorCode, message: string) => Promise<void>
  clearFailure: (pluginId: string) => Promise<void>
  addLog: (entry: Omit<PluginLogEntry, 'id' | 'createdAt'>) => void
  clearLogs: (pluginId?: string) => void
  getWorkspaceState: (pluginId: string) => PluginWorkspaceState | undefined
  getSetting: (pluginId: string, key: string) => PluginSettingValue | undefined
  isEnabled: (pluginId: string) => boolean
  isRequestedInAllWorkspaces: (pluginId: string) => boolean
}

function newPersistedState(): PersistedPluginsStateV1 {
  return {
    schemaVersion: 1,
    revision: 0,
    packageRevision: 0,
    workspaceIds: {},
    workspaces: {},
    deviceSettings: {},
    failures: {},
    developerSources: {},
    pendingUpdates: {},
    allWorkspacePlugins: {},
  }
}

function clonePersistedState(state: PersistedPluginsStateV1): PersistedPluginsStateV1 {
  return {
    schemaVersion: 1,
    revision: state.revision,
    packageRevision: state.packageRevision,
    workspaceIds: { ...state.workspaceIds },
    workspaces: Object.fromEntries(
      Object.entries(state.workspaces).map(([workspaceId, workspace]) => [
        workspaceId,
        Object.fromEntries(
          Object.entries(workspace).map(([pluginId, pluginState]) => [
            pluginId,
            {
              enablement: pluginState.enablement,
              enabledFingerprint: pluginState.enabledFingerprint,
              permissions: Object.fromEntries(
                Object.entries(pluginState.permissions).map(([permission, grant]) => [
                  permission,
                  grant ? { ...grant, paths: grant.paths ? [...grant.paths] : undefined } : grant,
                ]),
              ),
              settings: { ...pluginState.settings },
            },
          ]),
        ),
      ]),
    ),
    deviceSettings: Object.fromEntries(
      Object.entries(state.deviceSettings).map(([pluginId, settings]) => [pluginId, { ...settings }]),
    ),
    failures: Object.fromEntries(
      Object.entries(state.failures).map(([pluginId, failure]) => [pluginId, { ...failure }]),
    ),
    developerSources: { ...state.developerSources },
    pendingUpdates: Object.fromEntries(
      Object.entries(state.pendingUpdates).map(([pluginId, update]) => [pluginId, { ...update }]),
    ),
    allWorkspacePlugins: { ...state.allWorkspacePlugins },
  }
}

let persistedState = newPersistedState()
let initPromise: Promise<void> | null = null
let persistQueue: Promise<void> = Promise.resolve()
let stateSyncPollInFlight = false
let packageOperationEpoch = 0
let stateSyncStarted = false
let stateSyncPromise: Promise<void> | null = null
let stateSyncPollTimer: ReturnType<typeof setInterval> | null = null
let stateSyncRetryTimer: ReturnType<typeof setTimeout> | null = null
let stateSyncFailureLogged = false
let stateSyncPollFailureLogged = false
let packageSyncFailureLogged = false
let stateBroadcastFailureLogged = false
const stateSourceId = createOpaqueId()

async function readPersistedPluginState(): Promise<PersistedPluginsStateV1> {
  const stored = await readPluginHostState()
  if (stored === null || stored === undefined) return newPersistedState()
  if (!isPersistedState(stored)) {
    throw new PluginError('RuntimeFailure', 'The shared plugin state is invalid')
  }
  ensurePersistedStateDefaults(stored)
  return stored
}

function isStandaloneEditorWindow(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/editor-window')
}

function createOpaqueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function normalizeWorkspaceKey(path: string, isCustom: boolean): string {
  if (!isCustom) return '@notegen-default-workspace'
  const slashNormalized = path.trim().replace(/\\/g, '/')
  const normalized = slashNormalized === '/'
    || /^[A-Za-z]:\/$/.test(slashNormalized)
    ? slashNormalized
    : slashNormalized.replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function permissionChangesRequireReview(
  previous: InstalledPlugin,
  next: InstalledPlugin,
): boolean {
  return Object.entries(next.manifest.permissions).some(([permission, declaration]) => {
    const previousDeclaration = previous.manifest.permissions[permission as PluginPermissionName]
    if (!previousDeclaration) return true
    return previousDeclaration.scope !== declaration.scope
      || (previousDeclaration.optional === true && declaration.optional !== true)
  })
}

function migratePermissionGrants(
  state: PersistedPluginsStateV1,
  previous: InstalledPlugin,
  next: InstalledPlugin,
): void {
  const previousFingerprint = getPluginManifestFingerprint(previous)
  const nextFingerprint = getPluginManifestFingerprint(next)
  for (const workspace of Object.values(state.workspaces)) {
    const pluginState = workspace[previous.manifest.id]
    if (!pluginState) continue
    if (pluginState.enabledFingerprint === previousFingerprint) {
      pluginState.enabledFingerprint = nextFingerprint
    }
    for (const permission of Object.keys(pluginState.permissions) as PluginPermissionName[]) {
      if (!next.manifest.permissions[permission]) {
        delete pluginState.permissions[permission]
        continue
      }
      const grant = pluginState.permissions[permission]
      if (grant?.manifestFingerprint === previousFingerprint) {
        grant.manifestFingerprint = nextFingerprint
      }
    }
  }
}

function preserveSafePermissionGrants(
  state: PersistedPluginsStateV1,
  previous: InstalledPlugin | undefined,
  next: InstalledPlugin,
): void {
  if (!previous) return
  const previousSourceIdentity = getPluginSourceIdentity(previous)
  const nextSourceIdentity = getPluginSourceIdentity(next)
  const sameSourceIdentity = previousSourceIdentity !== null
    && previousSourceIdentity === nextSourceIdentity
  if (sameSourceIdentity && !permissionChangesRequireReview(previous, next)) {
    migratePermissionGrants(state, previous, next)
  }
}

function mergeInstalled(packages: InstalledPlugin[]): InstalledPlugin[] {
  const byId = new Map<string, InstalledPlugin>()
  for (const plugin of packages) byId.set(plugin.manifest.id, plugin)
  return [...byId.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
}

function installedPackagesEqual(left: InstalledPlugin[], right: InstalledPlugin[]): boolean {
  return left.length === right.length && left.every((plugin, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && getPluginManifestFingerprint(plugin) === getPluginManifestFingerprint(candidate)
      && plugin.pendingActivation === candidate.pendingActivation
      && plugin.previousVersion === candidate.previousVersion
      && plugin.installedAt === candidate.installedAt
      && plugin.verified === candidate.verified
  })
}

function beginPackageOperation(pluginId: string): void {
  if (usePluginStore.getState().operationPluginId) {
    throw new PluginError('Conflict', 'Another plugin package operation is in progress')
  }
  packageOperationEpoch += 1
  usePluginStore.setState({ operationPluginId: pluginId })
}

function committedPackageError(plugin: InstalledPlugin, error: unknown): PluginError {
  // Native package changes cannot be undone by a failed host-settings save.
  // Publish their actual identity immediately; stale grants cannot enable it.
  usePluginStore.setState((current) => ({
    installed: mergeInstalled([
      ...current.installed.filter((item) => item.manifest.id !== plugin.manifest.id),
      plugin,
    ]),
  }))
  return new PluginError(
    isPluginError(error) ? error.code : 'RuntimeFailure',
    `The plugin package changed, but its settings could not be saved. Refresh installed plugins and review its permissions: ${safeErrorMessage(error)}`,
    { committed: true, pluginId: plugin.manifest.id, version: plugin.activeVersion },
  )
}

function getDefaultPluginSettings(plugin: InstalledPlugin): Record<string, PluginSettingValue> {
  return Object.fromEntries(
    (plugin.manifest.contributes.settings ?? []).map((setting) => [setting.key, setting.default]),
  )
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRecordWithValues(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is Record<string, unknown> {
  return isRecordValue(value) && Object.values(value).every(predicate)
}

function isWorkspaceStateValue(value: unknown): boolean {
  if (!isRecordValue(value)) return false
  return ['disabled', 'workspace', 'all-workspaces'].includes(String(value.enablement))
    && (value.enabledFingerprint === undefined || typeof value.enabledFingerprint === 'string')
    && isRecordValue(value.permissions)
    && isRecordValue(value.settings)
}

function isPendingUpdateValue(value: unknown): boolean {
  return isRecordValue(value)
    && typeof value.version === 'string'
    && typeof value.previousVersion === 'string'
    && typeof value.installedAt === 'string'
}

function ensurePersistedStateDefaults(state: PersistedPluginsStateV1): void {
  state.revision ??= 0
  state.packageRevision ??= 0
  state.developerSources ??= {}
  state.pendingUpdates ??= {}
  if (!state.allWorkspacePlugins) {
    state.allWorkspacePlugins = {}
    for (const workspaceState of Object.values(state.workspaces)) {
      for (const [pluginId, pluginState] of Object.entries(workspaceState)) {
        if (pluginState.enablement === 'all-workspaces') {
          state.allWorkspacePlugins[pluginId] = true
        }
      }
    }
  }
}

function isPersistedState(value: unknown): value is PersistedPluginsStateV1 {
  if (!isRecordValue(value)) return false
  const candidate = value as Partial<PersistedPluginsStateV1>
  return candidate.schemaVersion === 1
    && (candidate.revision === undefined || (
      typeof candidate.revision === 'number'
      && Number.isSafeInteger(candidate.revision)
      && candidate.revision >= 0
    ))
    && (candidate.packageRevision === undefined || (
      typeof candidate.packageRevision === 'number'
      && Number.isSafeInteger(candidate.packageRevision)
      && candidate.packageRevision >= 0
    ))
    && isRecordWithValues(candidate.workspaceIds, (entry) => typeof entry === 'string')
    && isRecordWithValues(candidate.workspaces, (workspace) => (
      isRecordWithValues(workspace, isWorkspaceStateValue)
    ))
    && isRecordWithValues(candidate.deviceSettings, isRecordValue)
    && isRecordWithValues(candidate.failures, isRecordValue)
    && (candidate.developerSources === undefined || isRecordWithValues(
      candidate.developerSources,
      (entry) => typeof entry === 'string',
    ))
    && (candidate.pendingUpdates === undefined || isRecordWithValues(
      candidate.pendingUpdates,
      isPendingUpdateValue,
    ))
    && (candidate.allWorkspacePlugins === undefined || isRecordWithValues(
      candidate.allWorkspacePlugins,
      (entry) => typeof entry === 'boolean',
    ))
}

async function broadcastPersistedState(packagesChanged: boolean): Promise<void> {
  if (isStandaloneEditorWindow()) return
  try {
    await emit<PluginStateChangedPayload>(PLUGIN_STATE_CHANGED_EVENT, {
      sourceId: stateSourceId,
      packagesChanged,
      state: persistedState,
    })
    stateBroadcastFailureLogged = false
  } catch (error) {
    if (!stateBroadcastFailureLogged) {
      stateBroadcastFailureLogged = true
      usePluginStore.getState().addLog({
        pluginId: 'app.notegen.plugin-host',
        level: 'warning',
        message: `Could not broadcast plugin state; polling will retry synchronization: ${safeErrorMessage(error)}`,
      })
    }
  }
}

async function commitPersistedStateMutation(
  mutate: (candidate: PersistedPluginsStateV1) => void,
  publish: (committed: PersistedPluginsStateV1) => void,
  packagesChanged = false,
): Promise<void> {
  const operation = persistQueue
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const authoritative = await readPersistedPluginState()
        const candidate = clonePersistedState(authoritative)
        mutate(candidate)
        candidate.revision = authoritative.revision + 1
        candidate.packageRevision = authoritative.packageRevision + (packagesChanged ? 1 : 0)

        try {
          // The native lock makes the revision check and durable save one
          // operation shared by every window. On conflict, replay this scoped
          // mutation against the latest snapshot without losing other edits.
          await commitPluginHostState(authoritative.revision, candidate)
        } catch (error) {
          if (isPluginError(error) && error.code === 'Conflict' && attempt < 4) continue
          throw error
        }

        persistedState = candidate
        usePluginStore.setState({
          workspaceStates: { ...candidate.workspaces },
          deviceSettings: { ...candidate.deviceSettings },
          failures: { ...candidate.failures },
        })
        publish(candidate)
        await broadcastPersistedState(packagesChanged)
        return
      }
    })
  persistQueue = operation
  return operation
}

async function applySynchronizedState(
  candidate: PersistedPluginsStateV1,
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): Promise<void> {
  ensurePersistedStateDefaults(candidate)
  const stateChanged = candidate.revision > persistedState.revision

  if (stateChanged) {
    persistedState = candidate
    set({
      workspaceStates: { ...persistedState.workspaces },
      deviceSettings: { ...persistedState.deviceSettings },
      failures: { ...persistedState.failures },
    })
  }

  await synchronizeInstalledPackages(set, get)
}

async function synchronizeInstalledPackages(
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): Promise<void> {
  // Package state and host settings are separate durable commits. A crash or
  // failed CAS between them must not leave other windows on the old package
  // forever just because packageRevision did not advance.
  if (!get().initialized || get().operationPluginId) return
  const epoch = packageOperationEpoch
  try {
    const installed = mergeInstalled(await listInstalledPluginPackages())
    if (epoch !== packageOperationEpoch || get().operationPluginId) return
    if (!installedPackagesEqual(get().installed, installed)) set({ installed })
    packageSyncFailureLogged = false
  } catch (error) {
    if (!packageSyncFailureLogged) {
      packageSyncFailureLogged = true
      get().addLog({
        pluginId: 'app.notegen.plugin-host',
        level: 'warning',
        message: `Could not synchronize installed plugins: ${safeErrorMessage(error)}`,
      })
    }
  }
}

function queueSynchronizedState(
  candidate: PersistedPluginsStateV1,
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): Promise<void> {
  const operation = persistQueue
    .catch(() => undefined)
    .then(() => applySynchronizedState(candidate, set, get))
  persistQueue = operation
  return operation
}

async function pollPersistedState(
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): Promise<void> {
  if (stateSyncPollInFlight || !get().initialized) return
  stateSyncPollInFlight = true
  try {
    const stored = await readPersistedPluginState()
    await queueSynchronizedState(stored, set, get)
    stateSyncPollFailureLogged = false
  } catch (error) {
    // The package registry must remain observable even when host settings are
    // unreadable; otherwise a committed update can be hidden indefinitely.
    await synchronizeInstalledPackages(set, get)
    if (!stateSyncPollFailureLogged) {
      stateSyncPollFailureLogged = true
      get().addLog({
        pluginId: 'app.notegen.plugin-host',
        level: 'warning',
        message: `Could not poll shared plugin state: ${safeErrorMessage(error)}`,
      })
    }
  } finally {
    stateSyncPollInFlight = false
  }
}

function startPluginStatePolling(
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): void {
  if (stateSyncPollTimer || typeof window === 'undefined') return
  stateSyncPollTimer = setInterval(() => {
    void pollPersistedState(set, get)
  }, STATE_SYNC_POLL_INTERVAL_MS)
}

async function startPluginStateSync(
  set: (partial: Partial<PluginStoreState>) => void,
  get: () => PluginStoreState,
): Promise<void> {
  startPluginStatePolling(set, get)
  if (stateSyncStarted) return
  if (stateSyncPromise) return stateSyncPromise
  stateSyncPromise = listen<PluginStateChangedPayload>(PLUGIN_STATE_CHANGED_EVENT, (event) => {
    const payload = event.payload
    if (!payload || payload.sourceId === stateSourceId || !isPersistedState(payload.state)) return
    void queueSynchronizedState(payload.state, set, get)
  })
    .then(() => {
      stateSyncStarted = true
      stateSyncFailureLogged = false
      if (stateSyncRetryTimer) {
        clearTimeout(stateSyncRetryTimer)
        stateSyncRetryTimer = null
      }
    })
    .catch((error) => {
      stateSyncStarted = false
      if (!stateSyncFailureLogged) {
        stateSyncFailureLogged = true
        get().addLog({
          pluginId: 'app.notegen.plugin-host',
          level: 'warning',
          message: `Could not start plugin state events; polling remains active: ${safeErrorMessage(error)}`,
        })
      }
      if (!stateSyncRetryTimer) {
        stateSyncRetryTimer = setTimeout(() => {
          stateSyncRetryTimer = null
          void startPluginStateSync(set, get)
        }, STATE_SYNC_RETRY_INTERVAL_MS)
      }
    })
    .finally(() => {
      stateSyncPromise = null
    })
  return stateSyncPromise
}

export async function readAuthoritativePluginWorkspaceState(
  pluginId: string,
  binding: PluginWorkspaceBinding,
): Promise<PluginWorkspaceState | undefined> {
  const stored = await readPersistedPluginState()
  if (stored.workspaceIds[binding.workspaceKey] !== binding.workspaceId) {
    throw new Error('The shared plugin workspace binding has changed')
  }
  return stored.workspaces[binding.workspaceId]?.[pluginId]
}

function ensureWorkspacePluginStateIn(
  state: PersistedPluginsStateV1,
  workspaceId: string,
  plugin: InstalledPlugin,
): PluginWorkspaceState {
  const workspace = state.workspaces[workspaceId] ?? {}
  state.workspaces[workspaceId] = workspace
  const existing = workspace[plugin.manifest.id]
  if (existing) return existing

  const created: PluginWorkspaceState = {
    enablement: 'disabled',
    permissions: {},
    settings: getDefaultPluginSettings(plugin),
  }
  // An all-workspaces preference does not approve a package in a workspace
  // that the user has never reviewed, even when it declares no permissions.
  workspace[plugin.manifest.id] = created
  return created
}

function hasReviewedPluginPermissions(
  plugin: InstalledPlugin,
  pluginState: PluginWorkspaceState,
): boolean {
  const expectedFingerprint = getPluginManifestFingerprint(plugin)
  return Object.entries(plugin.manifest.permissions).every(([permission, declaration]) => {
    const grant = pluginState.permissions[permission as PluginPermissionName]
    return grant?.manifestFingerprint === expectedFingerprint
      && (declaration.optional || grant.granted)
  })
}

function disablePluginsThatNeedPermissionReview(
  state: PersistedPluginsStateV1,
  installed: InstalledPlugin[],
): void {
  const installedById = new Map(installed.map((plugin) => [plugin.manifest.id, plugin]))
  for (const workspace of Object.values(state.workspaces)) {
    for (const [pluginId, pluginState] of Object.entries(workspace)) {
      const plugin = installedById.get(pluginId)
      if (!plugin || pluginState.enablement === 'disabled') continue
      if (pluginState.enabledFingerprint !== getPluginManifestFingerprint(plugin)
        || !hasReviewedPluginPermissions(plugin, pluginState)) pluginState.enablement = 'disabled'
    }
  }
}

function migrateLegacyEnablementFingerprints(
  state: PersistedPluginsStateV1,
  installed: InstalledPlugin[],
): void {
  for (const plugin of installed) {
    // Old grants can prove a prior review, but an empty permission list cannot
    // prove which package was enabled. Those plugins require explicit enablement.
    if (Object.keys(plugin.manifest.permissions).length === 0) continue
    for (const workspace of Object.values(state.workspaces)) {
      const pluginState = workspace[plugin.manifest.id]
      if (pluginState && pluginState.enabledFingerprint === undefined
        && hasReviewedPluginPermissions(plugin, pluginState)) {
        pluginState.enabledFingerprint = getPluginManifestFingerprint(plugin)
      }
    }
  }
}

function reconcilePendingPluginUpdates(
  state: PersistedPluginsStateV1,
  installed: InstalledPlugin[],
): void {
  const pendingIds = new Set<string>()
  for (const plugin of installed) {
    if (!plugin.pendingActivation || !plugin.previousVersion) continue
    pendingIds.add(plugin.manifest.id)
    const pending = state.pendingUpdates[plugin.manifest.id]
    if (
      pending?.version === plugin.activeVersion
      && pending.previousVersion === plugin.previousVersion
    ) continue
    state.pendingUpdates[plugin.manifest.id] = {
      version: plugin.activeVersion,
      previousVersion: plugin.previousVersion,
      installedAt: plugin.installedAt,
    }
  }
  for (const pluginId of Object.keys(state.pendingUpdates)) {
    if (!pendingIds.has(pluginId)) delete state.pendingUpdates[pluginId]
  }
}

function validateSettingValue(
  plugin: InstalledPlugin,
  key: string,
  value: PluginSettingValue,
): void {
  const setting = plugin.manifest.contributes.settings?.find((item) => item.key === key)
  if (!setting) throw new Error(`Unknown plugin setting: ${key}`)

  if (setting.type === 'boolean' && typeof value !== 'boolean') throw new Error('Expected a boolean')
  if ((setting.type === 'string' || setting.type === 'workspace-file' || setting.type === 'workspace-folder')
    && typeof value !== 'string') throw new Error('Expected a string')
  if (
    setting.type === 'string'
    && typeof value === 'string'
    && setting.maxLength !== undefined
    && new TextEncoder().encode(value).byteLength > setting.maxLength
  ) {
    throw new Error(`Value exceeds the ${setting.maxLength}-byte limit`)
  }
  if (setting.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a number')
    if (setting.min !== undefined && value < setting.min) throw new Error('Value is below the minimum')
    if (setting.max !== undefined && value > setting.max) throw new Error('Value is above the maximum')
  }
  if (setting.type === 'select') {
    if (typeof value !== 'string' || !setting.options.some((option) => option.value === value)) {
      throw new Error('Unknown select value')
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  initialized: false,
  initializing: false,
  currentWorkspaceId: null,
  currentWorkspaceKey: null,
  installed: [],
  workspaceStates: {},
  deviceSettings: {},
  runtimeStates: {},
  statusBar: {},
  failures: {},
  logs: [],
  catalog: null,
  marketLoading: false,
  marketError: null,
  operationPluginId: null,

  initialize: async () => {
    if (get().initialized) return
    if (initPromise) return initPromise

    initPromise = (async () => {
      set({ initializing: true })
      try {
        await startPluginStateSync(set, get)
        persistedState = await readPersistedPluginState()
        const workspace = await getWorkspacePath()
        const workspaceKey = normalizeWorkspaceKey(workspace.path, workspace.isCustom)
        let workspaceId = persistedState.workspaceIds[workspaceKey] ?? createOpaqueId()

        // An unreadable registry is not an empty installation. Leave startup
        // retryable instead of persisting a fabricated empty package snapshot.
        const packages = await listInstalledPluginPackages()
        const installed = mergeInstalled(packages)
        const prepareWorkspaceState = (candidateState: PersistedPluginsStateV1) => {
          workspaceId = candidateState.workspaceIds[workspaceKey] ?? workspaceId
          candidateState.workspaceIds[workspaceKey] = workspaceId
          // Secondary windows must wait for a durable migration by the main
          // host, rather than activating against a locally fabricated receipt.
          if (!isStandaloneEditorWindow()) migrateLegacyEnablementFingerprints(candidateState, installed)
          reconcilePendingPluginUpdates(candidateState, installed)
          for (const plugin of installed) {
            ensureWorkspacePluginStateIn(candidateState, workspaceId, plugin)
          }
          disablePluginsThatNeedPermissionReview(candidateState, installed)
        }
        if (isStandaloneEditorWindow()) {
          prepareWorkspaceState(persistedState)
        } else {
          await commitPersistedStateMutation(prepareWorkspaceState, () => undefined)
        }
        set({
          initialized: true,
          currentWorkspaceId: workspaceId,
          currentWorkspaceKey: workspaceKey,
          installed,
          workspaceStates: { ...persistedState.workspaces },
          deviceSettings: { ...persistedState.deviceSettings },
          failures: { ...persistedState.failures },
        })
      } finally {
        set({ initializing: false })
        initPromise = null
      }
    })()
    return initPromise
  },

  refreshInstalled: async () => {
    beginPackageOperation('@installed-refresh')
    try {
      const installed = mergeInstalled(await listInstalledPluginPackages())
      // A settings error must not hide the authoritative installed packages.
      set({ installed })
      const workspaceId = get().currentWorkspaceId
      await commitPersistedStateMutation(
        (candidateState) => {
          reconcilePendingPluginUpdates(candidateState, installed)
          if (workspaceId) {
            for (const plugin of installed) {
              ensureWorkspacePluginStateIn(candidateState, workspaceId, plugin)
            }
          }
          disablePluginsThatNeedPermissionReview(candidateState, installed)
        },
        (committed) => set({
          installed,
          workspaceStates: { ...committed.workspaces },
        }),
        true,
      )
    } finally {
      set({ operationPluginId: null })
    }
  },

  refreshWorkspace: async () => {
    const workspace = await getWorkspacePath()
    const workspaceKey = normalizeWorkspaceKey(workspace.path, workspace.isCustom)
    let workspaceId = persistedState.workspaceIds[workspaceKey] ?? createOpaqueId()
    const installed = get().installed
    await commitPersistedStateMutation(
      (candidateState) => {
        workspaceId = candidateState.workspaceIds[workspaceKey] ?? workspaceId
        candidateState.workspaceIds[workspaceKey] = workspaceId
        for (const plugin of installed) {
          ensureWorkspacePluginStateIn(candidateState, workspaceId, plugin)
        }
      },
      (committed) => set({
        currentWorkspaceId: workspaceId,
        currentWorkspaceKey: workspaceKey,
        workspaceStates: { ...committed.workspaces },
      }),
    )
  },

  refreshMarket: async (force = false) => {
    set({ marketLoading: true, marketError: null })
    try {
      const catalog = await fetchPluginMarketCatalog({ force })
      set({ catalog })
    } catch (error) {
      set({ marketError: safeErrorMessage(error) })
    } finally {
      set({ marketLoading: false })
    }
  },

  setEnablement: async (pluginId, enablement) => {
    const workspaceId = get().currentWorkspaceId
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!workspaceId || !plugin) return
    const expectedFingerprint = getPluginManifestFingerprint(plugin)

    await commitPersistedStateMutation(
      (candidateState) => {
        const currentPlugin = get().installed.find((item) => item.manifest.id === pluginId)
        if (
          get().currentWorkspaceId !== workspaceId
          || !currentPlugin
          || getPluginManifestFingerprint(currentPlugin) !== expectedFingerprint
        ) {
          throw new Error('The plugin or workspace changed before enablement could be saved')
        }

        const currentPluginState = ensureWorkspacePluginStateIn(
          candidateState,
          workspaceId,
          currentPlugin,
        )
        if (
          enablement !== 'disabled'
          && !hasReviewedPluginPermissions(currentPlugin, currentPluginState)
        ) {
          throw new Error('Review the plugin permissions before enabling it')
        }

        if (enablement === 'all-workspaces') {
          candidateState.allWorkspacePlugins[pluginId] = true
          currentPluginState.enabledFingerprint = expectedFingerprint
          for (const candidateWorkspaceId of Object.keys(candidateState.workspaces)) {
            const candidate = ensureWorkspacePluginStateIn(
              candidateState,
              candidateWorkspaceId,
              currentPlugin,
            )
            candidate.enablement = candidate.enabledFingerprint === expectedFingerprint
              && hasReviewedPluginPermissions(currentPlugin, candidate)
              ? 'all-workspaces'
              : 'disabled'
          }
          return
        }

        if (candidateState.allWorkspacePlugins[pluginId]) {
          delete candidateState.allWorkspacePlugins[pluginId]
          for (const workspace of Object.values(candidateState.workspaces)) {
            const candidate = workspace[pluginId]
            if (candidate?.enablement === 'all-workspaces') candidate.enablement = 'disabled'
          }
        }
        currentPluginState.enablement = enablement
        if (enablement !== 'disabled') currentPluginState.enabledFingerprint = expectedFingerprint
      },
      (committed) => set({ workspaceStates: { ...committed.workspaces } }),
    )
  },

  setPermissionGrant: async (pluginId, permission, grant) => {
    await get().setPermissionGrants(pluginId, [{ permission, grant }])
  },

  setPermissionGrants: async (pluginId, updates) => {
    if (updates.length === 0) return
    const workspaceId = get().currentWorkspaceId
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!workspaceId || !plugin) return

    const copiedUpdates = updates.map(({ permission, grant }) => ({
      permission,
      grant: {
        ...grant,
        paths: grant.paths ? [...grant.paths] : undefined,
      },
    }))
    const uniquePermissions = new Set<PluginPermissionName>()
    for (const { permission } of copiedUpdates) {
      if (uniquePermissions.has(permission)) {
        throw new Error(`Permission was supplied more than once: ${permission}`)
      }
      uniquePermissions.add(permission)
      if (!plugin.manifest.permissions[permission]) {
        throw new Error(`Permission is not declared: ${permission}`)
      }
    }
    const expectedFingerprint = getPluginManifestFingerprint(plugin)

    await commitPersistedStateMutation(
      (candidateState) => {
        const currentPlugin = get().installed.find((item) => item.manifest.id === pluginId)
        if (
          get().currentWorkspaceId !== workspaceId
          || !currentPlugin
          || getPluginManifestFingerprint(currentPlugin) !== expectedFingerprint
        ) {
          throw new Error('The plugin or workspace changed before permissions could be saved')
        }

        const pluginState = ensureWorkspacePluginStateIn(
          candidateState,
          workspaceId,
          currentPlugin,
        )
        for (const { permission, grant } of copiedUpdates) {
          const declaration = currentPlugin.manifest.permissions[permission]
          if (!declaration) throw new Error(`Permission is not declared: ${permission}`)
          pluginState.permissions[permission] = {
            ...grant,
            permission,
            paths: grant.paths?.map((path) => {
              if (declaration.scope === 'network-origins') {
                try { return new URL(path).origin.toLowerCase() } catch { return path.trim().toLowerCase() }
              }
              const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
              return normalized === '.' ? '' : normalized
            }),
            manifestFingerprint: expectedFingerprint,
          }
          if (!grant.granted && !declaration.optional) pluginState.enablement = 'disabled'
        }
      },
      (committed) => set({ workspaceStates: { ...committed.workspaces } }),
    )
  },

  revokePermission: async (pluginId, permission) => {
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!get().currentWorkspaceId || !plugin?.manifest.permissions[permission]) return
    await get().setPermissionGrants(pluginId, [{ permission, grant: { granted: false } }])
  },

  setDisplayVisibility: async (pluginId, location, visible) => {
    const plugin = get().installed.find(item => item.manifest.id === pluginId)
    if (!plugin) throw new Error('Plugin is no longer installed')
    const fingerprint = getPluginManifestFingerprint(plugin)
    await commitPersistedStateMutation(candidate => {
      const current = get().installed.find(item => item.manifest.id === pluginId)
      if (!current || getPluginManifestFingerprint(current) !== fingerprint
        || !getPluginDisplayLocations(current).includes(location)) {
        throw new Error('The plugin changed before its display preference could be saved')
      }
      candidate.deviceSettings[pluginId] ??= {}
      candidate.deviceSettings[pluginId][pluginDisplayKey(location)] = visible
    }, committed => set({ deviceSettings: { ...committed.deviceSettings } }))
  },

  setSetting: async (pluginId, key, value) => {
    const workspaceId = get().currentWorkspaceId
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!workspaceId || !plugin) return
    validateSettingValue(plugin, key, value)
    const expectedFingerprint = getPluginManifestFingerprint(plugin)

    await commitPersistedStateMutation(
      (candidateState) => {
        const currentPlugin = get().installed.find((item) => item.manifest.id === pluginId)
        if (
          get().currentWorkspaceId !== workspaceId
          || !currentPlugin
          || getPluginManifestFingerprint(currentPlugin) !== expectedFingerprint
        ) {
          throw new Error('The plugin or workspace changed before the setting could be saved')
        }
        validateSettingValue(currentPlugin, key, value)
        const setting = currentPlugin.manifest.contributes.settings?.find((item) => item.key === key)
        if (!setting) throw new Error(`Unknown plugin setting: ${key}`)

        const pluginState = ensureWorkspacePluginStateIn(
          candidateState,
          workspaceId,
          currentPlugin,
        )
        if (setting.scope === 'device') {
          candidateState.deviceSettings[pluginId] ??= {}
          candidateState.deviceSettings[pluginId][key] = value
        } else {
          pluginState.settings[key] = value
        }
      },
      (committed) => set({
        workspaceStates: { ...committed.workspaces },
        deviceSettings: { ...committed.deviceSettings },
      }),
    )
  },

  installFromMarket: async (pluginId, version) => {
    beginPackageOperation(pluginId)
    let committedPlugin: InstalledPlugin | undefined
    try {
      const previous = get().installed.find((item) => item.manifest.id === pluginId)
      const result = await installPluginFromMarket(pluginId, version)
      committedPlugin = result.plugin
      const installed = mergeInstalled([
        ...get().installed.filter((item) => item.manifest.id !== pluginId),
        result.plugin,
      ])
      const workspaceId = get().currentWorkspaceId
      const installedAt = new Date().toISOString()
      await commitPersistedStateMutation(
        (candidateState) => {
          preserveSafePermissionGrants(candidateState, previous, result.plugin)
          if (result.replacedVersion) {
            candidateState.pendingUpdates[pluginId] = {
              version: result.plugin.activeVersion,
              previousVersion: result.replacedVersion,
              installedAt,
            }
          }
          reconcilePendingPluginUpdates(candidateState, installed)
          if (workspaceId) {
            ensureWorkspacePluginStateIn(candidateState, workspaceId, result.plugin)
          }
          disablePluginsThatNeedPermissionReview(candidateState, installed)
        },
        (committed) => set({
          installed,
          workspaceStates: { ...committed.workspaces },
        }),
        true,
      )
    } catch (error) {
      if (committedPlugin) throw committedPackageError(committedPlugin, error)
      throw error
    } finally {
      set({ operationPluginId: null })
    }
  },

  importDevelopment: async (path, expectedPluginId) => {
    beginPackageOperation('@development-import')
    let committedPlugin: InstalledPlugin | undefined
    try {
      const result = await importDevelopmentPlugin(path, useSettingStore.getState().developerMode, expectedPluginId)
      committedPlugin = result.plugin
      const previous = get().installed.find(
        (item) => item.manifest.id === result.plugin.manifest.id,
      )
      const installed = mergeInstalled([
        ...get().installed.filter((item) => item.manifest.id !== result.plugin.manifest.id),
        result.plugin,
      ])
      const workspaceId = get().currentWorkspaceId
      await commitPersistedStateMutation(
        (candidateState) => {
          preserveSafePermissionGrants(candidateState, previous, result.plugin)
          candidateState.developerSources[result.plugin.manifest.id] = result.plugin.developmentPath ?? path
          delete candidateState.pendingUpdates[result.plugin.manifest.id]
          if (workspaceId) {
            ensureWorkspacePluginStateIn(candidateState, workspaceId, result.plugin)
          }
          disablePluginsThatNeedPermissionReview(candidateState, installed)
        },
        (committed) => set({
          installed,
          workspaceStates: { ...committed.workspaces },
        }),
        true,
      )
      return result.plugin.manifest.id
    } catch (error) {
      if (committedPlugin) throw committedPackageError(committedPlugin, error)
      throw error
    } finally {
      set({ operationPluginId: null })
    }
  },

  uninstall: async (pluginId, removeData = false) => {
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!plugin) return
    beginPackageOperation(pluginId)
    let packageRemoved = false
    try {
      // Revoke capabilities before touching the package. The current window
      // stops synchronously, and secondary windows consult the shared store
      // authority before serving another plugin capability.
      await commitPersistedStateMutation(
        (candidateState) => {
          for (const workspace of Object.values(candidateState.workspaces)) {
            if (workspace[pluginId]) {
              workspace[pluginId].enablement = 'disabled'
              workspace[pluginId].permissions = {}
              delete workspace[pluginId].enabledFingerprint
            }
          }
          delete candidateState.allWorkspacePlugins[pluginId]
        },
        (committed) => set((current) => ({
          workspaceStates: { ...committed.workspaces },
          runtimeStates: { ...current.runtimeStates, [pluginId]: 'inactive' },
          statusBar: Object.fromEntries(
            Object.entries(current.statusBar).filter(([key]) => !key.startsWith(`${pluginId}:`)),
          ),
        })),
      )

      const result = await uninstallPluginPackage(pluginId, { removeData })
      packageRemoved = true
      await commitPersistedStateMutation(
        (candidateState) => {
          if (removeData) {
            for (const workspace of Object.values(candidateState.workspaces)) {
              delete workspace[pluginId]
            }
            delete candidateState.deviceSettings[pluginId]
          }
          delete candidateState.failures[pluginId]
          delete candidateState.developerSources[pluginId]
          delete candidateState.pendingUpdates[pluginId]
        },
        (committed) => set((current) => ({
          installed: current.installed.filter((item) => item.manifest.id !== pluginId),
          workspaceStates: { ...committed.workspaces },
          deviceSettings: { ...committed.deviceSettings },
          failures: { ...committed.failures },
        })),
        true,
      )
      if (result.cleanupWarning) {
        throw new Error(
          `The plugin was uninstalled, but its data could not be completely removed: ${result.cleanupWarning.message}`,
        )
      }
    } finally {
      if (packageRemoved) {
        try {
          const installed = mergeInstalled(await listInstalledPluginPackages())
          set({ installed })
        } catch (error) {
          get().addLog({
            pluginId: 'app.notegen.plugin-host',
            level: 'warning',
            message: `Could not refresh installed plugins after uninstall: ${safeErrorMessage(error)}`,
          })
        }
      }
      set({ operationPluginId: null })
    }
  },

  rollback: async (pluginId) => {
    beginPackageOperation(pluginId)
    let committedPlugin: InstalledPlugin | undefined
    try {
      const previous = get().installed.find((item) => item.manifest.id === pluginId)
      const rolledBack = await rollbackPluginPackage(pluginId)
      committedPlugin = rolledBack
      const installed = mergeInstalled([
        ...get().installed.filter((item) => item.manifest.id !== pluginId),
        rolledBack,
      ])
      const workspaceId = get().currentWorkspaceId
      await commitPersistedStateMutation(
        (candidateState) => {
          preserveSafePermissionGrants(candidateState, previous, rolledBack)
          delete candidateState.pendingUpdates[pluginId]
          if (workspaceId) {
            ensureWorkspacePluginStateIn(candidateState, workspaceId, rolledBack)
          }
          disablePluginsThatNeedPermissionReview(candidateState, installed)
        },
        (committed) => set({
          installed,
          workspaceStates: { ...committed.workspaces },
        }),
        true,
      )
    } catch (error) {
      if (committedPlugin) throw committedPackageError(committedPlugin, error)
      throw error
    } finally {
      set({ operationPluginId: null })
    }
  },

  hasPendingUpdate: (pluginId, version) => (
    get().installed.some((plugin) => (
      plugin.manifest.id === pluginId
      && plugin.activeVersion === version
      && plugin.pendingActivation
    ))
  ),

  confirmPendingUpdate: async (pluginId, version) => {
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (!plugin || plugin.activeVersion !== version || !plugin.pendingActivation) return
    const fingerprint = getPluginManifestFingerprint(plugin)
    const epoch = packageOperationEpoch
    const confirmed = await confirmPluginPackageActivation(pluginId, version, plugin.contentHash)
    const currentPlugin = get().installed.find((item) => item.manifest.id === pluginId)
    if (epoch !== packageOperationEpoch || !currentPlugin
      || getPluginManifestFingerprint(currentPlugin) !== fingerprint) return
    const installed = mergeInstalled([
      ...get().installed.filter((item) => item.manifest.id !== pluginId),
      confirmed,
    ])
    // Native package state is authoritative and is already durable here. Keep
    // this window from treating a later unrelated failure as a candidate crash
    // even if the UI-state cleanup cannot be saved.
    set({ installed })
    await commitPersistedStateMutation(
      (candidateState) => {
        const latestPlugin = get().installed.find((item) => item.manifest.id === pluginId)
        if (latestPlugin && getPluginManifestFingerprint(latestPlugin) === fingerprint
          && candidateState.pendingUpdates[pluginId]?.version === version) {
          delete candidateState.pendingUpdates[pluginId]
        }
      },
      () => undefined,
      true,
    )
  },

  setRuntimeState: (pluginId, state) => {
    set((current) => ({
      runtimeStates: { ...current.runtimeStates, [pluginId]: state },
    }))
  },

  setStatusBarState: (pluginId, itemId, state) => {
    set((current) => ({
      statusBar: { ...current.statusBar, [`${pluginId}:${itemId}`]: state },
    }))
  },

  clearStatusBar: (pluginId) => {
    set((current) => ({
      statusBar: Object.fromEntries(
        Object.entries(current.statusBar).filter(([key]) => !key.startsWith(`${pluginId}:`)),
      ),
    }))
  },

  recordFailure: async (pluginId, code, message) => {
    const lastAt = new Date().toISOString()
    await commitPersistedStateMutation(
      (candidateState) => {
        const previous = candidateState.failures[pluginId]
        candidateState.failures[pluginId] = {
          count: (previous?.count ?? 0) + 1,
          lastAt,
          code,
          message: message.slice(0, 500),
        }
      },
      (committed) => set({ failures: { ...committed.failures } }),
    )
    get().addLog({ pluginId, level: 'error', code, message })
  },

  clearFailure: async (pluginId) => {
    await commitPersistedStateMutation(
      (candidateState) => {
        delete candidateState.failures[pluginId]
      },
      (committed) => set({ failures: { ...committed.failures } }),
    )
  },

  addLog: (entry) => {
    const log: PluginLogEntry = {
      ...entry,
      id: createOpaqueId(),
      createdAt: new Date().toISOString(),
      message: entry.message.slice(0, 1_000),
    }
    set((current) => ({ logs: [log, ...current.logs].slice(0, MAX_LOG_ENTRIES) }))
  },

  clearLogs: (pluginId) => {
    set((current) => ({
      logs: pluginId ? current.logs.filter((entry) => entry.pluginId !== pluginId) : [],
    }))
  },

  getWorkspaceState: (pluginId) => {
    const workspaceId = get().currentWorkspaceId
    return workspaceId ? get().workspaceStates[workspaceId]?.[pluginId] : undefined
  },

  getSetting: (pluginId, key) => {
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    const definition = plugin?.manifest.contributes.settings?.find((item) => item.key === key)
    if (!plugin || !definition) return undefined
    if (definition.scope === 'device') {
      return get().deviceSettings[pluginId]?.[key] ?? definition.default
    }
    return get().getWorkspaceState(pluginId)?.settings[key] ?? definition.default
  },

  isEnabled: (pluginId) => {
    const pluginState = get().getWorkspaceState(pluginId)
    const plugin = get().installed.find((item) => item.manifest.id === pluginId)
    return Boolean(plugin && getPluginRevocation(plugin, get().catalog) === undefined && isPluginEnabledInWorkspace(plugin, pluginState))
  },

  isRequestedInAllWorkspaces: (pluginId) => Boolean(persistedState.allWorkspacePlugins[pluginId]),
}))
