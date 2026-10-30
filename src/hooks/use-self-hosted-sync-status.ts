'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import emitter from '@/lib/emitter'
import { workspaceRootsReferToSameLocation } from '@/lib/editor-deactivation'
import { getCurrentWorkspaceRoot } from '@/lib/self-hosted-sync/workspaces'
import { enabledPersonalSyncKinds } from '@/lib/self-hosted-sync/domains'
import type { SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import useSyncStore from '@/stores/sync'

interface SyncSummary {
  pendingCount: number
  blockedCount: number
  pausedCount: number
  conflictCount: number
  incomingCount: number
  lastSuccessAt: number | null
  reauthenticationRequired: boolean
  reviewRequired: boolean
  bindingRequired: boolean
}

const EMPTY_SUMMARY: SyncSummary = {
  pendingCount: 0, blockedCount: 0, pausedCount: 0, conflictCount: 0, incomingCount: 0,
  lastSuccessAt: null, reauthenticationRequired: false, reviewRequired: false, bindingRequired: false,
}

const summaryReads = new Map<string, Promise<SyncSummary>>()

async function readSummary(workspacePath: string, completedAt?: number): Promise<SyncSummary> {
  const readKey = JSON.stringify([workspacePath, completedAt ?? null])
  const existing = summaryReads.get(readKey)
  if (existing) return existing
  const read = (async () => {
    const database = await getDb()
    const root = await getCurrentWorkspaceRoot()
    const bindings = await database.select<Array<{
      workspaceId: string; profileId: string; type: string; localRoot: string | null; state: string; profileState: string; domainToggles: string
    }>>(`select b.workspace_id as workspaceId, b.profile_id as profileId, b.workspace_type as type,
      b.local_root as localRoot, b.binding_state as state, p.state as profileState, p.domain_toggles as domainToggles
      from self_hosted_workspace_bindings b join self_hosted_sync_profiles p on p.id = b.profile_id
      where p.state in ('connected', 'reauthentication-required') order by p.updated_at desc`)
    const library = bindings.find(item => item.type === 'library' && item.localRoot
      && workspaceRootsReferToSameLocation(item.localRoot, root))
    const profile = library ?? bindings[0]
    const scoped = bindings.filter(item => item.profileId === profile?.profileId
      && (item.type === 'account-data' || item.workspaceId === library?.workspaceId))
    const ids = JSON.stringify(scoped.map(item => item.workspaceId))
    const hasPersonal = scoped.some(item => item.type === 'account-data') ? 1 : 0
    const toggles = JSON.parse(profile?.domainToggles ?? '{}') as Record<string, boolean>
    const enabledKinds = JSON.stringify(enabledPersonalSyncKinds(toggles))
    const enabledDeleteKinds = JSON.stringify(enabledPersonalSyncKinds(toggles, true))
    // Mirror the runtime's domain and attachment policy. A paused domain is
    // excluded from active uploads, and queued source rows must not be counted twice.
    const [counts] = await database.select<Array<{
      pendingCount: number; blockedCount: number; pausedCount: number; conflictCount: number; incomingCount: number
    }>>(`with candidates as (
        select o.*, coalesce(json_extract(o.payload, '$.kind'), json_extract(o.payload, '$.objectResolution.kind'),
          json_extract(o.payload, '$.resolution.kind'), m.kind,
          (select parent.kind from self_hosted_conflicts conflict join self_hosted_object_mappings parent
            on parent.workspace_id = conflict.workspace_id and parent.object_id = conflict.object_id
            where conflict.workspace_id = o.workspace_id and conflict.id = json_extract(o.payload, '$.conflictId') limit 1)) as effectiveKind,
          coalesce(json_extract(o.payload, '$.objectId'), json_extract(o.payload, '$.objectResolution.objectId'),
            json_extract(o.payload, '$.resolution.objectId'),
            (select object_id from self_hosted_conflicts where workspace_id = o.workspace_id
              and id = json_extract(o.payload, '$.conflictId') limit 1)) as effectiveObjectId
        from self_hosted_outbox o left join self_hosted_object_mappings m
          on m.workspace_id = o.workspace_id and m.object_id = coalesce(json_extract(o.payload, '$.objectId'),
            json_extract(o.payload, '$.objectResolution.objectId'), json_extract(o.payload, '$.resolution.objectId'))
        where o.workspace_id in (select value from json_each($1)) and o.state in ('pending', 'retry', 'blocked', 'failed')
      ), commandBlobRefs as (
        select c.command_id, refs.value as blobId from candidates c join json_each(c.payload, '$.blobRefs') refs
        union select c.command_id, refs.value from candidates c join json_each(c.payload, '$.objectResolution.blobRefs') refs
        union select c.command_id, refs.value from candidates c join json_each(c.payload, '$.resolution.blobRefs') refs
      ), commands as (
        select o.*, case when o.workspace_id <> $5 and $6 = 0
          and coalesce(json_extract(o.payload, '$.type'), '') <> 'delete-object'
          and coalesce(json_extract(o.payload, '$.deleteObject'), 0) <> 1
          and exists (select 1 from commandBlobRefs ref where ref.command_id = o.command_id
            and not exists (select 1 from self_hosted_remote_objects accepted, json_each(accepted.payload, '$.personalAssets') asset
              where accepted.workspace_id = o.workspace_id and accepted.object_id = o.effectiveObjectId
                and json_extract(asset.value, '$.blobId') = ref.blobId)) then 1 else 0 end as attachmentsPaused
        from candidates o where o.workspace_id = $5 or o.effectiveKind in (select value from json_each(
          case when json_extract(o.payload, '$.type') = 'delete-object' or json_extract(o.payload, '$.deleteObject') = 1
            then $4 else $3 end))
      ), changes as (
        select c.* from self_hosted_local_changes c
        where c.state in ('pending', 'queued')
          and (c.workspace_id in (select value from json_each($1)) or (c.workspace_id is null and $2 = 1))
          and ((c.workspace_id = $5 and c.domain in ('file', 'asset', 'folder'))
            or ((c.workspace_id is null or c.workspace_id <> $5) and c.domain <> 'asset' and c.domain in (select value from json_each(
              case when c.operation = 'delete' then $4 else $3 end))))
          and not exists (select 1 from commands o, json_each(o.source_change_ids) source
            where cast(source.value as integer) = c.id)
          and c.id = (select max(latest.id) from self_hosted_local_changes latest
            where latest.state in ('pending', 'queued') and latest.domain = c.domain and latest.local_key = c.local_key
              and latest.workspace_id is c.workspace_id)
      ) select
        (select count(*) from commands where state in ('pending', 'retry') and attachmentsPaused = 0) +
          (select count(*) from changes where last_error_code is null) as pendingCount,
        (select count(*) from commands where state in ('blocked', 'failed')) +
          (select count(*) from changes where last_error_code is not null and last_error_code <> 'attachments_paused') +
          (select count(*) from self_hosted_inbox where (state = 'failed' or (state = 'pending' and error_code is not null))
            and workspace_id in (select value from json_each($1))) as blockedCount,
        (select count(*) from changes where last_error_code = 'attachments_paused') +
          (select count(*) from commands where state in ('pending', 'retry') and attachmentsPaused = 1) as pausedCount,
        (select count(*) from self_hosted_conflicts where state = 'unresolved'
          and workspace_id in (select value from json_each($1))) as conflictCount,
        (select count(*) from self_hosted_inbox where state = 'pending' and error_code is null
          and workspace_id in (select value from json_each($1))) as incomingCount`,
      [ids, hasPersonal, enabledKinds, enabledDeleteKinds, library?.workspaceId ?? '', toggles.attachments === false ? 0 : 1])
    const [store, settings] = await Promise.all([Store.load('self-hosted-sync-ui.json'), Store.load('store.json')])
    const successKey = JSON.stringify([profile?.profileId ?? '', root])
    let lastSuccessAt = await store.get<number>(successKey) ?? null
    const reviewProfileId = await settings.get<string>('selfHostedConnectionReviewProfileId')
    const reviewRequired = Boolean(profile?.profileId && reviewProfileId === profile.profileId)
    const reauthenticationRequired = profile?.profileState === 'reauthentication-required'
    const bindingRequired = !library || !['bound', 'bootstrapping', 'epoch-changed'].includes(library.state)
    const current = useSettingStore.getState()
    if (completedAt && current.primaryBackupMethod === 'selfHosted' && current.workspacePath === workspacePath
      && library?.state === 'bound' && !reviewRequired && !reauthenticationRequired
      && counts && !counts.pendingCount && !counts.blockedCount && !counts.pausedCount
      && !counts.conflictCount && !counts.incomingCount) {
      lastSuccessAt = completedAt
      await store.set(successKey, completedAt)
      await store.save()
    }
    return { ...EMPTY_SUMMARY, ...counts, lastSuccessAt, reviewRequired, reauthenticationRequired, bindingRequired }
  })()
  summaryReads.set(readKey, read)
  try { return await read } finally { summaryReads.delete(readKey) }
}

export function useSelfHostedSyncStatus() {
  const method = useSettingStore(state => state.primaryBackupMethod)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const connected = useSyncStore(state => state.selfHostedConnected)
  const serviceAvailable = useSyncStore(state => state.selfHostedServiceAvailable)
  const runtimeReady = useSyncStore(state => state.selfHostedRuntimeReady)
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [offline, setOffline] = useState(false)
  const [progress, setProgress] = useState<SwitchOperationProgress | null>(null)
  const [engineErrors, setEngineErrors] = useState<string[]>([])
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    setSummary(EMPTY_SUMMARY)
    setLoaded(false)
    setError(false)
    setProgress(null)
    setEngineErrors([])
    if (!settingsReady || method !== 'selfHosted') return
    let disposed = false
    let request = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    let running = false
    const update = async (completedAt?: number) => {
      const version = ++request
      try {
        const next = await readSummary(workspacePath, completedAt)
        if (!disposed && version === request) { setSummary(next); setLoaded(true); setError(false) }
      } catch (cause) {
        if (!disposed && version === request) { setLoaded(true); setError(true) }
        console.warn('[self-hosted-sync] Unable to read sync status', cause)
      }
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; void update() }, 200)
    }
    refreshRef.current = schedule
    const completed = ({ errors }: { errors: string[] }) => {
      if (timer) { clearTimeout(timer); timer = undefined }
      running = false
      setProgress(null)
      setEngineErrors(errors)
      void update(errors.length ? undefined : Date.now())
    }
    const networkChanged = () => { setOffline(!navigator.onLine); schedule() }
    const visible = () => { if (document.visibilityState === 'visible') schedule() }
    networkChanged()
    void import('@/lib/self-hosted-sync/runtime').then(({ getSelfHostedSyncRuntime }) => {
      if (disposed) return
      unsubscribe = getSelfHostedSyncRuntime().subscribeProgress(value => {
        setProgress(value)
        if (!running) { running = true; schedule() }
      })
    })
    emitter.on('sync-engine-completed', completed)
    emitter.on('self-hosted-conflicts-changed', schedule)
    emitter.on('article-saved', schedule)
    window.addEventListener('self-hosted-profile-state-changed', schedule)
    window.addEventListener('online', networkChanged)
    window.addEventListener('offline', networkChanged)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      refreshRef.current = () => {}
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      emitter.off('sync-engine-completed', completed)
      emitter.off('self-hosted-conflicts-changed', schedule)
      emitter.off('article-saved', schedule)
      window.removeEventListener('self-hosted-profile-state-changed', schedule)
      window.removeEventListener('online', networkChanged)
      window.removeEventListener('offline', networkChanged)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [method, settingsReady, workspacePath, connected])

  return { ...summary, loaded, error, offline, progress, engineErrors, serviceAvailable, runtimeReady, refresh }
}
