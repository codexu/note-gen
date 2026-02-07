'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, FileText, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Tab {
  id: string
  path: string
  name: string
}

interface TabBarProps {
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
  tab: Tab
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
        'group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md cursor-pointer transition-colors min-w-0 max-w-[150px]',
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
      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate flex-1">{tab.name}</span>

      {/* Close button */}
      <button
        onClick={onClose}
        className={cn(
          'opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all'
        )}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

export function TabBar({ onTabSwitch, onNewTab, onCloseTab }: TabBarProps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const { activeFilePath } = useArticleStore()
  const tabsRef = useRef<Tab[]>([])
  const activeTabIdRef = useRef<string>('')
  const isSwitchingRef = useRef(false)

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

  // Sync refs
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // Initialize and update tabs when active file changes
  useEffect(() => {
    if (!activeFilePath) {
      // No active file, clear tabs if not currently switching
      if (!isSwitchingRef.current && tabsRef.current.length > 0) {
        setTabs([])
        setActiveTabId('')
      }
      return
    }

    const fileName = activeFilePath.split('/').pop() || activeFilePath

    // Check if tab already exists
    const existingTab = tabsRef.current.find(tab => tab.path === activeFilePath)

    if (existingTab) {
      // Set as active
      if (activeTabIdRef.current !== existingTab.id) {
        setActiveTabId(existingTab.id)
      }
    } else {
      // Add new tab
      const newTab: Tab = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        path: activeFilePath,
        name: fileName
      }

      // Limit tabs to 10
      const newTabs = [...tabsRef.current, newTab].slice(-10)
      setTabs(newTabs)
      setActiveTabId(newTab.id)
    }
  }, [activeFilePath])

  const handleTabClick = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (tab) {
      isSwitchingRef.current = true
      setActiveTabId(tabId)
      onTabSwitch(tab.path)
      // Reset switching flag after a short delay
      setTimeout(() => {
        isSwitchingRef.current = false
      }, 100)
    }
  }, [onTabSwitch])

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()

    const tabIndex = tabsRef.current.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return

    const closedTab = tabsRef.current[tabIndex]
    const newTabs = tabsRef.current.filter(t => t.id !== tabId)

    setTabs(newTabs)

    // If closing the active tab, switch to another tab
    if (activeTabIdRef.current === tabId) {
      isSwitchingRef.current = true
      if (newTabs.length > 0) {
        const targetTab = newTabs[Math.min(tabIndex, newTabs.length - 1)]
        setActiveTabId(targetTab.id)
        onTabSwitch(targetTab.path)
      } else {
        // No tabs left
        setActiveTabId('')
        onCloseTab('') // Signal to clear editor
      }
      setTimeout(() => {
        isSwitchingRef.current = false
      }, 100)
    }

    onCloseTab(closedTab.path)
  }, [onCloseTab, onTabSwitch])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setTabs((items) => {
        const oldIndex = items.findIndex((tab) => tab.id === active.id)
        const newIndex = items.findIndex((tab) => tab.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
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
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b overflow-x-auto scrollbar-hide">
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
          className="flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          title="新建标签页"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </DndContext>
  )
}

export default TabBar
