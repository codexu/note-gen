'use client'
import { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { SyncButton } from './sync-button'
import { PullButton } from './pull-button'
import { HistorySheet } from './history-sheet'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import { useEffect, useState } from 'react'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSettingStore from '@/stores/setting'
import { useShallow } from 'zustand/react/shallow'
import { CloudCog } from 'lucide-react'
import { StatusBarItem } from '@/app/core/main/status-bar-order'

interface SyncToolsProps {
  editor: Editor
  markdown?: string
  getMarkdown?: () => string
  prepareExternalAction?: () => boolean
  onMarkdownChange?: (markdown: string) => void
  embedded?: boolean
}

export function SyncTools({ editor, markdown, getMarkdown, prepareExternalAction, onMarkdownChange, embedded = false }: SyncToolsProps) {
  const t = useTranslations('common')
  const { openSettings } = useSettingsDialogStore()
  const [configured, setConfigured] = useState(false)
  const syncContext = useSettingStore(useShallow(state => ({
    workspacePath: state.workspacePath,
    primaryBackupMethod: state.primaryBackupMethod,
    githubCustomSyncRepo: state.githubCustomSyncRepo,
    giteeCustomSyncRepo: state.giteeCustomSyncRepo,
    gitlabCustomSyncRepo: state.gitlabCustomSyncRepo,
    giteaCustomSyncRepo: state.giteaCustomSyncRepo,
  })))

  useEffect(() => {
    isSyncConfigured().then(setConfigured)
  }, [syncContext])

  const handleConfigureSync = () => {
    openSettings('sync')
  }

  if (syncContext.primaryBackupMethod === 'selfHosted' || syncContext.primaryBackupMethod === 'local') return null

  if (configured) {
    return (
      <div className={embedded ? 'contents' : 'flex items-center gap-1'}>
        {embedded ? <StatusBarItem id="editor:sync-history" rank={61}><HistorySheet editor={editor} prepareExternalAction={prepareExternalAction} onMarkdownChange={onMarkdownChange} /></StatusBarItem> : <HistorySheet editor={editor} prepareExternalAction={prepareExternalAction} onMarkdownChange={onMarkdownChange} />}
        {embedded ? <StatusBarItem id="editor:sync-push" rank={62}><SyncButton getMarkdown={getMarkdown} prepareExternalAction={prepareExternalAction} /></StatusBarItem> : <SyncButton getMarkdown={getMarkdown} prepareExternalAction={prepareExternalAction} />}
        {embedded ? <StatusBarItem id="editor:sync-pull" rank={63}><PullButton
          editor={editor}
          markdown={markdown}
          getMarkdown={getMarkdown}
          prepareExternalAction={prepareExternalAction}
          onMarkdownChange={onMarkdownChange}
        /></StatusBarItem> : <PullButton editor={editor} markdown={markdown} getMarkdown={getMarkdown} prepareExternalAction={prepareExternalAction} onMarkdownChange={onMarkdownChange} />}
      </div>
    )
  }

  const configureButton = (
    <button
      onClick={handleConfigureSync}
      className="flex items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={t('configureSync')}
    >
      <CloudCog className="size-3" />
      <span>{t('configureSync')}</span>
    </button>
  )
  return embedded ? <StatusBarItem id="editor:sync-configure" rank={61}>{configureButton}</StatusBarItem> : configureButton
}

export default SyncTools
