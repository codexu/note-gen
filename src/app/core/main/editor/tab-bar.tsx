'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, FilePlus2, FileText, Folder, Maximize2, MoreHorizontal, Palette, PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, Plus, Redo2, Undo2, X } from 'lucide-react'
import { platform } from '@tauri-apps/plugin-os'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import emitter from '@/lib/emitter'
import { TooltipButton } from '@/components/tooltip-button'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from '@/components/ui/enhanced-context-menu'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useSettingStore from '@/stores/setting'
import type { Mark } from '@/db/marks'
import { isRecordTabPath } from '../mark/mark-record-tab'
import { getMarkTypeListBadgeClasses } from '../mark/mark-type-meta'
import { getCanvasIdFromTabPath, isCanvasTabPath } from '../canvas/canvas-tab'
import type { EditorSplitDirection } from './editor-group-layout'
import { canOpenInEditorWindow } from '@/lib/editor-windows'
import { PluginFileMenuItems } from '@/components/plugins/plugin-file-menu-items'

export interface TabInfo {
  id: string
  path: string
  name: string
  isFolder: boolean
  kind?: 'file' | 'record' | 'canvas' | 'blank'
  autoCreated?: boolean
  preview?: boolean
  pinned?: boolean
  markId?: number
  markType?: Mark['type']
  canvasId?: string
}

interface TabBarProps {
  groupId: string
  tabs: TabInfo[]
  activeTabId: string
  isActiveGroup: boolean
  isMaximized: boolean
  onTabSwitch: (tabId: string) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: () => void
  onCloseLeftTabs: (tabId: string) => void
  onCloseRightTabs: (tabId: string) => void
  onSplitTab: (tabId: string, direction: EditorSplitDirection) => void
  onMoveToNewWindow: (tabId: string) => void
  onPinTab: (tabId: string) => void
  onUnpinTab: (tabId: string) => void
  canNavigateBack: boolean
  canNavigateForward: boolean
  onNavigateBack: () => void
  onNavigateForward: () => void
  onToggleMaximize: () => void
  canCloseGroup: boolean
  onCloseGroup: () => void
}

function SortableTabWithMenu({
  tab, groupId, isActive, tabs, modKey, onTabSwitch, onCloseTab,
  onCloseOtherTabs, onCloseAllTabs, onCloseLeftTabs, onCloseRightTabs,
  onSplitTab, onMoveToNewWindow, onPinTab, onUnpinTab,
}: {
  tab: TabInfo
  groupId: string
  isActive: boolean
  tabs: TabInfo[]
  modKey: string
  onTabSwitch: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: () => void
  onCloseLeftTabs: (tabId: string) => void
  onCloseRightTabs: (tabId: string) => void
  onSplitTab: (tabId: string, direction: EditorSplitDirection) => void
  onMoveToNewWindow: (tabId: string) => void
  onPinTab: (tabId: string) => void
  onUnpinTab: (tabId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `editor-tab:${groupId}:${tab.id}`,
    data: { type: 'editor-tab', groupId, tabId: tab.id },
  })
  const t = useTranslations('tabContext')
  const recordTypeT = useTranslations('record.mark.type')
  const currentIndex = tabs.findIndex(item => item.id === tab.id)
  const isRecordTab = tab.kind === 'record' || isRecordTabPath(tab.path)
  const isCanvasTab = tab.kind === 'canvas' || isCanvasTabPath(tab.path)
  const canDetach = canOpenInEditorWindow(tab)
  const canClose = tabs.length > 1 || tab.kind !== 'blank'
  const recordTypeLabel = isRecordTab ? recordTypeT(tab.markType || 'text') : ''
  const baseTitle = isRecordTab ? `${recordTypeLabel}: ${tab.name}` : tab.kind === 'blank' ? tab.name : tab.path
  const hasClosableOtherTabs = tabs.some(item => item.id !== tab.id && !item.pinned)
  const hasClosableLeftTabs = tabs.slice(0, currentIndex).some(item => !item.pinned)
  const hasClosableRightTabs = tabs.slice(currentIndex + 1).some(item => !item.pinned)
  const hasClosableUnpinnedTabs = tabs.some(item => !item.pinned && (tabs.length > 1 || item.kind !== 'blank'))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
          data-tab-id={tab.id}
          className={cn(
            'group relative flex h-12 max-w-56 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-sm transition-colors',
            isActive ? 'bg-muted/40 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          title={tab.preview ? `${t('previewTab')}: ${baseTitle}` : baseTitle}
          onClick={() => onTabSwitch(tab.id)}
          onAuxClick={event => {
            if (event.button !== 1 || !canClose) return
            event.preventDefault()
            onCloseTab(tab.id)
          }}
          onDoubleClick={event => {
            if ((event.target as HTMLElement).closest('button,[role="menuitem"]')) return
            if (tab.kind !== 'blank' && !tab.pinned) onPinTab(tab.id)
          }}
          {...attributes}
          {...listeners}
        >
          {tab.kind === 'blank' ? (
            <FilePlus2 className={cn('size-4 shrink-0', isActive && 'text-primary')} />
          ) : isRecordTab ? (
            <span className={cn(getMarkTypeListBadgeClasses(tab.markType || 'text'), 'shrink-0 text-[10px]')}>{recordTypeLabel}</span>
          ) : isCanvasTab ? (
            <Palette className={cn('size-4 shrink-0', isActive && 'text-primary')} />
          ) : tab.isFolder ? (
            <Folder className="size-4 shrink-0 text-amber-500" />
          ) : (
            <FileText className={cn('size-4 shrink-0', isActive && 'text-primary')} />
          )}
          {tab.pinned && <Pin className="size-3.5 shrink-0 text-primary" />}
          <span className={cn('truncate', tab.preview && 'italic')}>{tab.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-1 size-5 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={t('close')}
            disabled={!canClose}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onCloseTab(tab.id)
            }}
          >
            <X />
          </Button>
          {isActive && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={tab.kind === 'blank'}
            onClick={() => tab.pinned ? onUnpinTab(tab.id) : onPinTab(tab.id)}
          >
            {tab.pinned ? <PinOff /> : <Pin />}
            {t(tab.pinned ? 'unpinTab' : 'pinTab')}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={!canClose} onClick={() => onCloseTab(tab.id)}>{t('close')}<ContextMenuShortcut>{modKey}W</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={!hasClosableOtherTabs} onClick={() => onCloseOtherTabs(tab.id)}>{t('closeOthers')}</ContextMenuItem>
          <ContextMenuItem disabled={!hasClosableLeftTabs} onClick={() => onCloseLeftTabs(tab.id)}>{t('closeLeft')}</ContextMenuItem>
          <ContextMenuItem disabled={!hasClosableRightTabs} onClick={() => onCloseRightTabs(tab.id)}>{t('closeRight')}</ContextMenuItem>
          <ContextMenuItem disabled={!hasClosableUnpinnedTabs} onClick={onCloseAllTabs}>{t('closeAll')}</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={tabs.length < 2} onClick={() => onSplitTab(tab.id, 'left')}><PanelLeft />{t('splitLeft')}</ContextMenuItem>
          <ContextMenuItem disabled={tabs.length < 2} onClick={() => onSplitTab(tab.id, 'right')}><PanelRight />{t('splitRight')}</ContextMenuItem>
          <ContextMenuItem disabled={tabs.length < 2} onClick={() => onSplitTab(tab.id, 'up')}><PanelTop />{t('splitUp')}</ContextMenuItem>
          <ContextMenuItem disabled={tabs.length < 2} onClick={() => onSplitTab(tab.id, 'down')}><PanelBottom />{t('splitDown')}</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={!canDetach} onClick={() => onMoveToNewWindow(tab.id)}><ExternalLink />{t('moveToNewWindow')}</ContextMenuItem>
        </ContextMenuGroup>
        {!isRecordTab && !isCanvasTab && tab.kind !== 'blank' && !tab.isFolder && /\.md$/i.test(tab.path) ? (
          <PluginFileMenuItems location="tab/context" context={{ kind: 'file', relativePath: tab.path, selectedPaths: [tab.path] }} />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const MemoizedSortableTabWithMenu = memo(SortableTabWithMenu)

export function TabBar({
  groupId, tabs, activeTabId, isActiveGroup, isMaximized,
  onTabSwitch, onNewTab, onCloseTab, onCloseOtherTabs, onCloseAllTabs,
  onCloseLeftTabs, onCloseRightTabs, onSplitTab, onMoveToNewWindow,
  onPinTab, onUnpinTab, canNavigateBack, canNavigateForward,
  onNavigateBack, onNavigateForward, onToggleMaximize, canCloseGroup, onCloseGroup,
}: TabBarProps) {
  const { showEditorUndoRedo } = useSettingStore()
  const t = useTranslations('tabContext')
  const [currentPlatform, setCurrentPlatform] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [scrollIndicator, setScrollIndicator] = useState({ left: 0, width: 0, visible: false })
  const scrollIndicatorTimerRef = useRef<number | null>(null)
  const { setNodeRef: setTabListDropRef } = useDroppable({
    id: `editor-tab-list:${groupId}`,
    data: { type: 'editor-tab-list', groupId },
  })
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const setTabListRef = useCallback((node: HTMLDivElement | null) => {
    tabListRef.current = node
    setTabListDropRef(node)
  }, [setTabListDropRef])
  const activeTab = tabs.find(tab => tab.id === activeTabId)
  const canSplit = tabs.length > 1 && Boolean(activeTab)
  const canCloseActiveTab = Boolean(activeTab && (tabs.length > 1 || activeTab.kind !== 'blank'))
  const activeCanvasId = activeTab && (activeTab.kind === 'canvas' || isCanvasTabPath(activeTab.path))
    ? activeTab.canvasId || getCanvasIdFromTabPath(activeTab.path)
    : null
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl+'
  const navigateBackShortcut = currentPlatform === 'macos' ? '⌘[' : 'Alt+←'
  const navigateForwardShortcut = currentPlatform === 'macos' ? '⌘]' : 'Alt+→'

  const queryCanUndoRedo = useCallback(() => {
    if (!isActiveGroup) return
    const resolve = (value: { undo: boolean; redo: boolean }) => {
      setCanUndo(value.undo)
      setCanRedo(value.redo)
    }
    if (activeCanvasId) emitter.emit('canvas-can-undo-redo', { canvasId: activeCanvasId, resolve })
    else emitter.emit('editor-can-undo-redo', { resolve })
  }, [activeCanvasId, isActiveGroup])

  useEffect(() => {
    try { setCurrentPlatform(platform()) } catch { setCurrentPlatform('') }
  }, [])

  useEffect(() => {
    queryCanUndoRedo()
    if (!isActiveGroup) return
    const handleChange = (value: { undo: boolean; redo: boolean }) => {
      setCanUndo(value.undo)
      setCanRedo(value.redo)
    }
    if (activeCanvasId) {
      emitter.on('canvas-undo-redo-changed', handleChange)
      return () => emitter.off('canvas-undo-redo-changed', handleChange)
    }
    emitter.on('editor-undo-redo-changed', handleChange)
    return () => emitter.off('editor-undo-redo-changed', handleChange)
  }, [activeCanvasId, isActiveGroup, queryCanUndoRedo])

  useEffect(() => {
    if (!activeTabId) return
    const activeTabElement = Array.from(tabListRef.current?.children ?? [])
      .find(element => element instanceof HTMLElement && element.dataset.tabId === activeTabId)
    if (activeTabElement instanceof HTMLElement) {
      activeTabElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeTabId])

  const updateScrollIndicator = useCallback((show: boolean) => {
    const target = tabListRef.current
    if (!target) return
    const { clientWidth, scrollLeft, scrollWidth } = target
    if (scrollWidth <= clientWidth) {
      setScrollIndicator({ left: 0, width: 0, visible: false })
      return
    }
    const width = Math.max(24, clientWidth * (clientWidth / scrollWidth))
    const left = (scrollLeft / (scrollWidth - clientWidth)) * (clientWidth - width)
    setScrollIndicator(current => ({ left, width, visible: show || current.visible }))
    if (!show) return
    if (scrollIndicatorTimerRef.current !== null) window.clearTimeout(scrollIndicatorTimerRef.current)
    scrollIndicatorTimerRef.current = window.setTimeout(() => {
      setScrollIndicator(current => ({ ...current, visible: false }))
      scrollIndicatorTimerRef.current = null
    }, 700)
  }, [])

  useEffect(() => {
    const target = tabListRef.current
    if (!target) return
    const observer = new ResizeObserver(() => updateScrollIndicator(false))
    observer.observe(target)
    Array.from(target.children).forEach(child => observer.observe(child))
    updateScrollIndicator(false)
    return () => {
      observer.disconnect()
      if (scrollIndicatorTimerRef.current !== null) window.clearTimeout(scrollIndicatorTimerRef.current)
    }
  }, [tabs, updateScrollIndicator])

  useEffect(() => {
    const target = tabListRef.current
    if (!target) return
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      event.preventDefault()
      if (target.scrollWidth > target.clientWidth) target.scrollLeft += event.deltaY
    }
    target.addEventListener('wheel', handleWheel, { passive: false })
    return () => target.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActiveGroup || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'w' || !activeTabId) return
      event.preventDefault()
      if (!canCloseActiveTab) return
      onCloseTab(activeTabId)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabId, canCloseActiveTab, isActiveGroup, onCloseTab])

  const sortableIds = useMemo(() => tabs.map(tab => `editor-tab:${groupId}:${tab.id}`), [groupId, tabs])
  const runUndoRedo = (redo: boolean) => {
    if (activeCanvasId) emitter.emit(redo ? 'canvas-redo' : 'canvas-undo', { canvasId: activeCanvasId })
    else emitter.emit(redo ? 'editor-redo' : 'editor-undo')
    window.setTimeout(queryCanUndoRedo, 0)
  }

  return (
    <div className="flex h-12 shrink-0 items-center border-b bg-background">
      {isActiveGroup && (
        <div className="flex shrink-0 items-center gap-0.5 border-r px-1">
          <TooltipButton icon={<ArrowLeft />} tooltipText={`${t('navigateBack')} (${navigateBackShortcut})`} side="bottom" buttonClassName="size-7" disabled={!canNavigateBack} onClick={onNavigateBack} />
          <TooltipButton icon={<ArrowRight />} tooltipText={`${t('navigateForward')} (${navigateForwardShortcut})`} side="bottom" buttonClassName="size-7" disabled={!canNavigateForward} onClick={onNavigateForward} />
        </div>
      )}
      {isActiveGroup && showEditorUndoRedo && activeTab && activeTab.kind !== 'record' && activeTab.kind !== 'blank' && (
        <div className="flex shrink-0 items-center gap-0.5 border-r px-1">
          <TooltipButton icon={<Undo2 />} tooltipText={`${t('undo')} (${modKey}Z)`} side="bottom" buttonClassName="size-7" disabled={!canUndo} onClick={() => runUndoRedo(false)} />
          <TooltipButton icon={<Redo2 />} tooltipText={`${t('redo')} (${modKey}Shift+Z)`} side="bottom" buttonClassName="size-7" disabled={!canRedo} onClick={() => runUndoRedo(true)} />
        </div>
      )}
      <div className="tab-scrollbar-wrapper min-w-0 flex-1 self-stretch">
        <div
          ref={setTabListRef}
          className="tab-scrollbar flex h-full min-w-0 items-center overflow-x-auto"
          onScroll={() => updateScrollIndicator(true)}
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            {tabs.map(tab => (
              <MemoizedSortableTabWithMenu
                key={tab.id} tab={tab} groupId={groupId} isActive={activeTabId === tab.id}
                tabs={tabs} modKey={modKey} onTabSwitch={onTabSwitch} onCloseTab={onCloseTab}
                onCloseOtherTabs={onCloseOtherTabs} onCloseAllTabs={onCloseAllTabs}
                onCloseLeftTabs={onCloseLeftTabs} onCloseRightTabs={onCloseRightTabs}
                onSplitTab={onSplitTab} onMoveToNewWindow={onMoveToNewWindow}
                onPinTab={onPinTab} onUnpinTab={onUnpinTab}
              />
            ))}
          </SortableContext>
          {isActiveGroup && (
            <Button variant="ghost" size="icon-sm" className="mx-1" onClick={onNewTab} aria-label={t('newTab')}><Plus /></Button>
          )}
        </div>
        {scrollIndicator.width > 0 && (
          <div className={cn('tab-scrollbar-track', scrollIndicator.visible && 'is-scrolling')}>
            <div
              className="tab-scrollbar-thumb"
              style={{ width: scrollIndicator.width, transform: `translateX(${scrollIndicator.left}px)` }}
            />
          </div>
        )}
      </div>
      {isActiveGroup && (
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <TooltipButton icon={<PanelRight />} tooltipText={t('splitRight')} side="bottom" buttonClassName="size-7" disabled={!canSplit} onClick={() => activeTabId && onSplitTab(activeTabId, 'right')} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('groupActions')}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="!w-max min-w-40 whitespace-nowrap">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={!canSplit} onClick={() => activeTabId && onSplitTab(activeTabId, 'left')}><PanelLeft />{t('splitLeft')}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canSplit} onClick={() => activeTabId && onSplitTab(activeTabId, 'right')}><PanelRight />{t('splitRight')}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canSplit} onClick={() => activeTabId && onSplitTab(activeTabId, 'up')}><PanelTop />{t('splitUp')}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canSplit} onClick={() => activeTabId && onSplitTab(activeTabId, 'down')}><PanelBottom />{t('splitDown')}</DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleMaximize}><Maximize2 />{isMaximized ? t('restoreGroup') : t('maximizeGroup')}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup><DropdownMenuItem disabled={!canCloseGroup} onClick={onCloseGroup}><X />{t('closeGroup')}</DropdownMenuItem></DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

export default TabBar
