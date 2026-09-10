'use client'

import { useEffect, useRef, useState } from 'react'
import { activatePluginView, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { PluginDeclarativeUi } from './plugin-declarative-ui'
import { usePluginStore } from '@/stores/plugins'
import { useTranslations } from 'next-intl'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// A leading toolbar belongs to the sidebar header rather than the scrolling list.
export function PluginViewToolbar({ viewKey }: { viewKey: string }) {
  const first = usePluginUiStore(state => state.views[viewKey]?.blocks[0])
  if (first?.type !== 'toolbar') return null
  return <PluginDeclarativeUi scope={viewKey} document={{ blocks: [first] }} nested />
}

export function PluginViewSurface({ viewKey, active = true, toolbarInHeader = false }: { viewKey: string; active?: boolean; toolbarInHeader?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const content = usePluginUiStore(state => state.views[viewKey])
  const hostRevision = usePluginUiStore(state => state.hostRevision)
  const focus = usePluginUiStore(state => state.focusRequest)
  const t = useTranslations('settings.plugins.ui')
  const [pluginId, viewId] = viewKey.split(':')
  const hash = usePluginStore(state => state.installed.find(plugin => plugin.manifest.id === pluginId)?.contentHash)
  const workspace = usePluginStore(state => state.currentWorkspaceId)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    let current = true
    setLoading(true)
    setError('')
    void activatePluginView(pluginId, viewId).catch(reason => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [pluginId, viewId, hash, workspace, active, attempt, hostRevision])
  useEffect(() => {
    if (active && focus?.key === viewKey) container.current?.focus()
  }, [focus, viewKey, active])
  return <div ref={container} tabIndex={-1} aria-busy={loading} className="h-full min-h-0 min-w-0 overflow-auto focus-visible:outline-ring">
    {loading ? <div role="status" className="flex items-center gap-2 p-4"><Spinner />{t('loadingView')}</div> : null}
    {error ? <div className="p-4"><Alert variant="destructive"><AlertTitle>{t('viewFailed')}</AlertTitle><AlertDescription className="flex flex-col gap-2"><span className="break-words">{error}</span><Button variant="outline" size="sm" className="self-start" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></AlertDescription></Alert></div> : null}
    {content || (!loading && !error) ? <PluginDeclarativeUi key={viewKey} scope={viewKey} document={toolbarInHeader && content?.blocks[0]?.type === 'toolbar' ? { ...content, blocks: content.blocks.slice(1) } : content} /> : null}
  </div>
}
