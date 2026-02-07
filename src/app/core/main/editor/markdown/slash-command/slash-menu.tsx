'use client'

import { useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { type Editor } from '@tiptap/react'
import { SlashCommandItem, suggestionItems } from './suggestion'
import { cn } from '@/lib/utils'

interface SlashMenuProps {
  editor: Editor
  clientRect?: DOMRect | null
  query: string
}

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const groupOrder = ['AI', '标题', '列表', '块级', '对齐', '嵌入']

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(({ editor, query }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const items = useMemo(() => {
    const allItems = suggestionItems()
    if (query.length > 0) {
      const search = query.toLowerCase()
      return allItems.filter(
        (item) =>
          item.title.toLowerCase().includes(search) ||
          item.searchTerms?.some((term) => term.includes(search)) ||
          item.description?.toLowerCase().includes(search)
      )
    }
    return allItems
  }, [query])

  const groupedItems = useMemo(() => {
    const groups: Record<string, SlashCommandItem[]> = {}
    items.forEach((item) => {
      if (!groups[item.group]) {
        groups[item.group] = []
      }
      groups[item.group].push(item)
    })
    return Object.entries(groups).sort((a, b) => {
      const orderA = groupOrder.indexOf(a[0])
      const orderB = groupOrder.indexOf(b[0])
      if (orderA === -1 && orderB === -1) return 0
      if (orderA === -1) return 1
      if (orderB === -1) return -1
      return orderA - orderB
    })
  }, [items])

  const flatItems = useMemo(() => {
    return groupedItems.flatMap(([, items]) => items)
  }, [groupedItems])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view when index changes
  useEffect(() => {
    const selectedRef = itemRefs.current[selectedIndex]
    if (selectedRef) {
      selectedRef.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedIndex])

  const selectItem = useCallback(
    (index: number) => {
      const item = flatItems[index]
      if (item) {
        const { from, to } = editor.state.selection
        const tr = editor.state.doc
        let slashStart = from
        for (let i = from - 1; i >= Math.max(0, from - 20); i--) {
          const node = tr.nodeAt(i)
          if (node && node.text && node.text.endsWith('/')) {
            slashStart = i
            break
          }
          if (node && node.text && !node.text.includes('/')) {
            break
          }
        }

        editor.chain()
          .focus()
          .deleteRange({ from: slashStart, to: to })
          .run()

        item.command({ editor, range: { from: slashStart, to } })
      }
    },
    [editor, flatItems]
  )

  const upHandler = useCallback(() => {
    setSelectedIndex((prev) => (prev + flatItems.length - 1) % flatItems.length)
  }, [flatItems.length])

  const downHandler = useCallback(() => {
    setSelectedIndex((prev) => (prev + 1) % flatItems.length)
  }, [flatItems.length])

  const enterHandler = useCallback(() => {
    selectItem(selectedIndex)
  }, [selectItem, selectedIndex])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          upHandler()
          return true
        }
        if (event.key === 'ArrowDown') {
          downHandler()
          return true
        }
        if (event.key === 'Enter') {
          enterHandler()
          return true
        }
        return false
      },
    }),
    [upHandler, downHandler, enterHandler]
  )

  if (items.length === 0) {
    return (
      <div className="p-2 text-sm text-muted-foreground text-center">
        无匹配结果
      </div>
    )
  }

  return (
    <div className="max-h-64 overflow-auto p-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border rounded-lg shadow-lg min-w-36">
      {groupedItems.map(([group, groupItems]) => (
        <div key={group}>
          <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {group}
          </div>
          <div>
            {groupItems.map((item) => {
              const flatIndex = flatItems.indexOf(item)
              const isSelected = flatIndex === selectedIndex

              return (
                <button
                  key={item.title}
                  ref={(el) => {
                    itemRefs.current[flatIndex] = el
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 text-sm rounded-md transition-colors text-left',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'
                  )}
                  onClick={() => selectItem(flatIndex)}
                  onMouseEnter={() => setSelectedIndex(flatIndex)}
                >
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
})

SlashMenu.displayName = 'SlashMenu'

export default SlashMenu
