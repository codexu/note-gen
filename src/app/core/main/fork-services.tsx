'use client'

// Fork: background services for the main window, mounted once from page.tsx
// so upstream files only carry a single mount point.
import { useEffect } from 'react'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { startVaultIndex } from '@/lib/vault-index/service'
import { DailyNoteAutoOpen } from './daily-note-auto-open'
import { DailyNavShortcuts } from './daily/daily-nav-shortcuts'
import { ReminderService } from './daily/reminder-service'
import { LinkRewritePrompt } from './link-rewrite/link-rewrite-prompt'
import { AgentTaskService } from './agent-tasks/agent-task-service'
import { HomeService } from './home/home-service'
import { ConversationSummaryDialog } from './conversation-summary/summary-dialog'

/**
 * F3: keep the vault index in sync with the active workspace.
 * Issue #75: wait for settings hydration, otherwise the default workspacePath ('')
 * starts an index of AppData/article that races the real workspace.
 */
function VaultIndexService() {
  const workspacePath = useSettingStore(state => state.workspacePath)
  const settingsReady = useSettingsHydrationStore(state => state.status !== 'loading')

  useEffect(() => {
    if (!settingsReady) return
    const controller = new AbortController()
    void startVaultIndex(workspacePath, controller.signal)
      .catch(error => console.error('[vault-index] failed to start:', error))
    return () => controller.abort()
  }, [settingsReady, workspacePath])

  return null
}

export function ForkServices() {
  return (
    <>
      <VaultIndexService />
      <DailyNoteAutoOpen />
      <DailyNavShortcuts />
      <ReminderService />
      <LinkRewritePrompt />
      <AgentTaskService />
      <HomeService />
      <ConversationSummaryDialog />
    </>
  )
}
