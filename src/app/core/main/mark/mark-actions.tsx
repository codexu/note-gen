"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Sparkles, TagPlus } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import { OrganizeNotes } from "./organize-notes"
import { useEffect, useRef } from "react"
import { MarkFilterPopover } from "./mark-filter-popover"
import { MarkMoreMenu } from "./mark-more-menu"
import emitter from "@/lib/emitter"
import { EmitterRecordEvents } from "@/config/emitters"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState, initRecordFilters } = useMarkStore()
  const organizeRef = useRef<{ openOrganize: () => void }>(null)

  useEffect(() => {
    initRecordFilters()
  }, [initRecordFilters])

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  const handleNewTag = () => {
    emitter.emit(EmitterRecordEvents.openNewTag)
  }

  const handleOrganize = () => {
    organizeRef.current?.openOrganize()
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {!trashState && (
        <TooltipButton
          icon={<TagPlus className="h-4 w-4" />}
          tooltipText={t('tag.newTag')}
          onClick={handleNewTag}
          variant="ghost"
          side="bottom"
        />
      )}
      <MarkFilterPopover />
      {!trashState && (
        <TooltipButton
          buttonId="onboarding-target-organize-notes"
          icon={<Sparkles className="h-4 w-4" />}
          tooltipText={t('toolbar.organizeNotes')}
          onClick={handleOrganize}
          variant="ghost"
          side="bottom"
        />
      )}
      <MarkMoreMenu trashState={trashState} onToggleTrash={handleToggleTrash} />
      <OrganizeNotes ref={organizeRef} />
    </div>
  )
}
