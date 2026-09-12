'use client'

import type { PluginEmbeddedViewLocation } from '@notegen/plugin-api'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { usePluginStore } from '@/stores/plugins'
import { mountEmbeddedView, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'
import { usePluginLocalization } from '@/lib/plugins/localization'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { PluginViewSurface } from './plugin-view-surface'

export function useEmbeddedPluginViews(location: PluginEmbeddedViewLocation) {
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  const settings = usePluginStore(state => state.deviceSettings)
  usePluginLocalization(installed, locale)
  return [...installed].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).flatMap(plugin => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    if (!isPluginEnabledInWorkspace(plugin, state) || !isPluginDisplayVisible(settings, plugin.manifest.id, location)) return []
    return (plugin.manifest.contributes.views ?? []).filter(view => view.location === location).map(view => ({
      key: `${plugin.manifest.id}:${view.id}`, view, hash: plugin.contentHash,
      title: resolvePluginViewTitle(plugin, view, locale, state?.settings),
    }))
  })
}

type EmbeddedView = ReturnType<typeof useEmbeddedPluginViews>[number]

/** A view belongs to one visible host context at a time, never a hidden editor tab. */
export function PluginEmbeddedView({ item, contextKey = '', compact = false, card = true, popover = false }: {
  item: EmbeddedView; contextKey?: string; compact?: boolean; card?: boolean; popover?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const workspace = usePluginStore(state => state.currentWorkspaceId)
  const revision = usePluginUiStore(state => state.hostRevision)
  const hidden = usePluginUiStore(state => state.hiddenTitleBarViews.includes(item.key))
  const [visible, setVisible] = useState(false)
  const [placeholderHeight, setPlaceholderHeight] = useState(0)
  const focus = usePluginUiStore(state => state.focusRequest)
  useEffect(() => {
    if (!hidden && focus?.key === item.key) container.current?.scrollIntoView({ block: 'nearest' })
  }, [focus, hidden, item.key])
  const contextId = useMemo(() => crypto.randomUUID(), [item.key, item.hash, workspace, contextKey, revision, visible, hidden])
  useEffect(() => {
    const node = container.current
    if (!node || hidden) { setVisible(false); return }
    const observer = new IntersectionObserver(entries => {
      const next = entries.some(entry => entry.isIntersecting)
      if (!next) setPlaceholderHeight(node.getBoundingClientRect().height)
      setVisible(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hidden])
  useLayoutEffect(() => {
    if (!visible || hidden) return
    return mountEmbeddedView(item.key, contextId)
  }, [item.key, contextId, visible, hidden])
  if (hidden) return null
  const content = visible ? <PluginViewSurface key={contextId} viewKey={item.key} compact={compact} forcePopover={popover} title={item.title} icon={item.view.icon} /> : null
  return <div ref={container} style={!visible && placeholderHeight ? { minHeight: placeholderHeight } : undefined} className={compact ? 'min-h-6 min-w-6 shrink-0' : 'min-h-8 min-w-0'}>
    {card && !compact ? <Card><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent>{content}</CardContent></Card> : content}
  </div>
}

export function PluginEmbeddedViews({ location, active = true, contextKey = '', compact = false, popover = false }: {
  location: PluginEmbeddedViewLocation; active?: boolean; contextKey?: string; compact?: boolean; popover?: boolean
}) {
  const items = useEmbeddedPluginViews(location)
  if (!active || !items.length) return null
  return <div className={compact ? 'flex min-w-0 shrink-0 items-center gap-1' : 'flex max-h-[40vh] min-w-0 shrink-0 flex-col gap-3 overflow-auto p-2'}>
    {items.map(item => <PluginEmbeddedView key={item.key} item={item} contextKey={contextKey} compact={compact} popover={popover} />)}
  </div>
}
