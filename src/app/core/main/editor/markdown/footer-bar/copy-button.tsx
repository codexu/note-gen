'use client'

import { Editor } from '@tiptap/react'
import { Copy, FileCode, FileJson, FileText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
    copyToClipboard(editor.getMarkdown(), 'markdown')
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
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="复制"
          className="p-1 rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-0"
        >
          <Copy className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        <DropdownMenuItem onClick={handleCopyMarkdown} disabled={copying !== null}>
          <FileText size={12} />
          <span>Markdown</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyHtml} disabled={copying !== null}>
          <FileCode size={12} />
          <span>HTML</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyJson} disabled={copying !== null}>
          <FileJson size={12} />
          <span>JSON</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyText} disabled={copying !== null}>
          <FileText size={12} />
          <span>纯文本</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default CopyButton
