"use client"

import { Button } from "@/components/ui/button"
import { AtSign, X } from "lucide-react"
import { MarkdownFile } from "@/lib/files"
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

// 独立的关联文件显示组件
interface LinkedFileDisplayProps {
  linkedFile: MarkdownFile | null
  onFileRemove: () => void
}

export function LinkedFileDisplay({ linkedFile, onFileRemove }: LinkedFileDisplayProps) {
  if (!linkedFile) return null

  return (
    <div className="flex items-center justify-between bg-accent/50 rounded-md px-2 py-1 text-sm">
      <div className="flex items-center gap-2">
        <AtSign className="size-3" />
        <span className="font-medium">{linkedFile.name}</span>
        <span className="text-xs text-muted-foreground">({linkedFile.relativePath})</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFileRemove}
        className="size-6 p-0"
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
