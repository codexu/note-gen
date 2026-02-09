'use client'

import { Editor } from '@tiptap/react'
import { Copy, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import { serializeMathMarkdown } from '../math-serialize'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button title="复制">
          <Copy className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={4}
        className="min-w-30 p-0"
      >
        <div className="flex flex-col py-1 bg-background border-border rounded-lg shadow-lg">
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
      </PopoverContent>
    </Popover>
  )
}

export default CopyButton
