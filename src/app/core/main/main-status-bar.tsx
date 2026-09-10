'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChatFooter } from './chat/chat-footer'
import { FileFooter } from './file/file-footer'
import { PluginStatusBarItems } from '@/components/plugins/plugin-status-bar-items'

const EDITOR_STATUS_SLOT_ID = 'main-editor-status-slot'

export function MainStatusBar() {
  return (
    <footer className="scrollbar-hide flex h-6 min-h-6 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-border bg-background px-1 text-xs text-muted-foreground">
      <div className="h-full min-w-0 shrink-0">
        <FileFooter />
      </div>
      <PluginStatusBarItems alignment="left" />
      <div
        id={EDITOR_STATUS_SLOT_ID}
        className="flex h-full min-w-0 flex-1 items-center"
      />
      <PluginStatusBarItems alignment="right" />
      <div className="h-full min-w-0 shrink-0">
        <ChatFooter embedded />
      </div>
    </footer>
  )
}

export function MainStatusBarPortal({
  active = true,
  inline = false,
  children,
}: {
  active?: boolean
  inline?: boolean
  children: ReactNode
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setTarget(document.getElementById(EDITOR_STATUS_SLOT_ID))
  }, [])

  if (inline) return children
  if (!active || !target) return null
  return createPortal(children, target)
}
