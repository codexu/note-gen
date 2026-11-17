'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getWikiContext } from '@/lib/wiki/context'
import { initAllDatabases } from '@/db'
import { getWikiSettings } from '@/lib/wiki/settings'
import { getWikiMeta, getWikiUsage, listWikiJobs, listWikiPages, listWikiSourceStates } from '@/db/wiki'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import type { WikiContext, WikiJob, WikiPage, WikiSettings, WikiSourceState, WikiUsage } from '@/types/wiki'

interface WikiData {
  context: WikiContext
  settings: WikiSettings
  pages: WikiPage[]
  jobs: WikiJob[]
  sources: WikiSourceState[]
  usage: WikiUsage
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

export function useWikiData() {
  const workspacePath = useSettingStore(state => state.workspacePath)
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const mounted = useRef(false)
  const request = useRef(0)
  const scopeRef = useRef<WikiDataScope>({ workspacePath, ready: settingsReady })
  const [state, setState] = useState<WikiDataState>(() => emptyState(scopeRef.current))

  const getScope = useCallback(() => {
    const path = useSettingStore.getState().workspacePath
    const ready = useSettingsHydrationStore.getState().status === 'ready'
    if (scopeRef.current.workspacePath !== path || scopeRef.current.ready !== ready) {
      // Object identity also distinguishes A -> B -> A between React renders.
      scopeRef.current = { workspacePath: path, ready }
      request.current++
    }
    return scopeRef.current
  }, [])
  const scope = getScope()

  const refresh = useCallback(async () => {
    const target = getScope()
    if (!mounted.current || !target.ready) return
    const current = ++request.current
    const isCurrent = () => mounted.current && getScope() === target && current === request.current
    setState(previous => previous.scope === target
      ? { ...previous, error: null, loading: previous.data === null }
      : emptyState(target))
    try {
      await initAllDatabases()
      if (!isCurrent()) return
      const context = await getWikiContext()
      if (!isCurrent()) return
      const workspaceKey = target.workspacePath
        ? `custom:${target.workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')}`
        : 'default:article'
      if (context.workspaceKey !== workspaceKey) throw new Error('WIKI_CONTEXT_CHANGED')
      const [settings, pages, jobs, sources, usage, syncStatus] = await Promise.all([
        getWikiSettings(context.id), listWikiPages(context.id), listWikiJobs(context.id),
        listWikiSourceStates(context.id), getWikiUsage(context.id),
        getWikiMeta<WikiData['syncStatus']>(context.id, 'sync-status'),
      ])
      if (!isCurrent()) return
      const latestContext = await getWikiContext()
      if (!isCurrent() || latestContext.id !== context.id) return
      setState({ scope: target, data: { context, settings, pages, jobs, sources, usage, syncStatus },
        error: null, loading: false })
    } catch (cause) {
      if (isCurrent()) {
        setState(previous => ({ ...(previous.scope === target ? previous : emptyState(target)),
          error: cause instanceof Error ? cause.message : String(cause), loading: false }))
      }
    } finally {
      if (isCurrent()) setState(previous => previous.scope === target ? { ...previous, loading: false } : previous)
    }
  }, [getScope])

  useEffect(() => {
    mounted.current = true
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
    const onUpdate = () => { void refresh() }
    window.addEventListener('wiki-updated', onUpdate)
    return () => {
      mounted.current = false
      request.current++
      unsubscribeSettings()
      unsubscribeHydration()
      window.removeEventListener('wiki-updated', onUpdate)
    }
  }, [getScope, refresh])

  useEffect(() => { void refresh() }, [scope, refresh])

  const current = settingsReady && scope.ready && scope.workspacePath === workspacePath && state.scope === scope
  return { data: current ? state.data : null, error: current ? state.error : null,
    loading: !current || state.loading, refresh }
}
