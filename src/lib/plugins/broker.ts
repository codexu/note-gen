import { setRuntimeFileIcons, clearRuntimeFileIcons } from './resources'
import type { PluginFileIconRule } from '@notegen/plugin-api'
import { appDataDir, join } from '@tauri-apps/api/path'
import {
  PLUGIN_API_VERSION,
  isPluginError,
  PluginError,
  type OpenOrCreateNoteOptions,
  type OpenOrCreateResult,
  type PluginContext,
  type PluginDisposable,
  type PluginJsonValue,
  type PluginPermissionName,
  type PluginPermissionScope,
  type PluginSettingValue,
  type PluginStatusBarUpdate,
  type NoteChangeEvent,
  type PluginNetworkResponse,
  type ResolvedDay,
  type SearchNotesResult,
  type SearchNotesOptions,
  type PluginAttachment,
} from '@notegen/plugin-api'
import { toast as sonnerToast } from 'sonner'
import { recordWritingActivity } from '@/db/activity'
import emitter from '@/lib/emitter'
import {
  editorPathsCouldReferToSameFile,
  lockEditorPathsForMutation,
  markEditorPathMutation,
  prepareActiveEditorDeactivationDurably,
  prepareActiveEditorPathMutationDurably,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { hasEditorWindowForPaths } from '@/lib/editor-windows'
import {
  getActivePluginEditor,
  applyPluginEditorEdit,
  applyPluginEditorEdits,
  setPluginEditorSelection,
  getPluginEditorSelection,
  getPluginEditorTextSnapshot,
  onDidChangeActivePluginEditor,
  onDidChangePluginEditorContent,
} from '@/lib/plugins/editor-bridge'
import { registerPluginCommandHandler } from '@/lib/plugins/command-registry'
import { invokePluginBackend } from '@/lib/plugins/backend'
import {
  getPluginManifestFingerprint,
  type InstalledPlugin,
  type PluginStatusBarState,
  type PluginWorkspaceBinding,
  type PluginWorkspaceState,
} from '@/lib/plugins/internal-types'
import type { PluginRpcMethod } from '@/lib/plugins/runtime/protocol'
import { getWorkspacePath } from '@/lib/workspace'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import useArticleStore from '@/stores/article'
import {
  readAuthoritativePluginWorkspaceState,
  usePluginStore,
} from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { openPluginDialog, updatePluginDialog, openPluginView, updatePluginView, closePluginView, getPluginViewState, onPluginViewChange, onPluginDialogClose, closePluginDialog, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { executeHostCommand } from './host-commands'
import type { PluginHostCommand, PluginDialogUpdate } from '@notegen/plugin-api'
import type { PluginDialogOptions, PluginUiDocument } from '@notegen/plugin-api'

const MAX_NOTE_BYTES = 2 * 1_048_576
const MAX_NETWORK_BODY_BYTES = 2 * 1_048_576
const MAX_CONCURRENT_NETWORK_REQUESTS = 16
const MAX_CONCURRENT_NETWORK_REQUESTS_PER_PLUGIN = 4
const MAX_NOTICE_LENGTH = 500
const MAX_STATUS_TEXT_LENGTH = 160
const MIN_STATUS_UPDATE_INTERVAL_MS = 100
const statusUpdateTimes = new Map<string, number>()
const pendingStatusUpdates = new Map<string, {
  contentHash: string
  state: Omit<PluginStatusBarState, 'updatedAt'>
  assertCurrent: () => void
  timer: ReturnType<typeof setTimeout> | null
}>()
let noteMutationQueue: Promise<void> = Promise.resolve()
let activeNetworkRequests = 0
const activeNetworkRequestsByPlugin = new Map<string, number>()

interface NativeNoteSnapshot {
  modifiedAt?: number
  content: string
  revision: number
  path: string
}

interface NativeOpenOrCreateResult {
  status: 'created' | 'opened-existing'
  path: string
}

interface CurrentWorkspaceSnapshot {
  id: string
  key: string
  name: string
  root: string
}

function normalizePluginWorkspaceKey(path: string, isCustom: boolean): string {
  if (!isCustom) return '@notegen-default-workspace'
  const slashNormalized = path.trim().replace(/\\/g, '/')
  const normalized = slashNormalized === '/'
    || /^[A-Za-z]:\/$/.test(slashNormalized)
    ? slashNormalized
    : slashNormalized.replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function configuredWorkspaceKey(): string | null {
  if (typeof window === 'undefined' || window.location.pathname === '/editor-window') return null
  const path = useSettingStore.getState().workspacePath.trim()
  return normalizePluginWorkspaceKey(path || 'article', Boolean(path))
}

export function assertPluginWorkspaceBinding(binding?: PluginWorkspaceBinding): void {
  const store = usePluginStore.getState()
  if (store.currentWorkspaceId === null || store.currentWorkspaceKey === null) {
    throw new PluginError('WorkspaceChanged', 'No plugin workspace is active')
  }
  if (
    binding
    && (store.currentWorkspaceId !== binding.workspaceId || store.currentWorkspaceKey !== binding.workspaceKey)
  ) {
    throw new PluginError('WorkspaceChanged', 'The plugin runtime belongs to a different workspace')
  }
  const configuredKey = configuredWorkspaceKey()
  if (configuredKey && configuredKey !== store.currentWorkspaceKey) {
    throw new PluginError('WorkspaceChanged', 'The active workspace is still changing')
  }
}

export function isPluginWorkspaceBindingCurrent(binding?: PluginWorkspaceBinding): boolean {
  try {
    assertPluginWorkspaceBinding(binding)
    return true
  } catch {
    return false
  }
}

function currentPluginWorkspaceBinding(): PluginWorkspaceBinding | null {
  const state = usePluginStore.getState()
  if (!state.currentWorkspaceId || !state.currentWorkspaceKey) return null
  const binding = {
    workspaceId: state.currentWorkspaceId,
    workspaceKey: state.currentWorkspaceKey,
  }
  return isPluginWorkspaceBindingCurrent(binding) ? binding : null
}

export function capturePluginWorkspaceBindingForWorkspace(
  workspacePath: string,
  isCustom: boolean,
): PluginWorkspaceBinding | null {
  const binding = currentPluginWorkspaceBinding()
  if (!binding) return null
  const workspaceKey = normalizePluginWorkspaceKey(
    isCustom ? workspacePath : 'article',
    isCustom,
  )
  return binding.workspaceKey === workspaceKey ? binding : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new PluginError('InvalidPath', `${name} must be a string`)
  return value
}

function isPluginJsonValue(value: unknown): value is PluginJsonValue {
  const pending: Array<{ value: unknown; exit?: boolean }> = [{ value }]
  const ancestors = new Set<object>()
  let inspected = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (!item) continue
    const candidate = item.value
    if (item.exit) {
      ancestors.delete(candidate as object)
      continue
    }
    inspected += 1
    if (inspected > 100_000) return false
    if (
      candidate === null
      || typeof candidate === 'string'
      || typeof candidate === 'boolean'
    ) continue
    if (typeof candidate === 'number') {
      if (Number.isFinite(candidate)) continue
      return false
    }
    if (typeof candidate !== 'object') return false
    if (ancestors.has(candidate)) return false
    ancestors.add(candidate)
    pending.push({ value: candidate, exit: true })
    if (Array.isArray(candidate)) {
      // JSON arrays are dense sequences. Reject holes, custom properties,
      // accessors, and symbol keys instead of silently changing their shape
      // when the value crosses the JSON bridge.
      if (candidate.length > 100_000) return false
      const ownKeys = Reflect.ownKeys(candidate)
      if (ownKeys.length !== candidate.length + 1) return false
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index))
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
        pending.push({ value: descriptor.value })
      }
      continue
    }
    const prototype = Object.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Reflect.ownKeys(candidate).some((key) => typeof key === 'symbol')) return false
    const descriptors = Object.getOwnPropertyDescriptors(candidate)
    for (const descriptor of Object.values(descriptors)) {
      if (!('value' in descriptor) || !descriptor.enumerable) return false
      pending.push({ value: descriptor.value })
    }
  }
  return true
}

export function requirePluginJsonValue(value: unknown, name: string): PluginJsonValue {
  if (!isPluginJsonValue(value)) {
    throw new PluginError('RuntimeFailure', `${name} must be a finite JSON value`)
  }
  return value
}

function currentPlugin(pluginId: string): InstalledPlugin {
  const plugin = usePluginStore.getState().installed.find((item) => item.manifest.id === pluginId)
  if (!plugin) throw new PluginError('NotFound', `Plugin is not installed: ${pluginId}`)
  if (plugin.source === 'development' && !useSettingStore.getState().developerMode) {
    throw new PluginError('PermissionDenied', 'Developer Mode is required to run a development plugin')
  }
  return plugin
}

function assertPluginOperational(pluginId: string): InstalledPlugin {
  const plugin = currentPlugin(pluginId)
  if (!usePluginStore.getState().isEnabled(pluginId)) {
    throw new PluginError('Cancelled', 'The plugin is disabled')
  }
  return plugin
}

function normalizeRelativeMarkdownPath(path: string): string {
  const normalized = path.normalize('NFC').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
    || normalized.split('/').some((part) => part.toLowerCase() === '.notegen')
    || !normalized.toLowerCase().endsWith('.md')
  ) {
    throw new PluginError('InvalidPath', 'Expected a safe workspace-relative Markdown path')
  }
  return normalized
}

function normalizeAttachmentPath(path: string): string {
  const normalized = normalizeRelativeMarkdownPath(`${path}.md`).slice(0, -3)
  if (!/\.(png|jpe?g|gif|webp|pdf|txt|csv)$/i.test(normalized)) throw new PluginError('InvalidPath', 'Unsupported attachment extension')
  return normalized
}

function normalizeGrantPath(path: string): string {
  const normalized = path.normalize('NFC').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return normalized === '.' ? '' : normalized
}

function pathIsWithin(
  path: string,
  grantedPath: string,
  scope: PluginPermissionScope,
): boolean {
  const target = normalizeGrantPath(path)
  const grant = normalizeGrantPath(grantedPath)
  if (scope === 'network-origins') return Boolean(grant) && target === grant
  if (scope === 'workspace-file' || scope === 'workspace-files') return Boolean(grant) && target === grant
  if (!grant) return true
  return target === grant || target.startsWith(`${grant}/`)
}

type PluginNoteChangeSource = 'application' | 'plugin-api' | 'file-watcher'

interface PluginNoteChangeOptions {
  binding?: PluginWorkspaceBinding | null
  source?: PluginNoteChangeSource
}

interface PluginNoteChangeSubscription {
  listener: (event: NoteChangeEvent) => void | Promise<void>
  binding?: PluginWorkspaceBinding
}

const NOTE_CHANGE_DEDUPE_MS = 750
const MAX_RECENT_NOTE_CHANGES = 512
const MAX_REPLAYED_WORKSPACES = 32
const noteChangeListeners = new Set<PluginNoteChangeSubscription>()
const lastNoteChangeEvents = new Map<string, NoteChangeEvent>()
const recentAuthoritativeNoteChanges = new Map<string, number>()

function pluginWorkspaceBindingKey(binding: PluginWorkspaceBinding): string {
  return `${binding.workspaceId}\u0000${binding.workspaceKey}`
}

function noteChangePaths(event: NoteChangeEvent): string[] {
  return event.previousPath ? [event.path, event.previousPath] : [event.path]
}

function noteChangePathKey(binding: PluginWorkspaceBinding, path: string): string {
  return `${pluginWorkspaceBindingKey(binding)}\u0000${path.normalize('NFC').replace(/\\/g, '/')}`
}

function rememberAuthoritativeNoteChange(binding: PluginWorkspaceBinding, event: NoteChangeEvent, now: number): void {
  for (const path of noteChangePaths(event)) {
    recentAuthoritativeNoteChanges.set(noteChangePathKey(binding, path), now)
  }
  while (recentAuthoritativeNoteChanges.size > MAX_RECENT_NOTE_CHANGES) {
    const oldest = recentAuthoritativeNoteChanges.keys().next().value
    if (typeof oldest !== 'string') break
    recentAuthoritativeNoteChanges.delete(oldest)
  }
}

function isDuplicateWatcherChange(binding: PluginWorkspaceBinding, event: NoteChangeEvent, now: number): boolean {
  let duplicate = false
  for (const path of noteChangePaths(event)) {
    const key = noteChangePathKey(binding, path)
    const recordedAt = recentAuthoritativeNoteChanges.get(key)
    if (recordedAt === undefined) continue
    if (now - recordedAt <= NOTE_CHANGE_DEDUPE_MS) duplicate = true
    else recentAuthoritativeNoteChanges.delete(key)
  }
  return duplicate
}

export function emitPluginNoteChange(
  event: NoteChangeEvent,
  options: PluginNoteChangeOptions = {},
): void {
  const binding = options.binding === undefined
    ? currentPluginWorkspaceBinding()
    : options.binding
  if (!binding || !isPluginWorkspaceBindingCurrent(binding)) return

  const source = options.source ?? 'application'
  const now = Date.now()
  if (source === 'file-watcher' && isDuplicateWatcherChange(binding, event, now)) return
  if (source !== 'file-watcher') rememberAuthoritativeNoteChange(binding, event, now)

  const workspaceKey = pluginWorkspaceBindingKey(binding)
  lastNoteChangeEvents.delete(workspaceKey)
  lastNoteChangeEvents.set(workspaceKey, event)
  while (lastNoteChangeEvents.size > MAX_REPLAYED_WORKSPACES) {
    const oldest = lastNoteChangeEvents.keys().next().value
    if (typeof oldest !== 'string') break
    lastNoteChangeEvents.delete(oldest)
  }

  for (const subscription of noteChangeListeners) {
    if (
      subscription.binding
      && pluginWorkspaceBindingKey(subscription.binding) !== workspaceKey
    ) continue
    try {
      void Promise.resolve(subscription.listener(event)).catch(() => undefined)
    } catch { /* isolated listener */ }
  }
}

export function onDidChangePluginNotes(
  listener: (event: NoteChangeEvent) => void | Promise<void>,
  replayLatest = false,
  workspaceBinding?: PluginWorkspaceBinding,
): PluginDisposable {
  const subscription = { listener, binding: workspaceBinding }
  noteChangeListeners.add(subscription)
  const replayBinding = workspaceBinding ?? currentPluginWorkspaceBinding()
  const lastNoteChangeEvent = replayBinding
    ? lastNoteChangeEvents.get(pluginWorkspaceBindingKey(replayBinding))
    : undefined
  if (replayLatest && lastNoteChangeEvent) {
    try {
      void Promise.resolve(listener(lastNoteChangeEvent)).catch(() => undefined)
    } catch { /* isolated listener */ }
  }
  return { dispose: () => noteChangeListeners.delete(subscription) }
}

emitter.on('article-saved', ({ path, pluginChangeType, pluginNoteChangeAlreadyEmitted }) => {
  if (
    !pluginNoteChangeAlreadyEmitted
    && typeof path === 'string'
    && path.toLowerCase().endsWith('.md')
  ) {
    emitPluginNoteChange({ type: pluginChangeType ?? 'changed', path: path.replace(/\\/g, '/') })
  }
})

function assertPermission(
  pluginId: string,
  permission: PluginPermissionName,
  path?: string,
  workspaceId = usePluginStore.getState().currentWorkspaceId,
): void {
  assertPluginWorkspaceBinding()
  const plugin = currentPlugin(pluginId)
  if (!plugin.manifest.permissions[permission]) {
    throw new PluginError('PermissionDenied', `${pluginId} did not declare ${permission}`)
  }
  const state = workspaceId
    ? usePluginStore.getState().workspaceStates[workspaceId]?.[pluginId]
    : undefined
  const grant = state?.permissions[permission]
  if (!grant?.granted || grant.manifestFingerprint !== getPluginManifestFingerprint(plugin)) {
    throw new PluginError('PermissionDenied', `${permission} has not been granted`)
  }
  if (path !== undefined && !(grant.paths ?? []).some((grantedPath) => (
    pathIsWithin(path, grantedPath, plugin.manifest.permissions[permission]?.scope ?? 'active-editor')
  ))) {
    throw new PluginError('PermissionDenied', `${path} is outside the granted ${permission} scope`)
  }
}

export function canUsePluginPermission(
  pluginId: string,
  permission: PluginPermissionName,
  path?: string,
): boolean {
  try {
    assertPermission(pluginId, permission, path)
    return true
  } catch {
    return false
  }
}

async function assertCurrentPluginAuthority(
  pluginId: string,
  binding: PluginWorkspaceBinding,
  permission?: PluginPermissionName,
  path?: string,
): Promise<InstalledPlugin> {
  const initialPlugin = assertPluginOperational(pluginId)
  let authorityState: PluginWorkspaceState | undefined
  try {
    authorityState = await readAuthoritativePluginWorkspaceState(pluginId, binding)
  } catch (error) {
    throw new PluginError(
      'Cancelled',
      `Plugin authorization state is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  assertPluginWorkspaceBinding(binding)
  const plugin = assertPluginOperational(pluginId)
  if (getPluginManifestFingerprint(plugin) !== getPluginManifestFingerprint(initialPlugin)) {
    throw new PluginError('Cancelled', 'The plugin package changed while authorization was checked')
  }
  if (
    !authorityState
    || (authorityState.enablement !== 'workspace' && authorityState.enablement !== 'all-workspaces')
    || authorityState.enabledFingerprint !== getPluginManifestFingerprint(plugin)
  ) {
    throw new PluginError('Cancelled', 'This plugin package is not enabled in the workspace')
  }
  if (!permission) return plugin

  const declaration = plugin.manifest.permissions[permission]
  if (!declaration) {
    throw new PluginError('PermissionDenied', `${pluginId} did not declare ${permission}`)
  }
  const grant = authorityState.permissions[permission]
  if (!grant?.granted || grant.manifestFingerprint !== getPluginManifestFingerprint(plugin)) {
    throw new PluginError('PermissionDenied', `${permission} has not been granted`)
  }
  if (path !== undefined && !(grant.paths ?? []).some((grantedPath) => (
    pathIsWithin(path, grantedPath, declaration.scope)
  ))) {
    throw new PluginError('PermissionDenied', `${path} is outside the granted ${permission} scope`)
  }
  assertPermission(pluginId, permission, path, binding.workspaceId)
  return plugin
}

export async function assertPluginExecutionCurrent(
  pluginId: string,
  binding: PluginWorkspaceBinding,
): Promise<void> {
  await assertCurrentPluginAuthority(pluginId, binding)
}

export async function canUsePluginPermissionCurrent(
  pluginId: string,
  permission: PluginPermissionName,
  path?: string,
  binding?: PluginWorkspaceBinding,
): Promise<boolean> {
  const store = usePluginStore.getState()
  const currentBinding = binding ?? {
    workspaceId: store.currentWorkspaceId ?? '',
    workspaceKey: store.currentWorkspaceKey ?? '',
  }
  try {
    await assertCurrentPluginAuthority(pluginId, currentBinding, permission, path)
    return true
  } catch {
    return false
  }
}

const NOTE_EVENT_PERMISSIONS = ['notes.read', 'notes.list'] as const

async function canObserveNotePathCurrent(
  pluginId: string,
  path: string,
  binding: PluginWorkspaceBinding,
): Promise<boolean> {
  for (const permission of NOTE_EVENT_PERMISSIONS) {
    if (!canUsePluginPermission(pluginId, permission, path)) continue
    if (await canUsePluginPermissionCurrent(pluginId, permission, path, binding)) return true
  }
  return false
}

/**
 * Projects an internal note change into exactly the event a plugin is allowed
 * to observe. A move crossing a grant boundary becomes created/deleted, so the
 * path on the other side of the boundary is never disclosed.
 */
export async function filterPluginNoteChangeEvent(
  pluginId: string,
  event: NoteChangeEvent,
  binding: PluginWorkspaceBinding,
): Promise<NoteChangeEvent | null> {
  if (!isPluginWorkspaceBindingCurrent(binding)) return null

  if (event.type !== 'moved') {
    if (!await canObserveNotePathCurrent(pluginId, event.path, binding)) return null
    return { type: event.type, path: event.path }
  }

  const targetVisible = await canObserveNotePathCurrent(pluginId, event.path, binding)
  const sourceVisible = event.previousPath
    ? await canObserveNotePathCurrent(pluginId, event.previousPath, binding)
    : false
  if (!isPluginWorkspaceBindingCurrent(binding)) return null

  if (sourceVisible && targetVisible && event.previousPath) {
    return { type: 'moved', path: event.path, previousPath: event.previousPath }
  }
  if (targetVisible) return { type: 'created', path: event.path }
  if (sourceVisible && event.previousPath) return { type: 'deleted', path: event.previousPath }
  return null
}

async function getCurrentWorkspaceSnapshot(): Promise<CurrentWorkspaceSnapshot> {
  const store = usePluginStore.getState()
  const workspaceId = store.currentWorkspaceId
  if (!workspaceId) throw new PluginError('WorkspaceChanged', 'No workspace is active')
  const workspace = await getWorkspacePath()
  const workspaceKey = normalizePluginWorkspaceKey(workspace.path, workspace.isCustom)
  if (store.currentWorkspaceKey !== workspaceKey) {
    throw new PluginError('WorkspaceChanged', 'The active workspace is still changing')
  }
  const root = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
  const currentStore = usePluginStore.getState()
  if (currentStore.currentWorkspaceId !== workspaceId || currentStore.currentWorkspaceKey !== workspaceKey) {
    throw new PluginError('WorkspaceChanged', 'The active workspace changed while it was being resolved')
  }
  return {
    id: workspaceId,
    key: workspaceKey,
    name: getWorkspaceDisplayName(workspace.isCustom ? workspace.path : '', 'NoteGen'),
    root,
  }
}

async function getCurrentWorkspaceInfo(): Promise<{ id: string; name: string }> {
  const { id, name } = await getCurrentWorkspaceSnapshot()
  return { id, name }
}

async function assertWorkspaceStillCurrent(expected: CurrentWorkspaceSnapshot): Promise<void> {
  const current = await getCurrentWorkspaceSnapshot()
  if (current.id !== expected.id || current.root !== expected.root) {
    throw new PluginError('WorkspaceChanged', 'The active workspace has changed')
  }
}

function parseDayStartsAt(value: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) throw new PluginError('InvalidTimeZone', 'dayStartsAt must use HH:mm')
  return Number(match[1]) * 60 + Number(match[2])
}

function dayFromUtcTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

async function resolveDay(options: { timeZone: string; dayStartsAt: string }): Promise<ResolvedDay> {
  const timeZone = options.timeZone === 'system'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    : options.timeZone
  const dayStartsAt = parseDayStartsAt(options.dayStartsAt)
  const instant = new Date()
  let parts: Intl.DateTimeFormatPart[]

  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
  } catch {
    throw new PluginError('InvalidTimeZone', `Unknown time zone: ${timeZone}`)
  }

  const readPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value
    if (!value) throw new PluginError('InvalidTimeZone', 'Could not resolve the local date')
    return Number(value)
  }
  const year = readPart('year')
  const month = readPart('month')
  const day = readPart('day')
  const hour = readPart('hour')
  const minute = readPart('minute')
  const second = readPart('second')
  const localDayUtc = Date.UTC(year, month - 1, day)
  const logicalDayUtc = hour * 60 + minute < dayStartsAt ? localDayUtc - 86_400_000 : localDayUtc

  return {
    instant: instant.toISOString(),
    logicalDate: dayFromUtcTimestamp(logicalDayUtc),
    timeZone,
    localDateTime: `${dayFromUtcTimestamp(localDayUtc)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
  }
}

async function readNote(pluginId: string, path: string) {
  assertPluginOperational(pluginId)
  const normalizedPath = normalizeRelativeMarkdownPath(path)
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'notes.read', normalizedPath, workspace.id)
  await assertWorkspaceStillCurrent(workspace)
  const note = await invokePluginBackend<NativeNoteSnapshot>('plugin_read_workspace_note', {
    workspaceRoot: workspace.root,
    relativePath: normalizedPath,
  })
  await assertWorkspaceStillCurrent(workspace)
  assertPluginOperational(pluginId)
  assertPermission(pluginId, 'notes.read', normalizedPath, workspace.id)
  if (new TextEncoder().encode(note.content).byteLength > MAX_NOTE_BYTES) {
    throw new PluginError('QuotaExceeded', 'The note is too large for the plugin API')
  }
  return {
    id: `note:${note.revision}`,
    ...(typeof note.modifiedAt === 'number' && Number.isFinite(note.modifiedAt) ? { modifiedAt: note.modifiedAt } : {}),
    path: normalizedPath,
    revision: note.revision,
    content: note.content,
  }
}

async function listNotes(pluginId: string, folder = '', recursive = false, limit = 200, cursor?: string) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new PluginError('InvalidPath', 'List limit must be between 1 and 1000')
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 8192)) throw new PluginError('InvalidPath', 'Invalid note cursor')
  const normalizedFolder = folder ? normalizeGrantPath(folder) : ''
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'notes.list', normalizedFolder, workspace.id)
  const result = await invokePluginBackend<{ entries: Array<{ path: string; name: string; size: number }>; truncated: boolean; nextCursor?: string }>(
    'plugin_list_workspace_notes',
    { workspaceRoot: workspace.root, folder: normalizedFolder, recursive, limit, cursor },
  )
  await assertWorkspaceStillCurrent(workspace)
  assertPermission(pluginId, 'notes.list', normalizedFolder, workspace.id)
  return result
}

async function mutateClosedNotes<T>(
  pluginId: string,
  workspace: CurrentWorkspaceSnapshot,
  paths: readonly string[],
  assertAccess: () => Promise<void>,
  mutation: () => Promise<T>,
): Promise<T> {
  const operation = noteMutationQueue.then(async () => {
    // Standalone editors own a separate save queue and cannot inspect every
    // main-window tab. Their editor API remains available for the open note.
    if (typeof window !== 'undefined' && window.location.pathname === '/editor-window') {
      throw new PluginError('EditorBusy', 'Use the editor API in a separate editor window; file mutations must run in the main window')
    }
    await assertWorkspaceStillCurrent(workspace)
    assertPluginOperational(pluginId)
    await assertAccess()
    const uniquePaths = [...new Set(paths)].sort()
    const unlock = lockEditorPathsForMutation(uniquePaths, workspace.root)
    if (!unlock) throw new PluginError('EditorBusy', 'Another file mutation is in progress')
    try {
      const assertNoOpenEditors = () => {
        const article = useArticleStore.getState()
        const openPaths = [article.activeFilePath, article.aiGeneratingFilePath ?? '', ...article.openTabs.map(tab => tab.path)]
        if (uniquePaths.some(path => openPaths.some(openPath => (
          editorPathsCouldReferToSameFile(path, openPath, workspace.root)
        )))) {
          throw new PluginError('EditorBusy', 'Close every tab and editor pane for these notes before changing their files, or use the editor API')
        }
      }
      assertNoOpenEditors()
      if (await hasEditorWindowForPaths(uniquePaths, workspace.root)) {
        throw new PluginError('EditorBusy', 'Close all separate editor windows for these notes before changing their files')
      }
      if (!await prepareActiveEditorPathMutationDurably(
        useArticleStore.getState().activeFilePath,
        uniquePaths,
        workspace.root,
      )) {
        throw new PluginError('EditorBusy', 'Pending note changes could not be saved before the file mutation')
      }

      let result: T | undefined
      const queuedSaveChecks: Array<() => boolean> = []
      const transactionPaths = uniquePaths.filter((path, index) => !uniquePaths.slice(0, index).some(previous => (
        editorPathsCouldReferToSameFile(path, previous, workspace.root)
      )))
      const transact = async (index: number): Promise<boolean> => {
        if (index < transactionPaths.length) {
          return runEditorPathWriteTransaction(transactionPaths[index], async ({ hasQueuedSave }) => {
            queuedSaveChecks.push(hasQueuedSave)
            return transact(index + 1)
          }, workspace.root)
        }
        await assertWorkspaceStillCurrent(workspace)
        assertPluginOperational(pluginId)
        await assertAccess()
        assertNoOpenEditors()
        if (queuedSaveChecks.some(hasQueuedSave => hasQueuedSave())) {
          throw new PluginError('EditorBusy', 'The note has a newer queued editor save')
        }
        result = await mutation()
        return true
      }
      await transact(0)
      return result as T
    } finally {
      unlock()
    }
  })
  noteMutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function reconcileCommittedNoteMutation(
  workspace: CurrentWorkspaceSnapshot,
  path: string,
  reconcile: () => Promise<void>,
): Promise<void> {
  try {
    await assertWorkspaceStillCurrent(workspace)
    await reconcile()
  } catch (error) {
    throw new PluginError(
      isPluginError(error) ? error.code : 'RuntimeFailure',
      'The note file was changed, but the editor state could not be refreshed; re-read the file before retrying',
      { committed: true, path, workspaceId: workspace.id },
    )
  }
}

async function writeNote(pluginId: string, options: { path: string; content: string; expectedRevision?: number; create?: boolean }, assertCurrent: () => Promise<void>) {
  const path = normalizeRelativeMarkdownPath(options.path)
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'notes.write', path, workspace.id)
  if (new TextEncoder().encode(options.content).byteLength > MAX_NOTE_BYTES) {
    throw new PluginError('QuotaExceeded', 'The note is too large for the plugin API')
  }
  return mutateClosedNotes(pluginId, workspace, [path], async () => {
    await assertCurrent()
    assertPermission(pluginId, 'notes.write', path, workspace.id)
  }, async () => {
    const result = await invokePluginBackend<{ path: string; revision: number; created: boolean }>(
      'plugin_write_workspace_note',
      { workspaceRoot: workspace.root, relativePath: path, content: options.content, expectedRevision: options.expectedRevision, create: options.create === true },
    )
    markEditorPathMutation(path, workspace.root)
    await reconcileCommittedNoteMutation(workspace, path, async () => {
      emitter.emit('editor-file-content-updated', { path, content: options.content })
      await reconcileCreatedNote(
        path,
        options.content,
        result.created ? 'created' : 'changed',
        { workspaceId: workspace.id, workspaceKey: workspace.key },
      )
    })
    return result
  })
}

async function deleteNote(pluginId: string, pathValue: string, expectedRevision: number | undefined, assertCurrent: () => Promise<void>): Promise<void> {
  const path = normalizeRelativeMarkdownPath(pathValue)
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'notes.delete', path, workspace.id)
  await mutateClosedNotes(pluginId, workspace, [path], async () => {
    await assertCurrent()
    assertPermission(pluginId, 'notes.delete', path, workspace.id)
  }, async () => {
    await invokePluginBackend('plugin_delete_workspace_note', { workspaceRoot: workspace.root, relativePath: path, expectedRevision })
    markEditorPathMutation(path, workspace.root)
    await reconcileCommittedNoteMutation(workspace, path, async () => {
      await useArticleStore.getState().cleanTabsByDeletedFile(path, workspace.root)
      useArticleStore.getState().removeLocalEntry(path)
      emitter.emit('editor-file-close', { path })
      emitPluginNoteChange(
        { type: 'deleted', path },
        {
          binding: { workspaceId: workspace.id, workspaceKey: workspace.key },
          source: 'plugin-api',
        },
      )
    })
  })
}

async function moveNote(pluginId: string, fromValue: string, toValue: string, assertCurrent: () => Promise<void>): Promise<void> {
  const from = normalizeRelativeMarkdownPath(fromValue)
  const to = normalizeRelativeMarkdownPath(toValue)
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'notes.move', from, workspace.id)
  assertPermission(pluginId, 'notes.move', to, workspace.id)
  if (from === to) return
  await mutateClosedNotes(pluginId, workspace, [from, to], async () => {
    await assertCurrent()
    assertPermission(pluginId, 'notes.move', from, workspace.id)
    assertPermission(pluginId, 'notes.move', to, workspace.id)
  }, async () => {
    await invokePluginBackend('plugin_move_workspace_note', { workspaceRoot: workspace.root, from, to })
    markEditorPathMutation(from, workspace.root)
    markEditorPathMutation(to, workspace.root)
    await reconcileCommittedNoteMutation(workspace, to, async () => {
      useArticleStore.getState().moveLocalEntry(from, to)
      await useArticleStore.getState().syncOpenTabsForPathChange(from, to)
      emitter.emit('editor-file-path-changed', { oldPath: from, newPath: to })
      emitPluginNoteChange(
        { type: 'moved', path: to, previousPath: from },
        {
          binding: { workspaceId: workspace.id, workspaceKey: workspace.key },
          source: 'plugin-api',
        },
      )
    })
  })
}

function normalizeNetworkOrigin(urlValue: string): { url: string; origin: string } {
  let parsed: URL
  try { parsed = new URL(urlValue) } catch { throw new PluginError('InvalidPath', 'Network URL is invalid') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new PluginError('PermissionDenied', 'Only plain HTTPS URLs are allowed')
  }
  return { url: parsed.toString(), origin: parsed.origin.toLowerCase() }
}

async function fetchNetwork(pluginId: string, request: {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Readonly<Record<string, string>>
  body?: string
  timeoutMs?: number
}, assertCurrent: () => void): Promise<PluginNetworkResponse> {
  const { url, origin } = normalizeNetworkOrigin(request.url)
  const method = request.method ?? 'GET'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new PluginError('InvalidPath', 'Network method is invalid')
  }
  const timeoutMs = request.timeoutMs ?? 15_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new PluginError('InvalidPath', 'Network timeout must be between 1000 and 30000 milliseconds')
  }
  if (request.body !== undefined) {
    if (typeof request.body !== 'string') {
      throw new PluginError('InvalidPath', 'Network request body must be text')
    }
    if (new TextEncoder().encode(request.body).byteLength > MAX_NETWORK_BODY_BYTES) {
      throw new PluginError('QuotaExceeded', 'Network request body exceeds 2 MiB')
    }
  }
  const workspace = await getCurrentWorkspaceSnapshot()
  assertPermission(pluginId, 'network.fetch', origin, workspace.id)
  const headers: Record<string, string> = {}
  const forbidden = new Set([
    'connection',
    'content-length',
    'cookie',
    'expect',
    'host',
    'keep-alive',
    'origin',
    'referer',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ])
  if (Object.keys(request.headers ?? {}).length > 100) {
    throw new PluginError('QuotaExceeded', 'Network request declares too many headers')
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const normalizedName = name.toLowerCase()
    if (
      !/^[a-z0-9-]{1,100}$/.test(normalizedName)
      || forbidden.has(normalizedName)
      || normalizedName.startsWith('proxy-')
    ) {
      throw new PluginError('PermissionDenied', `Network header is not allowed: ${name}`)
    }
    if (typeof value !== 'string') {
      throw new PluginError('InvalidPath', `Network header must contain text: ${name}`)
    }
    const normalizedValue = value
    if (new TextEncoder().encode(normalizedValue).byteLength > 8_192) {
      throw new PluginError('QuotaExceeded', `Network header is too large: ${name}`)
    }
    headers[normalizedName] = normalizedValue
  }
  const pluginRequests = activeNetworkRequestsByPlugin.get(pluginId) ?? 0
  assertCurrent()
  if (
    activeNetworkRequests >= MAX_CONCURRENT_NETWORK_REQUESTS
    || pluginRequests >= MAX_CONCURRENT_NETWORK_REQUESTS_PER_PLUGIN
  ) {
    throw new PluginError('QuotaExceeded', 'Plugin network concurrency limit exceeded')
  }
  activeNetworkRequests += 1
  activeNetworkRequestsByPlugin.set(pluginId, pluginRequests + 1)
  try {
    const response = await invokePluginBackend<PluginNetworkResponse>('plugin_network_fetch', {
      url,
      method,
      headers,
      body: request.body,
      timeoutMs,
    })
    await assertWorkspaceStillCurrent(workspace)
    assertCurrent()
    assertPermission(pluginId, 'network.fetch', origin, workspace.id)
    return response
  } finally {
    activeNetworkRequests = Math.max(0, activeNetworkRequests - 1)
    const remaining = (activeNetworkRequestsByPlugin.get(pluginId) ?? 1) - 1
    if (remaining <= 0) activeNetworkRequestsByPlugin.delete(pluginId)
    else activeNetworkRequestsByPlugin.set(pluginId, remaining)
  }
}

async function reconcileCreatedNote(
  path: string,
  content: string,
  changeType: 'created' | 'changed' = 'created',
  workspaceBinding?: PluginWorkspaceBinding,
): Promise<void> {
  const article = useArticleStore.getState()
  let reconciled = article.reconcileLocalFile(path, true)
  if (!reconciled) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (parent) await article.loadCollapsibleFiles(parent, { force: true, skipRemoteSync: true })
    else await article.loadFileTree({ skipRemoteSync: true })
    reconciled = useArticleStore.getState().reconcileLocalFile(path, true)
  }
  await useArticleStore.getState().ensurePathExpanded(path)
  useArticleStore.getState().scheduleVectorCalculation(path, content)
  await recordWritingActivity({
    path,
    title: path.split('/').pop()?.replace(/\.md$/i, '') || path,
    description: path,
  })
  emitPluginNoteChange(
    { type: changeType, path },
    { binding: workspaceBinding, source: 'plugin-api' },
  )
  emitter.emit('article-saved', {
    path,
    content,
    pluginChangeType: changeType,
    pluginNoteChangeAlreadyEmitted: true,
  })
  if (!reconciled) {
    usePluginStore.getState().addLog({
      pluginId: 'app.notegen.plugin-host',
      level: 'warning',
      message: `Created a note that is not yet visible in the file tree: ${path}`,
    })
  }
}

async function openOrCreateNote(
  pluginId: string,
  options: OpenOrCreateNoteOptions,
  assertCurrent: () => void,
): Promise<OpenOrCreateResult> {
  if (
    options.open
    && typeof window !== 'undefined'
    && window.location.pathname.startsWith('/editor-window')
  ) {
    throw new PluginError('EditorBusy', 'Opening another note is unavailable in a standalone editor window')
  }
  if (options.create === false && !options.open) throw new PluginError('InvalidPath', 'Open-only mode requires open: true')
  assertPluginOperational(pluginId)
  const workspace = await getCurrentWorkspaceSnapshot()
  if (workspace.id !== options.workspaceId) {
    throw new PluginError('WorkspaceChanged', 'The active workspace has changed')
  }
  if (options.conflict !== 'open-existing') {
    throw new PluginError('Conflict', 'Only open-existing conflict handling is supported')
  }
  const path = normalizeRelativeMarkdownPath(options.path)
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  if (options.create !== false) assertPermission(pluginId, 'notes.create', parent || path, workspace.id)
  if (options.open) assertPermission(pluginId, 'notes.open', parent || path, workspace.id)
  if (new TextEncoder().encode(options.initialContent).byteLength > MAX_NOTE_BYTES) {
    throw new PluginError('QuotaExceeded', 'The initial note content is too large')
  }

  const activePath = options.open ? useArticleStore.getState().activeFilePath : ''
  if (activePath && !await prepareActiveEditorDeactivationDurably(activePath)) {
    throw new PluginError('EditorBusy', 'The current editor could not be saved safely')
  }
  await assertWorkspaceStillCurrent(workspace)
  assertCurrent()
  assertPluginOperational(pluginId)
  if (options.create !== false) assertPermission(pluginId, 'notes.create', parent || path, workspace.id)
  if (options.open) assertPermission(pluginId, 'notes.open', parent || path, workspace.id)

  let nativeResult: NativeOpenOrCreateResult
  if (options.create === false) {
    // Existence is checked by the native workspace reader. Never invoke a creation operation.
    await invokePluginBackend<NativeNoteSnapshot>('plugin_read_workspace_note', {
      workspaceRoot: workspace.root,
      relativePath: path,
    })
    nativeResult = { status: 'opened-existing', path }
  } else {
    nativeResult = await invokePluginBackend<NativeOpenOrCreateResult>('plugin_open_or_create_note', {
      workspaceRoot: workspace.root,
      relativePath: path,
      initialContent: options.initialContent,
      idempotencyKey: options.idempotencyKey,
    })
  }
  try {
    await assertWorkspaceStillCurrent(workspace)
    assertCurrent()
    assertPluginOperational(pluginId)
    if (options.create !== false) assertPermission(pluginId, 'notes.create', parent || path, workspace.id)
    if (options.open) assertPermission(pluginId, 'notes.open', parent || path, workspace.id)
  } catch (error) {
    if (error instanceof PluginError && error.code !== 'WorkspaceChanged' && nativeResult.status !== 'created') {
      throw error
    }
    throw new PluginError(
      nativeResult.status === 'created' ? 'CreatedNotOpened' : 'WorkspaceChanged',
      nativeResult.status === 'created'
        ? 'The note was created, but the plugin lost access before it could be opened'
        : 'The active workspace changed while the note was being opened',
      { workspaceId: workspace.id, path, opened: false },
    )
  }
  if (nativeResult.status === 'created') {
    await reconcileCreatedNote(
      path,
      options.initialContent,
      'created',
      { workspaceId: workspace.id, workspaceKey: workspace.key },
    )
  }

  let opened = false
  if (options.open) {
    await assertWorkspaceStillCurrent(workspace)
    try {
      assertCurrent()
      assertPluginOperational(pluginId)
    } catch {
      throw new PluginError(
        nativeResult.status === 'created' ? 'CreatedNotOpened' : 'Cancelled',
        'The plugin was disabled before the note could be opened',
        { workspaceId: workspace.id, path, opened: false },
      )
    }
    assertPermission(pluginId, 'notes.open', parent || path, workspace.id)
    try {
      await useArticleStore.getState().setActiveFilePath(path, true, {
        deactivationAlreadyPrepared: Boolean(activePath),
      })
      opened = useArticleStore.getState().activeFilePath === path
      if (opened) usePluginUiStore.getState().setActiveEditorView(null)
    } catch (error) {
      if (nativeResult.status === 'created') {
        throw new PluginError('CreatedNotOpened', 'The note was created but could not be opened', {
          workspaceId: workspace.id,
          path,
          opened: false,
        })
      }
      throw error
    }
    if (!opened) {
      throw new PluginError(
        nativeResult.status === 'created' ? 'CreatedNotOpened' : 'EditorBusy',
        nativeResult.status === 'created'
          ? 'The note was created but could not be opened'
          : 'The existing note could not be opened',
        {
          workspaceId: workspace.id,
          path,
          opened: false,
        },
      )
    }
  }

  return {
    status: nativeResult.status,
    workspaceId: workspace.id,
    path,
    opened,
  }
}

function storageKey(pluginId: string, scope: 'device' | 'workspace', workspaceId: string, key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) {
    throw new PluginError('InvalidManifest', 'Storage keys may contain letters, numbers, dot, dash, and underscore')
  }
  return scope === 'device'
    ? `device:${pluginId}:${key}`
    : `workspace:${workspaceId}:${pluginId}:${key}`
}

async function storageGet(
  pluginId: string,
  scope: 'device' | 'workspace',
  key: string,
): Promise<PluginJsonValue | undefined> {
  assertPluginOperational(pluginId)
  const workspace = scope === 'workspace' ? await getCurrentWorkspaceSnapshot() : null
  const result = await invokePluginBackend<{ found: boolean; value?: unknown }>('plugin_storage_get', {
    pluginId,
    key: storageKey(pluginId, scope, workspace?.id ?? '', key),
  })
  assertPluginOperational(pluginId)
  if (workspace) await assertWorkspaceStillCurrent(workspace)
  return result.found ? requirePluginJsonValue(result.value, 'Stored plugin value') : undefined
}

async function storageSet(
  pluginId: string,
  scope: 'device' | 'workspace',
  key: string,
  value: PluginJsonValue,
  assertCurrent: () => void,
): Promise<void> {
  assertPluginOperational(pluginId)
  const workspace = scope === 'workspace' ? await getCurrentWorkspaceSnapshot() : null
  const targetKey = storageKey(pluginId, scope, workspace?.id ?? '', key)
  const validatedValue = requirePluginJsonValue(value, 'Plugin storage value')
  if (workspace) await assertWorkspaceStillCurrent(workspace)
  assertCurrent()
  assertPluginOperational(pluginId)
  // The native operation checks the complete plugin quota and commits under
  // one shared lock, including writes from separate editor windows.
  await invokePluginBackend<void>('plugin_storage_set', {
    pluginId,
    key: targetKey,
    value: validatedValue,
  })
  assertPluginOperational(pluginId)
  if (workspace) await assertWorkspaceStillCurrent(workspace)
}

async function storageDelete(pluginId: string, scope: 'device' | 'workspace', key: string, assertCurrent: () => void): Promise<void> {
  assertPluginOperational(pluginId)
  const workspace = scope === 'workspace' ? await getCurrentWorkspaceSnapshot() : null
  const targetKey = storageKey(pluginId, scope, workspace?.id ?? '', key)
  if (workspace) await assertWorkspaceStillCurrent(workspace)
  assertCurrent()
  assertPluginOperational(pluginId)
  await invokePluginBackend<void>('plugin_storage_remove', {
    pluginId,
    key: targetKey,
  })
  assertPluginOperational(pluginId)
  if (workspace) await assertWorkspaceStillCurrent(workspace)
}

function translate(messages: Record<string, string>, key: string, values?: Record<string, string | number>): string {
  const template = messages[key] ?? key
  if (!values) return template
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => (
    values[name] === undefined ? match : String(values[name])
  ))
}

function applyStatusBarUpdate(
  pluginId: string,
  itemId: string,
  state: Omit<PluginStatusBarState, 'updatedAt'>,
): void {
  const now = Date.now()
  statusUpdateTimes.set(`${pluginId}:${itemId}`, now)
  usePluginStore.getState().setStatusBarState(pluginId, itemId, { ...state, updatedAt: now })
}

export function clearPendingPluginStatusBarUpdates(pluginId: string): void {
  const prefix = `${pluginId}:`
  for (const [key, pending] of pendingStatusUpdates) {
    if (!key.startsWith(prefix)) continue
    if (pending.timer !== null) clearTimeout(pending.timer)
    pendingStatusUpdates.delete(key)
  }
  for (const key of statusUpdateTimes.keys()) {
    if (key.startsWith(prefix)) statusUpdateTimes.delete(key)
  }
}

function updateStatusBar(pluginId: string, itemId: string, value: unknown, assertCurrent: () => void): void {
  const plugin = currentPlugin(pluginId)
  if (!plugin.manifest.contributes.statusBar?.some((item) => item.id === itemId)) {
    throw new PluginError('PermissionDenied', `Status item is not declared: ${itemId}`)
  }
  if (!isRecord(value)) throw new PluginError('RuntimeFailure', 'Invalid status bar state')
  if (typeof value.visible !== 'boolean') {
    throw new PluginError('RuntimeFailure', 'visible must be a boolean')
  }
  if (value.busy !== undefined && typeof value.busy !== 'boolean') {
    throw new PluginError('RuntimeFailure', 'busy must be a boolean')
  }
  const readText = (key: string): string | undefined => {
    const candidate = value[key]
    if (candidate === undefined) return undefined
    if (typeof candidate !== 'string') throw new PluginError('RuntimeFailure', `${key} must be a string`)
    return candidate.slice(0, MAX_STATUS_TEXT_LENGTH)
  }
  const text = readText('text')
  const compactText = readText('compactText')
  const tooltip = readText('tooltip')
  const accessibleLabel = readText('accessibleLabel')
  const state: Omit<PluginStatusBarState, 'updatedAt'> = {
    visible: value.visible,
    text,
    compactText,
    tooltip,
    accessibleLabel,
    busy: value.busy,
  }
  const rateKey = `${pluginId}:${itemId}`
  const now = Date.now()
  const elapsed = now - (statusUpdateTimes.get(rateKey) ?? 0)
  const pending = pendingStatusUpdates.get(rateKey)

  if (!pending && elapsed >= MIN_STATUS_UPDATE_INTERVAL_MS) {
    applyStatusBarUpdate(pluginId, itemId, state)
    return
  }

  if (pending) {
    pending.state = state
    pending.contentHash = plugin.contentHash
    pending.assertCurrent = assertCurrent
    return
  }

  const scheduled = {
    contentHash: plugin.contentHash,
    state,
    assertCurrent,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  scheduled.timer = setTimeout(() => {
    pendingStatusUpdates.delete(rateKey)
    try { scheduled.assertCurrent() } catch { return }
    const current = usePluginStore.getState()
    const currentPluginPackage = current.installed.find((item) => item.manifest.id === pluginId)
    if (
      !currentPluginPackage
      || currentPluginPackage.contentHash !== scheduled.contentHash
      || !current.isEnabled(pluginId)
    ) return
    applyStatusBarUpdate(pluginId, itemId, scheduled.state)
  }, Math.max(0, MIN_STATUS_UPDATE_INTERVAL_MS - elapsed))
  pendingStatusUpdates.set(rateKey, scheduled)
}

function settingFor(pluginId: string, key: string): PluginSettingValue | undefined {
  return usePluginStore.getState().getSetting(pluginId, key)
}

function createStorageArea(
  pluginId: string,
  scope: 'device' | 'workspace',
  guardCurrent: () => Promise<void>,
  guard: () => void,
) {
  return {
    get: async (key: string) => {
      await guardCurrent()
      const value = await storageGet(pluginId, scope, key)
      await guardCurrent()
      return value
    },
    set: async (key: string, value: PluginJsonValue) => {
      await guardCurrent()
      await storageSet(pluginId, scope, key, value, guard)
      await guardCurrent()
    },
    delete: async (key: string) => {
      await guardCurrent()
      await storageDelete(pluginId, scope, key, guard)
      await guardCurrent()
    },
  }
}

export function createPluginContext(options: {
  plugin: InstalledPlugin
  signal: AbortSignal
  messages: Record<string, string>
  disposables: PluginDisposable[]
  workspaceBinding?: PluginWorkspaceBinding
}): PluginContext {
  const { plugin, signal, messages, disposables } = options
  const pluginId = plugin.manifest.id
  const pluginFingerprint = getPluginManifestFingerprint(plugin)
  const currentStore = usePluginStore.getState()
  const workspaceBinding = options.workspaceBinding ?? {
    workspaceId: currentStore.currentWorkspaceId ?? '',
    workspaceKey: currentStore.currentWorkspaceKey ?? '',
  }
  const guard = () => {
    if (signal.aborted) throw new PluginError('Cancelled', 'The plugin has been stopped')
    assertPluginWorkspaceBinding(workspaceBinding)
    if (getPluginManifestFingerprint(currentPlugin(pluginId)) !== pluginFingerprint) {
      throw new PluginError('Cancelled', 'The plugin package changed during the operation')
    }
    if (!usePluginStore.getState().isEnabled(pluginId)) {
      throw new PluginError('Cancelled', 'The plugin is disabled')
    }
  }
  disposables.push({ dispose: () => clearRuntimeFileIcons(pluginId, signal) })
  const guardCurrent = async (permission?: PluginPermissionName, path?: string) => {
    guard()
    await assertCurrentPluginAuthority(pluginId, workspaceBinding, permission, path)
    guard()
  }

  return {
    plugin: {
      id: pluginId,
      version: plugin.manifest.version,
      apiVersion: PLUGIN_API_VERSION,
    },
    log: {
      info: message => { guard(); usePluginStore.getState().addLog({ pluginId, level: 'info', message }) },
      warning: message => { guard(); usePluginStore.getState().addLog({ pluginId, level: 'warning', message }) },
      error: message => { guard(); usePluginStore.getState().addLog({ pluginId, level: 'error', message }) },
    },
    signal,
    commands: {
      executeHost: async command => {
        await guardCurrent()
        await executeHostCommand(command)
      },
      handle: (commandId, handler) => {
        guard()
        const disposable = registerPluginCommandHandler(pluginId, commandId, async (argument) => {
          await guardCurrent()
          return handler(argument)
        })
        disposables.push(disposable)
        return disposable
      },
    },
    workspace: {
      getCurrent: async () => {
        await guardCurrent()
        const current = await getCurrentWorkspaceInfo()
        await guardCurrent()
        return current
      },
      onDidChange: (listener) => {
        guard()
        let previousPath = useSettingStore.getState().workspacePath
        const unsubscribe = useSettingStore.subscribe((state) => {
          if (state.workspacePath === previousPath || signal.aborted) return
          previousPath = state.workspacePath
          void getCurrentWorkspaceInfo()
            .then((current) => {
              guard()
              return listener({ previous: null, current })
            })
            .catch(() => undefined)
        })
        const disposable = { dispose: unsubscribe }
        disposables.push(disposable)
        return disposable
      },
    },
    calendar: {
      resolveDay: async (dayOptions) => {
        await guardCurrent()
        const day = await resolveDay(dayOptions)
        await guardCurrent()
        return day
      },
    },
    fileIcons: {
      setRules: async rules => { await guardCurrent(); setRuntimeFileIcons(pluginId, rules, signal) },
      clear: async () => { await guardCurrent(); clearRuntimeFileIcons(pluginId, signal) },
    },
    attachments: {
      read: async (options) => {
        const path = normalizeAttachmentPath(options.path)
        await guardCurrent('attachments.read', path)
        const workspace = await getCurrentWorkspaceSnapshot()
        await guardCurrent('attachments.read', path)
        const result = await invokePluginBackend<PluginAttachment>('plugin_read_attachment', { workspaceRoot: workspace.root, relativePath: path })
        await guardCurrent('attachments.read', path)
        return result
      },
      create: async (options) => {
        const path = normalizeAttachmentPath(options.path)
        if (typeof options.base64 !== 'string' || options.base64.length > 1_398_104) throw new PluginError('QuotaExceeded', 'Attachment exceeds 1 MiB')
        await guardCurrent('attachments.create', path)
        const workspace = await getCurrentWorkspaceSnapshot()
        await guardCurrent('attachments.create', path)
        const result = await invokePluginBackend<{ path: string; size: number }>('plugin_create_attachment', { workspaceRoot: workspace.root, relativePath: path, base64: options.base64 })
        try { await guardCurrent('attachments.create', path) } catch {
          throw new PluginError('Cancelled', 'Attachment was created before the plugin context changed', { committed: true, path })
        }
        return result
      },
    },
    notes: {
      search: async (searchOptions: SearchNotesOptions): Promise<SearchNotesResult> => {
        const { query, folder = '', caseSensitive = false, limit = 50 } = searchOptions
        if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new PluginError('InvalidPath', 'Search query must contain 1–500 characters')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new PluginError('InvalidPath', 'Search limit must be between 1 and 100')
        await guardCurrent('notes.list', folder)
        await guardCurrent('notes.read')
        const listed = await listNotes(pluginId, folder, true, 200)
        const needle = caseSensitive ? query : query.toLowerCase()
        const matches: Array<SearchNotesResult['matches'][number]> = []
        let scannedBytes = 0
        let truncated = listed.truncated
        for (const entry of listed.entries) {
          guard()
          if (!canUsePluginPermission(pluginId, 'notes.read', entry.path)) continue
          if (entry.size > MAX_NOTE_BYTES || scannedBytes + entry.size > 8 * MAX_NOTE_BYTES) { truncated = true; continue }
          await guardCurrent('notes.read', entry.path)
          let note
          try { note = await readNote(pluginId, entry.path) } catch (error) {
            if (isPluginError(error) && error.code === 'NotFound') continue
            throw error
          }
          await guardCurrent('notes.read', entry.path)
          scannedBytes += new TextEncoder().encode(note.content).byteLength
          if (scannedBytes > 8 * MAX_NOTE_BYTES) { truncated = true; break }
          for (const [index, line] of note.content.split('\n').entries()) {
            const position = (caseSensitive ? line : line.toLowerCase()).indexOf(needle)
            if (position < 0) continue
            matches.push({ path: note.path, revision: note.revision, line: index + 1, preview: line.slice(Math.max(0, position - 80), Math.max(0, position - 80) + 500) })
            if (matches.length >= limit) break
          }
          if (matches.length >= limit) { truncated = true; break }
        }
        await guardCurrent('notes.list', folder)
        for (const path of new Set(matches.map(match => match.path))) await guardCurrent('notes.read', path)
        return { matches, truncated }
      },
      read: async ({ path }) => {
        await guardCurrent('notes.read', path)
        const note = await readNote(pluginId, path)
        await guardCurrent('notes.read', path)
        return note
      },
      openOrCreate: async (noteOptions) => {
        if (noteOptions.create !== false) await guardCurrent('notes.create', noteOptions.path)
        if (noteOptions.open) await guardCurrent('notes.open', noteOptions.path)
        const result = await openOrCreateNote(pluginId, noteOptions, guard)
        if (noteOptions.create !== false) await guardCurrent('notes.create', noteOptions.path)
        if (noteOptions.open) await guardCurrent('notes.open', noteOptions.path)
        return result
      },
      list: async (listOptions = {}) => {
        await guardCurrent('notes.list', listOptions.folder ?? '')
        return listNotes(pluginId, listOptions.folder, listOptions.recursive, listOptions.limit, listOptions.cursor)
      },
      write: async (writeOptions) => {
        await guardCurrent('notes.write', writeOptions.path)
        return writeNote(pluginId, writeOptions, () => guardCurrent('notes.write', writeOptions.path))
      },
      move: async (moveOptions) => {
        await guardCurrent('notes.move', moveOptions.from)
        await guardCurrent('notes.move', moveOptions.to)
        return moveNote(pluginId, moveOptions.from, moveOptions.to, async () => {
          await guardCurrent('notes.move', moveOptions.from)
          await guardCurrent('notes.move', moveOptions.to)
        })
      },
      delete: async (deleteOptions) => {
        await guardCurrent('notes.delete', deleteOptions.path)
        return deleteNote(pluginId, deleteOptions.path, deleteOptions.expectedRevision, () => guardCurrent('notes.delete', deleteOptions.path))
      },
      onDidChange: (listener) => {
        guard()
        const permissions = currentPlugin(pluginId).manifest.permissions
        if (!permissions['notes.list'] && !permissions['notes.read']) {
          throw new PluginError('PermissionDenied', 'Note events require notes.read or notes.list')
        }
        const disposable = onDidChangePluginNotes(async (event) => {
          const visibleEvent = await filterPluginNoteChangeEvent(pluginId, event, workspaceBinding)
          if (!visibleEvent) return
          guard()
          return listener(visibleEvent)
        }, false, workspaceBinding)
        disposables.push(disposable)
        return disposable
      },
    },
    editor: {
      getActiveEditor: async () => {
        await guardCurrent('editor.read')
        const editor = await getActivePluginEditor()
        await guardCurrent('editor.read')
        return editor
      },
      getSelection: async () => {
        await guardCurrent('editor.read')
        const selection = await getPluginEditorSelection()
        await guardCurrent('editor.read')
        return selection
      },
      getTextSnapshot: async (snapshotOptions) => {
        await guardCurrent('editor.read')
        const snapshot = await getPluginEditorTextSnapshot(snapshotOptions)
        await guardCurrent('editor.read')
        return snapshot
      },
      applyEdit: async (editOptions) => {
        await guardCurrent('editor.write')
        const result = await applyPluginEditorEdit(editOptions)
        await guardCurrent('editor.write')
        return result
      },
      applyEdits: async (editOptions) => {
        await guardCurrent('editor.write')
        const result = await applyPluginEditorEdits(editOptions)
        try { await guardCurrent('editor.write') } catch (error) {
          throw new PluginError('Cancelled', toPluginError(error).message, { committed: true })
        }
        return result
      },
      setSelection: async (selectionOptions) => {
        await guardCurrent('editor.write')
        await setPluginEditorSelection(selectionOptions)
      },
      onDidChangeActiveEditor: (listener) => {
        guard()
        assertPermission(pluginId, 'editor.read')
        const disposable = onDidChangeActivePluginEditor(async (value) => {
          await guardCurrent('editor.read')
          return listener(value)
        })
        disposables.push(disposable)
        return disposable
      },
      onDidChangeContent: (listener) => {
        guard()
        assertPermission(pluginId, 'editor.read')
        const disposable = onDidChangePluginEditorContent(async (value) => {
          await guardCurrent('editor.read')
          return listener(value)
        })
        disposables.push(disposable)
        return disposable
      },
    },
    storage: {
      device: createStorageArea(pluginId, 'device', guardCurrent, guard),
      workspace: createStorageArea(pluginId, 'workspace', guardCurrent, guard),
    },
    ui: {
      showNotice: async (message) => {
        await guardCurrent()
        sonnerToast(message.slice(0, MAX_NOTICE_LENGTH))
      },
      statusBar: {
        update: async (itemId, state) => {
          await guardCurrent()
          updateStatusBar(pluginId, itemId, state, guard)
          await guardCurrent()
        },
      },
      views: {
        close: async (itemId) => { await guardCurrent(); await closePluginView(pluginId, itemId); await guardCurrent() },
        focus: async (itemId) => { await guardCurrent(); await openPluginView(pluginId, itemId, guard); await guardCurrent() },
        getState: async (itemId) => { await guardCurrent(); return getPluginViewState(pluginId, itemId) },
        onDidChange: listener => {
          guard()
          const disposable = onPluginViewChange(pluginId, async state => { await guardCurrent(); return listener(state) })
          disposables.push(disposable)
          return disposable
        },
        update: async (itemId, content) => {
          await guardCurrent()
          updatePluginView(pluginId, itemId, content)
          await guardCurrent()
        },
        open: async (itemId) => {
          await guardCurrent()
          await openPluginView(pluginId, itemId, guard)
          await guardCurrent()
        },
      },
      openDialog: async (dialogOptions) => {
        await guardCurrent()
        const handle = openPluginDialog(pluginId, dialogOptions)
        try {
          await guardCurrent()
        } catch (error) {
          closePluginDialog(pluginId, handle.id)
          throw error
        }
        return handle
      },
      updateDialog: async (id, options) => {
        await guardCurrent()
        updatePluginDialog(pluginId, id, options)
      },
      closeDialog: async id => { await guardCurrent(); closePluginDialog(pluginId, id) },
      onDidCloseDialog: listener => {
        guard()
        const disposable = onPluginDialogClose(pluginId, async event => { await guardCurrent(); return listener(event) })
        disposables.push(disposable)
        return disposable
      },
    },
    network: {
      fetch: async (request) => {
        await guardCurrent('network.fetch', normalizeNetworkOrigin(request.url).origin)
        return fetchNetwork(pluginId, request, guard)
      },
    },
    i18n: {
      t: (key, values) => translate(messages, key, values),
    },
    settings: {
      get: (key) => {
        guard()
        return settingFor(pluginId, key)
      },
      onDidChange: (listener) => {
        guard()
        let previous = Object.fromEntries(
          (plugin.manifest.contributes.settings ?? []).map((setting) => [setting.key, settingFor(pluginId, setting.key)]),
        )
        const unsubscribe = usePluginStore.subscribe(() => {
          try {
            guard()
          } catch {
            return
          }
          for (const setting of plugin.manifest.contributes.settings ?? []) {
            const value = settingFor(pluginId, setting.key)
            if (value !== undefined && value !== previous[setting.key]) {
              try {
                void Promise.resolve(listener(setting.key, value)).catch(() => undefined)
              } catch {
                // A plugin listener must not interrupt the host store update.
              }
            }
          }
          previous = Object.fromEntries(
            (plugin.manifest.contributes.settings ?? []).map((setting) => [setting.key, settingFor(pluginId, setting.key)]),
          )
        })
        const disposable = { dispose: unsubscribe }
        disposables.push(disposable)
        return disposable
      },
    },
  }
}

export async function invokePluginCapability(
  pluginId: string,
  method: PluginRpcMethod,
  params: unknown,
  signal?: AbortSignal,
  workspaceBinding?: PluginWorkspaceBinding,
  expectedPlugin?: InstalledPlugin,
): Promise<unknown> {
  assertPluginWorkspaceBinding(workspaceBinding)
  const plugin = currentPlugin(pluginId)
  if (expectedPlugin && getPluginManifestFingerprint(plugin) !== getPluginManifestFingerprint(expectedPlugin)) {
    throw new PluginError('Cancelled', 'The plugin runtime belongs to a previous package')
  }
  if (!usePluginStore.getState().isEnabled(pluginId)) {
    throw new PluginError('Cancelled', 'The plugin is disabled')
  }
  if (signal?.aborted) throw new PluginError('Cancelled', 'The plugin runtime has stopped')
  const currentStore = usePluginStore.getState()
  const currentBinding = workspaceBinding ?? {
    workspaceId: currentStore.currentWorkspaceId ?? '',
    workspaceKey: currentStore.currentWorkspaceKey ?? '',
  }
  await assertCurrentPluginAuthority(pluginId, currentBinding)
  const context = createPluginContext({
    plugin,
    signal: signal ?? new AbortController().signal,
    messages: {},
    disposables: [],
    workspaceBinding: currentBinding,
  })
  const record = isRecord(params) ? params : {}

  switch (method) {
    case 'workspace.getCurrent':
      return context.workspace.getCurrent()
    case 'calendar.resolveDay':
      return context.calendar.resolveDay({
        timeZone: requireString(record.timeZone, 'timeZone'),
        dayStartsAt: requireString(record.dayStartsAt, 'dayStartsAt'),
      })
    case 'fileIcons.setRules':
      return context.fileIcons.setRules(record.rules as unknown as PluginFileIconRule[])
    case 'fileIcons.clear': return context.fileIcons.clear()
    case 'attachments.read':
      return context.attachments.read({ path: requireString(record.path, 'path') })
    case 'attachments.create':
      return context.attachments.create({ path: requireString(record.path, 'path'), base64: requireString(record.base64, 'base64') })
    case 'notes.read':
      return context.notes.read({ path: requireString(record.path, 'path') })
    case 'notes.openOrCreate':
      if (record.create !== undefined && typeof record.create !== 'boolean') throw new PluginError('InvalidPath', 'Invalid create option')
      return context.notes.openOrCreate({
        workspaceId: requireString(record.workspaceId, 'workspaceId'),
        path: requireString(record.path, 'path'),
        initialContent: requireString(record.initialContent, 'initialContent'),
        create: record.create !== false,
        conflict: record.conflict === 'open-existing' ? 'open-existing' : 'open-existing',
        open: record.open !== false,
        idempotencyKey: requireString(record.idempotencyKey, 'idempotencyKey'),
      })
    case 'notes.list':
      if (record.cursor !== undefined && typeof record.cursor !== 'string') throw new PluginError('InvalidPath', 'Invalid note cursor')
      return context.notes.list({
        folder: typeof record.folder === 'string' ? record.folder : '',
        recursive: record.recursive === true,
        limit: typeof record.limit === 'number' ? record.limit : undefined,
        cursor: record.cursor as string | undefined,
      })
    case 'notes.search':
      return context.notes.search({ query: requireString(record.query, 'query'), folder: typeof record.folder === 'string' ? record.folder : undefined, caseSensitive: record.caseSensitive === true, limit: typeof record.limit === 'number' ? record.limit : undefined })
    case 'notes.write':
      return context.notes.write({
        path: requireString(record.path, 'path'),
        content: requireString(record.content, 'content'),
        expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : undefined,
        create: record.create === true,
      })
    case 'notes.move':
      return context.notes.move({ from: requireString(record.from, 'from'), to: requireString(record.to, 'to'), overwrite: false })
    case 'notes.delete':
      if (typeof record.expectedRevision !== 'number' || !Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 0) {
        throw new PluginError('StaleRevision', 'Read the note and provide expectedRevision before deleting')
      }
      return context.notes.delete({
        path: requireString(record.path, 'path'),
        expectedRevision: record.expectedRevision,
      })
    case 'editor.getActiveEditor':
      return context.editor.getActiveEditor()
    case 'editor.getSelection':
      return context.editor.getSelection()
    case 'editor.getTextSnapshot':
      return context.editor.getTextSnapshot({
        editorId: requireString(record.editorId, 'editorId'),
        expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : -1,
        format: 'markdown',
      })
    case 'editor.applyEdit':
      return context.editor.applyEdit({
        editorId: requireString(record.editorId, 'editorId'),
        expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : -1,
        text: requireString(record.text, 'text'),
        target: record.target === 'selection' ? 'selection' : 'cursor',
      })
    case 'editor.applyEdits': {
      if (!Array.isArray(record.edits)) throw new PluginError('InvalidPath', 'edits must be an array')
      return context.editor.applyEdits({
        editorId: requireString(record.editorId, 'editorId'), expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : -1,
        edits: record.edits.map(edit => {
          if (!isRecord(edit) || typeof edit.from !== 'number' || typeof edit.to !== 'number') throw new PluginError('InvalidPath', 'Invalid editor range')
          return { from: edit.from, to: edit.to, text: requireString(edit.text, 'text') }
        }),
      })
    }
    case 'editor.setSelection':
      return context.editor.setSelection({ editorId: requireString(record.editorId, 'editorId'), expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : -1, from: typeof record.from === 'number' ? record.from : -1, to: typeof record.to === 'number' ? record.to : -1 })
    case 'storage.get':
      return (record.scope === 'workspace' ? context.storage.workspace : context.storage.device)
        .get(requireString(record.key, 'key'))
    case 'storage.set':
      return (record.scope === 'workspace' ? context.storage.workspace : context.storage.device)
        .set(
          requireString(record.key, 'key'),
          requirePluginJsonValue(record.value, 'value'),
        )
    case 'storage.delete':
      return (record.scope === 'workspace' ? context.storage.workspace : context.storage.device)
        .delete(requireString(record.key, 'key'))
    case 'ui.showNotice':
      return context.ui.showNotice(requireString(record.message, 'message'))
    case 'ui.statusBar.update':
      if (!isRecord(record.state)) {
        throw new PluginError('RuntimeFailure', 'Invalid status bar state')
      }
      return context.ui.statusBar.update(
        requireString(record.id, 'id'),
        record.state as unknown as PluginStatusBarUpdate,
      )
    case 'ui.views.update':
      if (!isRecord(record.content)) throw new PluginError('RuntimeFailure', 'Invalid view content')
      return context.ui.views.update(requireString(record.id, 'id'), record.content as unknown as PluginUiDocument)
    case 'ui.views.open':
      return context.ui.views.open(requireString(record.id, 'id'))
    case 'ui.views.close': return context.ui.views.close(requireString(record.id, 'id'))
    case 'ui.views.focus': return context.ui.views.focus(requireString(record.id, 'id'))
    case 'ui.views.getState': return context.ui.views.getState(requireString(record.id, 'id'))
    case 'ui.closeDialog': return context.ui.closeDialog(requireString(record.id, 'id'))
    case 'ui.updateDialog':
      if (!isRecord(record.options)) throw new PluginError('InvalidPath', 'Invalid dialog update')
      return context.ui.updateDialog(requireString(record.id, 'id'), record.options as unknown as PluginDialogUpdate)
    case 'commands.executeHost':
      return context.commands.executeHost(requireString(record.command, 'command') as PluginHostCommand)
    case 'ui.openDialog':
      return context.ui.openDialog(record as unknown as PluginDialogOptions)
    case 'network.fetch':
      return context.network.fetch({
        url: requireString(record.url, 'url'),
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(record.method))
          ? record.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
          : 'GET',
        headers: isRecord(record.headers)
          ? Object.fromEntries(Object.entries(record.headers).map(([key, value]) => [key, String(value)]))
          : undefined,
        body: typeof record.body === 'string' ? record.body : undefined,
        timeoutMs: typeof record.timeoutMs === 'number' ? record.timeoutMs : undefined,
      })
  }

  const unsupportedMethod: never = method
  throw new PluginError('RuntimeFailure', `Unsupported plugin API method: ${String(unsupportedMethod)}`)
}

export function toPluginError(error: unknown): PluginError {
  if (error instanceof PluginError) return error
  if (isPluginError(error)) {
    return new PluginError(error.code, error.message, error.details)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new PluginError('RuntimeFailure', message)
}

/** Preview capability is bound to one visible document and one installed package. */
export async function readPluginPreviewChunk(
  pluginId: string, binding: PluginWorkspaceBinding, expectedFingerprint: string,
  pathValue: string, offset: number, length: number,
): Promise<Uint8Array> {
  const path = normalizeRelativeMarkdownPath(`${pathValue}.md`).slice(0, -3)
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 1_048_576) throw new PluginError('QuotaExceeded', 'Invalid preview read range')
  const guard = async () => {
    const plugin = await assertCurrentPluginAuthority(pluginId, binding, 'attachments.read', path)
    if (getPluginManifestFingerprint(plugin) !== expectedFingerprint) throw new PluginError('Cancelled', 'Preview package changed')
  }
  await guard()
  const workspace = await getCurrentWorkspaceSnapshot()
  await guard()
  const base64 = await invokePluginBackend<string>('plugin_read_preview_chunk', { workspaceRoot: workspace.root, relativePath: path, offset, length })
  await guard()
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}
