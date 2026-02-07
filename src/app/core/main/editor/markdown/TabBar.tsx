'use client'

import { useCallback } from 'react'
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
        'group flex items-center gap-1.5 px-3 h-9 text-sm rounded-md cursor-pointer transition-colors min-w-0 max-w-36',
        'hover:bg-accent',
        isActive
          ? 'bg-background border-x border-t text-foreground'
          : 'text-muted-foreground bg-muted/30'
      )}
      title={tab.path}
      onClick={onClick}
      // Drag handle is the entire tab
      {...attributes}
      {...listeners}
    >
      {tab.isFolder ? (
        <Folder className="w-4 h-4 shrink-0 text-yellow-500" />
      ) : (
        <FileText className="w-4 h-4 shrink-0" />
      )}
      <span className="truncate flex-1">{tab.name}</span>

      {/* Close button */}
      <button
        onClick={onClose}
        className={cn(
          'opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all'
        )}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function TabBar({ tabs, activeTabId, onTabSwitch, onNewTab, onCloseTab }: TabBarProps) {
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
      // For now, we'll emit a custom event or parent can listen to dnd
    }
  }, [])

  if (tabs.length === 0) {
    return null
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-center h-12 px-2 border-b gap-1 overflow-x-auto scrollbar-hide">
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
          className="flex items-center gap-1 px-2 h-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          title="新建标签页"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </DndContext>
  )
}

export default TabBar
