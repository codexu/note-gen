'use client'

import { Editor } from '@tiptap/react'
import { WordCount } from './word-count'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncButton } from './sync-button'
import { PullButton } from './pull-button'
import { PrimarySyncBadge } from './primary-sync-badge'

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

      {/* Right side: Knowledge base, Sync tools */}
      <div className="flex items-center gap-1">
        <PrimarySyncBadge />
        <SyncButton />
        <PullButton editor={editor} />
      </div>
    </div>
  )
}

export default FooterBar
