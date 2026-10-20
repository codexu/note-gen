'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { PluginIcon } from './plugin-icon'
import Chat from '@/app/core/main/chat'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PluginViewSurface } from '@/components/plugins/plugin-view-surface'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { useLocale, useTranslations } from 'next-intl'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'

export function PluginRightSidebar() {
  const locale = useLocale()
  const t = useTranslations('settings.plugins.ui')
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore((state) => state.installed)
  usePluginLocalization(installed, locale)
  const workspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const active = usePluginUiStore((state) => state.activeRightView)
  const setActive = usePluginUiStore((state) => state.setActiveRightView)
  const contributions = installed.flatMap((plugin) => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    const enabled = isPluginEnabledInWorkspace(plugin, state)
    return enabled ? (plugin.manifest.contributes.views ?? []).filter((view) => view.location === 'right-sidebar' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location)).map((view) => ({ plugin, view, key: `${plugin.manifest.id}:${view.id}` })) : []
  })
  useEffect(() => {
    if (active && !contributions.some(item => item.key === active)) setActive(null)
  }, [active, contributions, setActive])
  if (contributions.length === 0) return <Chat />
  const selected = contributions.find((item) => item.key === active)
  return (
    <Tabs value={selected?.key ?? '@chat'} onValueChange={key => setActive(key === '@chat' ? null : key)} className="h-full min-h-0 min-w-0 gap-0">
      <div className="shrink-0 overflow-x-auto overflow-y-hidden border-b px-2">
        <TabsList className="my-1">
          <TabsTrigger value="@chat" aria-label={t('chat')}><MessageSquare /></TabsTrigger>
          {contributions.map(({ plugin, view, key }) => (
            <TabsTrigger key={key} value={key}>
              <PluginIcon name={view.icon} data-icon="inline-start" />
              {resolvePluginViewTitle(plugin, view, locale, workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id]?.settings : undefined)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent forceMount value="@chat" className="min-h-0 overflow-hidden data-[state=inactive]:hidden"><Chat /></TabsContent>
      {selected ? <TabsContent key={selected.key} value={selected.key} className="min-h-0 overflow-hidden"><PluginViewSurface viewKey={selected.key} /></TabsContent> : null}
    </Tabs>
  )
}
