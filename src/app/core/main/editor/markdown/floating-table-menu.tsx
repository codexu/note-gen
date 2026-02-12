'use client'

import { Editor } from '@tiptap/react'
import {
  TableIcon,
  Columns,
  Rows,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface FloatingTableMenuProps {
  editor: Editor
}

export function FloatingTableMenu({ editor }: FloatingTableMenuProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate menu position based on table selection
  const updatePosition = useCallback(() => {
    const { from } = editor.state.selection

    // Check if we're inside a table using TipTap's isActive method
    const isInsideTable = editor.isActive('table')

    if (!isInsideTable) {
      setShow(false)
      return
    }

    // Get editor bounds and scroll container
    const editorElement = document.querySelector('.ProseMirror')
    const scrollContainer = editorElement?.parentElement
    if (!editorElement || !scrollContainer) return

    const containerBounds = scrollContainer.getBoundingClientRect()

    // Get the coordinates of the selection
    const coords = editor.view.coordsAtPos(from)

    // 转换为滚动容器内的相对坐标
    const relativeTop = coords.bottom - containerBounds.top + scrollContainer.scrollTop + 10
    const relativeLeft = coords.left - containerBounds.left + scrollContainer.scrollLeft

    // 边界检测：left 在 [0, 容器宽度 - 菜单宽度] 范围内
    const currentMenuWidth = menuRef.current?.offsetWidth || 200
    const maxLeft = Math.max(0, containerBounds.width - currentMenuWidth)
    const left = Math.min(relativeLeft, maxLeft)

    setPosition({ top: relativeTop, left })
    setShow(true)
  }, [editor])

  // Update position on selection change
  useEffect(() => {
    const updateHandler = () => updatePosition()

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updateHandler)

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updateHandler)
    }
  }, [editor, updatePosition])

  // Hide menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShow(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Update position on scroll
  useEffect(() => {
    const scrollContainer = document.querySelector('.ProseMirror')?.parentElement
    if (!scrollContainer) return

    const handleScroll = () => {
      if (show) {
        updatePosition()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [show, updatePosition])

  const canInsertTable = editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    setShow(false)
  }, [editor])

  const addColumnBefore = useCallback(() => {
    editor.chain().focus().addColumnBefore().run()
  }, [editor])

  const addColumnAfter = useCallback(() => {
    editor.chain().focus().addColumnAfter().run()
  }, [editor])

  const addRowBefore = useCallback(() => {
    editor.chain().focus().addRowBefore().run()
  }, [editor])

  const addRowAfter = useCallback(() => {
    editor.chain().focus().addRowAfter().run()
  }, [editor])

  const deleteColumn = useCallback(() => {
    editor.chain().focus().deleteColumn().run()
  }, [editor])

  const deleteRow = useCallback(() => {
    editor.chain().focus().deleteRow().run()
  }, [editor])

  const deleteTable = useCallback(() => {
    editor.chain().focus().deleteTable().run()
  }, [editor])

  const setColumnAlignmentLeft = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'left').run()
  }, [editor])

  const setColumnAlignmentCenter = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'center').run()
  }, [editor])

  const setColumnAlignmentRight = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'right').run()
  }, [editor])

  const isTableActive = editor.isActive('table')

  if (!show) return null

  return (
    <div
      ref={menuRef}
      className="absolute z-50"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {/* Arrow */}
      <div className="absolute -top-0 left-1/2 -translate-x-1/2 translate-y-[-100%]">
        <div className="w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-border" />
      </div>

      {/* Table toolbar */}
      <div className="flex items-center gap-0.5 px-1 py-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border rounded-lg shadow-lg">
        {/* Insert table button (when no table selected) */}
        {!isTableActive && (
          <button
            onClick={insertTable}
            disabled={!canInsertTable}
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors',
              !canInsertTable && 'opacity-50 cursor-not-allowed'
            )}
            title="插入表格"
          >
            <TableIcon className="w-4 h-4" />
          </button>
        )}

        {/* Table operations (when table is active) */}
        {isTableActive && (
          <>
            {/* Add row/column */}
            <button
              onClick={addRowBefore}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="在上方插入行"
            >
              <Rows className="w-4 h-4" />
            </button>
            <button
              onClick={addRowAfter}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="在下方插入行"
            >
              <Rows className="w-4 h-4 rotate-180" />
            </button>
            <button
              onClick={addColumnBefore}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="在左侧插入列"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button
              onClick={addColumnAfter}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="在右侧插入列"
            >
              <Columns className="w-4 h-4 rotate-180" />
            </button>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Alignment */}
            <button
              onClick={setColumnAlignmentLeft}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="左对齐"
            >
              <AlignLeft className="w-4 h-4" />
            </button>
            <button
              onClick={setColumnAlignmentCenter}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="居中对齐"
            >
              <AlignCenter className="w-4 h-4" />
            </button>
            <button
              onClick={setColumnAlignmentRight}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="右对齐"
            >
              <AlignRight className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Delete */}
            <button
              onClick={deleteColumn}
              className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
              title="删除列"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={deleteRow}
              className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
              title="删除行"
            >
              <Rows className="w-4 h-4" />
            </button>
            <button
              onClick={deleteTable}
              className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
              title="删除表格"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default FloatingTableMenu
