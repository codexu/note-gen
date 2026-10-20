'use client'

import type { PluginTitleBarLocation } from '@notegen/plugin-api'
import { useLocale } from 'next-intl'
import { usePluginStore } from '@/stores/plugins'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'
import { usePluginLocalization } from '@/lib/plugins/localization'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import { PluginViewSurface } from './plugin-view-surface'
import { cn } from '@/lib/utils'

export function PluginTitleBar({ location }: { location: PluginTitleBarLocation }) {
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  const settings = usePluginStore(state => state.deviceSettings)
  const hidden = usePluginUiStore(state => state.hiddenTitleBarViews)
  usePluginLocalization(installed, locale)
  const items = [...installed].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).flatMap(plugin => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    if (!isPluginEnabledInWorkspace(plugin, state) || !isPluginDisplayVisible(settings, plugin.manifest.id, location)) return []
    return (plugin.manifest.contributes.views ?? []).filter(view => view.location === location).map(view => ({
      key: `${plugin.manifest.id}:${view.id}`, view,
      title: resolvePluginViewTitle(plugin, view, locale, state?.settings),
    }))
  })
  if (!items.length) return null
  return <div className={cn('flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]', location === 'title-bar-center' ? 'max-w-full' : 'max-w-[min(20vw,240px)]')}>
    {items.map(({ key, view, title }) => <div key={key} className={hidden.includes(key) ? 'hidden' : 'shrink-0'}><PluginViewSurface viewKey={key} active={!hidden.includes(key)} compact title={title} icon={view.icon} /></div>)}
  </div>
}
