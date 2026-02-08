'use client'

import { Editor } from '@tiptap/react'
import { Download } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { TextNumber } from './text-number'
import { VectorCalc } from './vector-calc'
import { CopyButton } from './copy-button'
import { SyncButton } from './sync-button'
import { PullButton } from './pull-button'
import { PrimarySyncBadge } from './primary-sync-badge'
import { HistorySheet } from './history-sheet'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import useArticleStore from '@/stores/article'

interface FooterBarProps {
  editor: Editor
  aiCompletionEnabled: boolean
  onToggleAICompletion: (enabled: boolean) => void
}

export function FooterBar({
  editor,
  aiCompletionEnabled,
  onToggleAICompletion
}: FooterBarProps) {
  const [isExportOpen, setIsExportOpen] = useState(false)

  // Download file helper
  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  // Export as PDF
  const exportPdf = useCallback(async () => {
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'

    const editorElement = document.querySelector('.tiptap') || document.querySelector('.ProseMirror')
    if (!editorElement) {
      console.error('Editor element not found')
      setIsExportOpen(false)
      return
    }

    try {
      const container = document.createElement('div')
      container.innerHTML = editorElement.innerHTML
      container.style.width = '595px'
      container.style.padding = '40px'
      container.style.background = 'white'
      container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      container.style.fontSize = '12px'
      container.style.lineHeight = '1.6'
      container.style.color = '#333'

      const styles = container.querySelectorAll('style, link[rel="stylesheet"]')
      styles.forEach(s => s.remove())

      document.body.appendChild(container)

      const canvas = await html2canvas(container as HTMLElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      })

      document.body.removeChild(container)

      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
      })

      const imgWidth = 595
      const pageHeight = 842
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = 0

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      pdf.save(`${fileName}.pdf`)
    } catch (error) {
      console.error('PDF export failed:', error)
    }

    setIsExportOpen(false)
  }, [])

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border bg-background text-xs text-muted-foreground">
      {/* Left side: Character/Word count */}
      <div className="flex items-center gap-2">
        <TextNumber editor={editor} />
      </div>

      {/* Center: Sync status, Pull, Vector DB, AI Toggle */}
      <div className="flex items-center gap-1">
        <PrimarySyncBadge />
        <SyncButton />
        <PullButton editor={editor} />
        <HistorySheet />
        <div className="w-px h-3 bg-border mx-1" />
        <VectorCalc
          aiCompletionEnabled={aiCompletionEnabled}
          onToggleAICompletion={onToggleAICompletion}
        />
      </div>

      {/* Right side: Copy, Export */}
      <div className="flex items-center gap-1">
        <CopyButton editor={editor} />

        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsExportOpen(!isExportOpen)}
            className={cn(
              'flex items-center justify-center w-5 h-4 rounded transition-colors',
              'hover:bg-accent',
              isExportOpen && 'bg-accent'
            )}
            title="导出"
          >
            <Download size={10} />
          </button>

          {isExportOpen && (
            <div className="absolute bottom-full right-0 mb-1 min-w-[120px] bg-background border border-border rounded-lg shadow-lg overflow-hidden z-50">
              <button
                onClick={() => {
                  const content = editor.getMarkdown()
                  const activeFilePath = useArticleStore.getState().activeFilePath
                  const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
                  downloadFile(content, `${fileName}.md`, 'text/markdown')
                  setIsExportOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                <span>Markdown</span>
              </button>
              <button
                onClick={() => {
                  const content = editor.getHTML()
                  const activeFilePath = useArticleStore.getState().activeFilePath
                  const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
                  downloadFile(content, `${fileName}.html`, 'text/html')
                  setIsExportOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                <span>HTML</span>
              </button>
              <button
                onClick={() => {
                  const content = JSON.stringify(editor.getJSON(), null, 2)
                  const activeFilePath = useArticleStore.getState().activeFilePath
                  const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
                  downloadFile(content, `${fileName}.json`, 'application/json')
                  setIsExportOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                <span>JSON</span>
              </button>
              <button
                onClick={exportPdf}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                <span>PDF</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FooterBar
