'use client'

import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Files, Highlighter } from "lucide-react"
import { FileSidebar } from "./file"
import { NoteSidebar } from "./mark"
import { FileActions } from "./file/file-actions"
import { MarkActions } from "./mark/mark-actions"
import { useTranslations } from "next-intl"
import { useSidebarStore } from "@/stores/sidebar"
import { ExpandableTabs } from "@/components/ui/expandable-tabs"
import { AnimatePresence, motion } from "framer-motion"

const SIDEBAR_TABS = [
  { title: "files", icon: Files },
  { title: "notes", icon: Highlighter },
] as const

export function LeftSidebar() {
  const { leftSidebarTab, setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations()

  const handleTabChange = (index: number | null) => {
    if (index !== null) {
      setLeftSidebarTab(SIDEBAR_TABS[index].title)
    }
  }

  const getSelectedIndex = () => {
    return SIDEBAR_TABS.findIndex(tab => tab.title === leftSidebarTab)
  }

  // Prepare tabs with translated titles
  const tabs = SIDEBAR_TABS.map(tab => ({
    ...tab,
    title: t(`navigation.${tab.title === 'notes' ? 'record' : tab.title}`),
  }))

  return (
    <div className="w-full h-full flex flex-col">
      <Tabs value={leftSidebarTab} className="w-full h-full flex flex-col">
        <div className="w-full h-12 border-b flex items-center justify-between px-2">
          <ExpandableTabs
            tabs={tabs}
            onChange={handleTabChange}
            selected={getSelectedIndex()}
          />
          <div className="relative">
            <AnimatePresence mode="wait">
              {leftSidebarTab === "files" && (
                <motion.div
                  key="files-actions"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <FileActions />
                </motion.div>
              )}
              {leftSidebarTab === "notes" && (
                <motion.div
                  key="notes-actions"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <MarkActions />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <TabsContent value="files" className="flex-1 m-0 overflow-hidden">
          <FileSidebar />
        </TabsContent>
        <TabsContent value="notes" className="flex-1 m-0 overflow-hidden">
          <NoteSidebar />
        </TabsContent>
      </Tabs>
    </div>
  )
}
