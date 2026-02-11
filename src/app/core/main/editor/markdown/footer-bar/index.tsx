'use client'

import { Editor } from '@tiptap/react'
import { WordCount } from './word-count'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncTools } from '../sync/sync-tools'

interface FooterBarProps {
  editor: Editor
}

export function FooterBar({
  editor,
}: FooterBarProps) {
  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border bg-background text-xs text-muted-foreground">
      {/* Left side: Word count, Copy, Export */}
      <div className="flex items-center gap-1">
        <WordCount editor={editor} />
        <CopyButton editor={editor} />
        <ExportButton editor={editor} />
      </div>

      {/* Right side: Sync tools */}
      <SyncTools editor={editor} />
    </div>
  )
}

export default FooterBar
