'use client'

import { Editor } from '@tiptap/react'
import { WordCount } from './word-count'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncTools } from '../sync/sync-tools'
import { OutlineToggle } from './outline-toggle'

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
