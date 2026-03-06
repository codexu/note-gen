'use client'

import { useCallback, useRef, useState, useEffect, memo } from 'react'
import { X, FileText, Folder, Plus, Undo2, Redo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import emitter from '@/lib/emitter'
import { TooltipButton } from '@/components/tooltip-button'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/enhanced-context-menu'
import { platform } from '@tauri-apps/plugin-os'
import useSettingStore from '@/stores/setting'

export interface TabInfo {
  id: string
  path: string
  name: string
  isFolder: boolean
}

interface TabBarProps {
  tabs: TabInfo[]
  activeTabId: string
  onTabSwitch: (path: string) => void
  onNewTab: () => void
  onCloseTab: (path: string) => void
  onCloseOtherTabs: (path: string) => void
  onCloseAllTabs: () => void
  onCloseLeftTabs: (path: string) => void
  onCloseRightTabs: (path: string) => void
  showUndoRedo?: boolean // 保留这个 prop 以保持兼容性，但主要使用 store 中的值
}

// Sortable Tab with Context Menu
function SortableTabWithMenu({
  tab,
  isActive,
  tabs,
  modKey,
  onTabSwitch,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseLeftTabs,
  onCloseRightTabs,
}: {
  tab: TabInfo
  isActive: boolean
  tabs: TabInfo[]
  modKey: string
  onTabSwitch: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseOtherTabs: (path: string) => void
  onCloseAllTabs: () => void
  onCloseLeftTabs: (path: string) => void
  onCloseRightTabs: (path: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const t = useTranslations('tabContext')
  const currentIndex = tabs.findIndex(t => t.id === tab.id)
  const canCloseLeft = currentIndex > 0
  const canCloseRight = currentIndex < tabs.length - 1
  const hasOthers = tabs.length > 1

  const handleAction = (action: 'close' | 'closeOthers' | 'closeAll' | 'closeLeft' | 'closeRight') => {
    switch (action) {
      case 'close':
        onCloseTab(tab.path)
        break
      case 'closeOthers':
        onCloseOtherTabs(tab.path)
        break
      case 'closeAll':
        onCloseAllTabs()
        break
      case 'closeLeft':
        onCloseLeftTabs(tab.path)
        break
      case 'closeRight':
        onCloseRightTabs(tab.path)
        break
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          data-tab-id={tab.id}
          className={cn(
            'group relative flex items-center gap-1.5 px-3 h-9 text-sm cursor-pointer transition-all shrink-0',
            isActive
              ? 'text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title={tab.path}
          onClick={() => onTabSwitch(tab.path)}
          {...attributes}
          {...listeners}
        >
          {tab.isFolder ? (
            <Folder className="w-4 h-4 shrink-0 text-amber-500" />
          ) : (
            <FileText className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary' : '')} />
          )}
          <span className="truncate max-w-40">{tab.name}</span>

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCloseTab(tab.path)
            }}
            className={cn(
              'p-1 rounded transition-all shrink-0 ml-1',
              'opacity-0 group-hover:opacity-100',
              'hover:bg-muted'
            )}
          >
            <X className="w-3 h-3" />
          </button>

          {/* Active indicator line */}
          {isActive && (
            <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary" />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => handleAction('close')}>
          {t('close')}
          <ContextMenuShortcut>{modKey}W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => handleAction('closeOthers')}
          disabled={!hasOthers}
        >
          {t('closeOthers')}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => handleAction('closeLeft')}
          disabled={!canCloseLeft}
        >
          {t('closeLeft')}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => handleAction('closeRight')}
          disabled={!canCloseRight}
        >
          {t('closeRight')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => handleAction('closeAll')}
          disabled={tabs.length === 0}
        >
          {t('closeAll')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Memoize to prevent unnecessary re-renders
const MemoizedSortableTabWithMenu = memo(SortableTabWithMenu)

export function TabBar({
  tabs,
  activeTabId,
  onTabSwitch,
  onNewTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseLeftTabs,
  onCloseRightTabs,
}: TabBarProps) {
  const { showEditorUndoRedo } = useSettingStore()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollState, setScrollState] = useState({ left: 0, width: 0, scrollWidth: 0 })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Query undo/redo capability from editor
  const queryCanUndoRedo = useCallback(() => {
    emitter.emit('editor-can-undo-redo', {
      resolve: (can) => {
        setCanUndo(can.undo)
        setCanRedo(can.redo)
      }
    })
  }, [])

  // Query on mount and when activeTabId changes
  useEffect(() => {
    queryCanUndoRedo()
  }, [activeTabId, queryCanUndoRedo])

  // Listen for undo/redo state changes from editor
  useEffect(() => {
    const handleUndoRedoChanged = (can: { undo: boolean; redo: boolean }) => {
      setCanUndo(can.undo)
      setCanRedo(can.redo)
    }

    emitter.on('editor-undo-redo-changed', handleUndoRedoChanged)
    return () => {
      emitter.off('editor-undo-redo-changed', handleUndoRedoChanged)
    }
  }, [])

  // Get current platform
  const [currentPlatform, setCurrentPlatform] = useState<'macos' | 'windows' | 'linux' | 'unknown'>('unknown')
  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  // Keyboard shortcut for closing tab (Cmd/Ctrl + W)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = currentPlatform === 'macos'
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl + W: Close current tab
      if (modKey && e.key === 'w' && activeTabId) {
        e.preventDefault()
        onCloseTab(tabs.find(t => t.id === activeTabId)?.path || '')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPlatform, activeTabId, tabs, onCloseTab])

  const t = useTranslations('tabContext')

  // Get modifier key display text
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'

  // Dnd sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Update scroll state
  const updateScrollState = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, clientWidth, scrollWidth } = scrollContainerRef.current
      setScrollState({ left: scrollLeft, width: clientWidth, scrollWidth })
    }
  }, [])

  useEffect(() => {
    updateScrollState()
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('scroll', updateScrollState)
      const resizeObserver = new ResizeObserver(updateScrollState)
      resizeObserver.observe(container)
      return () => {
        container.removeEventListener('scroll', updateScrollState)
        resizeObserver.disconnect()
      }
    }
  }, [updateScrollState, tabs])

  // Scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollContainerRef.current) return

    const tabElement = document.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement
    if (!tabElement) return

    const container = scrollContainerRef.current
    const tabRect = tabElement.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // Check if tab is outside the visible area
    const isOutside =
      tabRect.right > containerRect.right ||
      tabRect.left < containerRect.left

    if (isOutside) {
      // Calculate scroll position to center the tab
      const scrollLeft = tabRect.left - containerRect.left + container.scrollLeft
      container.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      })
    }
  }, [activeTabId, tabs])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      // Let parent handle reordering via callback
    }
  }, [])

  // Handle wheel scroll to horizontal scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      e.preventDefault()
      scrollContainerRef.current.scrollLeft += e.deltaY
    }
  }, [])

  if (tabs.length === 0) {
    return null
  }

  // Calculate scrollbar thumb position and width
  const showScrollbar = scrollState.scrollWidth > scrollState.width
  const thumbWidth = showScrollbar
    ? Math.max(20, (scrollState.width / scrollState.scrollWidth) * 100)
    : 0
  const thumbLeft = showScrollbar
    ? (scrollState.left / (scrollState.scrollWidth - scrollState.width)) * (100 - thumbWidth)
    : 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="relative tab-scrollbar-wrapper">
        <div className="flex items-center h-12 bg-background border-b">
          {/* Undo/Redo buttons - fixed on the left */}
          {showEditorUndoRedo && (
            <div className="flex items-center gap-0.5 px-2 border-r border-border shrink-0">
              <TooltipButton
                icon={<Undo2 className="w-4 h-4" />}
                tooltipText={`撤销 (${modKey}+Z)`}
                onClick={() => {
                  emitter.emit('editor-undo')
                  // Update state after action
                  setTimeout(queryCanUndoRedo, 0)
                }}
                disabled={!canUndo}
              />
              <TooltipButton
                icon={<Redo2 className="w-4 h-4" />}
                tooltipText={`重做 (${modKey}+Shift+Z)`}
                onClick={() => {
                  emitter.emit('editor-redo')
                  // Update state after action
                  setTimeout(queryCanUndoRedo, 0)
                }}
                disabled={!canRedo}
              />
            </div>
          )}

          {/* Tabs scroll container */}
          <div
            ref={scrollContainerRef}
            className="flex items-center h-12 px-1 overflow-x-auto tab-scrollbar gap-1"
            onWheel={handleWheel}
          >
            {/* Tabs */}
            <SortableContext
              items={tabs.map(t => t.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <MemoizedSortableTabWithMenu
                  key={tab.id}
                  tab={tab}
                  isActive={activeTabId === tab.id}
                  tabs={tabs}
                  modKey={modKey}
                  onTabSwitch={onTabSwitch}
                  onCloseTab={onCloseTab}
                  onCloseOtherTabs={onCloseOtherTabs}
                  onCloseAllTabs={onCloseAllTabs}
                  onCloseLeftTabs={onCloseLeftTabs}
                  onCloseRightTabs={onCloseRightTabs}
                />
              ))}
            </SortableContext>

            {/* New tab button */}
            <button
              onClick={onNewTab}
              className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors shrink-0"
              title={t('closeAll')}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Custom absolute scrollbar */}
        {showScrollbar && (
          <div className="tab-scrollbar-track">
            <div
              className="tab-scrollbar-thumb"
              style={{
                width: `${thumbWidth}%`,
                left: `${thumbLeft}%`,
              }}
            />
          </div>
        )}
      </div>
    </DndContext>
  )
}

export default TabBar
