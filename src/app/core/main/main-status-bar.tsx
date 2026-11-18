'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChatFooter } from './chat/chat-footer'
import { FileFooter } from './file/file-footer'
import { PluginStatusBarCenter } from '@/components/plugins/plugin-status-bar-center'
import { UnifiedSyncStatus } from './unified-sync-status'
import { StatusBarItem, StatusBarSpacer, useStatusBarOrder } from './status-bar-order'
import { TodayStatusItem } from './today/today-status-item'
import { DailyNavStatusItem } from './daily/daily-calendar'

const EDITOR_STATUS_SLOT_ID = 'main-editor-status-slot'

export function MainStatusBar() {
  const loadOrder = useStatusBarOrder(state => state.load)
  useEffect(() => { void loadOrder() }, [loadOrder])
  return (
    <footer className="scrollbar-hide flex h-7 min-h-7 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-line-soft bg-statusbar px-2 text-xs text-muted-foreground v3:text-[10.5px]">
      <StatusBarItem id="system:sync" rank={0}><UnifiedSyncStatus /></StatusBarItem>
      <StatusBarItem id="system:workspace" rank={10}>
        <FileFooter />
      </StatusBarItem>
      <StatusBarSpacer id="spacer:before-plugins" rank={15} />
      <div
        id={EDITOR_STATUS_SLOT_ID}
        className="contents"
      />
      <PluginStatusBarCenter />
      <StatusBarSpacer id="spacer:after-plugins" rank={85} />
      <StatusBarItem id="fork:daily-nav" rank={86}><DailyNavStatusItem /></StatusBarItem>
      <StatusBarItem id="fork:today" rank={87}><TodayStatusItem /></StatusBarItem>
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
