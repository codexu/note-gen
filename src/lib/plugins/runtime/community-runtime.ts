import { onPluginAiStream } from '@/lib/plugins/ai'
import emitter from '@/lib/emitter'
import { clearRuntimeFileIcons } from '@/lib/plugins/resources'
import {
  PluginError,
  type PluginCommandArgument,
  type PluginCommandResult,
  type PluginDisposable,
  type PluginSettingValue,
} from '@notegen/plugin-api'
import {
  assertPluginExecutionCurrent,
  assertPluginWorkspaceBinding,
  canUsePluginPermission,
  canUsePluginPermissionCurrent,
  filterPluginNoteChangeEvent,
  isPluginWorkspaceBindingCurrent,
  invokePluginCapability,
  onDidChangePluginNotes,
  requirePluginJsonValue,
  toPluginError,
} from '@/lib/plugins/broker'
import { registerPluginCommandHandler } from '@/lib/plugins/command-registry'
import {
  onDidChangeActivePluginEditor,
  onDidChangePluginEditorContent,
} from '@/lib/plugins/editor-bridge'
import {
  getPluginManifestFingerprint,
  type InstalledPlugin,
  type PluginWorkspaceBinding,
} from '@/lib/plugins/internal-types'
import type {
  PluginHostToWorkerMessage,
  PluginRpcMethod,
  PluginRpcFailure,
  PluginWorkerToHostMessage,
} from '@/lib/plugins/runtime/protocol'
import { usePluginStore } from '@/stores/plugins'
import { onPluginViewChange, onPluginDialogClose, usePluginUiStore } from '@/lib/plugins/ui-registry'

const MAX_NETWORK_TIMEOUT_MS = 30_000
const ASYNC_OPERATION_GRACE_MS = 15_000
const ACTIVATION_TIMEOUT_MS = MAX_NETWORK_TIMEOUT_MS + ASYNC_OPERATION_GRACE_MS
const COMMAND_TIMEOUT_MS = MAX_NETWORK_TIMEOUT_MS + ASYNC_OPERATION_GRACE_MS
const MAX_RPC_PER_SECOND = 120
const MAX_NOTICES_PER_TEN_SECONDS = 5
const MAX_BRIDGE_PAYLOAD_BYTES = 2 * 1_048_576 + 128 * 1_024
const EDITOR_WINDOW_UNAVAILABLE_RPC_METHODS: ReadonlySet<PluginRpcMethod> = new Set<PluginRpcMethod>([
  'ui.prompt', 'ai.generate', 'ai.cancel',
  'records.list', 'records.read', 'records.tags', 'records.create', 'records.update', 'chat.setDraft',
  'ui.statusBar.update',
  'ui.views.update',
  'ui.views.open',
  'ui.views.close',
  'ui.views.focus',
  'ui.views.getState',
  'ui.openDialog',
  'ui.updateDialog',
  'commands.executeHost',
  'ui.closeDialog',
])

interface PendingCommand {
  resolve: (value: PluginCommandResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function parseBridgePayload(value: string | undefined, label: string): PluginCommandArgument {
  if (!value) return undefined
  if (new TextEncoder().encode(value).byteLength > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new PluginError('QuotaExceeded', `${label} exceeded the bridge payload limit`)
  }
  try {
    return requirePluginJsonValue(JSON.parse(value) as unknown, label)
  } catch {
    throw new PluginError('RuntimeFailure', `${label} is not valid JSON`)
  }
}

function serializeBridgePayload(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  requirePluginJsonValue(value, label)
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new PluginError('RuntimeFailure', `${label} is not JSON-serializable`)
  }
  if (serialized === undefined) {
    throw new PluginError('RuntimeFailure', `${label} is not JSON-serializable`)
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new PluginError('QuotaExceeded', `${label} exceeded the bridge payload limit`)
  }
  return serialized
}

function serializeBridgeError(error: PluginError): PluginRpcFailure['error'] {
  let details: PluginError['details']
  if (error.details !== undefined) {
    try {
      const serialized = serializeBridgePayload(error.details, 'Plugin error details')
      if (serialized && new TextEncoder().encode(serialized).byteLength <= 16 * 1_024) {
        details = error.details
      }
    } catch { /* Invalid optional details must not replace the original error. */ }
  }
  return { code: error.code, message: error.message.slice(0, 500), details }
}

export class CommunityPluginRuntime {
  private uiEventQueue: Promise<void> = Promise.resolve()
  private pendingUiEvents = 0
  readonly plugin: InstalledPlugin
  private readonly locale: string
  private readonly messages: Record<string, string>
  private readonly settings: Record<string, PluginSettingValue>
  private readonly workspaceBinding: PluginWorkspaceBinding
  private readonly surface: 'main' | 'editor-window'
  private worker: Worker | null = null
  private state: 'new' | 'starting' | 'active' | 'stopped' = 'new'
  private activationPromise: Promise<void> | null = null
  private activationResolve: (() => void) | null = null
  private activationReject: ((error: Error) => void) | null = null
  private activationTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pendingCommands = new Map<string, PendingCommand>()
  private readonly disposables: PluginDisposable[] = []
  private readonly controller = new AbortController()
  private previousSettings: Record<string, PluginSettingValue>
  private readonly onFailure?: (error: PluginError) => void
  private rpcWindowStartedAt = 0
  private rpcCount = 0
  private noticeWindowStartedAt = 0
  private noticeCount = 0

  constructor(options: {
    plugin: InstalledPlugin
    locale: string
    messages: Record<string, string>
    settings: Record<string, PluginSettingValue>
    workspaceBinding: PluginWorkspaceBinding
    surface: 'main' | 'editor-window'
    onFailure?: (error: PluginError) => void
  }) {
    this.plugin = options.plugin
    this.locale = options.locale
    this.messages = options.messages
    this.settings = options.settings
    this.workspaceBinding = options.workspaceBinding
    this.surface = options.surface
    this.onFailure = options.onFailure
    this.previousSettings = { ...options.settings }
  }

  async activate(entrySource: string): Promise<void> {
    if (this.state === 'active') return
    if (this.state === 'stopped') throw new PluginError('Cancelled', 'Plugin runtime has stopped')
    if (this.activationPromise) return this.activationPromise

    this.state = 'starting'
    this.activationPromise = new Promise<void>((resolve, reject) => {
      this.activationResolve = resolve
      this.activationReject = reject
    })
    const checkActivationTimeout = () => {
      if (usePluginUiStore.getState().prompt?.pluginId === this.plugin.manifest.id) {
        this.activationTimer = setTimeout(checkActivationTimeout, ACTIVATION_TIMEOUT_MS)
        return
      }
      this.fail(new PluginError('Timeout', 'Plugin activation timed out'))
    }
    this.activationTimer = setTimeout(checkActivationTimeout, ACTIVATION_TIMEOUT_MS)

    try {
      // Built separately: Next 15 Turbopack otherwise emits raw TypeScript as an asset.
      // Use the browser constructor so Turbopack leaves this public asset URL intact.
      const worker = new window.Worker('/plugin-runtime.js', {
        type: 'module',
        name: `notegen-plugin:${this.plugin.manifest.id}`,
      })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<PluginWorkerToHostMessage>) => {
        void this.handleMessage(event.data).catch((error) => this.fail(toPluginError(error)))
      }
      worker.onerror = (event) => {
        this.fail(new PluginError('RuntimeFailure', event.message || 'Plugin worker crashed'))
      }
      worker.onmessageerror = () => {
        this.fail(new PluginError('RuntimeFailure', 'Plugin sent an invalid message'))
      }
      if (this.surface === 'main') {
        this.disposables.push(onPluginViewChange(this.plugin.manifest.id, value => this.forwardUiEvent({ type: 'view-event', value })))
        this.disposables.push(onPluginDialogClose(this.plugin.manifest.id, value => this.forwardUiEvent({ type: 'dialog-closed', value })))
      }
      this.post({
        type: 'initialize',
        surface: this.surface,
        manifest: this.plugin.manifest,
        entrySource,
        locale: this.locale,
        messages: this.messages,
        settings: this.settings,
      })
    } catch (error) {
      this.fail(toPluginError(error))
    }
    return this.activationPromise
  }

  async executeCommand(
    commandId: string,
    argument?: PluginCommandArgument,
  ): Promise<PluginCommandResult> {
    this.assertCurrent()
    await assertPluginExecutionCurrent(this.plugin.manifest.id, this.workspaceBinding)
    this.assertCurrent()
    if (this.state !== 'active') throw new PluginError('RuntimeFailure', 'Plugin is not active')
    if (this.pendingCommands.size >= 16) {
      throw new PluginError('QuotaExceeded', 'Plugin has too many pending commands')
    }
    if (argument !== undefined) requirePluginJsonValue(argument, 'Plugin command argument')
    const requestId = createRequestId()
    return new Promise<PluginCommandResult>((resolve, reject) => {
      const checkTimeout = () => {
        const pending = this.pendingCommands.get(requestId)
        if (!pending) return
        if (usePluginUiStore.getState().prompt?.pluginId === this.plugin.manifest.id) {
          pending.timer = setTimeout(checkTimeout, COMMAND_TIMEOUT_MS)
          return
        }
        this.pendingCommands.delete(requestId)
        const error = new PluginError('Timeout', `Plugin command timed out: ${commandId}`)
        reject(error)
        this.fail(error)
      }
      const timer = setTimeout(checkTimeout, COMMAND_TIMEOUT_MS)
      this.pendingCommands.set(requestId, { resolve, reject, timer })
      this.post({ type: 'execute-command', requestId, commandId, argument })
    })
  }

  stop(): void {
    if (this.state === 'stopped') return
    const wasActive = this.state === 'active'
    const worker = this.worker
    this.worker = null
    if (this.state === 'starting') {
      this.activationReject?.(new PluginError('Cancelled', 'Plugin activation was cancelled'))
    }
    this.controller.abort()
    clearRuntimeFileIcons(this.plugin.manifest.id, this.controller.signal)
    this.state = 'stopped'
    this.activationResolve = null
    this.activationReject = null
    if (this.activationTimer) clearTimeout(this.activationTimer)
    this.activationTimer = null
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer)
      pending.reject(new PluginError('Cancelled', 'Plugin runtime stopped'))
    }
    this.pendingCommands.clear()
    for (const disposable of this.disposables.splice(0)) {
      try { disposable.dispose() } catch { /* Continue releasing other host resources. */ }
    }
    if (worker && wasActive) {
      try { worker.postMessage({ type: 'deactivate' }) } catch { /* Termination below remains mandatory. */ }
    }
    setTimeout(() => worker?.terminate(), 150)
  }

  private forwardUiEvent(message: Extract<PluginHostToWorkerMessage, { type: 'view-event' | 'dialog-closed' }>): Promise<void> {
    if (this.pendingUiEvents >= 64) {
      const error = new PluginError('QuotaExceeded', 'Plugin UI event queue exceeded its limit')
      this.fail(error)
      return Promise.reject(error)
    }
    this.pendingUiEvents += 1
    const pending = this.uiEventQueue.then(async () => {
      this.assertCurrent()
      await assertPluginExecutionCurrent(this.plugin.manifest.id, this.workspaceBinding)
      this.assertCurrent()
      this.post(message)
    }).finally(() => { this.pendingUiEvents -= 1 })
    this.uiEventQueue = pending.catch(() => undefined)
    return pending
  }

  private post(message: PluginHostToWorkerMessage): void {
    if (!this.worker || this.state === 'stopped') return
    try { this.worker.postMessage(message) } catch (error) { this.fail(toPluginError(error)) }
  }

  private assertCurrent(): void {
    if (this.controller.signal.aborted) throw new PluginError('Cancelled', 'The plugin runtime stopped')
    assertPluginWorkspaceBinding(this.workspaceBinding)
    const store = usePluginStore.getState()
    const current = store.installed.find(plugin => plugin.manifest.id === this.plugin.manifest.id)
    if (!current || !store.isEnabled(this.plugin.manifest.id)
      || getPluginManifestFingerprint(current) !== getPluginManifestFingerprint(this.plugin)) {
      throw new PluginError('Cancelled', 'The plugin runtime belongs to a previous package or enablement state')
    }
  }

  private async handleMessage(message: PluginWorkerToHostMessage): Promise<void> {
    if (this.state === 'stopped') return
    if (message.type === 'log') {
      this.assertCurrent()
      usePluginStore.getState().addLog({ pluginId: this.plugin.manifest.id, level: message.level, message: message.message })
      return
    }
    if (message.type === 'rpc-request') {
      if (!this.consumeRpcBudget(message.method)) {
        this.fail(new PluginError('QuotaExceeded', 'Plugin exceeded the host call rate limit'))
        return
      }
      try {
        if (
          this.surface === 'editor-window'
          && EDITOR_WINDOW_UNAVAILABLE_RPC_METHODS.has(message.method)
        ) {
          throw new PluginError(
            'UnavailableOnPlatform',
            'This plugin UI surface is unavailable in a standalone editor window',
          )
        }
        const params = parseBridgePayload(message.paramsJson, 'Plugin API request')
        const value = await invokePluginCapability(
          this.plugin.manifest.id,
          message.method,
          params,
          this.controller.signal,
          this.workspaceBinding,
          this.plugin,
        )
        if (this.controller.signal.aborted) return
        const valueJson = serializeBridgePayload(value, 'Plugin API result')
        this.post({ type: 'rpc-result', requestId: message.requestId, ok: true, valueJson })
      } catch (error) {
        const pluginError = toPluginError(error)
        this.post({
          type: 'rpc-result',
          requestId: message.requestId,
          ok: false,
          error: serializeBridgeError(pluginError),
        })
      }
      return
    }

    if (message.type === 'ready') {
      this.handleReady(message.commands)
      return
    }

    if (message.type === 'command-result') {
      const pending = this.pendingCommands.get(message.requestId)
      if (!pending) return
      this.pendingCommands.delete(message.requestId)
      clearTimeout(pending.timer)
      if (message.ok) {
        try {
          this.assertCurrent()
          pending.resolve(parseBridgePayload(message.valueJson, 'Plugin command result'))
        } catch (error) {
          const pluginError = toPluginError(error)
          pending.reject(pluginError)
          this.fail(pluginError)
        }
      }
      else pending.reject(new PluginError(message.error.code, message.error.message, message.error.details))
      return
    }

    if (message.type === 'runtime-error') {
      this.fail(new PluginError(message.code, message.message))
    }
  }

  private consumeRpcBudget(method: string): boolean {
    const now = Date.now()
    if (now - this.rpcWindowStartedAt >= 1_000) {
      this.rpcWindowStartedAt = now
      this.rpcCount = 0
    }
    this.rpcCount += 1
    if (this.rpcCount > MAX_RPC_PER_SECOND) return false

    if (method === 'ui.showNotice') {
      if (now - this.noticeWindowStartedAt >= 10_000) {
        this.noticeWindowStartedAt = now
        this.noticeCount = 0
      }
      this.noticeCount += 1
      if (this.noticeCount > MAX_NOTICES_PER_TEN_SECONDS) return false
    }
    return true
  }

  private handleReady(commandIds: string[]): void {
    if (this.state !== 'starting') return
    this.assertCurrent()
    const declaredCommands = new Set(
      (this.plugin.manifest.contributes.commands ?? []).map((command) => command.id),
    )
    for (const commandId of commandIds) {
      if (!declaredCommands.has(commandId)) {
        this.fail(new PluginError('PermissionDenied', `Plugin registered an undeclared command: ${commandId}`))
        return
      }
      this.disposables.push(registerPluginCommandHandler(
        this.plugin.manifest.id,
        commandId,
        (argument) => this.executeCommand(commandId, argument),
      ))
    }

    if (canUsePluginPermission(this.plugin.manifest.id, 'editor.read')) {
      this.disposables.push(onDidChangeActivePluginEditor(async (value) => {
        if (
          !isPluginWorkspaceBindingCurrent(this.workspaceBinding)
          || !await canUsePluginPermissionCurrent(
            this.plugin.manifest.id,
            'editor.read',
            undefined,
            this.workspaceBinding,
          )
        ) return
        try { this.assertCurrent() } catch { return }
        this.post({ type: 'editor-event', event: 'active-editor-changed', value })
      }))
      this.disposables.push(onDidChangePluginEditorContent(async (value) => {
        if (
          !isPluginWorkspaceBindingCurrent(this.workspaceBinding)
          || !await canUsePluginPermissionCurrent(
            this.plugin.manifest.id,
            'editor.read',
            undefined,
            this.workspaceBinding,
          )
        ) return
        try { this.assertCurrent() } catch { return }
        this.post({ type: 'editor-event', event: 'content-changed', value })
      }))
    }

    if (this.surface === 'main' && canUsePluginPermission(this.plugin.manifest.id, 'ai.generate')) {
      this.disposables.push(onPluginAiStream(this.plugin.manifest.id, async value => {
        if (!await canUsePluginPermissionCurrent(this.plugin.manifest.id, 'ai.generate', undefined, this.workspaceBinding)) return
        try { this.assertCurrent(); this.post({ type: 'ai-event', value }) } catch { /* Runtime stopped. */ }
      }))
    }

    if (this.surface === 'main' && canUsePluginPermission(this.plugin.manifest.id, 'records.read')) {
      const changed = () => {
        void canUsePluginPermissionCurrent(this.plugin.manifest.id, 'records.read', undefined, this.workspaceBinding).then(granted => {
          if (!granted || !isPluginWorkspaceBindingCurrent(this.workspaceBinding)) return
          try { this.assertCurrent(); this.post({ type: 'record-event' }) } catch { /* Runtime stopped. */ }
        }).catch(() => undefined)
      }
      emitter.on('plugin-records-changed', changed)
      this.disposables.push({ dispose: () => emitter.off('plugin-records-changed', changed) })
    }

    const canObserveNotes = canUsePluginPermission(this.plugin.manifest.id, 'notes.list')
      || canUsePluginPermission(this.plugin.manifest.id, 'notes.read')
    if (canObserveNotes) {
      this.disposables.push(onDidChangePluginNotes(async (value) => {
        if (!isPluginWorkspaceBindingCurrent(this.workspaceBinding)) return
        const visibleEvent = await filterPluginNoteChangeEvent(
          this.plugin.manifest.id,
          value,
          this.workspaceBinding,
        )
        if (!visibleEvent) return
        try { this.assertCurrent() } catch { return }
        this.post({ type: 'note-event', value: visibleEvent })
      }, true, this.workspaceBinding))
    }

    void invokePluginCapability(
      this.plugin.manifest.id,
      'workspace.getCurrent',
      {},
      this.controller.signal,
      this.workspaceBinding,
      this.plugin,
    ).then((current) => {
      this.assertCurrent()
      this.post({
        type: 'workspace-event',
        value: { previous: null, current: current as { id: string; name: string } },
      })
    }).catch(() => undefined)

    const syncSettings = () => {
      try { this.assertCurrent() } catch { return }
      for (const setting of this.plugin.manifest.contributes.settings ?? []) {
        const value = usePluginStore.getState().getSetting(this.plugin.manifest.id, setting.key)
        if (value === undefined || value === this.previousSettings[setting.key]) continue
        this.previousSettings[setting.key] = value
        this.post({ type: 'settings-changed', key: setting.key, value })
      }
    }
    const unsubscribe = usePluginStore.subscribe(syncSettings)
    this.disposables.push({ dispose: unsubscribe })
    syncSettings()

    this.assertCurrent()
    this.state = 'active'
    if (this.activationTimer) clearTimeout(this.activationTimer)
    this.activationTimer = null
    this.activationResolve?.()
    this.activationResolve = null
    this.activationReject = null
  }

  private fail(error: PluginError): void {
    if (this.state === 'stopped') return
    const wasActive = this.state === 'active'
    this.activationReject?.(error)
    this.activationReject = null
    this.activationResolve = null
    this.stop()
    if (wasActive) this.onFailure?.(error)
  }
}
