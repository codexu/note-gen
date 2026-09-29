'use client'

import { PluginEditorToolbar } from '@/components/plugins/plugin-editor-toolbar'
import { Editor } from '@tiptap/react'
import { Code2, Eye, Search } from 'lucide-react'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { SyncTools } from '../sync/sync-tools'
import { OutlineToggle } from './outline-toggle'
import { SyncButton } from '../sync/sync-button'
import { PullButton } from '../sync/pull-button'
import { HistorySheet } from '../sync/history-sheet'
import { isMobileDevice } from '@/lib/check'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { PluginStatusBarItems } from '@/components/plugins/plugin-status-bar-items'
import { usePluginStore } from '@/stores/plugins'
import { WordCount } from './word-count'
import { StatusBarItem } from '@/app/core/main/status-bar-order'
import emitter from '@/lib/emitter'

interface FooterBarProps {
  editor: Editor
  readOnly?: boolean
  outlineOpen?: boolean
  onToggleOutline?: () => void
  viewMode?: 'visual' | 'source'
  onToggleViewMode?: () => void
  sourceMarkdown?: string
  getMarkdown?: () => string
  prepareExternalAction?: () => boolean
  onMarkdownChange?: (markdown: string) => void
  embedded?: boolean
}

export function FooterBar({
  editor,
  readOnly = false,
  outlineOpen,
  onToggleOutline,
  viewMode = 'visual',
  onToggleViewMode,
  sourceMarkdown,
  getMarkdown,
  prepareExternalAction,
  onMarkdownChange,
  embedded = false,
}: FooterBarProps) {
  const isMobile = isMobileDevice()
  const primaryBackupMethod = useSettingStore((state) => state.primaryBackupMethod)
  const showEditorStats = useSettingStore((state) => state.showEditorStats)
  const pluginStatisticsVisible = usePluginStore((state) => Object.entries(state.statusBar).some(
    ([key, item]) => key.startsWith('top.notegen.editor-statistics:') && item.visible && Boolean(item.text || item.compactText),
  ))
  const tSourceMode = useTranslations('settings.editor.sourceMode')
  const tReading = useTranslations('editor.readingMode')
  const prepareWriteAction = () => !readOnly && (prepareExternalAction?.() ?? true)
  if (isMobile) {
    return (
      <div className="mobile-editor-footer flex h-7 select-none items-center justify-between gap-3 border-t border-border bg-background px-3 text-xs text-muted-foreground">
        {!readOnly ? (
          <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {showEditorStats ? <WordCount editor={editor} sourceMarkdown={sourceMarkdown} compact /> : null}
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {onToggleViewMode ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title={tSourceMode(viewMode)}
              aria-label={tSourceMode(viewMode)}
              onClick={onToggleViewMode}
            >
              {viewMode === 'source' ? <Code2 /> : <Eye />}
              <span>{tSourceMode(viewMode)}</span>
            </Button>
          ) : null}
          {readOnly ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={tReading('search')}
                title={tReading('search')}
                onClick={() => emitter.emit('editor-search-trigger')}
              >
                <Search />
              </Button>
              <CopyButton editor={editor} markdown={sourceMarkdown} getMarkdown={getMarkdown} />
              {onToggleOutline ? (
                <OutlineToggle editor={editor} outlineOpen={outlineOpen} onToggleOutline={onToggleOutline} />
              ) : null}
            </>
          ) : null}
          {!readOnly && primaryBackupMethod !== 'selfHosted' && primaryBackupMethod !== 'local' ? (
            <>
              <HistorySheet editor={editor} prepareExternalAction={prepareWriteAction} onMarkdownChange={onMarkdownChange} />
              <SyncButton getMarkdown={getMarkdown} prepareExternalAction={prepareWriteAction} />
              <PullButton
                editor={editor}
                markdown={sourceMarkdown}
                getMarkdown={getMarkdown}
                prepareExternalAction={prepareWriteAction}
                onMarkdownChange={onMarkdownChange}
              />
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'flex h-6 min-w-0 select-none items-center overflow-hidden bg-background text-xs text-muted-foreground',
      embedded ? 'contents' : 'w-full justify-between border-t border-border px-3',
    )}>
      {/* Left side: Plugin contributions, Copy, Export, Outline */}
      <div className={embedded ? 'contents' : 'flex items-center gap-1'}>
        {!embedded ? <PluginStatusBarItems alignment="left" /> : null}
        {!readOnly && !embedded && viewMode === 'visual' ? <PluginEditorToolbar editor={editor} location="editor/toolbar" /> : null}
        {onToggleViewMode ? (embedded ? <StatusBarItem id="editor:view-mode" rank={20}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            title={tSourceMode(viewMode)}
            aria-label={tSourceMode(viewMode)}
            onClick={onToggleViewMode}
          >
            {viewMode === 'source' ? <Code2 /> : <Eye />}
            <span>{tSourceMode(viewMode)}</span>
          </Button>
        </StatusBarItem> : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            title={tSourceMode(viewMode)}
            aria-label={tSourceMode(viewMode)}
            onClick={onToggleViewMode}
          >
            {viewMode === 'source' ? <Code2 /> : <Eye />}
            <span>{tSourceMode(viewMode)}</span>
          </Button>
        )) : null}
        {embedded ? <StatusBarItem id="editor:copy" rank={21}><CopyButton editor={editor} markdown={sourceMarkdown} getMarkdown={getMarkdown} /></StatusBarItem> : <CopyButton editor={editor} markdown={sourceMarkdown} getMarkdown={getMarkdown} />}
        {embedded ? <StatusBarItem id="editor:export" rank={22}><ExportButton editor={editor} markdown={sourceMarkdown} getMarkdown={getMarkdown} /></StatusBarItem> : <ExportButton editor={editor} markdown={sourceMarkdown} getMarkdown={getMarkdown} />}
        {onToggleOutline ? (
          embedded ? <StatusBarItem id="editor:outline" rank={23}><OutlineToggle
            editor={editor}
            outlineOpen={outlineOpen}
            onToggleOutline={onToggleOutline}
          /></StatusBarItem> : <OutlineToggle editor={editor} outlineOpen={outlineOpen} onToggleOutline={onToggleOutline} />
        ) : null}
      </div>

      {/* Right side: Sync tools */}
      <div className={embedded ? 'contents' : 'flex min-w-0 items-center gap-1'}>
        {showEditorStats && !pluginStatisticsVisible ? (embedded ? <StatusBarItem id="editor:word-count" rank={60}><WordCount editor={editor} sourceMarkdown={sourceMarkdown} compact /></StatusBarItem> : <WordCount editor={editor} sourceMarkdown={sourceMarkdown} compact />) : null}
        {!embedded ? <PluginStatusBarItems alignment="right" /> : null}
        {!readOnly && <SyncTools
          embedded={embedded}
          editor={editor}
          markdown={sourceMarkdown}
          getMarkdown={getMarkdown}
          prepareExternalAction={prepareWriteAction}
          onMarkdownChange={onMarkdownChange}
        />}
      </div>
    </div>
  )
}

export default FooterBar
