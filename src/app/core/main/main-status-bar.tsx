'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChatFooter } from './chat/chat-footer'
import { FileFooter } from './file/file-footer'
import { PluginStatusBarCenter } from '@/components/plugins/plugin-status-bar-center'
import { UnifiedSyncStatus } from './unified-sync-status'
import { StatusBarItem, StatusBarSpacer, useStatusBarOrder } from './status-bar-order'

const EDITOR_STATUS_SLOT_ID = 'main-editor-status-slot'

export function MainStatusBar() {
  const loadOrder = useStatusBarOrder(state => state.load)
  useEffect(() => { void loadOrder() }, [loadOrder])
  return (
    <footer className="scrollbar-hide flex h-6 min-h-6 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-border bg-background px-1 text-xs text-muted-foreground">
      <StatusBarItem id="system:sync" rank={0}><UnifiedSyncStatus /></StatusBarItem>
      <StatusBarItem id="system:workspace" rank={10}>
        <FileFooter />
      </StatusBarItem>
      <div
        id={EDITOR_STATUS_SLOT_ID}
        className="contents"
      />
      <StatusBarSpacer id="spacer:before-plugins" rank={45} />
      <PluginStatusBarCenter />
      <StatusBarSpacer id="spacer:after-plugins" rank={56} />
      <ChatFooter embedded />
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
