'use client'

import { Editor } from '@tiptap/react'
import { Download, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'
import { useTranslations } from 'next-intl'
import {
  exportMarkdownSource,
  getMarkdownExportBaseName,
  type MarkdownExportFormat,
} from '../markdown-export'

interface ExportButtonProps {
  editor: Editor
  markdown?: string
  getMarkdown?: () => string
}

export function ExportButton({ editor, markdown, getMarkdown }: ExportButtonProps) {
  const t = useTranslations('editor.statusBar.documentActions')
  const [isOpen, setIsOpen] = useState(false)
  const [exporting, setExporting] = useState<MarkdownExportFormat | null>(null)

  const showPdfExportStart = useCallback(() => {
    toast({
      title: t('preparingPdf'),
      description: t('saveAsPdf'),
    })
  }, [t])

  const runExport = useCallback(async (format: MarkdownExportFormat) => {
    try {
      setExporting(format)

      const activeFilePath = useArticleStore.getState().activeFilePath
      const exported = await exportMarkdownSource(
        format,
        {
          baseName: getMarkdownExportBaseName(activeFilePath),
          markdown: () => getMarkdown?.() ?? markdown ?? editor.getMarkdown(),
          json: getMarkdown || markdown !== undefined ? undefined : () => editor.getJSON(),
          sourcePath: activeFilePath,
        },
        { onPdfRenderStart: showPdfExportStart },
      )

      if (exported) {
        toast({ title: t(format === 'pdf' ? 'printDialogOpened' : 'exported') })
      }
    } catch (error) {
      console.error(`${format} export failed:`, error)
      toast({
        title: t('exportFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
      setIsOpen(false)
    }
  }, [editor, getMarkdown, markdown, showPdfExportStart, t])

  const handleExport = useCallback((format: MarkdownExportFormat) => {
    void runExport(format)
  }, [runExport])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('export')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={exporting !== null}
        >
          <Download className="size-3" />
          <span>{t('export')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('markdown')
          }}
        >
          <FileText size={12} />
          <span>Markdown</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('html')
          }}
        >
          <FileCode size={12} />
          <span>HTML</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('json')
          }}
        >
          <FileJson size={12} />
          <span>JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exporting !== null}
          onSelect={(event) => {
            event.preventDefault()
            handleExport('pdf')
          }}
        >
          <FileText size={12} />
          <span>PDF</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
