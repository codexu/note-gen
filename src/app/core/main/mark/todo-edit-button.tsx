'use client'

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"
import { TodoEditDialog } from "./todo-edit-dialog"
import useMarkStore from "@/stores/mark"
import { useSidebarStore } from "@/stores/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"
import useArticleStore from "@/stores/article"
import { createRecordTab } from "./mark-record-tab"

type TodoEditTriggerProps = {
  mark: Mark
  className?: string
  children: React.ReactNode
}

export function TodoEditTrigger({ mark, className, children }: TodoEditTriggerProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const t = useTranslations('record.mark.type')
  const { isMultiSelectMode, activeMarkId, setActiveMarkId } = useMarkStore()
  const openTabs = useArticleStore((state) => state.openTabs)
  const addTab = useArticleStore((state) => state.addTab)
  const setActiveTabId = useArticleStore((state) => state.setActiveTabId)
  const setActiveFilePath = useArticleStore((state) => state.setActiveFilePath)
  const { centerPanelVisible, showCenterPanel } = useSidebarStore()

  const handleOpen = useCallback(async () => {
    if (isMobile) {
      setOpen(true)
      return
    }

    if (isMultiSelectMode) {
      return
    }

    setActiveMarkId(mark.id)
    const recordTab = createRecordTab(mark, t(mark.type))
    const existingTab = openTabs.find(tab => tab.path === recordTab.path)
    if (existingTab) {
      await setActiveTabId(existingTab.id)
    } else {
      await addTab(recordTab)
    }
    await setActiveFilePath('')
    if (!centerPanelVisible) {
      await showCenterPanel()
    }
  }, [addTab, centerPanelVisible, isMobile, isMultiSelectMode, mark, openTabs, setActiveFilePath, setActiveMarkId, setActiveTabId, showCenterPanel, t])

  return (
    <>
      <button
        type="button"
        aria-pressed={activeMarkId === mark.id}
        onClick={handleOpen}
        className={cn("min-w-0 text-left transition-colors hover:underline", activeMarkId === mark.id && "text-primary", className)}
      >
        {children}
      </button>
      {isMobile ? <TodoEditDialog mark={mark} open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
