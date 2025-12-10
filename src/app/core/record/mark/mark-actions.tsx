"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { Trash2, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"

export function MarkActions() {
  const t = useTranslations('record.mark')
  const { trashState, setTrashState } = useMarkStore()

  const handleToggleTrash = () => {
    setTrashState(!trashState)
  }

  return (
    <div className="flex items-center gap-1">
      <TooltipButton 
        icon={trashState ? <XCircle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} 
        tooltipText={trashState ? t('toolbar.closeTrash') : t('toolbar.trash')} 
        onClick={handleToggleTrash}
        variant={trashState ? "default" : "ghost"}
        side="bottom"
      />
    </div>
  )
}
