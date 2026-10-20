"use client"

import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { cn } from '@/lib/utils'
import { StatusBarItem } from '../status-bar-order'

export function ChatFooter({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={cn(
      'flex h-6 min-w-0 items-center gap-2 overflow-hidden bg-background text-xs text-muted-foreground',
      embedded ? 'contents' : 'w-full justify-between border-t border-border px-1',
    )}>
      {embedded ? <>
        <StatusBarItem id="system:model" rank={90}><ModelSelect display="status" /></StatusBarItem>
        <StatusBarItem id="system:prompt" rank={91}><PromptSelect display="status" /></StatusBarItem>
      </> : <>
        <ModelSelect display="status" />
        <PromptSelect display="status" />
      </>}
    </div>
  )
}
