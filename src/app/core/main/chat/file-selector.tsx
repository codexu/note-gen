"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText } from "lucide-react"
import { getAllMarkdownFiles, MarkdownFile } from "@/lib/files"
import { cn } from "@/lib/utils"
import { useTranslations } from 'next-intl'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog'

interface FileSelectorProps {
  onFileSelect: (file: MarkdownFile) => void
  onClose: () => void
  isOpen: boolean
}

export function FileSelector({ onFileSelect, onClose, isOpen }: FileSelectorProps) {
  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [filteredFiles, setFilteredFiles] = useState<MarkdownFile[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useTranslations('record.chat.input.fileLink')

  // 加载所有Markdown文件
  useEffect(() => {
    if (isOpen) {
      loadFiles()
      // 自动聚焦搜索框
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  // 过滤文件
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredFiles(files)
    } else {
      const query = searchQuery.toLowerCase()
      const filtered = files.filter(file => 
        file.name.toLowerCase().includes(query) ||
        file.relativePath.toLowerCase().includes(query)
      )
      setFilteredFiles(filtered)
    }
    setSelectedIndex(0)
  }, [searchQuery, files])

  const loadFiles = async () => {
    setLoading(true)
    try {
      const allFiles = await getAllMarkdownFiles()
      setFiles(allFiles)
      setFilteredFiles(allFiles)
    } catch (error) {
      console.error('加载文件失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, filteredFiles.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredFiles[selectedIndex]) {
        handleFileSelect(filteredFiles[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleFileSelect = (file: MarkdownFile) => {
    onFileSelect(file)
    onClose()
    setSearchQuery("")
  }

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <ResponsiveDialogContent className="flex max-h-[80vh] max-w-md flex-col overflow-hidden p-0">
        <ResponsiveDialogHeader className="gap-2 p-4">
          <ResponsiveDialogTitle className="sr-only">{t('searchPlaceholder')}</ResponsiveDialogTitle>
          <Input
            ref={inputRef}
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
            onKeyDown={handleKeyDown}
          />
        </ResponsiveDialogHeader>

        {/* 文件列表 */}
        <ScrollArea className="flex-1 max-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">{t('loading')}</div>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">{t('noFiles')}</div>
            </div>
          ) : (
            <div className="p-2">
              {filteredFiles.map((file, index) => (
                <button
                  type="button"
                  key={file.path}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md p-2 text-left transition-colors",
                    index === selectedIndex 
                      ? "bg-accent text-accent-foreground" 
                      : "hover:bg-accent/50"
                  )}
                  onClick={() => handleFileSelect(file)}
                >
                  <FileText className="size-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {file.relativePath}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
