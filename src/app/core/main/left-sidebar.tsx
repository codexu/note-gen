'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useEffect } from 'react'
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Files, Highlighter, Palette } from "lucide-react"
import { FileSidebar } from "./file"
import { NoteSidebar } from "./mark"
import { FileActions } from "./file/file-actions"
import { MarkActions } from "./mark/mark-actions"
import { useLocale, useTranslations } from "next-intl"
import { isBuiltInLeftSidebarTab, useSidebarStore } from "@/stores/sidebar"
import { ExpandableTabs } from "@/components/ui/expandable-tabs"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import { CanvasActions, CanvasSidebar } from './canvas/canvas-sidebar'
import { SidebarSearch } from './sidebar-search'
import { getPluginIcon } from '@/components/plugins/plugin-icon'
import { PluginViewSurface, PluginViewToolbar } from '@/components/plugins/plugin-view-surface'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'

const SIDEBAR_TABS = [
  { title: "files", icon: Files },
  { title: "notes", icon: Highlighter },
  { title: "canvases", icon: Palette },
] as const

export function LeftSidebar() {
  const { leftSidebarTab, setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations()
  const locale = useLocale()
  const pluginsInitialized = usePluginStore((state) => state.initialized)
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore((state) => state.installed)
  usePluginLocalization(installed, locale)
  const workspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const pluginTabs = installed.flatMap((plugin) => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    const enabled = isPluginEnabledInWorkspace(plugin, state)
    return enabled ? (plugin.manifest.contributes.views ?? [])
      .filter((view) => view.location === 'left-sidebar' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location))
      .map((view) => ({ title: resolvePluginViewTitle(plugin, view, locale, state?.settings), icon: getPluginIcon(view.icon), id: `${plugin.manifest.id}:${view.id}` })) : []
  })
  const allTabs = [
    ...SIDEBAR_TABS.map((tab) => ({ ...tab, id: tab.title, title: t(`navigation.${tab.title === 'notes' ? 'record' : tab.title}`) })),
    ...pluginTabs,
  ]
  const activeTabAvailable = allTabs.some((tab) => tab.id === leftSidebarTab)

  useEffect(() => {
    if (!pluginsInitialized || activeTabAvailable) return
    void setLeftSidebarTab('files')
  }, [activeTabAvailable, pluginsInitialized, setLeftSidebarTab])

  const handleTabChange = (index: number | null) => {
    if (index !== null) {
      const tab = allTabs[index]
      if (tab) setLeftSidebarTab(tab.id)
    }
  }

  const getSelectedIndex = () => {
    return allTabs.findIndex(tab => tab.id === leftSidebarTab)
  }

  // Prepare tabs with translated titles
  const tabs = allTabs
  const activePluginTab = pluginTabs.find((tab) => tab.id === leftSidebarTab)

  return (
    <div className="w-full h-full flex flex-col">
      <Tabs value={leftSidebarTab} className="h-full w-full gap-0 overflow-hidden">
        <div className="flex h-12 w-full shrink-0 items-center justify-between border-b px-2">
          <div className="flex min-w-0 items-center gap-1">
            <ExpandableTabs
              tabs={tabs}
              onChange={handleTabChange}
              selected={getSelectedIndex()}
              className="shrink-0 flex-nowrap"
            />
          </div>
          {activePluginTab ? (
            <div className="ml-auto mr-1 shrink-0">
              <PluginViewToolbar viewKey={activePluginTab.id} />
            </div>
          ) : null}
          <div className={cn("grid shrink-0", activePluginTab && "hidden")}>
            <motion.div
              initial={false}
              animate={leftSidebarTab === "files"
                ? { opacity: 1, x: 0 }
                : { opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "col-start-1 row-start-1",
                leftSidebarTab !== "files" && "pointer-events-none"
              )}
            >
              <FileActions />
            </motion.div>
            <motion.div
              initial={false}
              animate={leftSidebarTab === "notes"
                ? { opacity: 1, x: 0 }
                : { opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "col-start-1 row-start-1",
                leftSidebarTab !== "notes" && "pointer-events-none"
              )}
            >
              <MarkActions />
            </motion.div>
            <motion.div
              initial={false}
              animate={leftSidebarTab === "canvases"
                ? { opacity: 1, x: 0 }
                : { opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "col-start-1 row-start-1",
                leftSidebarTab !== "canvases" && "pointer-events-none"
              )}
            >
              <CanvasActions />
            </motion.div>
          </div>
        </div>
        {activePluginTab ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PluginViewSurface key={activePluginTab.id} viewKey={activePluginTab.id} toolbarInHeader />
          </div>
        ) : <SidebarSearch activeTab={isBuiltInLeftSidebarTab(leftSidebarTab) ? leftSidebarTab : 'files'}>
          <div className="relative min-h-0 flex-1">
            <TabsContent
              forceMount
              value="files"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <FileSidebar />
            </TabsContent>
            <TabsContent
              forceMount
              value="notes"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <NoteSidebar />
            </TabsContent>
            <TabsContent
              forceMount
              value="canvases"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <CanvasSidebar />
            </TabsContent>
          </div>
        </SidebarSearch>}
      </Tabs>
    </div>
  )
}
