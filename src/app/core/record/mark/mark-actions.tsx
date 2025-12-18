"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Trash2, XCircle, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import { OrganizeNotes } from "./organize-notes"
import { useRef } from "react"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState } = useMarkStore()
  const organizeRef = useRef<{ openOrganize: () => void }>(null)

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  const handleOrganize = () => {
    organizeRef.current?.openOrganize()
  }

  return (
    <div className="flex items-center gap-1">
      {!trashState && (
        <TooltipButton 
          icon={<Sparkles className="h-4 w-4" />} 
          tooltipText={t('toolbar.organizeNotes')} 
          onClick={handleOrganize}
          variant="ghost"
          side="bottom"
        />
      )}
      <TooltipButton 
        icon={trashState ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} 
        tooltipText={trashState ? t('toolbar.closeTrash') : t('toolbar.trash')} 
        onClick={handleToggleTrash}
        variant={trashState ? "default" : "ghost"}
        side="bottom"
      />
      <OrganizeNotes ref={organizeRef} />
    </div>
  )
}
