import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'
import { getDb } from '@/db'
import useSyncStore from '@/stores/sync'
import { getSelfHostedSyncRuntime } from './runtime'
import emitter from '@/lib/emitter'

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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runtime.wake('foreground')
  })
}

export async function refreshSelfHostedSyncRuntime() {
  useSyncStore.getState().setSelfHostedRuntimeReady(false)
  const store = await Store.load('store.json')
  const selected = await store.get<string>('primaryBackupMethod') === 'selfHosted'
  const runtime = getSelfHostedSyncRuntime()
  const profiles = await (await getDb()).select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' limit 1"
  )
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
  await invoke<number>('self_hosted_recover_file_journal')
  runtime.start()
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
