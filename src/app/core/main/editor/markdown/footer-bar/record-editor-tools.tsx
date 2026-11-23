'use client'

import type { Editor } from '@tiptap/react'
import { ArrowUp, Code2, Eye, List, Redo2, SlidersHorizontal, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EditorViewMode } from '@/lib/editor-layout-styles'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'

const historyTools = [
  { action: 'undo', icon: Undo2 },
  { action: 'redo', icon: Redo2 },
] as const

export function RecordEditorHistory({ undo, redo, onAction, mobile }: {
  undo: boolean
  redo: boolean
  onAction: (action: 'undo' | 'redo') => void
  mobile: boolean
}) {
  const t = useTranslations('tabContext')
  const available = { undo, redo }

  return (
    <div className="flex shrink-0 items-center">
      {historyTools.map(({ action, icon: Icon }) => (
        <Button
          key={action}
          type="button"
          variant="ghost"
          size={mobile ? 'icon' : 'icon-sm'}
          className={mobile ? 'size-11' : undefined}
          aria-label={t(action)}
          title={t(action)}
          disabled={!available[action]}
          onPointerDown={mobile ? event => event.preventDefault() : undefined}
          onMouseDown={mobile ? event => event.preventDefault() : undefined}
          onClick={() => onAction(action)}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
    </div>
  )
}

interface MobileRecordEditorToolsProps {
  editor: Editor
  exportName: string
  viewMode: EditorViewMode
  outlineOpen?: boolean
  onToggleViewMode: () => void
  onToggleOutline?: () => void
  onScrollToTop?: () => void
  getMarkdown: () => string
}

export function MobileRecordEditorTools({
  editor,
  exportName,
  viewMode,
  outlineOpen,
  onToggleViewMode,
  onToggleOutline,
  onScrollToTop,
  getMarkdown,
}: MobileRecordEditorToolsProps) {
  const t = useTranslations('record.mark.detail')
  const tEditor = useTranslations('editor')
  const tMode = useTranslations('settings.editor.sourceMode')
  const menuItemClass = 'min-h-11 px-2'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('bodyTools')}
          title={t('bodyTools')}
          className="size-11 px-0"
        >
          <SlidersHorizontal aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem className={menuItemClass} onSelect={onToggleViewMode}>
            {viewMode === 'source' ? <Eye /> : <Code2 />}
            {tMode(viewMode === 'source' ? 'visual' : 'source')}
          </DropdownMenuItem>
          {onToggleOutline ? (
            <DropdownMenuItem className={menuItemClass} onSelect={onToggleOutline}>
              <List />
              {tEditor(outlineOpen ? 'outline.close' : 'outline.open')}
            </DropdownMenuItem>
          ) : null}
          {onScrollToTop ? (
            <DropdownMenuItem className={menuItemClass} onSelect={onScrollToTop}>
              <ArrowUp />
              {t('backToTop')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <CopyButton editor={editor} getMarkdown={getMarkdown} kind="record" submenuLabel={t('copyBody')} />
          <ExportButton editor={editor} getMarkdown={getMarkdown} recordExportName={exportName} submenuLabel={t('exportBody')} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
