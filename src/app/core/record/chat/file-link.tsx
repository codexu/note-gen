"use client"

import { Button } from "@/components/ui/button"
import { AtSign, X, FolderOpen } from "lucide-react"
import { LinkedResource, isLinkedFolder } from "@/lib/files"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'

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
}

export function LinkedFileDisplay({ linkedResource, onFileRemove }: LinkedResourceDisplayProps) {
  if (!linkedResource) return null

  const isFolder = isLinkedFolder(linkedResource)

  return (
    <div className="flex items-center justify-between bg-third rounded-xl rounded-b-none px-2 text-sm border-t border-l border-r w-full pb-2 translate-y-2">
      <div className="flex items-center gap-2 opacity-50">
        {isFolder ? (
          <FolderOpen className="size-3" />
        ) : (
          <AtSign className="size-3" />
        )}
        <span className="font-medium text-xs">{linkedResource.name}</span>
        {isFolder && (
          <span className="text-xs opacity-70">
            ({(linkedResource as any).indexedCount}/{(linkedResource as any).fileCount})
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFileRemove}
        className="size-6 p-0 opacity-50"
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
