'use client'

import { Editor } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { WordCount } from './word-count'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncTools } from '../sync/sync-tools'
import { OutlineToggle } from './outline-toggle'
import { SyncButton } from '../sync/sync-button'
import { PullButton } from '../sync/pull-button'
import { HistorySheet } from '../sync/history-sheet'
import useArticleStore from '@/stores/article'
import { isMobileDevice } from '@/lib/check'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({
  editor,
  outlineOpen,
  onToggleOutline,
}: FooterBarProps) {
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const isMobile = isMobileDevice()
  const fileName = activeFilePath
    ? activeFilePath.split('/').pop() || activeFilePath
    : '未命名'

  if (isMobile) {
    return (
      <div className="h-7 flex items-center justify-between gap-3 px-3 border-t border-border bg-background text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <FileText className="size-3.5 shrink-0" />
          <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
            <span className="block min-w-0 truncate font-medium text-foreground/90">{fileName}</span>
            <div className="shrink-0">
              <WordCount editor={editor} />
            </div>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <HistorySheet editor={editor} />
          <SyncButton />
          <PullButton editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border bg-background text-xs text-muted-foreground">
      {/* Left side: Word count, Copy, Export, Outline */}
      <div className="flex items-center gap-1">
        <WordCount editor={editor} />
        <CopyButton editor={editor} />
        <ExportButton editor={editor} />
        <OutlineToggle
          editor={editor}
          outlineOpen={outlineOpen}
          onToggleOutline={onToggleOutline}
        />
      </div>

      {/* Right side: Sync tools */}
      <SyncTools editor={editor} />
    </div>
  )
}

export default FooterBar
