'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getWikiContext } from '@/lib/wiki/context'
import { initAllDatabases } from '@/db'
import { getWikiSettings } from '@/lib/wiki/settings'
import { getWikiMeta, getWikiSettingsProgress, listWikiJobs, listWikiPageEntries, listWikiSourceStates, type WikiPageListEntry } from '@/db/wiki'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { canRunWikiJob, type WikiContext, type WikiJob, type WikiSettings, type WikiSourceState } from '@/types/wiki'

interface WikiData {
  context: WikiContext
  settings: WikiSettings
  pages: WikiPageListEntry[]
  jobs: WikiJob[]
  sources: WikiSourceState[]
  failedCount: number
  syncStatus: { phase: 'syncing' | 'idle' | 'failed'; error: string | null; completedAt?: number } | null
}

interface WikiDataScope {
  workspacePath: string
  ready: boolean
}

interface WikiDataState {
  scope: WikiDataScope
  data: WikiData | null
  error: string | null
  loading: boolean
}

function emptyState(scope: WikiDataScope): WikiDataState {
  return { scope, data: null, error: null, loading: true }
}

async function getFolderWikiProgress(contextId: string) {
  const [pages, jobs, sources] = await Promise.all([
    listWikiPageEntries(contextId), listWikiJobs(contextId), listWikiSourceStates(contextId),
  ])
  const pagesById = new Map(pages.map(page => [page.id, page]))
  const visibleJobs = jobs.filter(job => canRunWikiJob(job, pagesById.get(job.id)))
  return { pages, sources, jobs: visibleJobs, failedCount: visibleJobs.filter(job => job.status === 'failed').length }
}

export function useWikiData(settingsFailureLimit?: number) {
  const workspacePath = useSettingStore(state => state.workspacePath)
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const refreshRequest = useRef<() => Promise<void>>(() => Promise.resolve())
  const scopeRef = useRef<WikiDataScope>({ workspacePath, ready: settingsReady })
  const [state, setState] = useState<WikiDataState>(() => emptyState(scopeRef.current))

  const getScope = useCallback(() => {
    const path = useSettingStore.getState().workspacePath
    const ready = useSettingsHydrationStore.getState().status === 'ready'
    if (scopeRef.current.workspacePath !== path || scopeRef.current.ready !== ready) {
      // Object identity also distinguishes A -> B -> A between React renders.
      scopeRef.current = { workspacePath: path, ready }
    }
    return scopeRef.current
  }, [])
  const scope = getScope()

  const refresh = useCallback(() => refreshRequest.current(), [])

  useEffect(() => {
    const invalidateScope = () => {
      const next = getScope()
      setState(previous => previous.scope === next ? previous : emptyState(next))
    }
    const unsubscribeSettings = useSettingStore.subscribe((next, previous) => {
      if (next.workspacePath !== previous.workspacePath) invalidateScope()
    })
    const unsubscribeHydration = useSettingsHydrationStore.subscribe((next, previous) => {
      if (next.status !== previous.status) invalidateScope()
    })
    return () => {
      unsubscribeSettings()
      unsubscribeHydration()
    }
  }, [getScope])

  useEffect(() => {
    if (!scope.ready) return
    let disposed = false
    let running: Promise<void> | null = null
    let queued: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const isCurrent = () => !disposed && getScope() === scope
    const load = async () => {
      try {
        await initAllDatabases()
        if (!isCurrent()) return
        const context = await getWikiContext()
        const workspaceKey = scope.workspacePath
          ? `custom:${scope.workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')}`
          : 'default:article'
        if (context.workspaceKey !== workspaceKey) throw new Error('WIKI_CONTEXT_CHANGED')
        if (!isCurrent()) return
        const [settings, progress, syncStatus] = await Promise.all([
          getWikiSettings(context.id),
          settingsFailureLimit === undefined ? getFolderWikiProgress(context.id) : getWikiSettingsProgress(context.id, settingsFailureLimit),
          getWikiMeta<WikiData['syncStatus']>(context.id, 'sync-status'),
        ])
        if (isCurrent()) setState({ scope, data: { context, settings, ...progress, syncStatus }, error: null, loading: false })
      } catch (cause) {
        if (isCurrent()) setState(previous => ({ ...(previous.scope === scope ? previous : emptyState(scope)),
          error: cause instanceof Error ? cause.message : String(cause), loading: false }))
      }
    }
    const request = (): Promise<void> => {
      clearTimeout(timer)
      timer = undefined
      if (running) {
        if (!queued) queued = running.then(() => {
          queued = null
          if (isCurrent()) return request()
        })
        return queued
      }
      running = load().finally(() => { running = null })
      return running
    }
    // A burst of source and queue writes needs one refresh after the writes settle.
    const onUpdate = () => {
      if (timer === undefined) timer = setTimeout(() => { void request() }, 200)
    }
    refreshRequest.current = request
    window.addEventListener('wiki-updated', onUpdate)
    void request()
    return () => {
      disposed = true
      clearTimeout(timer)
      refreshRequest.current = () => Promise.resolve()
      window.removeEventListener('wiki-updated', onUpdate)
    }
  }, [getScope, scope, settingsFailureLimit])

  const current = settingsReady && scope.ready && scope.workspacePath === workspacePath && state.scope === scope
  return { data: current ? state.data : null, error: current ? state.error : null,
    loading: !current || state.loading, refresh }
}
