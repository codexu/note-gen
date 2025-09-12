"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AtSign, X } from "lucide-react"
import { FileSelector } from "./file-selector"
import { MarkdownFile } from "@/lib/files"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'

interface FileLinkProps {
  linkedFile: MarkdownFile | null
  onFileSelect: (file: MarkdownFile) => void
  onFileRemove: () => void
  disabled?: boolean
}

export function FileLink({ onFileSelect, disabled = false }: FileLinkProps) {
  const [showFileSelector, setShowFileSelector] = useState(false)
  const t = useTranslations('record.chat.input.fileLink')

  const handleFileSelect = (file: MarkdownFile) => {
    onFileSelect(file)
    setShowFileSelector(false)
  }

  return (
    <div className="flex flex-col">
      {/* @ 按钮 */}
      <TooltipButton
        icon={<AtSign className="size-4" />}
        tooltipText={t('tooltip')}
        size="icon"
        onClick={() => setShowFileSelector(true)}
        disabled={disabled}
      />

      {/* 文件选择器 */}
      <FileSelector
        isOpen={showFileSelector}
        onFileSelect={handleFileSelect}
        onClose={() => setShowFileSelector(false)}
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
