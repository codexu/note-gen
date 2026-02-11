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
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import useArticleStore from '@/stores/article'

interface ExportButtonProps {
  editor: Editor
}

export function ExportButton({ editor }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

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
      setIsOpen(false)
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

    setIsOpen(false)
  }, [])

  const handleExportMarkdown = useCallback(() => {
    const content = editor.getMarkdown()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.md`, 'text/markdown')
    setIsOpen(false)
  }, [editor, downloadFile])

  const handleExportHtml = useCallback(() => {
    const content = editor.getHTML()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.html`, 'text/html')
    setIsOpen(false)
  }, [editor, downloadFile])

  const handleExportJson = useCallback(() => {
    const content = JSON.stringify(editor.getJSON(), null, 2)
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.json`, 'application/json')
    setIsOpen(false)
  }, [editor, downloadFile])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="导出"
          className="p-1 rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-0"
        >
          <Download className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuItem onClick={handleExportMarkdown}>
          <FileText size={12} />
          <span>Markdown</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportHtml}>
          <FileCode size={12} />
          <span>HTML</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportJson}>
          <FileJson size={12} />
          <span>JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf}>
          <FileText size={12} />
          <span>PDF</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
