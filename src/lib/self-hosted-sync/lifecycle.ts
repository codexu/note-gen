import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getDb, initAllDatabases } from '@/db'
import useSyncStore from '@/stores/sync'
import { getSelfHostedSyncRuntime } from './runtime'
import emitter from '@/lib/emitter'
import type { SyncPlatform } from '@/types/sync'
import type { SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'

let listenersInstalled = false
let activeLibraryWorkspaceId: string | null = null

function installRuntimeListeners(runtime: ReturnType<typeof getSelfHostedSyncRuntime>) {
  if (listenersInstalled) return
  listenersInstalled = true
  emitter.on('self-hosted-binding-ready', (value) => {
    const workspaceId = typeof value === 'object' && value !== null && 'workspaceId' in value
      ? String(value.workspaceId)
      : null
    if (workspaceId && workspaceId === activeLibraryWorkspaceId) {
      useSyncStore.getState().setSelfHostedRuntimeReady(true)
    }
  })
  window.addEventListener('online', () => void runtime.wake('network'))
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const resume = () => {
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      void runtime.wake('foreground')
    }, 150)
  }
  window.addEventListener('focus', resume)
  window.addEventListener('pageshow', resume)
  void listen('self-hosted-app-resumed', resume).catch(error => {
    console.warn('[self-hosted-sync] Unable to listen for native resume', error)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume()
  })
}

export async function refreshSelfHostedSyncRuntime(
  target?: SyncPlatform,
  onProgress?: (progress: SwitchOperationProgress) => void,
  reason: 'startup' | 'manual-retry' = 'startup',
) {
  // Complete path recovery before exact local-root lookups can create or bind
  // another cloud workspace for a stale iOS container path.
  await initAllDatabases()
  const report = (startupTask: NonNullable<SwitchOperationProgress['startupTask']>) => {
    onProgress?.({ phase: 'start', kind: 'item', startupTask, current: 0, total: 0 })
  }
  if (target === 'selfHosted') report('workspace')
  useSyncStore.getState().setSelfHostedRuntimeReady(false)
  const store = await Store.load('store.json')
  // An explicit target is allowed only for the controlled switch attempt. On
  // startup, an interrupted attempt must keep every sync engine paused.
  const interrupted = target === undefined && Boolean(await store.get('platformSwitchRecovery'))
  const selected = !interrupted && (target ?? await store.get<string>('primaryBackupMethod')) === 'selfHosted'
  const runtime = getSelfHostedSyncRuntime()
  const profiles = await (await getDb()).select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' limit 1"
  )
  const pendingConnectionReview = await store.get<string>('selfHostedConnectionReviewProfileId')
  if (pendingConnectionReview && target !== 'selfHosted') {
    activeLibraryWorkspaceId = null
    runtime.stop()
    useSyncStore.getState().setSelfHostedConnected(profiles.length > 0)
    return
  }
  if (!selected || profiles.length === 0) {
    activeLibraryWorkspaceId = null
    console.info('[self-hosted-sync] runtime.stopped', {
      reason: selected ? 'no-connected-profile' : 'not-primary-provider',
    })
    runtime.stop()
    // Connection state and runtime state are independent: a profile remains
    // connected while another provider is selected, even though its runtime
    // must stay stopped until self-hosted sync becomes the primary provider.
    useSyncStore.getState().setSelfHostedConnected(profiles.length > 0)
    return
  }
  console.info('[self-hosted-sync] runtime.preparing', { profileId: profiles[0]!.id })
  const { ensureDefaultLibraryForCurrentWorkspace } = await import('./workspaces')
  const libraryWorkspaceId = await ensureDefaultLibraryForCurrentWorkspace(
    profiles[0]!.id,
    '我的工作区',
  )
  if (!libraryWorkspaceId) {
    activeLibraryWorkspaceId = null
    console.warn('[self-hosted-sync] runtime.not-ready', {
      reason: 'library-selection-required',
      profileId: profiles[0]!.id,
    })
    useSyncStore.getState().setSelfHostedConnected(true)
    return
  }
  activeLibraryWorkspaceId = libraryWorkspaceId
  installRuntimeListeners(runtime)
  report('recover')
  await invoke<number>('self_hosted_recover_file_journal')
  report('connect')
  runtime.start(reason)
  useSyncStore.getState().setSelfHostedConnected(true)
  if (!await runtime.bindingIsReady(libraryWorkspaceId)) {
    console.warn('[self-hosted-sync] runtime.not-ready', {
      reason: 'library-recovery-pending',
      profileId: profiles[0]!.id,
      workspaceId: libraryWorkspaceId,
    })
    return
  }
  useSyncStore.getState().setSelfHostedRuntimeReady(true)
  console.info('[self-hosted-sync] runtime.started', { profileId: profiles[0]!.id })
}
