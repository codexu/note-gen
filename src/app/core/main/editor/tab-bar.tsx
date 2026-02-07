'use client'

import { useCallback, useRef, useState, useEffect } from 'react'
import { X, FileText, Folder, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
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
}

// Sortable Tab Component
function SortableTab({
  tab,
  isActive,
  onClick,
  onClose
}: {
  tab: TabInfo
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-9 text-sm cursor-pointer transition-all shrink-0',
        isActive
          ? 'text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground'
      )}
      title={tab.path}
      onClick={onClick}
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
        onClick={onClose}
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
  )
}

export function TabBar({ tabs, activeTabId, onTabSwitch, onNewTab, onCloseTab }: TabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollState, setScrollState] = useState({ left: 0, width: 0, scrollWidth: 0 })

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

  const handleTabClick = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      onTabSwitch(tab.path)
    }
  }, [tabs, onTabSwitch])

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      onCloseTab(tab.path)
    }
  }, [tabs, onCloseTab])

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
        <div
          ref={scrollContainerRef}
          className="flex items-center h-12 px-1 bg-background border-b overflow-x-auto tab-scrollbar gap-1"
          onWheel={handleWheel}
        >
          {/* Tabs */}
          <SortableContext
            items={tabs.map(t => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map(tab => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={activeTabId === tab.id}
                onClick={() => handleTabClick(tab.id)}
                onClose={(e) => handleCloseTab(e, tab.id)}
              />
            ))}
          </SortableContext>

          {/* New tab button */}
          <button
            onClick={onNewTab}
            className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors shrink-0"
            title="新建标签页"
          >
            <Plus className="w-4 h-4" />
          </button>
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
