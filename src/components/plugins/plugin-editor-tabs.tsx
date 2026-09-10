'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useEffect, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { usePluginStore } from '@/stores/plugins'
import useArticleStore from '@/stores/article'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { cancelPluginViewNavigation, closePluginView, openPluginView, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import { PluginIcon } from './plugin-icon'
import { PluginViewSurface } from './plugin-view-surface'
import { toast } from 'sonner'

export function PluginEditorTabs({ children }: { children: ReactNode }) {
  const t = useTranslations('settings.plugins.ui')
  const locale = useLocale()
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore(state => state.installed)
  usePluginLocalization(installed, locale)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaces = usePluginStore(state => state.workspaceStates)
  const tabs = usePluginUiStore(state => state.editorTabs)
  const active = usePluginUiStore(state => state.activeEditorView)
  const setActive = usePluginUiStore(state => state.setActiveEditorView)
  const available = installed.flatMap(plugin => {
    if (!isPluginEnabledInWorkspace(plugin, workspaceId ? workspaces[workspaceId]?.[plugin.manifest.id] : undefined)) return []
    return (plugin.manifest.contributes.views ?? []).filter(view => view.location === 'editor-tab' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location)).map(view => ({
      key: `${plugin.manifest.id}:${view.id}`, pluginId: plugin.manifest.id, plugin, view,
    }))
  })
  const opened = tabs.flatMap(key => available.filter(item => item.key === key))
  const selected = opened.find(item => item.key === active)
  useEffect(() => {
    if (active && !selected) setActive(null)
  }, [active, selected, setActive])
  useEffect(() => {
    for (const key of tabs) {
      if (!available.some(item => item.key === key)) usePluginUiStore.getState().closeEditorView(key)
    }
  }, [tabs, available])
  useEffect(() => useArticleStore.subscribe((state, previous) => {
    if (state.activeTabId !== previous.activeTabId || state.activeFilePath !== previous.activeFilePath) setActive(null)
  }), [setActive])
  return <Tabs className="min-h-0 min-w-0 flex-1 gap-0" value={selected?.key ?? '@editor'} onValueChange={key => {
      if (key === '@editor') { cancelPluginViewNavigation(); setActive(null); return }
      const item = opened.find(candidate => candidate.key === key)
      if (item) void openPluginView(item.pluginId, item.view.id).catch(error => toast.error(error instanceof Error ? error.message : String(error)))
    }}>
      <TabsList data-empty={!opened.length} className="max-w-full shrink-0 overflow-x-auto overflow-y-hidden data-[empty=true]:hidden">
        <TabsTrigger value="@editor">{t('editor')}</TabsTrigger>
        {opened.map(item => <div key={item.key} className="flex h-full shrink-0 items-center">
          <TabsTrigger value={item.key}><PluginIcon name={item.view.icon} data-icon="inline-start" />{resolvePluginViewTitle(item.plugin, item.view, locale, workspaceId ? workspaces[workspaceId]?.[item.pluginId]?.settings : undefined)}</TabsTrigger>
          <Button variant="ghost" size="icon-sm" aria-label={t('closeView', { name: resolvePluginViewTitle(item.plugin, item.view, locale, workspaceId ? workspaces[workspaceId]?.[item.pluginId]?.settings : undefined) })} onClick={() => { void closePluginView(item.pluginId, item.view.id).catch(error => toast.error(String(error))) }}><X /></Button>
        </div>)}
      </TabsList>
    <TabsContent forceMount value="@editor" className="flex min-h-0 data-[state=inactive]:hidden">{children}</TabsContent>
    {opened.map(item => <TabsContent forceMount key={item.key} value={item.key} className="min-h-0 data-[state=inactive]:hidden"><PluginViewSurface viewKey={item.key} active={selected?.key === item.key} /></TabsContent>)}
  </Tabs>
}
