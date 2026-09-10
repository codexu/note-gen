import {
  PluginError,
  type PluginActivationEvent,
  type PluginDisposable,
  type PluginPermissionName,
  type PluginSettingValue,
} from '@notegen/plugin-api'
import {
  assertPluginExecutionCurrent,
  assertPluginWorkspaceBinding,
  canUsePluginPermission,
  clearPendingPluginStatusBarUpdates,
  filterPluginNoteChangeEvent,
  isPluginWorkspaceBindingCurrent,
  onDidChangePluginNotes,
} from '@/lib/plugins/broker'
import {
  registerPluginContributions,
  setPluginActivationResolver,
} from '@/lib/plugins/command-registry'
import { hasActiveMarkdownPluginEditor, onDidChangeActivePluginEditor } from '@/lib/plugins/editor-bridge'
import { getPluginPlatform, readPluginEntry } from '@/lib/plugins/backend'
import { loadPluginMessages } from '@/lib/plugins/localization'
import { CommunityPluginRuntime } from '@/lib/plugins/runtime/community-runtime'
import {
  getPluginManifestFingerprint,
  getPluginRevocation,
  type InstalledPlugin,
  type PluginWorkspaceBinding,
} from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { clearPluginUi, setPluginViewActivationResolver } from '@/lib/plugins/ui-registry'
import { startDevelopmentAutoReload } from '@/lib/plugins/development-reload'

interface ActiveRuntime {
  signature: string
  activationId: symbol
  stop: () => void
}

export type PluginHostSurface = 'main' | 'editor-window'

function settingsFor(plugin: InstalledPlugin): Record<string, PluginSettingValue> {
  return Object.fromEntries(
    (plugin.manifest.contributes.settings ?? []).map((setting) => [
      setting.key,
      usePluginStore.getState().getSetting(plugin.manifest.id, setting.key) ?? setting.default,
    ]),
  )
}

function pluginSignature(plugin: InstalledPlugin): string {
  const state = usePluginStore.getState().getWorkspaceState(plugin.manifest.id)
  return [
    getPluginManifestFingerprint(plugin),
    plugin.activeVersion,
    plugin.contentHash,
    state?.enablement ?? 'disabled',
    state?.enabledFingerprint ?? '@unapproved-package',
    JSON.stringify(state?.permissions ?? {}),
  ].join(':')
}

function pluginRuntimeSignature(plugin: InstalledPlugin, locale: string): string {
  const store = usePluginStore.getState()
  return [
    pluginSignature(plugin),
    locale,
    store.currentWorkspaceId ?? '@no-workspace',
    store.currentWorkspaceKey ?? '@no-workspace-key',
  ].join(':')
}

function pluginContributionSignature(plugin: InstalledPlugin, locale: string): string {
  const store = usePluginStore.getState()
  return [
    getPluginManifestFingerprint(plugin),
    plugin.activeVersion,
    locale,
    store.currentWorkspaceId ?? '@no-workspace',
    store.currentWorkspaceKey ?? '@no-workspace-key',
  ].join(':')
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PluginHost {
  private stopDevelopmentReload: (() => void) | null = null
  private marketRefreshTimer: ReturnType<typeof setInterval> | null = null
  private initialized = false
  private locale = 'en'
  private platform: 'desktop' | 'ios' | 'android' = 'desktop'
  private surface: PluginHostSurface = 'main'
  private storeUnsubscribe: (() => void) | null = null
  private settingsUnsubscribe: (() => void) | null = null
  private editorSubscription: PluginDisposable | null = null
  private noteSubscription: PluginDisposable | null = null
  private contributionDisposables = new Map<string, PluginDisposable>()
  private contributionVersions = new Map<string, string>()
  private runtimes = new Map<string, ActiveRuntime>()
  private pendingRuntimes = new Map<string, {
    generation: number
    activationId: symbol
    runtime: ActiveRuntime
  }>()
  private activations = new Map<string, {
    generation: number
    activationId: symbol
    signature: string
    promise: Promise<void>
  }>()
  private reconcileQueue: Promise<void> = Promise.resolve()
  private lastStoreSignature = ''
  private lastDeveloperMode = false
  private lastWorkspacePath = ''
  private workspaceTransitioning = false
  private lifecycleGeneration = 0

  async initialize(locale: string, surface: PluginHostSurface = 'main'): Promise<void> {
    const generation = ++this.lifecycleGeneration
    this.locale = locale
    this.surface = surface
    const platform = await getPluginPlatform()
    if (generation !== this.lifecycleGeneration) return
    this.platform = platform
    await usePluginStore.getState().initialize()
    if (generation !== this.lifecycleGeneration) return
    if (this.initialized) {
      await this.reconcile()
      return
    }

    this.initialized = true
    if (this.platform === 'desktop') {
      void usePluginStore.getState().refreshMarket(true)
      this.marketRefreshTimer = setInterval(() => {
        if (!usePluginStore.getState().marketLoading) void usePluginStore.getState().refreshMarket(true)
      }, 30 * 60 * 1_000)
    }
    if (this.surface === 'main' && this.platform === 'desktop') this.stopDevelopmentReload = startDevelopmentAutoReload()
    setPluginActivationResolver((pluginId, commandId) => this.activate(pluginId, `onCommand:${commandId}`))
    setPluginViewActivationResolver(pluginId => this.activate(pluginId))
    this.editorSubscription = onDidChangeActivePluginEditor((event) => {
      if (!event.current) return
      void this.activateEditorPlugins()
    })
    this.noteSubscription = onDidChangePluginNotes((event) => {
      const store = usePluginStore.getState()
      const workspaceId = store.currentWorkspaceId
      const workspaceKey = store.currentWorkspaceKey
      if (!workspaceId || !workspaceKey) return
      const workspaceBinding = { workspaceId, workspaceKey }
      for (const plugin of store.installed) {
        if (
          !this.runtimes.has(plugin.manifest.id)
          && !this.activations.has(plugin.manifest.id)
          && store.isEnabled(plugin.manifest.id)
          && plugin.manifest.activationEvents.includes('onNotes:change')
        ) {
          void filterPluginNoteChangeEvent(plugin.manifest.id, event, workspaceBinding)
            .then((visibleEvent) => {
              if (!visibleEvent || !isPluginWorkspaceBindingCurrent(workspaceBinding)) return
              return this.activate(plugin.manifest.id, 'onNotes:change')
            })
            .catch((error) => this.logHostError(error))
        }
      }
    })
    this.lastStoreSignature = this.getStoreSignature()
    this.storeUnsubscribe = usePluginStore.subscribe(() => {
      const signature = this.getStoreSignature()
      if (signature === this.lastStoreSignature) return
      this.lastStoreSignature = signature
      void this.reconcile().catch((error) => this.logHostError(error))
    })
    this.lastDeveloperMode = useSettingStore.getState().developerMode
    this.lastWorkspacePath = useSettingStore.getState().workspacePath
    this.settingsUnsubscribe = useSettingStore.subscribe((state) => {
      const developerModeChanged = state.developerMode !== this.lastDeveloperMode
      const workspaceChanged = state.workspacePath !== this.lastWorkspacePath
      this.lastDeveloperMode = state.developerMode
      this.lastWorkspacePath = state.workspacePath
      if (developerModeChanged && !state.developerMode) {
        this.cancelPendingActivations()
        this.stopAllRuntimes()
      }
      if (workspaceChanged) {
        void this.changeWorkspace().catch((error) => this.logHostError(error))
        return
      }
      if (!developerModeChanged) return
      void this.reconcile().catch((error) => this.logHostError(error))
    })
    await this.reconcile()
  }

  async changeWorkspace(): Promise<void> {
    const generation = ++this.lifecycleGeneration
    this.workspaceTransitioning = true
    this.cancelPendingActivations()
    this.stopAllRuntimes()
    this.clearContributions()
    try {
      await usePluginStore.getState().refreshWorkspace()
      if (!this.initialized || generation !== this.lifecycleGeneration) return
      this.workspaceTransitioning = false
      await this.reconcile()
    } catch (error) {
      // Stay fail-closed until a later workspace refresh succeeds or the host
      // is reinitialized. No contribution may reactivate against stale grants.
      throw error
    }
  }

  async reconcile(): Promise<void> {
    const generation = this.lifecycleGeneration
    const operation = this.reconcileQueue
      .catch(() => undefined)
      .then(async () => {
        if (
          !this.initialized
          || this.workspaceTransitioning
          || generation !== this.lifecycleGeneration
        ) return
        await this.reconcileNow(generation)
      })
    this.reconcileQueue = operation.catch((error) => this.logHostError(error))
    return operation
  }

  async activate(pluginId: string, activationEvent?: string): Promise<void> {
    if (!this.initialized) throw new PluginError('Cancelled', 'The plugin host is not running')
    if (this.workspaceTransitioning || !isPluginWorkspaceBindingCurrent()) {
      throw new PluginError('Cancelled', 'The active workspace is changing')
    }
    const generation = this.lifecycleGeneration
    const plugin = usePluginStore.getState().installed.find((item) => item.manifest.id === pluginId)
    const signature = plugin ? pluginRuntimeSignature(plugin, this.locale) : '@missing'
    const pending = this.activations.get(pluginId)
    if (pending?.generation === generation && pending.signature === signature) return pending.promise
    if (pending) this.cancelPendingActivation(pluginId, pending.activationId)

    const activationId = Symbol(pluginId)
    const record = {
      generation,
      activationId,
      signature,
      promise: Promise.resolve(),
    }
    this.activations.set(pluginId, record)
    const activation = Promise.resolve().then(() => this.activateOnce(
      pluginId,
      activationEvent,
      generation,
      activationId,
      signature,
    ))
    record.promise = activation
    try {
      await activation
    } finally {
      if (this.activations.get(pluginId) === record) this.activations.delete(pluginId)
    }
  }

  private async activateOnce(
    pluginId: string,
    activationEvent: string | undefined,
    generation: number,
    activationId: symbol,
    expectedRuntimeSignature: string,
  ): Promise<void> {
    this.assertActivationCurrent(pluginId, generation, activationId)
    const store = usePluginStore.getState()
    const workspaceId = store.currentWorkspaceId
    const workspaceKey = store.currentWorkspaceKey
    if (workspaceId === null || workspaceKey === null) {
      throw new PluginError('Cancelled', 'No plugin workspace is active')
    }
    const workspaceBinding: PluginWorkspaceBinding = { workspaceId, workspaceKey }
    assertPluginWorkspaceBinding(workspaceBinding)
    await assertPluginExecutionCurrent(pluginId, workspaceBinding)
    const plugin = store.installed.find((item) => item.manifest.id === pluginId)
    if (!plugin || !store.isEnabled(pluginId)) {
      throw new PluginError('Cancelled', 'Plugin is not enabled in this workspace')
    }
    if (pluginRuntimeSignature(plugin, this.locale) !== expectedRuntimeSignature) {
      throw new PluginError('Cancelled', 'Plugin state changed before activation')
    }
    if (activationEvent && !plugin.manifest.activationEvents.includes(activationEvent as PluginActivationEvent)) {
      const isCommand = activationEvent.startsWith('onCommand:')
      if (!isCommand) return
    }
    if (!plugin.manifest.platforms.includes(this.platform)) {
      throw new PluginError('UnavailableOnPlatform', 'Plugin is unavailable on this platform')
    }
    if (this.platform !== 'desktop') {
      throw new PluginError('UnavailableOnPlatform', 'Plugin execution is desktop-only')
    }
    if (plugin.source === 'development' && !useSettingStore.getState().developerMode) {
      throw new PluginError('PermissionDenied', 'Developer Mode is required to run a development plugin')
    }
    if (!this.supportsCurrentSurface(plugin)) {
      throw new PluginError('UnavailableOnPlatform', 'Plugin is unavailable in this window')
    }
    const existing = this.runtimes.get(pluginId)
    if (existing?.signature === expectedRuntimeSignature) return
    if (existing) {
      existing.stop()
      this.runtimes.delete(pluginId)
    }

    store.setRuntimeState(pluginId, 'activating')
    let candidateRuntime: ActiveRuntime | null = null
    try {
      this.assertRequiredPermissions(plugin)
      const messages = await loadPluginMessages(plugin, this.locale)
      this.assertActivationCurrent(pluginId, generation, activationId)
      assertPluginWorkspaceBinding(workspaceBinding)
      this.ensureContributions(plugin, messages)
      if (!plugin.manifest.platforms.includes('desktop')) {
        throw new PluginError('UnavailableOnPlatform', 'Plugin execution is desktop-only')
      }
      const runtime = new CommunityPluginRuntime({
        plugin,
        locale: this.locale,
        messages,
        settings: settingsFor(plugin),
        workspaceBinding,
        surface: this.surface,
        onFailure: (error) => this.handleRuntimeFailure(
          pluginId,
          expectedRuntimeSignature,
          generation,
          activationId,
          error,
        ),
      })
      candidateRuntime = {
        signature: expectedRuntimeSignature,
        activationId,
        stop: () => runtime.stop(),
      }
      this.pendingRuntimes.set(pluginId, { generation, activationId, runtime: candidateRuntime })
      const entrySource = await readPluginEntry(pluginId, {
        version: plugin.activeVersion,
        contentHash: plugin.contentHash,
      })
      this.assertActivationCurrent(pluginId, generation, activationId)
      assertPluginWorkspaceBinding(workspaceBinding)
      await runtime.activate(entrySource)

      this.assertActivationCurrent(pluginId, generation, activationId)
      assertPluginWorkspaceBinding(workspaceBinding)
      if (!candidateRuntime) throw new PluginError('RuntimeFailure', 'Plugin runtime did not start')
      const currentPlugin = usePluginStore.getState().installed.find((item) => item.manifest.id === pluginId)
      if (
        !this.initialized
        || generation !== this.lifecycleGeneration
        || !currentPlugin
        || !store.isEnabled(pluginId)
        || (currentPlugin.source === 'development' && !useSettingStore.getState().developerMode)
        || pluginRuntimeSignature(currentPlugin, this.locale) !== expectedRuntimeSignature
      ) {
        throw new PluginError('Cancelled', 'Plugin state changed during activation')
      }
      const pendingRuntime = this.pendingRuntimes.get(pluginId)
      if (pendingRuntime?.activationId === activationId) this.pendingRuntimes.delete(pluginId)
      this.runtimes.set(pluginId, candidateRuntime)
      candidateRuntime = null
      store.setRuntimeState(pluginId, 'active')
      if (this.surface === 'main' && store.hasPendingUpdate(pluginId, plugin.activeVersion)) {
        try {
          await store.confirmPendingUpdate(pluginId, plugin.activeVersion)
        } catch (error) {
          // The runtime itself activated successfully. Keep the update pending
          // for a later confirmation instead of misclassifying a settings-store
          // write failure as a plugin crash and rolling back healthy code.
          store.addLog({
            pluginId,
            level: 'warning',
            message: `Plugin update activated, but confirmation could not be saved: ${safeMessage(error)}`,
          })
        }
      }
      if (this.runtimes.get(pluginId)?.signature !== expectedRuntimeSignature) return
      if (this.surface === 'main' && usePluginStore.getState().failures[pluginId]) {
        void store.clearFailure(pluginId).catch((error) => this.logHostError(error))
      }
    } catch (error) {
      const pendingRuntime = this.pendingRuntimes.get(pluginId)
      if (pendingRuntime?.activationId === activationId) this.pendingRuntimes.delete(pluginId)
      candidateRuntime?.stop()
      const pluginError = error instanceof PluginError
        ? error
        : new PluginError('RuntimeFailure', safeMessage(error))
      if (this.activations.get(pluginId)?.activationId === activationId) {
        // Keep the selected empty surface mounted so it can show activation failure and Retry.
        clearPluginUi(pluginId, true)
        clearPendingPluginStatusBarUpdates(pluginId)
        store.clearStatusBar(pluginId)
        store.setRuntimeState(pluginId, 'inactive')
      }
      if (!this.isActivationCurrent(pluginId, generation, activationId)) {
        throw new PluginError('Cancelled', 'Plugin activation was cancelled')
      }
      clearPendingPluginStatusBarUpdates(pluginId)
      store.clearStatusBar(pluginId)
      if (
        pluginError.code === 'PermissionDenied'
        || pluginError.code === 'Cancelled'
        || pluginError.code === 'UnavailableOnPlatform'
        || pluginError.code === 'WorkspaceChanged'
      ) {
        store.setRuntimeState(pluginId, 'inactive')
        throw pluginError
      }
      store.setRuntimeState(pluginId, 'failed')
      if (this.surface !== 'main') {
        this.logHostError(pluginError)
        throw pluginError
      }
      await store.recordFailure(pluginId, pluginError.code, pluginError.message)
      this.assertActivationCurrent(pluginId, generation, activationId)
      if (
        plugin.source === 'marketplace'
        && store.hasPendingUpdate(pluginId, plugin.activeVersion)
      ) {
        try {
          await store.rollback(pluginId)
          store.addLog({
            pluginId,
            level: 'warning',
            code: pluginError.code,
            message: `Plugin update ${plugin.activeVersion} failed to activate and was rolled back`,
          })
          store.setRuntimeState(pluginId, 'inactive')
          throw pluginError
        } catch (rollbackError) {
          if (rollbackError === pluginError) throw pluginError
          this.logHostError(rollbackError)
        }
      }
      const failures = usePluginStore.getState().failures[pluginId]?.count ?? 0
      if (failures >= 3) {
        store.setRuntimeState(pluginId, 'quarantined')
        await store.setEnablement(pluginId, 'disabled')
      }
      throw pluginError
    }
  }

  stop(): void {
    if (this.marketRefreshTimer) clearInterval(this.marketRefreshTimer)
    this.marketRefreshTimer = null
    this.stopDevelopmentReload?.()
    this.stopDevelopmentReload = null
    this.lifecycleGeneration += 1
    this.workspaceTransitioning = false
    this.cancelPendingActivations()
    this.stopAllRuntimes()
    this.clearContributions()
    this.editorSubscription?.dispose()
    this.editorSubscription = null
    this.noteSubscription?.dispose()
    this.noteSubscription = null
    this.storeUnsubscribe?.()
    this.storeUnsubscribe = null
    this.settingsUnsubscribe?.()
    this.settingsUnsubscribe = null
    setPluginActivationResolver(null)
    setPluginViewActivationResolver(null)
    this.initialized = false
  }

  private async reconcileNow(generation: number): Promise<void> {
    if (
      !this.initialized
      || this.workspaceTransitioning
      || generation !== this.lifecycleGeneration
    ) return
    const store = usePluginStore.getState()
    const developerMode = useSettingStore.getState().developerMode
    const enabledIds = new Set(
      store.installed
        .filter((plugin) => (
          store.isEnabled(plugin.manifest.id)
          && plugin.manifest.platforms.includes(this.platform)
          && this.platform === 'desktop'
          && (plugin.source !== 'development' || developerMode)
          && this.supportsCurrentSurface(plugin)
        ))
        .map((plugin) => plugin.manifest.id),
    )

    for (const [pluginId, activation] of this.activations) {
      const plugin = store.installed.find((item) => item.manifest.id === pluginId)
      if (
        !enabledIds.has(pluginId)
        || !plugin
        || activation.signature !== pluginRuntimeSignature(plugin, this.locale)
      ) {
        this.cancelPendingActivation(pluginId, activation.activationId)
        if (!this.runtimes.has(pluginId)) {
          clearPendingPluginStatusBarUpdates(pluginId)
          store.clearStatusBar(pluginId)
          store.setRuntimeState(pluginId, 'inactive')
        }
      }
    }

    for (const [pluginId, runtime] of this.runtimes) {
      const plugin = store.installed.find((item) => item.manifest.id === pluginId)
      if (!enabledIds.has(pluginId) || !plugin || runtime.signature !== pluginRuntimeSignature(plugin, this.locale)) {
        runtime.stop()
        this.runtimes.delete(pluginId)
        clearPluginUi(pluginId)
        clearPendingPluginStatusBarUpdates(pluginId)
        store.clearStatusBar(pluginId)
        store.setRuntimeState(pluginId, 'inactive')
      }
    }

    for (const [pluginId, disposable] of this.contributionDisposables) {
      const plugin = store.installed.find((item) => item.manifest.id === pluginId)
      const version = plugin ? pluginContributionSignature(plugin, this.locale) : ''
      if (!enabledIds.has(pluginId) || this.contributionVersions.get(pluginId) !== version) {
        disposable.dispose()
        clearPluginUi(pluginId)
        this.contributionDisposables.delete(pluginId)
        this.contributionVersions.delete(pluginId)
      }
    }

    for (const plugin of store.installed) {
      if (!enabledIds.has(plugin.manifest.id) || this.contributionDisposables.has(plugin.manifest.id)) continue
      try {
        const messages = await loadPluginMessages(plugin, this.locale)
        if (!this.initialized || generation !== this.lifecycleGeneration) return
        const currentPlugin = usePluginStore.getState().installed.find(
          (item) => item.manifest.id === plugin.manifest.id,
        )
        if (
          !currentPlugin
          || !usePluginStore.getState().isEnabled(plugin.manifest.id)
          || pluginSignature(currentPlugin) !== pluginSignature(plugin)
          || (currentPlugin.source === 'development' && !useSettingStore.getState().developerMode)
        ) {
          continue
        }
        this.ensureContributions(plugin, messages)
        if (!this.runtimes.has(plugin.manifest.id) && !this.activations.has(plugin.manifest.id)) {
          store.setRuntimeState(plugin.manifest.id, 'inactive')
        }
      } catch (error) {
        if (!this.initialized || generation !== this.lifecycleGeneration) return
        if (error instanceof PluginError && ['Cancelled', 'WorkspaceChanged'].includes(error.code)) continue
        if (this.surface === 'main') {
          await store.recordFailure(plugin.manifest.id, 'InvalidManifest', safeMessage(error))
        } else {
          this.logHostError(error)
        }
      }
    }

    if (hasActiveMarkdownPluginEditor()) await this.activateEditorPlugins(generation)
    await Promise.allSettled(store.installed
      .filter((plugin) => (
        store.isEnabled(plugin.manifest.id)
        && plugin.manifest.activationEvents.includes('onWorkspace:open')
      ))
      .map((plugin) => this.activate(plugin.manifest.id, 'onWorkspace:open')))
  }

  private async activateEditorPlugins(generation = this.lifecycleGeneration): Promise<void> {
    if (!this.initialized || generation !== this.lifecycleGeneration) return
    const store = usePluginStore.getState()
    const plugins = store.installed.filter((plugin) => (
      store.isEnabled(plugin.manifest.id)
      && plugin.manifest.activationEvents.includes('onEditor:markdown')
      && plugin.manifest.platforms.includes(this.platform)
      && this.platform === 'desktop'
      && (plugin.source !== 'development' || useSettingStore.getState().developerMode)
      && this.supportsCurrentSurface(plugin)
    ))
    await Promise.allSettled(plugins.map((plugin) => this.activate(plugin.manifest.id, 'onEditor:markdown')))
  }

  private assertRequiredPermissions(plugin: InstalledPlugin): void {
    for (const [permission, declaration] of Object.entries(plugin.manifest.permissions)) {
      if (!declaration || declaration.optional) continue
      if (!canUsePluginPermission(plugin.manifest.id, permission as PluginPermissionName)) {
        throw new PluginError('PermissionDenied', `Required permission has not been granted: ${permission}`)
      }
    }
  }

  private ensureContributions(plugin: InstalledPlugin, messages: Record<string, string>): void {
    const pluginId = plugin.manifest.id
    const signature = pluginContributionSignature(plugin, this.locale)
    if (this.contributionVersions.get(pluginId) === signature) return
    this.contributionDisposables.get(pluginId)?.dispose()
    this.contributionDisposables.delete(pluginId)
    this.contributionVersions.delete(pluginId)
    const disposable = registerPluginContributions(plugin, messages)
    this.contributionDisposables.set(pluginId, disposable)
    this.contributionVersions.set(pluginId, signature)
  }

  private handleRuntimeFailure(
    pluginId: string,
    signature: string,
    generation: number,
    activationId: symbol,
    error: PluginError,
  ): void {
    if (!this.initialized || generation !== this.lifecycleGeneration) return
    if (this.runtimes.get(pluginId)?.activationId !== activationId) return
    this.runtimes.delete(pluginId)
    usePluginStore.getState().setRuntimeState(pluginId, 'failed')
    clearPendingPluginStatusBarUpdates(pluginId)
    usePluginStore.getState().clearStatusBar(pluginId)
    clearPluginUi(pluginId)
    if (['Cancelled', 'WorkspaceChanged', 'PermissionDenied', 'UnavailableOnPlatform'].includes(error.code)) {
      usePluginStore.getState().setRuntimeState(pluginId, 'inactive')
      return
    }
    if (this.surface !== 'main') {
      this.logHostError(error)
      return
    }
    void (async () => {
      const store = usePluginStore.getState()
      await store.recordFailure(pluginId, error.code, error.message)
      const currentPlugin = usePluginStore.getState().installed.find(plugin => plugin.manifest.id === pluginId)
      if (!this.initialized || generation !== this.lifecycleGeneration
        || this.runtimes.has(pluginId) || this.activations.has(pluginId)
        || !currentPlugin || pluginRuntimeSignature(currentPlugin, this.locale) !== signature) return
      const count = usePluginStore.getState().failures[pluginId]?.count ?? 0
      if (count >= 3) {
        store.setRuntimeState(pluginId, 'quarantined')
        await store.setEnablement(pluginId, 'disabled')
      }
    })().catch((reason) => this.logHostError(reason))
  }

  private stopAllRuntimes(): void {
    for (const [pluginId, runtime] of this.runtimes) {
      runtime.stop()
      clearPluginUi(pluginId)
      clearPendingPluginStatusBarUpdates(pluginId)
      usePluginStore.getState().clearStatusBar(pluginId)
      usePluginStore.getState().setRuntimeState(pluginId, 'inactive')
    }
    this.runtimes.clear()
  }

  private clearContributions(): void {
    for (const [pluginId, disposable] of this.contributionDisposables) {
      disposable.dispose()
      clearPluginUi(pluginId)
    }
    this.contributionDisposables.clear()
    this.contributionVersions.clear()
  }

  private cancelPendingActivations(): void {
    for (const pluginId of this.activations.keys()) {
      this.pendingRuntimes.get(pluginId)?.runtime.stop()
      clearPluginUi(pluginId)
      clearPendingPluginStatusBarUpdates(pluginId)
      usePluginStore.getState().clearStatusBar(pluginId)
      if (!this.runtimes.has(pluginId)) usePluginStore.getState().setRuntimeState(pluginId, 'inactive')
    }
    this.pendingRuntimes.clear()
    this.activations.clear()
  }

  private cancelPendingActivation(pluginId: string, activationId: symbol): void {
    const activation = this.activations.get(pluginId)
    if (activation?.activationId !== activationId) return
    const pendingRuntime = this.pendingRuntimes.get(pluginId)
    if (pendingRuntime?.activationId === activationId) {
      pendingRuntime.runtime.stop()
      this.pendingRuntimes.delete(pluginId)
    }
    clearPluginUi(pluginId)
    clearPendingPluginStatusBarUpdates(pluginId)
    usePluginStore.getState().clearStatusBar(pluginId)
    if (!this.runtimes.has(pluginId)) usePluginStore.getState().setRuntimeState(pluginId, 'inactive')
    this.activations.delete(pluginId)
  }

  private isActivationCurrent(pluginId: string, generation: number, activationId: symbol): boolean {
    const store = usePluginStore.getState()
    const plugin = store.installed.find(item => item.manifest.id === pluginId)
    const activation = this.activations.get(pluginId)
    return this.initialized
      && generation === this.lifecycleGeneration
      && activation !== undefined
      && activation.activationId === activationId
      && Boolean(plugin && store.isEnabled(pluginId)
        && activation.signature === pluginRuntimeSignature(plugin, this.locale)
        && (plugin.source !== 'development' || useSettingStore.getState().developerMode))
  }

  private assertActivationCurrent(pluginId: string, generation: number, activationId: symbol): void {
    if (!this.isActivationCurrent(pluginId, generation, activationId)) {
      throw new PluginError('Cancelled', 'Plugin activation is no longer current')
    }
  }

  private logHostError(error: unknown): void {
    usePluginStore.getState().addLog({
      pluginId: 'app.notegen.plugin-host',
      level: 'error',
      message: safeMessage(error),
    })
  }

  private supportsCurrentSurface(plugin: InstalledPlugin): boolean {
    return this.surface === 'main' || plugin.manifest.activationEvents.includes('onEditor:markdown')
  }

  private getStoreSignature(): string {
    const store = usePluginStore.getState()
    return [
      store.currentWorkspaceId,
      store.currentWorkspaceKey,
      this.surface,
      this.workspaceTransitioning ? 'workspace:changing' : 'workspace:ready',
      useSettingStore.getState().developerMode ? 'developer:on' : 'developer:off',
      ...store.installed.map(pluginSignature),
      ...store.installed.map(plugin => getPluginRevocation(plugin, store.catalog) ?? ""),
    ].join('|')
  }
}

export const pluginHost = new PluginHost()
