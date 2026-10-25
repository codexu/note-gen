'use client'

import { Editor } from '@tiptap/react'
import {
  ChevronDown,
  ChevronRight,
  Heading1,
  Heading2,
  Heading3,
  Search,
  X,
} from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '@/lib/utils'
import { getOutlineHeadingTextClass, getOutlinePanelClass } from '@/lib/outline-styles'
import {
  DEFAULT_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  MIN_OUTLINE_WIDTH,
  normalizeOutlineWidth,
} from '@/lib/outline-preferences'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'
import type { EditorEvents } from '@tiptap/core'
import { OutlineHeadingIndex, type HeadingItem } from './outline-index'

const COLLAPSIBLE_HEADING_LEVELS = new Set([2, 3])

interface OutlineProps {
  editor: Editor
  isOpen: boolean
  position?: 'left' | 'right'
  floating?: boolean
  variant?: 'panel' | 'drawer' | 'sidebar'
  documentKey?: string
  width?: number
  onWidthChange?: (width: number) => void
  onWidthCommit?: (width: number) => void
  onHeadingSelect?: () => void
}

interface OutlineMeta {
  ancestorIdsById: Map<string, string[]>
  hasChildrenById: Map<string, boolean>
  parentIdById: Map<string, string | null>
}

interface OutlineDragData {
  level: number
  parentId: string | null
}

function getNormalizedSearchText(value: string) {
  return value.trim().toLocaleLowerCase()
}

function getHeadingIcon(level: number) {
  if (level === 1) return <Heading1 />
  if (level === 2) return <Heading2 />
  if (level === 3) return <Heading3 />

  return (
    <span className="mt-0.5 w-4 shrink-0 text-center text-[10px] font-medium leading-4 text-muted-foreground">
      H{level}
    </span>
  )
}

function OutlineHeadingEditInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  placeholder: string
  ariaLabel: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shouldCommitOnBlurRef = useRef(true)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <Input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-7 min-w-0 flex-1 bg-background px-2 py-1 font-normal text-foreground shadow-none"
      style={{ fontSize: 'inherit' }}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (shouldCommitOnBlurRef.current) {
          onCommit()
        }
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return

        if (event.key === 'Enter') {
          event.preventDefault()
          shouldCommitOnBlurRef.current = false
          onCommit()
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          shouldCommitOnBlurRef.current = false
          onCancel()
        }
      }}
    />
  )
}

function isOutlineDragData(value: unknown): value is OutlineDragData {
  if (!value || typeof value !== 'object') return false

  const data = value as Partial<OutlineDragData>
  return typeof data.level === 'number'
    && (typeof data.parentId === 'string' || data.parentId === null)
}

function SortableOutlineItem({
  heading,
  indentLevel,
  activeHeadingId,
  collapsedHeadingIds,
  hasChildrenById,
  parentId,
  normalizedSearchQuery,
  editingHeadingId,
  editingHeadingText,
  dragDisabled,
  onSelect,
  onToggleCollapse,
  onStartEdit,
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
}: {
  heading: HeadingItem
  indentLevel: number
  activeHeadingId: string | null
  collapsedHeadingIds: Set<string>
  hasChildrenById: Map<string, boolean>
  parentId: string | null
  normalizedSearchQuery: string
  editingHeadingId: string | null
  editingHeadingText: string
  dragDisabled: boolean
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
  onStartEdit: (id: string) => void
  onEditTextChange: (value: string) => void
  onCommitEdit: (id: string) => void
  onCancelEdit: () => void
}) {
  const t = useTranslations('editor')
  const {
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: heading.id,
    disabled: dragDisabled,
    data: { level: heading.level, parentId } satisfies OutlineDragData,
  })
  const isActive = activeHeadingId === heading.id
  const hasChildren = hasChildrenById.get(heading.id) || false
  const canCollapse = COLLAPSIBLE_HEADING_LEVELS.has(heading.level) && hasChildren && !normalizedSearchQuery
  const isCollapsed = collapsedHeadingIds.has(heading.id)
  const isSearchContext =
    Boolean(normalizedSearchQuery) &&
    !getNormalizedSearchText(heading.text).includes(normalizedSearchQuery)
  const isEditing = editingHeadingId === heading.id
  const dragDescriptionId = `outline-drag-description-${heading.id}`
  const headingContentClass = cn(
    'flex min-w-0 flex-1 items-start gap-2 rounded py-1.5 pr-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-colors',
    isActive
      ? '[&_svg]:text-accent-foreground/80 group-hover:[&_svg]:text-accent-foreground'
      : '[&_svg]:text-muted-foreground group-hover:[&_svg]:text-foreground'
  )

  return (
    <li
      ref={setNodeRef}
      id={`outline-${heading.id}`}
      data-outline-id={heading.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
    >
      <div
        className={cn(
          'group flex min-w-0 items-start rounded transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted',
          heading.level === 1 ? 'font-semibold' : '',
          isSearchContext && !isActive ? 'text-muted-foreground' : ''
        )}
        style={{ paddingLeft: `${Math.min(indentLevel, 5) * 12 + 8}px` }}
      >
        {canCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'mt-0.5 size-6 shrink-0',
              isActive
                ? 'text-accent-foreground/80 hover:text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? t('outline.expandHeading', { title: heading.text })
                : t('outline.collapseHeading', { title: heading.text })
            }
            title={
              isCollapsed
                ? t('outline.expandHeading', { title: heading.text })
                : t('outline.collapseHeading', { title: heading.text })
            }
            onClick={() => onToggleCollapse(heading.id)}
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}

        {isEditing ? (
          <div className={headingContentClass}>
            {getHeadingIcon(heading.level)}
            <OutlineHeadingEditInput
              value={editingHeadingText}
              placeholder={t('outline.untitledHeading', { level: heading.level })}
              ariaLabel={t('outline.editHeading', { title: heading.text })}
              onChange={onEditTextChange}
              onCommit={() => onCommitEdit(heading.id)}
              onCancel={onCancelEdit}
            />
          </div>
        ) : (
          <button
            ref={setActivatorNodeRef}
            type="button"
            onClick={() => onSelect(heading.id)}
            onDoubleClick={() => onStartEdit(heading.id)}
            onPointerDown={dragDisabled ? undefined : (event) => listeners?.onPointerDown?.(event)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault()
                onStartEdit(heading.id)
                return
              }

              if (!dragDisabled && event.shiftKey && event.code === 'Space') {
                listeners?.onKeyDown?.(event)
              }
            }}
            className={cn(
              headingContentClass,
              !dragDisabled && 'cursor-grab active:cursor-grabbing'
            )}
            aria-current={isActive ? 'true' : undefined}
            aria-describedby={!dragDisabled ? dragDescriptionId : undefined}
            aria-keyshortcuts={!dragDisabled ? 'Shift+Space' : undefined}
          >
            {getHeadingIcon(heading.level)}
            <span className={getOutlineHeadingTextClass()}>{heading.text}</span>
            {!dragDisabled ? (
              <span id={dragDescriptionId} className="sr-only">
                {t('outline.dragHeading', { title: heading.text })}
              </span>
            ) : null}
          </button>
        )}
      </div>
    </li>
  )
}

function OutlineItems({
  headings,
  totalHeadingCount,
  activeHeadingId,
  collapsedHeadingIds,
  ancestorIdsById,
  hasChildrenById,
  parentIdById,
  normalizedSearchQuery,
  editingHeadingId,
  editingHeadingText,
  dragDisabled,
  onSelect,
  onToggleCollapse,
  onStartEdit,
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
  onDragEnd,
}: {
  headings: HeadingItem[]
  totalHeadingCount: number
  activeHeadingId: string | null
  collapsedHeadingIds: Set<string>
  ancestorIdsById: Map<string, string[]>
  hasChildrenById: Map<string, boolean>
  parentIdById: Map<string, string | null>
  normalizedSearchQuery: string
  editingHeadingId: string | null
  editingHeadingText: string
  dragDisabled: boolean
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
  onStartEdit: (id: string) => void
  onEditTextChange: (value: string) => void
  onCommitEdit: (id: string) => void
  onCancelEdit: () => void
  onDragEnd: (event: DragEndEvent) => void
}) {
  const t = useTranslations('editor')
  const textSize = useSettingStore(state => state.fileManagerTextSize)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeData = args.active.data.current
    if (!isOutlineDragData(activeData)) return []

    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => {
        const targetData = container.data.current
        return isOutlineDragData(targetData)
          && targetData.level === activeData.level
          && targetData.parentId === activeData.parentId
      }),
    })
  }, [])

  return headings.length === 0 ? (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
      {totalHeadingCount === 0 ? t('outline.empty') : t('outline.noResults')}
    </div>
  ) : (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <SortableContext
        items={headings.map((heading) => heading.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={cn('flex flex-col gap-1 p-2', `text-${textSize}`)}>
          {headings.map((heading) => (
            <SortableOutlineItem
              key={heading.id}
              heading={heading}
              indentLevel={ancestorIdsById.get(heading.id)?.length ?? 0}
              activeHeadingId={activeHeadingId}
              collapsedHeadingIds={collapsedHeadingIds}
              hasChildrenById={hasChildrenById}
              parentId={parentIdById.get(heading.id) ?? null}
              normalizedSearchQuery={normalizedSearchQuery}
              editingHeadingId={editingHeadingId}
              editingHeadingText={editingHeadingText}
              dragDisabled={dragDisabled}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              onStartEdit={onStartEdit}
              onEditTextChange={onEditTextChange}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

export function Outline({
  editor,
  isOpen,
  position = 'right',
  floating = false,
  variant = 'panel',
  documentKey,
  width = DEFAULT_OUTLINE_WIDTH,
  onWidthChange,
  onWidthCommit,
  onHeadingSelect,
}: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(() => new Set())
  const [editingHeadingId, setEditingHeadingId] = useState<string | null>(null)
  const [editingHeadingText, setEditingHeadingText] = useState('')
  const [outlineOverflowing, setOutlineOverflowing] = useState(false)
  const t = useTranslations('editor')
  // Use ref to always get latest headings in event handlers
  const headingsRef = useRef<HeadingItem[]>([])
  const headingIndexRef = useRef<OutlineHeadingIndex | null>(null)
  if (!headingIndexRef.current) headingIndexRef.current = new OutlineHeadingIndex()
  const outlineScrollContainerRef = useRef<HTMLDivElement>(null)
  const activeHeadingSourceRef = useRef<'cursor' | 'viewport'>('viewport')
  const headingScrollTargetRef = useRef<number | null>(null)
  const headingScrollFrameRef = useRef<number | null>(null)
  const lastAutoExpandedActiveHeadingIdRef = useRef<string | null>(null)
  // Track if editor is ready - use both ref and state
  const isEditorReadyRef = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const outlineWidth = normalizeOutlineWidth(width)

  const getEditorScrollContainer = useCallback((): HTMLElement | null => {
    if (!editor || editor.isDestroyed) return null

    const scrollContainer = editor.view.dom.closest('[data-editor-viewport-root="true"]')

    if (scrollContainer instanceof HTMLElement) {
      return scrollContainer
    }

    return null
  }, [editor])

  useEffect(() => {
    activeHeadingSourceRef.current = 'viewport'
    headingScrollTargetRef.current = null

    return () => {
      if (headingScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(headingScrollFrameRef.current)
        headingScrollFrameRef.current = null
      }
      headingScrollTargetRef.current = null
    }
  }, [editor, documentKey])

  // Check if editor is ready - wait for view to be available
  useEffect(() => {
    isEditorReadyRef.current = false
    setIsReady(false)
    if (!editor) {
      return
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const resetReadiness = () => {
      clearTimeout(retryTimer)
      isEditorReadyRef.current = false
      setIsReady(false)
    }
    // Check periodically if editor view is available
    const checkEditor = () => {
      clearTimeout(retryTimer)
      if (cancelled) return
      if (editor.isDestroyed) {
        resetReadiness()
        return
      }

      // Check if editor view is ready
      if (editor.view && editor.view.dom && editor.view.dom.isConnected) {
        // Additional check: ensure DOM is actually mounted
        try {
          // This will throw if not ready
          editor.view.dom.getBoundingClientRect()
          isEditorReadyRef.current = true
          setIsReady(true)
        } catch {
          isEditorReadyRef.current = false
          setIsReady(false)
          retryTimer = setTimeout(checkEditor, 50)
          return
        }
      } else {
        isEditorReadyRef.current = false
        setIsReady(false)
        retryTimer = setTimeout(checkEditor, 50)
      }
    }

    editor.on('mount', checkEditor)
    editor.on('unmount', resetReadiness)
    editor.on('destroy', resetReadiness)
    checkEditor()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      editor.off('mount', checkEditor)
      editor.off('unmount', resetReadiness)
      editor.off('destroy', resetReadiness)
      isEditorReadyRef.current = false
    }
  }, [editor])

  const publishHeadings = useCallback((nextHeadings: HeadingItem[]) => {
    const previousHeadings = headingsRef.current
    if (previousHeadings === nextHeadings) return
    headingsRef.current = nextHeadings

    // Body edits only move positions. Keep those in the ref without rendering
    // the entire outline again on every keystroke.
    const changed = previousHeadings.length !== nextHeadings.length
      || nextHeadings.some((heading, index) => {
        const previous = previousHeadings[index]
        return heading.id !== previous.id
          || heading.level !== previous.level
          || heading.rawText !== previous.rawText
          || heading.text !== previous.text
      })

    if (changed) setHeadings(nextHeadings)
  }, [])

  // Find the active heading based on cursor position
  const findActiveHeading = useCallback((cursorPos: number): string | null => {
    const currentHeadings = headingsRef.current
    if (currentHeadings.length === 0) return null

    let from = 0
    let to = currentHeadings.length
    while (from < to) {
      const middle = Math.floor((from + to) / 2)
      if (currentHeadings[middle].pos <= cursorPos) from = middle + 1
      else to = middle
    }

    return currentHeadings[Math.max(0, from - 1)]?.id ?? null
  }, [])

  // Update headings when editor content changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!isOpen || !isReady || !editor || editor.isDestroyed) {
      return
    }

    const headingIndex = headingIndexRef.current
    if (!headingIndex) return
    const untitledHeading = (level: number) => t('outline.untitledHeading', { level })

    // Initial extraction
    try {
      publishHeadings(headingIndex.rebuild(editor.state.doc, untitledHeading))
    } catch (e) {
      console.error('[Outline] Error building heading index:', e)
    }

    // Transaction events also include silent setContent and appended changes.
    const handleTransaction = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
      try {
        publishHeadings(headingIndex.update(
          editor.state.doc,
          [transaction, ...appendedTransactions],
          untitledHeading,
        ))
      } catch (e) {
        console.error('[Outline] Error updating heading index:', e)
      }
    }

    editor.on('transaction', handleTransaction)

    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [documentKey, editor, isOpen, isReady, publishHeadings, t])

  const outlineMeta = useMemo<OutlineMeta>(() => {
    const ancestorIdsById = new Map<string, string[]>()
    const hasChildrenById = new Map<string, boolean>()
    const parentIdById = new Map<string, string | null>()
    const stack: HeadingItem[] = []

    for (const heading of headings) {
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop()
      }

      const ancestorIds = stack.map((item) => item.id)
      ancestorIdsById.set(heading.id, ancestorIds)
      parentIdById.set(heading.id, ancestorIds.at(-1) ?? null)
      hasChildrenById.set(heading.id, hasChildrenById.get(heading.id) || false)

      const parent = stack[stack.length - 1]
      if (parent) {
        hasChildrenById.set(parent.id, true)
      }

      stack.push(heading)
    }

    return { ancestorIdsById, hasChildrenById, parentIdById }
  }, [headings])

  const normalizedSearchQuery = useMemo(() => getNormalizedSearchText(searchQuery), [searchQuery])

  const visibleHeadings = useMemo(() => {
    if (!normalizedSearchQuery) {
      return headings.filter((heading) => {
        const ancestorIds = outlineMeta.ancestorIdsById.get(heading.id) || []
        return !ancestorIds.some((ancestorId) => collapsedHeadingIds.has(ancestorId))
      })
    }

    const visibleIds = new Set<string>()

    for (const heading of headings) {
      if (!getNormalizedSearchText(heading.text).includes(normalizedSearchQuery)) {
        continue
      }

      visibleIds.add(heading.id)
      const ancestorIds = outlineMeta.ancestorIdsById.get(heading.id) || []
      for (const ancestorId of ancestorIds) {
        visibleIds.add(ancestorId)
      }
    }

    return headings.filter((heading) => visibleIds.has(heading.id))
  }, [collapsedHeadingIds, headings, normalizedSearchQuery, outlineMeta])

  useEffect(() => {
    const headingIds = new Set(headings.map((heading) => heading.id))

    setCollapsedHeadingIds((previous) => {
      let changed = false
      const next = new Set<string>()

      for (const id of previous) {
        if (headingIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }

      return changed ? next : previous
    })
  }, [headings])

  const visibleHeadingIds = useMemo(() => new Set(visibleHeadings.map((heading) => heading.id)), [visibleHeadings])

  useEffect(() => {
    if (!activeHeadingId || normalizedSearchQuery) {
      if (!activeHeadingId) {
        lastAutoExpandedActiveHeadingIdRef.current = null
      }
      return
    }

    if (lastAutoExpandedActiveHeadingIdRef.current === activeHeadingId) return
    lastAutoExpandedActiveHeadingIdRef.current = activeHeadingId

    const ancestorIds = outlineMeta.ancestorIdsById.get(activeHeadingId) || []

    setCollapsedHeadingIds((previous) => {
      let changed = false
      const next = new Set(previous)

      for (const ancestorId of ancestorIds) {
        if (next.delete(ancestorId)) {
          changed = true
        }
      }

      return changed ? next : previous
    })
  }, [activeHeadingId, normalizedSearchQuery, outlineMeta])

  const toggleHeadingCollapsed = useCallback((id: string) => {
    setCollapsedHeadingIds((previous) => {
      const next = new Set(previous)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      return next
    })
  }, [])

  const startHeadingEdit = useCallback((id: string) => {
    if (!editor.isEditable) return
    const heading = headingsRef.current.find((item) => item.id === id)
    if (!heading) return

    setActiveHeadingId(id)
    setEditingHeadingId(id)
    setEditingHeadingText(heading.rawText)
  }, [editor])

  const cancelHeadingEdit = useCallback(() => {
    setEditingHeadingId(null)
    setEditingHeadingText('')
  }, [])

  const commitHeadingEdit = useCallback((id: string) => {
    if (!editor.isEditable) return
    const heading = headingsRef.current.find((item) => item.id === id)
    if (!heading) {
      cancelHeadingEdit()
      return
    }

    const nextText = editingHeadingText.trim()

    if (nextText === heading.rawText) {
      cancelHeadingEdit()
      return
    }

    const node = editor.state.doc.nodeAt(heading.pos)
    if (!node || node.type.name !== 'heading') {
      cancelHeadingEdit()
      return
    }

    const from = heading.pos + 1
    const to = heading.pos + node.nodeSize - 1
    const transaction = nextText
      ? editor.state.tr.insertText(nextText, from, to)
      : editor.state.tr.delete(from, to)

    editor.view.dispatch(transaction)
    editor.commands.focus()
    setActiveHeadingId(id)
    cancelHeadingEdit()
  }, [cancelHeadingEdit, editingHeadingText, editor])

  const moveHeadingSection = useCallback((event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id || !editor.isEditable) return

    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    const currentHeadings = headingsRef.current
    const activeIndex = currentHeadings.findIndex((heading) => heading.id === activeId)
    const overIndex = currentHeadings.findIndex((heading) => heading.id === overId)
    if (activeIndex < 0 || overIndex < 0) return

    const activeHeading = currentHeadings[activeIndex]
    const overHeading = currentHeadings[overIndex]
    const activeParentId = outlineMeta.parentIdById.get(activeId) ?? null
    const overParentId = outlineMeta.parentIdById.get(overId) ?? null
    if (activeHeading.level !== overHeading.level || activeParentId !== overParentId) return

    const findSectionEnd = (headingIndex: number) => {
      const heading = currentHeadings[headingIndex]
      const nextBoundary = currentHeadings
        .slice(headingIndex + 1)
        .find((candidate) => candidate.level <= heading.level)
      return nextBoundary?.pos ?? editor.state.doc.content.size
    }

    const activeFrom = activeHeading.pos
    const activeTo = findSectionEnd(activeIndex)
    const insertPos = activeIndex < overIndex
      ? findSectionEnd(overIndex)
      : overHeading.pos
    const slice = editor.state.doc.slice(activeFrom, activeTo)
    const transaction = editor.state.tr.deleteRange(activeFrom, activeTo)
    const mappedInsertPos = transaction.mapping.map(insertPos)
    const beforeInsert = transaction.doc

    transaction.replaceRange(mappedInsertPos, mappedInsertPos, slice)
    if (transaction.doc.eq(beforeInsert)) return

    editor.view.dispatch(transaction.setMeta('uiEvent', 'drop'))
    setCollapsedHeadingIds(new Set())
    editor.commands.focus(Math.min(mappedInsertPos + 1, editor.state.doc.content.size))
  }, [editor, outlineMeta])

  useEffect(() => {
    cancelHeadingEdit()
    setCollapsedHeadingIds(new Set())
  }, [cancelHeadingEdit, documentKey])

  useEffect(() => {
    if (!editingHeadingId) return

    if (!headings.some((heading) => heading.id === editingHeadingId)) {
      cancelHeadingEdit()
    }
  }, [cancelHeadingEdit, editingHeadingId, headings])

  const updateOutlineWidth = useCallback((nextWidth: number, commit = false) => {
    const normalizedWidth = normalizeOutlineWidth(nextWidth)
    onWidthChange?.(normalizedWidth)

    if (commit) {
      onWidthCommit?.(normalizedWidth)
    }
  }, [onWidthChange, onWidthCommit])

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (variant === 'drawer') return

    event.preventDefault()

    const startX = event.clientX
    const startWidth = outlineWidth
    let nextWidth = outlineWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = position === 'left'
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX

      nextWidth = normalizeOutlineWidth(startWidth + delta)
      updateOutlineWidth(nextWidth)
    }

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      updateOutlineWidth(nextWidth, true)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }, [outlineWidth, position, updateOutlineWidth, variant])

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') {
      nextWidth = outlineWidth + (position === 'right' ? step : -step)
    } else if (event.key === 'ArrowRight') {
      nextWidth = outlineWidth + (position === 'left' ? step : -step)
    } else if (event.key === 'Home') {
      nextWidth = MIN_OUTLINE_WIDTH
    } else if (event.key === 'End') {
      nextWidth = MAX_OUTLINE_WIDTH
    }

    if (nextWidth === null) return

    event.preventDefault()
    updateOutlineWidth(nextWidth, true)
  }, [outlineWidth, position, updateOutlineWidth])

  // Find active heading based on scroll position (viewport)
  const findActiveHeadingByScroll = useCallback((): string | null => {
    // Check if editor is fully initialized - use isEditorReadyRef
    const currentHeadings = headingsRef.current
    if (!isEditorReadyRef.current || currentHeadings.length === 0) return null

    const scrollContainer = getEditorScrollContainer()
    if (!scrollContainer) return null

    const viewport = scrollContainer.getBoundingClientRect()
    const editorBounds = editor.view.dom.getBoundingClientRect()
    // Match the reading anchor used by centered outline navigation.
    const viewportTop = Math.min(
      viewport.top + scrollContainer.clientTop + scrollContainer.clientHeight / 2,
      viewport.bottom - 1,
      editorBounds.bottom - 1,
    )
    const hit = editor.view.posAtCoords({
      left: Math.max(viewport.left, editorBounds.left) + 8,
      top: Math.max(viewportTop, editorBounds.top + 1),
    })
    if (!hit) return null

    // Hit-test the visible line, then search the position index. Measuring all
    // preceding headings makes scrolling near the end depend on document size.
    let from = 0
    let to = currentHeadings.length
    while (from < to) {
      const middle = Math.floor((from + to) / 2)
      if (currentHeadings[middle].pos <= hit.pos) from = middle + 1
      else to = middle
    }
    let index = Math.max(0, from - 1)
    const domNode = editor.view.nodeDOM(currentHeadings[index].pos)
    if (index > 0 && domNode instanceof HTMLElement && domNode.getBoundingClientRect().top > viewportTop) {
      index -= 1
    }
    return currentHeadings[index]?.id ?? null
  }, [editor, getEditorScrollContainer])

  // Update active heading when selection or scroll changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!isOpen || !isReady || !editor || editor.isDestroyed) return

    let scrollFrame: number | null = null
    headingScrollTargetRef.current = null

    const updateActiveHeading = () => {
      if (editor.isDestroyed) return
      activeHeadingSourceRef.current = 'cursor'
      headingScrollTargetRef.current = null
      if (scrollFrame !== null) {
        window.cancelAnimationFrame(scrollFrame)
        scrollFrame = null
      }
      const { from } = editor.state.selection
      const activeId = findActiveHeading(from)
      setActiveHeadingId(activeId)
    }

    // Handle scroll - update based on viewport position
    const handleScroll = () => {
      if (scrollFrame !== null) return
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null
        if (editor.isDestroyed) return
        const target = headingScrollTargetRef.current
        if (target !== null) {
          // Keep the clicked heading highlighted throughout smooth navigation.
          if (scrollContainer && Math.abs(scrollContainer.scrollTop - target) <= 1) {
            headingScrollTargetRef.current = null
          }
          return
        }
        activeHeadingSourceRef.current = 'viewport'
        const scrollActiveId = findActiveHeadingByScroll()
        if (scrollActiveId) setActiveHeadingId(scrollActiveId)
      })
    }

    setActiveHeadingId(activeHeadingSourceRef.current === 'cursor'
      ? findActiveHeading(editor.state.selection.from)
      : findActiveHeadingByScroll())
    editor.on('selectionUpdate', updateActiveHeading)

    // Keep silent content changes in sync without returning to an old cursor
    // position during reading. The heading index updates earlier in this event.
    const handleTransaction = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
      if (editor.isDestroyed || ![transaction, ...appendedTransactions].some(item => item.docChanged)) return
      if (activeHeadingSourceRef.current === 'cursor') {
        setActiveHeadingId(findActiveHeading(editor.state.selection.from))
      } else {
        handleScroll()
      }
    }
    editor.on('transaction', handleTransaction)

    const scrollContainer = getEditorScrollContainer()
    const interruptHeadingScroll = () => {
      headingScrollTargetRef.current = null
    }
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
    scrollContainer?.addEventListener('wheel', interruptHeadingScroll, { passive: true })
    scrollContainer?.addEventListener('touchstart', interruptHeadingScroll, { passive: true })
    scrollContainer?.addEventListener('pointerdown', interruptHeadingScroll, { passive: true })
    scrollContainer?.addEventListener('keydown', interruptHeadingScroll)

    return () => {
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame)
      editor.off('selectionUpdate', updateActiveHeading)
      editor.off('transaction', handleTransaction)
      scrollContainer?.removeEventListener('scroll', handleScroll)
      scrollContainer?.removeEventListener('wheel', interruptHeadingScroll)
      scrollContainer?.removeEventListener('touchstart', interruptHeadingScroll)
      scrollContainer?.removeEventListener('pointerdown', interruptHeadingScroll)
      scrollContainer?.removeEventListener('keydown', interruptHeadingScroll)
    }
  }, [documentKey, editor, findActiveHeading, findActiveHeadingByScroll, getEditorScrollContainer, isOpen, isReady])

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((id: string) => {
    // Use ref to get latest headings to avoid stale closure
    const currentHeadings = headingsRef.current
    const heading = currentHeadings.find(h => h.id === id)
    if (heading && editor && !editor.isDestroyed) {
      // Use stored position directly - it's calculated from current document
      const targetPos = heading.pos

      // Do not let focus schedule a competing scroll to the previous selection.
      editor.chain()
        .setTextSelection(Math.min(targetPos + 1, editor.state.doc.content.size))
        .focus(undefined, { scrollIntoView: false })
        .run()
      activeHeadingSourceRef.current = 'cursor'
      setActiveHeadingId(id)

      if (headingScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(headingScrollFrameRef.current)
      }
      const documentSnapshot = editor.state.doc
      headingScrollFrameRef.current = window.requestAnimationFrame(() => {
        headingScrollFrameRef.current = null
        if (editor.isDestroyed || !editor.view.dom.isConnected || editor.state.doc !== documentSnapshot) return
        if (targetPos >= documentSnapshot.content.size
          || documentSnapshot.nodeAt(targetPos)?.type.name !== 'heading') return
        const domNode = editor.view.nodeDOM(targetPos)
        const scrollContainer = getEditorScrollContainer()
        if (!(domNode instanceof HTMLElement) || !scrollContainer) return

        const headingRect = domNode.getBoundingClientRect()
        const viewportRect = scrollContainer.getBoundingClientRect()
        const centeredTop = scrollContainer.scrollTop + headingRect.top + headingRect.height / 2
          - viewportRect.top - scrollContainer.clientTop - scrollContainer.clientHeight / 2
        const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
        const top = Math.max(0, Math.min(maxScrollTop, centeredTop))
        headingScrollTargetRef.current = Math.abs(scrollContainer.scrollTop - top) > 1 ? top : null
        scrollContainer.scrollTo({ top, behavior: 'smooth' })
      })

      onHeadingSelect?.()
    }
  }, [editor, getEditorScrollContainer, onHeadingSelect])

  // Auto-scroll to keep active heading visible
  useEffect(() => {
    if (!activeHeadingId || normalizedSearchQuery) return

    const scrollContainer = outlineScrollContainerRef.current
    if (!scrollContainer) return

    const targetHeadingId = visibleHeadingIds.has(activeHeadingId)
      ? activeHeadingId
      : [...(outlineMeta.ancestorIdsById.get(activeHeadingId) || [])]
        .reverse()
        .find((ancestorId) => visibleHeadingIds.has(ancestorId))

    if (!targetHeadingId) return

    const activeElement = scrollContainer.querySelector<HTMLElement>(`[data-outline-id="${targetHeadingId}"]`)
    if (activeElement) {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeHeadingId, normalizedSearchQuery, outlineMeta, visibleHeadingIds])

  useEffect(() => {
    const scrollContainer = outlineScrollContainerRef.current
    if (!isOpen || !isReady || !scrollContainer) return

    const updateOverflow = () => {
      setOutlineOverflowing(scrollContainer.scrollHeight > scrollContainer.clientHeight + 1)
    }
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(scrollContainer)
    const content = scrollContainer.firstElementChild
    if (content) observer.observe(content)
    const frame = window.requestAnimationFrame(updateOverflow)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isOpen, isReady, visibleHeadings])

  // 如果编辑器还没准备好或没有打开Outline，直接返回 null
  if (!isOpen || !isReady) return null

  const outlineContent = (
    <>
      <div className="shrink-0 bg-background p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('outline.searchPlaceholder')}
            disabled={headings.length === 0}
            className="h-8 pl-8 pr-8 text-sm"
          />
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('outline.clearSearch')}
              title={t('outline.clearSearch')}
              onClick={() => setSearchQuery('')}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <div
        ref={outlineScrollContainerRef}
        className={cn('min-h-0 flex-1', outlineOverflowing ? 'overflow-y-auto' : 'overflow-y-hidden')}
      >
        <OutlineItems
          headings={visibleHeadings}
          totalHeadingCount={headings.length}
          activeHeadingId={activeHeadingId}
          collapsedHeadingIds={collapsedHeadingIds}
          ancestorIdsById={outlineMeta.ancestorIdsById}
          hasChildrenById={outlineMeta.hasChildrenById}
          parentIdById={outlineMeta.parentIdById}
          normalizedSearchQuery={normalizedSearchQuery}
          editingHeadingId={editingHeadingId}
          editingHeadingText={editingHeadingText}
          dragDisabled={Boolean(normalizedSearchQuery) || Boolean(editingHeadingId) || !editor.isEditable}
          onSelect={scrollToHeading}
          onToggleCollapse={toggleHeadingCollapsed}
          onStartEdit={startHeadingEdit}
          onEditTextChange={setEditingHeadingText}
          onCommitEdit={commitHeadingEdit}
          onCancelEdit={cancelHeadingEdit}
          onDragEnd={moveHeadingSection}
        />
      </div>
    </>
  )
  const outlinePanelStyle: CSSProperties = {
    width: outlineWidth,
    minWidth: MIN_OUTLINE_WIDTH,
    maxWidth: MAX_OUTLINE_WIDTH,
  }
  const resizeHandle = (
    <div
      role="separator"
      aria-label={t('outline.resizeHandle')}
      aria-orientation="vertical"
      aria-valuemin={MIN_OUTLINE_WIDTH}
      aria-valuemax={MAX_OUTLINE_WIDTH}
      aria-valuenow={outlineWidth}
      tabIndex={0}
      title={t('outline.resizeHandle')}
      className={cn(
        'absolute top-0 bottom-0 z-10 w-2 cursor-col-resize touch-none outline-none transition-colors hover:bg-border/60 focus-visible:bg-ring/30',
        position === 'left' ? '-right-1' : '-left-1'
      )}
      onPointerDown={handleResizePointerDown}
      onKeyDown={handleResizeKeyDown}
    />
  )

  if (variant === 'sidebar') {
    return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">{outlineContent}</div>
  }

  if (variant === 'drawer') {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => {
        if (!open) {
          onHeadingSelect?.()
        }
      }}>
        <DrawerContent className="flex max-h-[80vh] flex-col overflow-hidden rounded-t-[24px]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t('outline.title')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-4">
            {outlineContent}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div
      className={cn(
        getOutlinePanelClass(position, floating),
        !floating ? 'relative' : '',
        'flex flex-col overflow-hidden'
      )}
      style={outlinePanelStyle}
    >
      {resizeHandle}
      {outlineContent}
    </div>
  )
}

export default Outline
