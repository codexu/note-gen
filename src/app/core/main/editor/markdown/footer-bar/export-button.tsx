'use client'

import { Editor } from '@tiptap/react'
import { Download, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'
import {
  exportMarkdownSource,
  type MarkdownExportFormat,
} from '../markdown-export'

interface ExportButtonProps {
  editor: Editor
  markdown?: string
  getMarkdown?: () => string
  recordExportName?: string
  submenuLabel?: string
}

export function ExportButton({ editor, markdown, getMarkdown, recordExportName, submenuLabel }: ExportButtonProps) {
  const t = useTranslations('record.mark.detail')
  const label = recordExportName !== undefined ? t('exportBody') : '导出'
  const [isOpen, setIsOpen] = useState(false)
  const [exporting, setExporting] = useState<MarkdownExportFormat | null>(null)

  const showPdfExportStart = useCallback(() => {
    toast({
      title: '正在准备 PDF',
      description: '请在系统打印窗口中选择“另存为 PDF”。',
    })
  }, [])

  const runExport = useCallback(async (format: MarkdownExportFormat) => {
    try {
      setExporting(format)

      const isRecord = recordExportName !== undefined
      const activeFilePath = isRecord ? undefined : useArticleStore.getState().activeFilePath
      const readMarkdown = () => getMarkdown?.() ?? markdown ?? editor.getMarkdown()
      const exported = await exportMarkdownSource(
        format,
        {
          baseName: recordExportName ?? activeFilePath ?? 'document',
          markdown: isRecord ? readMarkdown() : readMarkdown,
          json: isRecord || getMarkdown || markdown !== undefined ? undefined : () => editor.getJSON(),
          sourcePath: activeFilePath,
          kind: isRecord ? 'record' : undefined,
        },
        { onPdfRenderStart: showPdfExportStart },
      )

      if (exported) {
        toast({ title: format === 'pdf' ? '已打开 PDF 打印窗口' : '导出成功' })
      }
    } catch (error) {
      console.error(`${format} export failed:`, error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
      setIsOpen(false)
    }
  }, [editor, getMarkdown, markdown, recordExportName, showPdfExportStart])

  const handleExport = (event: Event, format: MarkdownExportFormat) => {
    if (submenuLabel === undefined) event.preventDefault()
    void runExport(format)
  }

  const formats = (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={exporting !== null} onSelect={(event) => handleExport(event, 'markdown')}>
        <FileText size={12} />
        <span>Markdown</span>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={exporting !== null} onSelect={(event) => handleExport(event, 'html')}>
        <FileCode size={12} />
        <span>HTML</span>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={exporting !== null} onSelect={(event) => handleExport(event, 'json')}>
        <FileJson size={12} />
        <span>JSON</span>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={exporting !== null} onSelect={(event) => handleExport(event, 'pdf')}>
        <FileText size={12} />
        <span>PDF</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )

  if (submenuLabel !== undefined) {
    return (
      <DropdownMenuSub open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuSubTrigger>
          <Download />
          {submenuLabel}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>{formats}</DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    )
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-0"
          disabled={exporting !== null}
        >
          <Download className="size-3" />
          <span>{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        {formats}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
