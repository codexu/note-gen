'use client'

import { useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { type Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { SlashCommandItem, suggestionItems, filterItems } from './suggestion'
import { cn } from '@/lib/utils'

interface SlashMenuProps {
  editor: Editor
  clientRect?: DOMRect | null
  query: string
}

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(({ editor, query }, ref) => {
  const t = useTranslations('editor.slashCommand')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 构建翻译对象
  const translations = useMemo(() => ({
    groups: {
      ai: t('groups.ai'),
      heading: t('groups.heading'),
      list: t('groups.list'),
      block: t('groups.block'),
      align: t('groups.align'),
      embed: t('groups.embed'),
      math: t('groups.math'),
      chart: t('groups.chart'),
    },
    items: {
      continue: t('items.continue'),
      continueDesc: t('items.continueDesc'),
      heading1: t('items.heading1'),
      heading1Desc: t('items.heading1Desc'),
      heading2: t('items.heading2'),
      heading2Desc: t('items.heading2Desc'),
      heading3: t('items.heading3'),
      heading3Desc: t('items.heading3Desc'),
      bulletList: t('items.bulletList'),
      bulletListDesc: t('items.bulletListDesc'),
      orderedList: t('items.orderedList'),
      orderedListDesc: t('items.orderedListDesc'),
      taskList: t('items.taskList'),
      taskListDesc: t('items.taskListDesc'),
      image: t('items.image'),
      imageDesc: t('items.imageDesc'),
      table: t('items.table'),
      tableDesc: t('items.tableDesc'),
      blockquote: t('items.blockquote'),
      blockquoteDesc: t('items.blockquoteDesc'),
      codeBlock: t('items.codeBlock'),
      codeBlockDesc: t('items.codeBlockDesc'),
      divider: t('items.divider'),
      dividerDesc: t('items.dividerDesc'),
      inlineMath: t('items.inlineMath'),
      inlineMathDesc: t('items.inlineMathDesc'),
      blockMath: t('items.blockMath'),
      blockMathDesc: t('items.blockMathDesc'),
      flowchart: t('items.flowchart'),
      flowchartDesc: t('items.flowchartDesc'),
      sequence: t('items.sequence'),
      sequenceDesc: t('items.sequenceDesc'),
      gantt: t('items.gantt'),
      ganttDesc: t('items.ganttDesc'),
      classDiagram: t('items.classDiagram'),
      classDiagramDesc: t('items.classDiagramDesc'),
      stateDiagram: t('items.stateDiagram'),
      stateDiagramDesc: t('items.stateDiagramDesc'),
      pie: t('items.pie'),
      pieDesc: t('items.pieDesc'),
      erDiagram: t('items.erDiagram'),
      erDiagramDesc: t('items.erDiagramDesc'),
      journey: t('items.journey'),
      journeyDesc: t('items.journeyDesc'),
    },
    imageUpload: {
      success: t('imageUpload.success'),
      saveSuccess: t('imageUpload.saveSuccess'),
      savePath: t('imageUpload.savePath'),
      failed: t('imageUpload.failed'),
    },
  }), [t])

  // 分组顺序
  const groupOrder = useMemo(() => [
    translations.groups.ai,
    translations.groups.heading,
    translations.groups.list,
    translations.groups.block,
    translations.groups.align,
    translations.groups.embed,
    translations.groups.math,
    translations.groups.chart,
  ], [translations.groups])

  const items = useMemo(() => {
    return filterItems(suggestionItems(translations), query)
  }, [query, translations])

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
    return null
  }

  return (
    <div className="max-h-64 overflow-auto p-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border rounded-lg shadow-lg min-w-36">
      {groupedItems.map(([group, groupItems], groupIdx) => {
        // 计算当前分组之前的累积偏移量
        let offset = 0
        for (let i = 0; i < groupIdx; i++) {
          offset += groupedItems[i][1].length
        }

        return (
          <div key={group}>
            <div className="px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {group}
            </div>
            <div>
              {groupItems.map((item, itemIdx) => {
                const flatIndex = offset + itemIdx
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
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

SlashMenu.displayName = 'SlashMenu'

export default SlashMenu
