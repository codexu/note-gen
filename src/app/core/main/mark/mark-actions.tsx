"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Trash2, XCircle, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import { OrganizeNotes } from "./organize-notes"
import { useEffect } from "react"
import { MarkFilterPopover } from "./mark-filter-popover"
import emitter from "@/lib/emitter"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState, initRecordFilters } = useMarkStore()

  useEffect(() => {
    initRecordFilters()
  }, [initRecordFilters])

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  const handleOrganize = () => {
    emitter.emit('open-organize-notes', undefined)
  }

  return (
    <div className="flex items-center gap-1">
      {!trashState && (
        <TooltipButton 
          buttonId="onboarding-target-organize-notes"
          icon={<Sparkles className="h-4 w-4" />} 
          tooltipText={t('toolbar.organizeCurrentTag')} 
          onClick={handleOrganize}
          variant="ghost"
          side="bottom"
        />
      )}
      <MarkFilterPopover />
      <TooltipButton 
        icon={trashState ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} 
        tooltipText={trashState ? t('toolbar.closeTrash') : t('toolbar.trash')} 
        onClick={handleToggleTrash}
        variant={trashState ? "default" : "ghost"}
        side="bottom"
      />
      <OrganizeNotes />
    </div>
  )
}
