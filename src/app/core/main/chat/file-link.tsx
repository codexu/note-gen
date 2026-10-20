"use client"

import { Button } from "@/components/ui/button"
import { AtSign, X, FolderOpen } from "lucide-react"
import { LinkedResource, isLinkedFolder } from "@/lib/files"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'
import { cn } from "@/lib/utils"

interface FileLinkProps {
  onFileLinkClick: () => void
  disabled?: boolean
}

export function FileLink({ onFileLinkClick, disabled = false }: FileLinkProps) {
  const t = useTranslations('record.chat.input.fileLink')

  return (
    <div>
      <TooltipButton
        icon={<AtSign className="size-4" />}
        tooltipText={t('tooltip')}
        size="icon"
        side="bottom"
        onClick={onFileLinkClick}
        disabled={disabled}
      />
    </div>
  )
}

// 独立的关联资源显示组件
interface LinkedResourceDisplayProps {
  linkedResource: LinkedResource | null
  onFileRemove: () => void
  mobileDockStyle?: boolean
}

export function LinkedFileDisplay({ linkedResource, onFileRemove, mobileDockStyle = false }: LinkedResourceDisplayProps) {
  if (!linkedResource) return null

  const isFolder = isLinkedFolder(linkedResource)

  return (
    <div
      className={cn(
        "flex items-center justify-between",
        mobileDockStyle
          ? "mobile-dock-surface mb-1 min-h-7 w-[calc(100%-1rem)] rounded-xl px-2 py-0.5 text-[11px] leading-none text-[hsl(var(--component-inactive-color))]"
          : "w-full translate-y-2 rounded-xl rounded-b-none border-l border-r border-t bg-third px-2 pb-2 text-sm"
      )}
    >
      <div className={cn(
        "flex min-w-0 items-center",
        mobileDockStyle ? "gap-1.5" : "gap-2",
        mobileDockStyle ? "opacity-80" : "opacity-50"
      )}>
        {isFolder ? (
          <FolderOpen className={cn("shrink-0", mobileDockStyle ? "size-2.5" : "size-3")} />
        ) : (
          <AtSign className={cn("shrink-0", mobileDockStyle ? "size-2.5" : "size-3")} />
        )}
        <span className={cn("truncate font-medium", mobileDockStyle ? "text-[11px]" : "text-xs")}>{linkedResource.name}</span>
        {isFolder && (
          <span className={cn("shrink-0 opacity-70", mobileDockStyle ? "text-[10px]" : "text-xs")}>
            ({linkedResource.indexedCount}/{linkedResource.fileCount})
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFileRemove}
        className={cn(
          "p-0",
          mobileDockStyle ? "size-5 shrink-0 rounded-full opacity-70 hover:bg-[hsl(var(--component-active-bg))] hover:text-foreground" : "size-6 opacity-50"
        )}
      >
        <X className={cn(mobileDockStyle ? "size-2.5" : "size-3")} />
      </Button>
    </div>
  )
}
