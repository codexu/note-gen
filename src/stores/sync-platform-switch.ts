'use client'

import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import useSettingStore from './setting'
import useSyncStore from './sync'
import emitter from '@/lib/emitter'
import { inspectSyncEngineSwitch, pauseSyncEngine, type SyncEngineSwitchReview } from '@/lib/sync/engine-switch'
import { finishAutoDataSyncRepositoryChange, prepareAutoDataSyncForRepositoryChange } from '@/lib/sync/auto-data-sync-queue'
import {
  targetIdentity, restorePlatformSwitchBackup, inspectPlatformSwitchPlan, disposePlatformSwitchPlan, revalidatePlatformSwitchPlan, backupPlatformSwitchPlan, executePlatformSwitchPlan, preparePlatformSwitchDecision,
  type PlatformSwitchPlan, type SwitchModule, type SwitchOperationProgress, type SwitchResolution, type SwitchStrategy,
} from '@/lib/sync/platform-switch-plan'
import { getSyncPushQueue } from '@/lib/sync/sync-push-queue'
import { SYNC_PLATFORMS, type SyncPlatform, type CloudFolderConfig } from '@/types/sync'
import { restoreInterruptedPrimaryPlatform, type PlatformSwitchRecovery } from '@/lib/sync/platform-switch-recovery'
import { acquireActiveSwitchBackup, prunePlatformSwitchBackups } from '@/lib/sync/platform-switch-backup-retention'
import { settleSwitchBackupRecovery } from '@/lib/sync/platform-switch-journal'
import { sanitizeSyncErrorMessage } from '@/lib/sync/remote-file'
import { syncStaleError, withSyncStaleContext, type SyncStaleDetails } from '@/lib/sync/sync-stale-error'

type SwitchStep = 'local' | 'currentRemote' | 'nextRemote' | 'review' | 'confirm' | 'preparing' | 'saving' | 'starting' | 'reconciling' | 'error' | 'cancelled' | 'completed'
interface PlatformSwitchState {
  platform: SyncPlatform | null
  step: SwitchStep
  failedStep: SwitchStep | null
  review: SyncEngineSwitchReview | null
  plan: PlatformSwitchPlan | null
  progress: SwitchOperationProgress | null
  error: string | null
  listing: { path: string; files: number } | null
  strategy: SwitchStrategy | null
  selected: SwitchModule[]
  resolutions: Record<string, SwitchResolution>
  automatic: boolean
  mutated: boolean
  backupPath: string | null
  recovered: boolean
  cancelRequested: boolean
  skipped: boolean
}
const initialState: PlatformSwitchState = {
  platform: null, step: 'local', failedStep: null, review: null, plan: null, progress: null, error: null,
  listing: null, strategy: null, selected: [], resolutions: {}, automatic: false, mutated: false, backupPath: null, recovered: false, cancelRequested: false, skipped: false,
}
export const usePlatformSwitchStore = create<PlatformSwitchState>(() => initialState)
interface Decision { strategy: SwitchStrategy; selected: SwitchModule[]; resolutions: Record<string, SwitchResolution> }
let reviewDecision: ((decision: Decision | null) => void) | null = null
let running = false
let cancelling = false
let dismissing = false
let paused = false
let inspectionContext: { method: SyncPlatform; workspace: string; targetFingerprint?: string } | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let restoringRecovery: Promise<void> | null = null
let initialBackupCleanupStarted = false
type BackupLease = () => Promise<void>

function recoveryBackupPaths(...markers: (Pick<PlatformSwitchRecovery, 'backupPath' | 'backupPaths'> | null | undefined)[]): string[] {
  return [...new Set(markers.flatMap(marker => [
    ...(Array.isArray(marker?.backupPaths) ? marker.backupPaths : []),
    ...(typeof marker?.backupPath === 'string' ? [marker.backupPath] : []),
  ]).filter((path): path is string => typeof path === 'string'))]
}

async function finishBackupRetention(release: BackupLease | null, paths: string[], verified: boolean, noMutations = false) {
  try {
    // Only a durable final commit, or a journal proving no writes occurred,
    // can release protection. Failures keep this flag across application restarts.
    if (verified || noMutations) {
      for (const path of paths) {
        try { await settleSwitchBackupRecovery(path, !verified) }
        catch (error) { console.warn('Keeping unresolved sync backup', path, error) }
      }
    }
  } finally {
    try { await release?.() }
    catch (error) { console.warn('Failed to release active sync backup', error) }
    void prunePlatformSwitchBackups()
  }
}

function assertSwitchActive() {
  if (usePlatformSwitchStore.getState().cancelRequested) throw new Error('SYNC_SWITCH_CANCELLED')
}
function assertSwitchConfiguration(method: SyncPlatform, workspace: string, stage: SyncStaleDetails['stage']) {
  const current = useSettingStore.getState()
  if (method !== current.primaryBackupMethod || workspace !== current.workspacePath) {
    throw syncStaleError({ stage, check: 'configuration', path: method !== current.primaryBackupMethod ? 'primaryBackupMethod' : 'workspacePath' })
  }
}

function switchErrorContext(state: PlatformSwitchState, fallback: SyncStaleDetails['stage']): SyncStaleDetails {
  const phase = state.progress?.phase
  return {
    stage: phase === 'list' || phase === 'scan' ? 'scan' : phase === 'compare' ? 'validate' : phase || fallback,
    path: state.progress?.path, source: state.progress?.source,
  }
}
async function targetFingerprint(platform: SyncPlatform) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await targetIdentity(platform)))
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
const commitProgress = (step: 'preparing' | 'saving' | 'starting' | 'reconciling') => {
  assertSwitchActive()
  usePlatformSwitchStore.setState({ step, progress: null })
}

async function releaseSync(cancelled = false) {
  if (!paused) return
  paused = false
  const settings = useSettingStore.getState()
  const resume = cancelled && inspectionContext?.method === settings.primaryBackupMethod && inspectionContext?.workspace === settings.workspacePath
  getSyncPushQueue().finishWorkspaceSwitch(resume)
  inspectionContext = null
  await finishAutoDataSyncRepositoryChange(resume ? 'auto' : 'deferred')
  if (resume) await import('@/lib/self-hosted-sync/lifecycle').then(module => module.refreshSelfHostedSyncRuntime())
}
export async function restorePlatformSwitchRecovery() {
  if (running || cancelling || dismissing || usePlatformSwitchStore.getState().platform) return
  if (restoringRecovery) return restoringRecovery
  restoringRecovery = (async () => {
    const store = await Store.load('store.json')
    const saved = await restoreInterruptedPrimaryPlatform(store)
    if (!saved || running || cancelling || dismissing || usePlatformSwitchStore.getState().platform) return
    const primary = await store.get<SyncPlatform>('primaryBackupMethod')
    if (running || cancelling || dismissing || usePlatformSwitchStore.getState().platform) return
    if (primary && SYNC_PLATFORMS.includes(primary)) useSettingStore.setState({ primaryBackupMethod: primary })
    pauseSyncEngine('selfHosted')
    usePlatformSwitchStore.setState({ ...initialState, platform: saved.platform,
      step: saved.resolution === 'skipped' ? 'completed' : saved.resolution === 'cancelled' ? 'cancelled' : 'error',
      mutated: saved.mutated ?? (Boolean(saved.backupPath) || !saved.workspaceSetup), backupPath: saved.backupPath || null,
      error: sanitizeSyncErrorMessage(saved.error || 'SYNC_SWITCH_INTERRUPTED'), skipped: saved.resolution === 'skipped',
    })
  })()
  try { await restoringRecovery }
  finally {
    restoringRecovery = null
    if (!initialBackupCleanupStarted) {
      initialBackupCleanupStarted = true
      void prunePlatformSwitchBackups()
    }
  }
}
export async function dismissPlatformSwitch() {
  if (dismissing) return
  dismissing = true
  try {
    const state = usePlatformSwitchStore.getState()
    // During a write, leaving the settings page must never cancel a partly applied plan.
    if (state.step !== 'completed' && (state.mutated || (running && !['review', 'confirm', 'error'].includes(state.step)))) return
    if (!running && ['error', 'cancelled'].includes(state.step)) {
      const store = await Store.load('store.json')
      const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      if (recovery && recovery.mutated === false && !recovery.workspaceSetup && recovery.resolution !== 'skipped') {
        await store.delete('platformSwitchRecovery')
        await store.save()
        await finishBackupRetention(null, recoveryBackupPaths(recovery, { backupPath: state.backupPath || undefined }), false, true)
      }
      const setup = recovery?.workspaceSetup
      if (setup && !recovery?.backupPath && setup.originalPath !== undefined) {
        running = true
        try {
          if (setup.originalConfig) await store.set('cloudFolderSyncConfig', setup.originalConfig)
          else await store.delete('cloudFolderSyncConfig')
          await store.save()
          await useSettingStore.getState().setWorkspacePath(setup.originalPath)
          await store.delete('platformSwitchRecovery')
          await store.save()
          await import('@/lib/self-hosted-sync/lifecycle').then(module => module.refreshSelfHostedSyncRuntime())
        } catch (error) {
          usePlatformSwitchStore.setState({ step: 'error', error: sanitizeSyncErrorMessage(error) })
          return
        } finally { running = false }
      }
    }
    reviewDecision?.(null); reviewDecision = null
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
    usePlatformSwitchStore.setState({ ...initialState, skipped: state.skipped })
    if (!running) {
      const wasPaused = paused
      await releaseSync(!state.skipped)
      // On startup there is no in-memory pause depth to release, but dismissing
      // a clean cancelled attempt must still restart the original engines.
      if (!wasPaused && !state.skipped) {
        await finishAutoDataSyncRepositoryChange('deferred')
        await import('@/lib/self-hosted-sync/lifecycle').then(module => module.refreshSelfHostedSyncRuntime())
      }
    }
  } finally { dismissing = false }
}
export function choosePlatformSwitchStrategy(strategy: SwitchStrategy) {
  const state = usePlatformSwitchStore.getState()
  if (state.step !== 'review' || !state.selected.length || !['merge', 'local', 'remote'].includes(strategy)) return
  if (strategy === 'remote' && state.plan?.unavailableModules.some(module => state.selected.includes(module))) return
  usePlatformSwitchStore.setState({ strategy, step: 'confirm' })
}
export function editPlatformSwitchChoice() {
  if (usePlatformSwitchStore.getState().step === 'confirm') usePlatformSwitchStore.setState({ step: 'review' })
}
export function selectPlatformSwitchModule(module: SwitchModule, enabled: boolean) {
  const state = usePlatformSwitchStore.getState()
  if (state.step !== 'review') return
  const selected = new Set(state.selected)
  // Records, their labels and canvases share IDs; attachments must travel with their owners.
  const group: SwitchModule[] = ['records', 'tags', 'canvases', 'dataAssets'].includes(module)
    ? ['records', 'tags', 'canvases', 'dataAssets', 'conversations']
    : module === 'conversations' ? ['records', 'tags', 'canvases', 'dataAssets', 'conversations']
      : ['settings', 'memories'].includes(module) ? ['settings', 'memories']
        : ['notes', 'assets']
  for (const id of group) {
    if (enabled && state.plan?.available.includes(id)) selected.add(id); else selected.delete(id)
  }
  usePlatformSwitchStore.setState({ selected: [...selected], resolutions: {} })
}
export function resolvePlatformSwitchConflict(id: string, resolution: SwitchResolution) {
  const state = usePlatformSwitchStore.getState()
  const conflict = state.plan?.conflicts.find(item => item.id === id)
  if (state.step !== 'confirm' || !conflict || (resolution === 'both' && !conflict.allowBoth)) return
  usePlatformSwitchStore.setState({ resolutions: { ...state.resolutions, [id]: resolution } })
}
export function confirmPlatformSwitch() {
  const { step, strategy, selected, resolutions, plan } = usePlatformSwitchStore.getState()
  if (step !== 'confirm' || !strategy || !selected.length) return
  if (strategy === 'merge' && plan?.conflicts.some(item => selected.includes(item.module) && !resolutions[item.id])) return
  const decide = reviewDecision
  if (!decide) return
  reviewDecision = null
  usePlatformSwitchStore.setState({ step: 'preparing' })
  decide({ strategy, selected, resolutions })
}
let progressReportedAt = 0
let progressContext = ''
const progress = (value: SwitchOperationProgress) => {
  assertSwitchActive()
  const context = `${value.phase}:${value.source}:${value.kind}:${value.module}`
  const now = Date.now()
  if (context === progressContext && value.current < value.total && now - progressReportedAt < 100) return
  progressContext = context
  progressReportedAt = now
  usePlatformSwitchStore.setState({ progress: value, step: value.phase === 'list' || value.phase === 'scan' || value.phase === 'compare' ? (value.source === 'local' ? 'local' : 'nextRemote') : 'reconciling' })
}
export async function cancelPlatformSwitch() {
  const state = usePlatformSwitchStore.getState()
  if (!state.platform || state.step === 'completed' || cancelling || dismissing) return
  if (running) {
    usePlatformSwitchStore.setState({ cancelRequested: true })
    if (state.platform === 'selfHosted' && state.mutated) pauseSyncEngine('selfHosted')
    reviewDecision?.(null)
    reviewDecision = null
    return
  }
  cancelling = true
  usePlatformSwitchStore.setState({ cancelRequested: true })
  try {
    if (!state.mutated) {
      await dismissPlatformSwitch()
      return
    }
    usePlatformSwitchStore.setState({ step: 'cancelled' })
    const store = await Store.load('store.json')
    const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    if (recovery?.workspaceSetup && !state.backupPath && !recovery.backupPath
      && !recovery.skippedFromPlatform && recovery.resolution !== 'skipped') {
      usePlatformSwitchStore.setState({ mutated: false })
      await dismissPlatformSwitch()
      return
    }
    if (recovery) {
      await store.set('platformSwitchRecovery', { ...recovery, resolution: 'cancelled', error: recovery.error || state.error || 'SYNC_SWITCH_CANCELLED', failedAt: recovery.failedAt || Date.now() })
      await store.save()
    }
  } catch (error) {
    usePlatformSwitchStore.setState({ step: 'error', error: sanitizeSyncErrorMessage(error) })
  } finally {
    cancelling = false
    usePlatformSwitchStore.setState({ cancelRequested: false })
  }
}
export function cancelPlatformSwitchInspection() { void cancelPlatformSwitch() }
async function reconcileSelfHosted() {
  const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
  let errors: string[] = []
  const completed = (event: { provider: 'selfHosted'; errors: string[] }) => { errors = event.errors }
  emitter.on('sync-engine-completed', completed)
  try {
    await import('@/lib/self-hosted-sync/lifecycle').then(module => module.refreshSelfHostedSyncRuntime('selfHosted'))
    await getSelfHostedSyncRuntime().wake('platform-switch')
    if (errors.length) throw new Error(errors.join('\n'))
    if (!useSyncStore.getState().selfHostedRuntimeReady) throw new Error('Self-hosted sync is not ready')
  } finally { emitter.off('sync-engine-completed', completed) }
}
function completeSwitch() {
  usePlatformSwitchStore.setState({ step: 'completed', error: null, cancelRequested: false, skipped: false })
  hideTimer = setTimeout(() => { usePlatformSwitchStore.setState(initialState); hideTimer = null }, 1800)
}
export function holdPlatformSwitchCompletion() {
  if (usePlatformSwitchStore.getState().step !== 'completed') return
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}
export async function switchSyncPlatform(platform: SyncPlatform, retry = false, workspaceSetup?: PlatformSwitchRecovery['workspaceSetup']): Promise<boolean> {
  await restorePlatformSwitchRecovery()
  if (retry && usePlatformSwitchStore.getState().platform !== platform) return false
  const previousState = usePlatformSwitchStore.getState()
  if (running || cancelling || dismissing || (!retry && previousState.platform && !(previousState.step === 'completed' && previousState.skipped))) return false
  if (!retry && !workspaceSetup && useSettingStore.getState().primaryBackupMethod === platform) return false
  if (hideTimer) clearTimeout(hideTimer)
  running = true
  const current = useSettingStore.getState().primaryBackupMethod
  let workspace = useSettingStore.getState().workspacePath
  let activePlan: PlatformSwitchPlan | null = null
  let fingerprint: string | undefined
  let activeWorkspaceSetup = workspaceSetup
  let inheritedUnverified = false
  let releaseBackup: BackupLease | null = null
  let verified = false
  let cleanCancellation = false
  const recoveryBackup = usePlatformSwitchStore.getState().backupPath
  let attemptBackupPaths = recoveryBackupPaths({ backupPath: recoveryBackup || undefined })
  usePlatformSwitchStore.setState({ ...initialState, platform, backupPath: recoveryBackup })
  try {
    const recoveryStore = await Store.load('store.json')
    let pendingRecovery = await recoveryStore.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    attemptBackupPaths = recoveryBackupPaths(pendingRecovery, { backupPaths: attemptBackupPaths })
    inheritedUnverified = Boolean(pendingRecovery?.resolution === 'skipped' || pendingRecovery?.skippedFromPlatform)
    if (pendingRecovery) usePlatformSwitchStore.setState({ mutated: inheritedUnverified || (pendingRecovery.mutated ?? true) })
    if (retry && pendingRecovery?.platform === platform) {
      // A new scan is a new attempt, even when it inherits unresolved writes
      // and protected backups. Do not resurrect the previous failure on reload.
      pendingRecovery = { ...pendingRecovery, startedAt: Date.now() }
      delete pendingRecovery.error
      delete pendingRecovery.failedAt
      await recoveryStore.set('platformSwitchRecovery', pendingRecovery)
      await recoveryStore.save()
    }
    fingerprint = await targetFingerprint(platform)
    assertSwitchActive()
    if (pendingRecovery?.resolution === 'skipped') {
      const store = await Store.load('store.json')
      await store.set('platformSwitchRecovery', { ...pendingRecovery, platform, originalPlatform: current, commitPlatform: undefined,
        workspace, targetFingerprint: fingerprint, workspaceSetup: workspaceSetup, mutated: true, resolution: undefined, startedAt: Date.now(),
      } satisfies PlatformSwitchRecovery)
      await store.save()
      assertSwitchActive()
    }
    if (!paused) {
      paused = true
      inspectionContext = { method: current, workspace, targetFingerprint: fingerprint }
      await Promise.all([getSyncPushQueue().prepareForWorkspaceSwitch(), prepareAutoDataSyncForRepositoryChange()])
    }
    assertSwitchActive()
    const { prepareActiveEditorDeactivationDurably } = await import('@/lib/editor-deactivation')
    const activePath = (await import('./article')).default.getState().activeFilePath
    if (activePath && !await prepareActiveEditorDeactivationDurably(activePath)) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
    const setupStore = await Store.load('store.json')
    const pendingSetup = await setupStore.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    const setup = workspaceSetup || (pendingSetup?.platform === platform && pendingSetup.resolution !== 'skipped' ? pendingSetup.workspaceSetup : undefined)
    activeWorkspaceSetup = setup
    if (setup) {
      if (platform !== 'cloudFolder' || setup.config.provider !== 'oneDrive' || !setup.path) throw syncStaleError({ stage: 'validate', path: 'cloudFolderSyncConfig', check: 'configuration' })
      if (setup.originalPath === undefined) {
        setup.originalPath = workspace
        setup.originalConfig = await setupStore.get<CloudFolderConfig>('cloudFolderSyncConfig')
      }
      // Persist preparation before changing the active workspace. A restart can
      // repeat this idempotent step while the original primary stays selected.
      assertSwitchActive()
      pauseSyncEngine(current)
      usePlatformSwitchStore.setState({ mutated: true, step: 'preparing' })
      await setupStore.set('platformSwitchRecovery', { ...pendingSetup, platform, originalPlatform: current, workspaceSetup: setup, workspace, targetFingerprint: fingerprint, mutated: true, resolution: undefined, startedAt: pendingSetup?.startedAt || Date.now() })
      await setupStore.save()
      await setupStore.set('cloudFolderSyncConfig', setup.config)
      await setupStore.save()
      await useSettingStore.getState().setWorkspacePath(setup.path)
      workspace = useSettingStore.getState().workspacePath
      fingerprint = await targetFingerprint(platform)
      assertSwitchActive()
    }
    if (platform === 'local') {
      pauseSyncEngine(current)
      await useSettingStore.getState().commitVerifiedPrimaryBackupMethod(platform, commitProgress, 'deferred', undefined, assertSwitchActive)
    } else if (platform === 'selfHosted') {
      const review = await inspectSyncEngineSwitch(current, platform, (step, listing) => { assertSwitchActive(); usePlatformSwitchStore.setState({ step, listing: listing || null }) })
      assertSwitchActive()
      // The self-hosted server owns its reconciliation protocol; do not offer unsupported overwrite modes.
      const decision = await new Promise<Decision | null>(resolve => {
        reviewDecision = resolve
        usePlatformSwitchStore.setState({ step: 'review', review, selected: ['notes', 'assets', 'records', 'tags', 'canvases', 'conversations', 'settings', 'memories', 'dataAssets'] })
      })
      if (!decision) { assertSwitchActive(); return false }
      assertSwitchConfiguration(current, workspace, 'validate')
      assertSwitchActive()
      usePlatformSwitchStore.setState({ mutated: true })
      pauseSyncEngine(current)
      const store = await Store.load('store.json')
      const previousRecovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      assertSwitchActive()
      await store.set('platformSwitchRecovery', { ...previousRecovery, platform, originalPlatform: current, commitPlatform: undefined, workspace, targetFingerprint: fingerprint, workspaceSetup: activeWorkspaceSetup, mutated: true, resolution: undefined, startedAt: Date.now() })
      await store.save()
      await useSettingStore.getState().commitVerifiedPrimaryBackupMethod(platform, commitProgress, 'deferred', reconcileSelfHosted, assertSwitchActive)
    } else {
      const plan = await inspectPlatformSwitchPlan(platform, progress)
      activePlan = plan
      assertSwitchActive()
      const selected = [...plan.available]
      const automatic = !selected.length
      usePlatformSwitchStore.setState({ plan, selected, automatic })
      const decision: Decision | null = automatic ? { strategy: 'local', selected, resolutions: {} } : await new Promise<Decision | null>(resolve => {
        reviewDecision = resolve
        usePlatformSwitchStore.setState({ step: 'review' })
      })
      if (!decision) { assertSwitchActive(); return false }
      assertSwitchConfiguration(current, workspace, 'validate')
      usePlatformSwitchStore.setState({ strategy: decision.strategy })
      const latestActivePath = (await import('./article')).default.getState().activeFilePath
      if (latestActivePath && !await prepareActiveEditorDeactivationDurably(latestActivePath)) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
      await preparePlatformSwitchDecision(plan, decision.strategy, decision.selected, decision.resolutions)
      await revalidatePlatformSwitchPlan(plan, progress)
      releaseBackup = await backupPlatformSwitchPlan(plan, progress)
      attemptBackupPaths = recoveryBackupPaths({ backupPaths: attemptBackupPaths }, plan)
      usePlatformSwitchStore.setState({ backupPath: plan.backupPath || null })
      // After the backup, recheck remote state once more before any setting or data write.
      await revalidatePlatformSwitchPlan(plan, progress)
      if (usePlatformSwitchStore.getState().cancelRequested) throw new Error('SYNC_SWITCH_CANCELLED')
      pauseSyncEngine(current)
      usePlatformSwitchStore.setState({ mutated: true })
      const store = await Store.load('store.json')
      const previousRecovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      attemptBackupPaths = recoveryBackupPaths(previousRecovery, { backupPaths: attemptBackupPaths })
      await store.set('platformSwitchRecovery', { ...previousRecovery, platform, originalPlatform: current, commitPlatform: undefined, workspace, targetFingerprint: fingerprint, workspaceSetup: activeWorkspaceSetup, mutated: true, resolution: undefined, backupPath: plan.backupPath,
        backupPaths: attemptBackupPaths, startedAt: Date.now() })
      await store.save()
      await executePlatformSwitchPlan(plan, decision.strategy, decision.selected, decision.resolutions, progress)
      assertSwitchConfiguration(current, workspace, 'verify')
      // Opted-out domains must not be reconciled by the periodic queue immediately after switching.
      const settings = useSettingStore.getState()
      const previousPreferences = { autoRecordSyncEnabled: settings.autoRecordSyncEnabled, autoSettingsSyncEnabled: settings.autoSettingsSyncEnabled, autoConversationSyncEnabled: settings.autoConversationSyncEnabled, autoSync: settings.autoSync }
      try {
        if (!decision.selected.includes('records') && settings.autoRecordSyncEnabled) await settings.setAutoRecordSyncEnabled(false)
        if (!decision.selected.includes('settings') && settings.autoSettingsSyncEnabled) await settings.setAutoSettingsSyncEnabled(false)
        if (!decision.selected.includes('conversations') && settings.autoConversationSyncEnabled) await settings.setAutoConversationSyncEnabled(false)
        if (plan.available.includes('notes') && !decision.selected.includes('notes')) await settings.setAutoSync('disabled')
        await useSettingStore.getState().commitVerifiedPrimaryBackupMethod(platform, commitProgress, 'deferred', undefined, assertSwitchActive)
      } catch (error) {
        for (const [key, value] of Object.entries(previousPreferences)) await store.set(key, value)
        await store.save()
        useSettingStore.setState(previousPreferences)
        throw error
      }
    }
    await releaseSync().catch(error => console.warn('Verified platform switch queue cleanup failed', error))
    completeSwitch()
    verified = true
    return true
  } catch (error) {
    if (platform === 'selfHosted') pauseSyncEngine('selfHosted')
    const state = usePlatformSwitchStore.getState()
    const cancelled = state.cancelRequested || (error instanceof Error && error.message === 'SYNC_SWITCH_CANCELLED')
    const message = cancelled ? 'SYNC_SWITCH_CANCELLED' : sanitizeSyncErrorMessage(withSyncStaleContext(error, switchErrorContext(state, 'validate')))
    usePlatformSwitchStore.setState({ failedStep: state.step, step: cancelled ? 'cancelled' : 'error', error: message, cancelRequested: false })
    try {
      const store = await Store.load('store.json')
      const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      attemptBackupPaths = recoveryBackupPaths(recovery, { backupPaths: attemptBackupPaths }, { backupPath: state.backupPath || undefined }, activePlan || undefined)
      const setup = recovery?.workspaceSetup || activeWorkspaceSetup
      if (cancelled && setup && !inheritedUnverified && !state.backupPath && !recovery?.backupPath && setup.originalPath !== undefined) {
        // Workspace preparation is reversible before any plan data is applied.
        // Keep its marker until the old configuration and path are both durable.
        if (setup.originalConfig) await store.set('cloudFolderSyncConfig', setup.originalConfig)
        else await store.delete('cloudFolderSyncConfig')
        await store.save()
        await useSettingStore.getState().setWorkspacePath(setup.originalPath)
        await store.delete('platformSwitchRecovery')
        await store.save()
        usePlatformSwitchStore.setState(initialState)
        cleanCancellation = true
        return false
      }
      if (cancelled && !state.mutated && !recovery?.workspaceSetup) {
        if (recovery && recovery.resolution !== 'skipped') { await store.delete('platformSwitchRecovery'); await store.save() }
        usePlatformSwitchStore.setState({ ...initialState, skipped: recovery?.resolution === 'skipped' })
        cleanCancellation = recovery?.resolution !== 'skipped'
        return false
      }
      // Keep the failed attempt and its backup durable, including a deliberate skip.
      await store.set('platformSwitchRecovery', { ...recovery, platform, originalPlatform: current, commitPlatform: undefined,
        workspace, targetFingerprint: fingerprint, workspaceSetup: activeWorkspaceSetup, mutated: state.mutated, resolution: cancelled ? 'cancelled' : undefined,
        backupPath: state.backupPath || recovery?.backupPath,
        backupPaths: attemptBackupPaths,
        startedAt: recovery?.startedAt || Date.now(), error: message, failedAt: Date.now(),
      } satisfies PlatformSwitchRecovery)
      await store.save()
    } catch (persistenceError) {
      const details = sanitizeSyncErrorMessage(persistenceError)
      usePlatformSwitchStore.setState({ step: 'error', error: `${message}\n${details}` })
    }
    return false
  } finally {
    try {
      if (activePlan) await disposePlatformSwitchPlan(activePlan).catch(error => console.warn('Platform switch scan cleanup failed', error))
      // Keep queues paused while an error is awaiting a safe rescan or recovery.
      if (!usePlatformSwitchStore.getState().platform) await releaseSync(true).catch(error => console.warn('Cancelled platform switch queue cleanup failed', error))
    } finally {
      await finishBackupRetention(releaseBackup, attemptBackupPaths, verified, cleanCancellation)
      running = false
      usePlatformSwitchStore.setState({ cancelRequested: false })
    }
  }
}
export async function skipPlatformSwitchError() {
  const state = usePlatformSwitchStore.getState()
  const platform = state.platform
  if (!platform || running || cancelling || dismissing || !['error', 'cancelled'].includes(state.step)) return false
  const previous = useSettingStore.getState().primaryBackupMethod
  const workspace = useSettingStore.getState().workspacePath
  running = true
  usePlatformSwitchStore.setState({ step: 'saving', cancelRequested: false, progress: null })
  try {
    const store = await Store.load('store.json')
    let recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    if (recovery && (!recovery.targetFingerprint || recovery.workspace === undefined)) {
      // Older interrupted attempts had no target guard. An explicit skip only
      // selects a provider and keeps sync paused, so bind it to the current local
      // configuration after checking the backup's workspace; never replay data.
      if (recovery.platform !== platform || (recovery.workspace !== undefined && recovery.workspace !== workspace)) throw syncStaleError({ stage: 'validate', path: 'platformSwitchRecovery', check: 'configuration' })
      if (recovery.backupPath) {
        const { assertSwitchBackupPath } = await import('@/lib/sync/platform-switch-journal')
        const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        assertSwitchBackupPath(recovery.backupPath)
        const manifest = JSON.parse(new TextDecoder().decode(await readFile(`${recovery.backupPath}/manifest.json`, { baseDir: BaseDirectory.AppData }))) as { version?: number; workspace?: string; platform?: SyncPlatform }
        if (manifest.version !== 1 || manifest.workspace !== workspace || (manifest.platform && manifest.platform !== platform)) throw syncStaleError({ stage: 'validate', path: `${recovery.backupPath}/manifest.json`, check: 'configuration' })
      } else if (recovery.workspaceSetup && recovery.workspaceSetup.path !== workspace) {
        throw syncStaleError({ stage: 'validate', path: 'workspacePath', check: 'configuration' })
      }
      const fingerprint = await targetFingerprint(platform)
      if (recovery.targetFingerprint && recovery.targetFingerprint !== fingerprint) throw syncStaleError({ stage: 'validate', path: 'syncTarget', check: 'configuration', expected: { sha: recovery.targetFingerprint }, actual: { sha: fingerprint } })
      assertSwitchActive()
      recovery = { ...recovery, workspace, targetFingerprint: fingerprint, error: recovery.error || state.error || 'SYNC_SWITCH_INTERRUPTED', failedAt: recovery.failedAt || Date.now() }
      await store.set('platformSwitchRecovery', recovery)
      await store.save()
    }
    if (recovery && !recovery.error) {
      // A crash can interrupt the attempt before its catch writes a reason.
      recovery = { ...recovery, error: state.error || 'SYNC_SWITCH_INTERRUPTED', failedAt: recovery.failedAt || Date.now() }
      await store.set('platformSwitchRecovery', recovery)
      await store.save()
    }
    const assertTarget = async () => {
      assertSwitchActive()
      const current = useSettingStore.getState()
      if (!recovery || recovery.platform !== platform || !recovery.targetFingerprint
        || recovery.workspace !== workspace || current.workspacePath !== workspace || current.primaryBackupMethod !== previous
        || await targetFingerprint(platform) !== recovery.targetFingerprint) throw syncStaleError({ stage: 'validate', path: 'platformSwitchRecovery / syncTarget', check: 'configuration' })
      const latest = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      if (!latest || latest.platform !== platform || latest.startedAt !== recovery.startedAt || latest.failedAt !== recovery.failedAt) throw syncStaleError({ stage: 'validate', path: 'platformSwitchRecovery', check: 'configuration' })
      assertSwitchActive()
    }
    await assertTarget()
    pauseSyncEngine(previous)
    pauseSyncEngine(platform)
    await useSettingStore.getState().commitUnverifiedPrimaryBackupMethod(platform, assertTarget)
    await releaseSync().catch(error => console.warn('Skipped platform switch queue cleanup failed', error))
    // No success timer: this remains an unresolved, explicitly paused selection.
    usePlatformSwitchStore.setState({ step: 'completed', skipped: true, cancelRequested: false, error: recovery?.error || state.error })
    return true
  } catch (error) {
    const cancelled = usePlatformSwitchStore.getState().cancelRequested || (error instanceof Error && error.message === 'SYNC_SWITCH_CANCELLED')
    const message = cancelled ? 'SYNC_SWITCH_CANCELLED' : sanitizeSyncErrorMessage(error)
    usePlatformSwitchStore.setState({ step: cancelled ? 'cancelled' : 'error', error: message, cancelRequested: false })
    return false
  } finally { running = false }
}

export async function retryPlatformSwitch() {
  const { platform, step } = usePlatformSwitchStore.getState()
  if (!platform || (!['error', 'cancelled'].includes(step) && !(step === 'completed' && usePlatformSwitchStore.getState().skipped)) || running || cancelling || dismissing) return
  // Always rescan a partially completed operation; never silently repeat a destructive decision.
  await switchSyncPlatform(platform, true)
}

export async function recoverPlatformSwitchLocalBackup() {
  const { step, backupPath } = usePlatformSwitchStore.getState()
  if (running || cancelling || dismissing || (!['error', 'cancelled'].includes(step) && !(step === 'completed' && usePlatformSwitchStore.getState().skipped)) || !backupPath) return
  running = true
  let releaseBackup: BackupLease | null = null
  let verified = false
  let attemptBackupPaths = recoveryBackupPaths({ backupPath })
  usePlatformSwitchStore.setState({ step: 'preparing', error: null, cancelRequested: false, skipped: false })
  try {
    releaseBackup = await acquireActiveSwitchBackup(backupPath)
    if (!paused) {
      paused = true
      await Promise.all([getSyncPushQueue().prepareForWorkspaceSwitch(), prepareAutoDataSyncForRepositoryChange()])
    }
    // Restoring a backup follows the same final-commit rule as switching: a
    // failed/interrupted restore must retain the original primary provider.
    pauseSyncEngine(useSettingStore.getState().primaryBackupMethod)
    const store = await Store.load('store.json')
    const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
    if (!recovery) throw syncStaleError({ stage: 'restore', path: 'platformSwitchRecovery', check: 'configuration', expected: { exists: true }, actual: { exists: false } })
    attemptBackupPaths = recoveryBackupPaths(recovery, { backupPaths: attemptBackupPaths })
    await store.set('platformSwitchRecovery', { ...recovery, commitPlatform: 'local' })
    await store.save()
    await restorePlatformSwitchBackup(backupPath, progress)
    await useSettingStore.getState().initSettingData({ hydrateOnly: true })
    const views = await Promise.allSettled([
      import('./article').then(module => module.default.getState().loadFileTree({ skipRemoteSync: true })),
      import('./tag').then(module => module.default.getState().fetchTags()),
      import('./mark').then(async module => { await module.default.getState().fetchMarks(); await module.default.getState().fetchAllMarks() }),
      import('./canvas').then(module => module.default.getState().loadProjects()),
      import('./memories').then(async module => { await module.default.getState().loadMemories(); await module.default.getState().loadStats(); await module.default.getState().loadPolicy() }),
    ])
    for (const result of views) if (result.status === 'rejected') console.warn('Recovery view refresh failed', result.reason)
    await useSettingStore.getState().commitVerifiedPrimaryBackupMethod('local', commitProgress, 'deferred', undefined, assertSwitchActive)
    await releaseSync().catch(error => console.warn('Recovered platform switch queue cleanup failed', error))
    usePlatformSwitchStore.setState({ ...initialState, platform: usePlatformSwitchStore.getState().platform, step: 'completed', recovered: true, backupPath })
    verified = true
  } catch (error) {
    const cancelled = usePlatformSwitchStore.getState().cancelRequested || (error instanceof Error && error.message === 'SYNC_SWITCH_CANCELLED')
    const message = cancelled ? 'SYNC_SWITCH_CANCELLED' : sanitizeSyncErrorMessage(error)
    usePlatformSwitchStore.setState({ step: cancelled ? 'cancelled' : 'error', mutated: true, error: message, cancelRequested: false })
    try {
      const store = await Store.load('store.json')
      const recovery = await store.get<PlatformSwitchRecovery>('platformSwitchRecovery')
      if (recovery) {
        await store.set('platformSwitchRecovery', { ...recovery, resolution: cancelled ? 'cancelled' : undefined, mutated: true, error: message, failedAt: Date.now() })
        await store.save()
      }
    } catch (persistenceError) {
      const details = sanitizeSyncErrorMessage(persistenceError)
      usePlatformSwitchStore.setState({ step: 'error', error: `${message}\n${details}` })
    }
  } finally {
    await finishBackupRetention(releaseBackup, attemptBackupPaths, verified)
    running = false
  }
}
