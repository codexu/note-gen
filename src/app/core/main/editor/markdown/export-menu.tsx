'use client'

import { Editor } from '@tiptap/react'
import {
  FileText,
  FileCode,
  FileJson,
  Download,
  FileType,
} from 'lucide-react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { useCallback, useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'

interface ExportMenuProps {
  editor: Editor
}

export function ExportMenu({ editor }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Get content as different formats
  const getMarkdown = useCallback(() => {
    return editor.getMarkdown()
  }, [editor])

  const getHtml = useCallback(() => {
    return editor.getHTML()
  }, [editor])

  const getJson = useCallback(() => {
    return JSON.stringify(editor.getJSON(), null, 2)
  }, [editor])

  const getText = useCallback(() => {
    return editor.getText()
  }, [editor])

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

  // Export handlers
  const exportMarkdown = useCallback(() => {
    const content = getMarkdown()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.md`, 'text/markdown')
    setIsOpen(false)
  }, [getMarkdown, downloadFile])

  const exportHtml = useCallback(() => {
    const content = getHtml()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
    }
    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    code {
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
    blockquote {
      border-left: 4px solid #dfe2e5;
      margin: 0;
      padding-left: 16px;
      color: #6a737d;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    table th, table td {
      border: 1px solid #dfe2e5;
      padding: 8px 12px;
    }
    table th {
      background: #f6f8fa;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`
    downloadFile(htmlContent, `${fileName}.html`, 'text/html')
    setIsOpen(false)
  }, [getHtml, downloadFile])

  const exportJson = useCallback(() => {
    const content = getJson()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.json`, 'application/json')
    setIsOpen(false)
  }, [getJson, downloadFile])

  const exportText = useCallback(() => {
    const content = getText()
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'
    downloadFile(content, `${fileName}.txt`, 'text/plain')
    setIsOpen(false)
  }, [getText, downloadFile])

  const exportPdf = useCallback(async () => {
    const activeFilePath = useArticleStore.getState().activeFilePath
    const fileName = activeFilePath?.replace(/\.md$/, '') || 'document'

    // Get editor content element
    const editorElement = document.querySelector('.tiptap') || document.querySelector('.ProseMirror')
    if (!editorElement) {
      console.error('Editor element not found')
      setIsOpen(false)
      return
    }

    try {
      // Create a temporary container for PDF rendering
      const container = document.createElement('div')
      container.innerHTML = editorElement.innerHTML
      container.style.width = '595px' // A4 width in points
      container.style.padding = '40px'
      container.style.background = 'white'
      container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      container.style.fontSize = '12px'
      container.style.lineHeight = '1.6'
      container.style.color = '#333'

      // Add basic styles for PDF
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

      const imgWidth = 595 // A4 width in points
      const pageHeight = 842 // A4 height in points
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = 0

      // Add first page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      // Add additional pages if needed
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
  }, [downloadFile])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={menuRef} className="export-menu relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-center w-5 h-4 rounded transition-colors',
          'hover:bg-[hsl(var(--accent))]',
          isOpen && 'bg-[hsl(var(--accent))]'
        )}
        title="导出"
      >
        <Download size={10} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[160px] bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={exportMarkdown}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileText size={14} />
            <span>Markdown (.md)</span>
          </button>
          <button
            onClick={exportHtml}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileCode size={14} />
            <span>HTML (.html)</span>
          </button>
          <button
            onClick={exportJson}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileJson size={14} />
            <span>JSON (.json)</span>
          </button>
          <button
            onClick={exportText}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileText size={14} />
            <span>纯文本 (.txt)</span>
          </button>
          <button
            onClick={exportPdf}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileType size={14} />
            <span>PDF (.pdf)</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ExportMenu