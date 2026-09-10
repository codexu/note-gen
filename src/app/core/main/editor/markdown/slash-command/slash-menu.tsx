'use client'

import { useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { type Range } from '@tiptap/core'
import { type Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { SlashCommandItem, suggestionItems, filterItems } from './suggestion'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import {
  executePluginCommand,
} from '@/lib/plugins/command-registry'
import { PluginIcon } from '@/components/plugins/plugin-icon'
import { usePluginEditorCommands } from '@/components/plugins/use-plugin-editor-commands'
import { toast } from '@/hooks/use-toast'

interface SlashMenuProps {
  editor: Editor
  range: Range
  clientRect?: DOMRect | null
  query: string
  onSelectItem?: (item: SlashCommandItem) => void
}

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

function ShortcutHint({ keys }: { keys: string[] }) {
  return (
    <KbdGroup aria-hidden="true" className="shrink-0">
      {keys.map((key) => (
        <Kbd
          key={key}
          className="border border-border bg-muted/50 px-1.5 font-medium leading-4 text-muted-foreground"
        >
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  )
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(({ editor, range, query, onSelectItem }, ref) => {
  const t = useTranslations('editor.slashCommand')
  const hasQuery = query.trim().length > 0
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pluginCommands = usePluginEditorCommands('editor/slash', editor).filter(command => !command.disabled)

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
      generateSection: t('items.generateSection'),
      generateSectionDesc: t('items.generateSectionDesc'),
      summarize: t('items.summarize'),
      summarizeDesc: t('items.summarizeDesc'),
      customInstruction: t('items.customInstruction'),
      customInstructionDesc: t('items.customInstructionDesc'),
      heading1: t('items.heading1'),
      heading1Desc: t('items.heading1Desc'),
      heading2: t('items.heading2'),
      heading2Desc: t('items.heading2Desc'),
      heading3: t('items.heading3'),
      heading3Desc: t('items.heading3Desc'),
      heading4: t('items.heading4'),
      heading4Desc: t('items.heading4Desc'),
      heading5: t('items.heading5'),
      heading5Desc: t('items.heading5Desc'),
      heading6: t('items.heading6'),
      heading6Desc: t('items.heading6Desc'),
      bulletList: t('items.bulletList'),
      bulletListDesc: t('items.bulletListDesc'),
      orderedList: t('items.orderedList'),
      orderedListDesc: t('items.orderedListDesc'),
      taskList: t('items.taskList'),
      taskListDesc: t('items.taskListDesc'),
      image: t('items.image'),
      imageDesc: t('items.imageDesc'),
      file: t('items.file'),
      fileDesc: t('items.fileDesc'),
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
    fileInsert: {
      failed: t('fileInsert.failed'),
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
    const pluginItems: SlashCommandItem[] = pluginCommands.map((command) => ({
      id: command.id,
      title: command.title,
      description: command.description,
      icon: <PluginIcon name={command.icon} className="size-4" />,
      group: command.group ?? command.pluginName,
      searchTerms: [command.id, command.pluginName, ...(command.keywords ?? [])],
      command: ({ editor: targetEditor, range: targetRange }) => {
        targetEditor.chain().focus().deleteRange(targetRange).run()
        document.dispatchEvent(new CustomEvent('slash-command-hide'))
        void executePluginCommand(command.id).catch((error) => {
          toast({
            title: command.title,
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          })
        })
      },
    }))
    return filterItems([...suggestionItems(translations), ...pluginItems], query)
  }, [pluginCommands, query, translations])

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
  }, [items, groupOrder])

  const flatItems = useMemo(() => {
    return groupedItems.flatMap(([, items]) => items)
  }, [groupedItems])

  const activeGroupIndex = Math.min(selectedGroupIndex, Math.max(groupedItems.length - 1, 0))
  const activeGroup = groupedItems[activeGroupIndex]
  const visibleItems = hasQuery ? flatItems : activeGroup?.[1] ?? []

  useEffect(() => {
    setSelectedGroupIndex(0)
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    setSelectedGroupIndex((prev) => Math.min(prev, Math.max(groupedItems.length - 1, 0)))
  }, [groupedItems.length])

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(visibleItems.length - 1, 0)))
  }, [visibleItems.length])

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

  const selectGroup = useCallback((index: number) => {
    setSelectedGroupIndex(index)
    setSelectedIndex(0)
  }, [])

  const selectItem = useCallback(
    (item: SlashCommandItem | undefined) => {
      if (item) {
        if (onSelectItem) {
          onSelectItem(item)
        } else {
          item.command({ editor, range })
        }
      }
    },
    [editor, onSelectItem, range]
  )

  const selectVisibleItem = useCallback(
    (index: number) => {
      selectItem(visibleItems[index])
    },
    [selectItem, visibleItems]
  )

  const upHandler = useCallback(() => {
    if (visibleItems.length === 0) {
      return
    }
    setSelectedIndex((prev) => (prev + visibleItems.length - 1) % visibleItems.length)
  }, [visibleItems.length])

  const downHandler = useCallback(() => {
    if (visibleItems.length === 0) {
      return
    }
    setSelectedIndex((prev) => (prev + 1) % visibleItems.length)
  }, [visibleItems.length])

  const previousGroupHandler = useCallback(() => {
    if (hasQuery || groupedItems.length === 0) {
      return
    }
    selectGroup((activeGroupIndex + groupedItems.length - 1) % groupedItems.length)
  }, [activeGroupIndex, groupedItems.length, hasQuery, selectGroup])

  const nextGroupHandler = useCallback(() => {
    if (hasQuery || groupedItems.length === 0) {
      return
    }
    selectGroup((activeGroupIndex + 1) % groupedItems.length)
  }, [activeGroupIndex, groupedItems.length, hasQuery, selectGroup])

  const enterHandler = useCallback(() => {
    selectVisibleItem(selectedIndex)
  }, [selectVisibleItem, selectedIndex])

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
        if (event.key === 'ArrowLeft') {
          previousGroupHandler()
          return !hasQuery
        }
        if (event.key === 'ArrowRight') {
          nextGroupHandler()
          return !hasQuery
        }
        if (event.key === 'Enter') {
          enterHandler()
          return true
        }
        return false
      },
    }),
    [upHandler, downHandler, previousGroupHandler, nextGroupHandler, enterHandler, hasQuery]
  )

  if (items.length === 0) {
    return null
  }

  if (hasQuery) {
    return (
      <div className="max-h-72 w-[min(26rem,calc(100vw-1rem))] overflow-auto rounded-lg border border-border bg-background/95 p-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {visibleItems.map((item, itemIdx) => {
          const isSelected = itemIdx === selectedIndex

          return (
            <button
              key={item.id ?? `${item.group}-${item.title}-${itemIdx}`}
              ref={(el) => {
                itemRefs.current[itemIdx] = el
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
              )}
              onClick={() => selectVisibleItem(itemIdx)}
              onMouseEnter={() => setSelectedIndex(itemIdx)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{item.group}</span>
                </span>
                {item.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid max-h-72 w-[min(26rem,calc(100vw-1rem))] grid-cols-[7.5rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex max-h-72 min-w-0 flex-col border-r border-border p-1">
        <div className="flex h-7 shrink-0 items-center justify-end px-1">
          <ShortcutHint keys={['←', '→']} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
          {groupedItems.map(([group, groupItems], groupIdx) => {
            const isSelected = groupIdx === activeGroupIndex

            return (
              <button
                key={group}
                className={cn(
                  'flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                )}
                onClick={() => selectGroup(groupIdx)}
                onMouseEnter={() => selectGroup(groupIdx)}
              >
                <span className="min-w-0 truncate">{group}</span>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  {groupItems.length}
                  {isSelected && <ChevronRight className="size-3" />}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex max-h-72 min-w-0 flex-col p-1">
        {activeGroup && (
          <div className="flex h-7 shrink-0 items-center justify-between gap-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="min-w-0 truncate">{activeGroup[0]}</span>
            <ShortcutHint keys={['↑', '↓']} />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
          {visibleItems.map((item, itemIdx) => {
            const isSelected = itemIdx === selectedIndex

            return (
              <button
                key={item.id ?? `${item.group}-${item.title}-${itemIdx}`}
                ref={(el) => {
                  itemRefs.current[itemIdx] = el
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                )}
                onClick={() => selectVisibleItem(itemIdx)}
                onMouseEnter={() => setSelectedIndex(itemIdx)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {item.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.title}</span>
                  {item.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})

SlashMenu.displayName = 'SlashMenu'

export default SlashMenu
