'use client'

import { Editor } from '@tiptap/react'
import { Copy, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { serializeMathMarkdown } from '../math-serialize'

interface CopyButtonProps {
  editor: Editor
}

type CopyFormat = 'markdown' | 'html' | 'json' | 'text'

export function CopyButton({ editor }: CopyButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copying, setCopying] = useState<CopyFormat | null>(null)

  const copyToClipboard = useCallback(async (content: string, format: CopyFormat) => {
    try {
      setCopying(format)
      await navigator.clipboard.writeText(content)
      toast({
        title: '复制成功',
        description: `已复制为 ${format.toUpperCase()} 格式`
      })
    } catch {
      toast({
        title: '复制失败',
        description: '无法复制到剪贴板',
        variant: 'destructive'
      })
    } finally {
      setCopying(null)
      setIsOpen(false)
    }
  }, [])

  const handleCopyMarkdown = useCallback(() => {
    copyToClipboard(serializeMathMarkdown(editor.getHTML()), 'markdown')
  }, [editor, copyToClipboard])

  const handleCopyHtml = useCallback(() => {
    copyToClipboard(editor.getHTML(), 'html')
  }, [editor, copyToClipboard])

  const handleCopyJson = useCallback(() => {
    copyToClipboard(JSON.stringify(editor.getJSON(), null, 2), 'json')
  }, [editor, copyToClipboard])

  const handleCopyText = useCallback(() => {
    copyToClipboard(editor.getText(), 'text')
  }, [editor, copyToClipboard])

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-0.5 px-1.5 rounded transition-colors',
          'hover:bg-[hsl(var(--muted))]',
          isOpen && 'bg-[hsl(var(--muted))]'
        )}
        title="复制"
      >
        <Copy size={10} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 min-w-[120px] bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={handleCopyMarkdown}
            disabled={copying !== null}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileText size={12} />
            <span>Markdown</span>
          </button>
          <button
            onClick={handleCopyHtml}
            disabled={copying !== null}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileCode size={12} />
            <span>HTML</span>
          </button>
          <button
            onClick={handleCopyJson}
            disabled={copying !== null}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileJson size={12} />
            <span>JSON</span>
          </button>
          <button
            onClick={handleCopyText}
            disabled={copying !== null}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <FileText size={12} />
            <span>纯文本</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default CopyButton
