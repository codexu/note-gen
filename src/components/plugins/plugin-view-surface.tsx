'use client'

import { useEffect, useRef, useState } from 'react'
import { activatePluginView, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { PluginDeclarativeUi } from './plugin-declarative-ui'
import { usePluginStore } from '@/stores/plugins'
import { useTranslations } from 'next-intl'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { PluginIcon } from './plugin-icon'
import { PluginSettingsLayoutContext } from './plugin-settings-layout'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

// A leading toolbar belongs to the sidebar header rather than the scrolling list.
export function PluginViewToolbar({ viewKey }: { viewKey: string }) {
  const first = usePluginUiStore(state => state.views[viewKey]?.blocks[0])
  if (first?.type !== 'toolbar') return null
  return <PluginDeclarativeUi scope={viewKey} document={{ blocks: [first] }} nested />
}

export function PluginViewSurface({ viewKey, active = true, toolbarInHeader = false, compact = false, forcePopover = false, title, icon }: { viewKey: string; active?: boolean; toolbarInHeader?: boolean; compact?: boolean; forcePopover?: boolean; title?: string; icon?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const content = usePluginUiStore(state => state.views[viewKey])
  const hostRevision = usePluginUiStore(state => state.hostRevision)
  const focus = usePluginUiStore(state => state.focusRequest)
  const t = useTranslations('settings.plugins.ui')
  const [pluginId, viewId] = viewKey.split(':')
  const hash = usePluginStore(state => state.installed.find(plugin => plugin.manifest.id === pluginId)?.contentHash)
  const settingsLayout = usePluginStore(state => state.installed.find(plugin => plugin.manifest.id === pluginId)?.manifest.contributes.views?.find(view => view.id === viewId)?.location === 'settings')
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
  if (compact) {
    if (!active) return null
    const inline = !forcePopover && content?.blocks.every(block => ['toolbar', 'actions', 'text', 'badge', 'loading', 'separator', 'progress'].includes(block.type))
    return <div ref={container} tabIndex={-1} aria-label={title} aria-busy={loading} className={cn('flex min-w-0 items-center focus-visible:outline-ring', forcePopover ? 'h-6' : 'h-8')}>
      {error ? <Button variant="ghost" size="sm" title={error} onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button>
        : !content && loading ? <Spinner aria-label={t('loadingView')} />
        : content?.blocks.length ? inline ? <PluginDeclarativeUi scope={viewKey} document={content} compact />
          : <Popover><PopoverTrigger asChild><Button variant="ghost" size={forcePopover ? (icon ? 'icon-xs' : 'xs') : (icon ? 'icon-sm' : 'sm')} aria-label={title} title={title}>{icon ? <PluginIcon name={icon} /> : title}</Button></PopoverTrigger><PopoverContent aria-label={title} side="bottom" className="max-h-[70vh] w-80 overflow-auto"><PluginDeclarativeUi scope={viewKey} document={content} /></PopoverContent></Popover>
        : null}
    </div>
  }
  return <PluginSettingsLayoutContext.Provider value={settingsLayout}><div ref={container} tabIndex={-1} aria-busy={loading} className={settingsLayout ? "min-w-0 focus-visible:outline-ring" : "h-full min-h-0 min-w-0 overflow-auto focus-visible:outline-ring"}>
    {loading ? <div role="status" className="flex items-center gap-2 p-4"><Spinner />{t('loadingView')}</div> : null}
    {error ? <div className="p-4"><Alert variant="destructive"><AlertTitle>{t('viewFailed')}</AlertTitle><AlertDescription className="flex flex-col gap-2"><span className="break-words">{error}</span><Button variant="outline" size="sm" className="self-start" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></AlertDescription></Alert></div> : null}
    {content || (!loading && !error) ? <PluginDeclarativeUi key={viewKey} scope={viewKey} document={toolbarInHeader && content?.blocks[0]?.type === 'toolbar' ? { ...content, blocks: content.blocks.slice(1) } : content} /> : null}
  </div></PluginSettingsLayoutContext.Provider>
}
