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

const COLLAPSIBLE_HEADING_LEVELS = new Set([2, 3])

interface HeadingItem {
  level: number
  rawText: string
  text: string
  id: string
  pos: number
  nodeSize: number
}

interface OutlineProps {
  editor: Editor
  isOpen: boolean
  position?: 'left' | 'right'
  floating?: boolean
  variant?: 'panel' | 'drawer'
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
      className="h-7 min-w-0 flex-1 bg-background px-2 py-1 text-sm font-normal text-foreground shadow-none"
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
          'group flex min-w-0 items-start rounded text-sm transition-colors',
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
        <ul className="flex flex-col gap-1 p-2">
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
  const headingIdsRef = useRef(new WeakMap<object, string>())
  const nextHeadingIdRef = useRef(0)
  const outlineScrollContainerRef = useRef<HTMLDivElement>(null)
  const lastAutoExpandedActiveHeadingIdRef = useRef<string | null>(null)
  // Track if editor is ready - use both ref and state
  const isEditorReadyRef = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const outlineWidth = normalizeOutlineWidth(width)

  const getEditorScrollContainer = useCallback((): HTMLElement | null => {
    if (!editor?.view?.dom) return null

    const root = editor.view.dom.closest('.tiptap-editor')
    const scrollContainer = root?.querySelector('.overflow-y-auto')

    if (scrollContainer instanceof HTMLElement) {
      return scrollContainer
    }

    return editor.view.dom instanceof HTMLElement ? editor.view.dom : null
  }, [editor])

  // Check if editor is ready - wait for view to be available
  useEffect(() => {
    if (!editor) {
      isEditorReadyRef.current = false
      return
    }

    // Check periodically if editor view is available
    const checkEditor = () => {
      // Check if editor is destroyed
      if (!editor || ('isDestroyed' in editor && editor.isDestroyed)) {
        isEditorReadyRef.current = false
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
          setTimeout(checkEditor, 50)
          return
        }
      } else {
        isEditorReadyRef.current = false
        setIsReady(false)
        setTimeout(checkEditor, 50)
      }
    }

    checkEditor()
  }, [editor])

  // Keep ref in sync with state
  useEffect(() => {
    headingsRef.current = headings
  }, [headings])

  // Extract headings from the editor with position info
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const items: HeadingItem[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const rawLevel = node.attrs.level
        const level = typeof rawLevel === 'number' ? rawLevel : Number(rawLevel) || 1
        const rawText = node.textContent.trim()
        const text = rawText || t('outline.untitledHeading', { level })
        let id = headingIdsRef.current.get(node)
        if (!id) {
          id = `heading-${nextHeadingIdRef.current}`
          nextHeadingIdRef.current += 1
          headingIdsRef.current.set(node, id)
        }
        const nodeSize = node.nodeSize
        items.push({
          level,
          rawText,
          text,
          id,
          pos,
          nodeSize,
        })
      }
    })

    return items
  }, [editor, t])

  // Find the active heading based on cursor position
  const findActiveHeading = useCallback((cursorPos: number): string | null => {
    if (headings.length === 0) return null

    let activeId: string | null = null

    for (const heading of headings) {
      if (heading.pos <= cursorPos) {
        activeId = heading.id
        continue
      }

      break
    }

    return activeId || headings[0]?.id || null
  }, [headings])

  // Update headings when editor content changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!isOpen || !editor || !editor.view || !editor.view.dom) {
      return
    }

    // Initial extraction
    try {
      setHeadings(extractHeadings())
    } catch (e) {
      console.error('[Outline] Error in extractHeadings:', e)
    }

    // Listen to editor update events to keep headings in sync
    const handleUpdate = () => {
      try {
        setHeadings(extractHeadings())
      } catch (e) {
        console.error('[Outline] Error in extractHeadings on update:', e)
      }
    }

    editor.on('update', handleUpdate)

    return () => {
      editor.off('update', handleUpdate)
    }
  }, [editor, extractHeadings, isOpen])

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
    const heading = headingsRef.current.find((item) => item.id === id)
    if (!heading) return

    setActiveHeadingId(id)
    setEditingHeadingId(id)
    setEditingHeadingText(heading.rawText)
  }, [])

  const cancelHeadingEdit = useCallback(() => {
    setEditingHeadingId(null)
    setEditingHeadingText('')
  }, [])

  const commitHeadingEdit = useCallback((id: string) => {
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
    setHeadings(extractHeadings())
  }, [cancelHeadingEdit, editingHeadingText, editor, extractHeadings])

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
    if (!isOpen) return

    try {
      setHeadings(extractHeadings())
    } catch (error) {
      console.error('[Outline] Error reloading headings:', error)
    }
  }, [documentKey, extractHeadings, isOpen])

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
    if (!isEditorReadyRef.current || headings.length === 0) return null

    const scrollContainer = getEditorScrollContainer()
    if (!scrollContainer) return null

    const viewportTop = scrollContainer.getBoundingClientRect().top + 100
    let activeId: string | null = null

    // Use the last heading above the viewport top as the current section.
    for (const heading of headings) {
      const domNode = editor.view.nodeDOM(heading.pos)
      if (!(domNode instanceof HTMLElement)) {
        continue
      }

      if (domNode.getBoundingClientRect().top <= viewportTop) {
        activeId = heading.id
        continue
      }

      break
    }

    return activeId || headings[0]?.id || null
  }, [editor, getEditorScrollContainer, headings])

  // Update active heading when selection or scroll changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!isOpen || !editor || !editor.view || !editor.view.dom) return

    const updateActiveHeading = () => {
      // First try to get heading from cursor position
      const { from } = editor.state.selection
      const activeId = findActiveHeading(from)
      setActiveHeadingId(activeId)
    }

    // Handle scroll - update based on viewport position
    const handleScroll = () => {
      const scrollActiveId = findActiveHeadingByScroll()
      if (scrollActiveId) {
        setActiveHeadingId(scrollActiveId)
      }
    }

    updateActiveHeading()
    editor.on('selectionUpdate', updateActiveHeading)
    editor.on('transaction', updateActiveHeading)

    const scrollContainer = getEditorScrollContainer()
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      editor.off('selectionUpdate', updateActiveHeading)
      editor.off('transaction', updateActiveHeading)
      scrollContainer?.removeEventListener('scroll', handleScroll)
    }
  }, [editor, findActiveHeading, findActiveHeadingByScroll, getEditorScrollContainer, headings, isOpen])

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((id: string) => {
    // Use ref to get latest headings to avoid stale closure
    const currentHeadings = headingsRef.current
    const heading = currentHeadings.find(h => h.id === id)
    if (heading && editor) {
      // Use stored position directly - it's calculated from current document
      const targetPos = heading.pos

      // First, focus the editor to ensure it can receive commands
      editor.commands.focus()

      // Then set the selection to the heading position
      editor.commands.setTextSelection(Math.min(targetPos + 1, editor.state.doc.content.size))
      setActiveHeadingId(id)

      // Then scroll into view
      // Use setTimeout to ensure the selection is applied first
      setTimeout(() => {
        const domNode = editor.view.nodeDOM(targetPos)
        if (domNode instanceof HTMLElement) {
          domNode.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          editor.commands.scrollIntoView()
        }
      }, 0)

      onHeadingSelect?.()
    }
  }, [editor, onHeadingSelect])

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
      <div className="shrink-0 border-b border-border bg-background p-2">
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
