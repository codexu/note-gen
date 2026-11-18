'use client'

// Fork（almanac ALMNC-20）：知識頁的分頁清單。外掛視圖的篩選條件與舊側欄（left-sidebar.tsx）相同。
import { useMemo } from 'react'
import { useLocale } from 'next-intl'
import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginLocalization } from '@/lib/plugins/localization'
import { buildKnowledgeTabs, type KnowledgeTabItem } from '@/lib/sidebar-v3/knowledge'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import useSettingStore from '@/stores/setting'
import { usePluginStore } from '@/stores/plugins'

export function useKnowledgeTabs(): KnowledgeTabItem[] {
  const locale = useLocale()
  const outlinePlacement = useSettingStore(state => state.outlinePlacement)
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore(state => state.installed)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  usePluginLocalization(installed, locale)
  return useMemo(() => {
    const pluginTabs = installed.flatMap((plugin) => {
      const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
      if (!isPluginEnabledInWorkspace(plugin, state)) return []
      return (plugin.manifest.contributes.views ?? [])
        .filter(view => view.location === 'left-sidebar' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location))
        .map(view => ({ id: `${plugin.manifest.id}:${view.id}`, title: resolvePluginViewTitle(plugin, view, locale, state?.settings) }))
    })
    return buildKnowledgeTabs({ outlineInSidebar: outlinePlacement === 'sidebar', pluginTabs })
  }, [installed, workspaceId, workspaceStates, displaySettings, outlinePlacement, locale])
}
