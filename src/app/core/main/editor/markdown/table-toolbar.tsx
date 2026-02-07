'use client'

import { Editor } from '@tiptap/react'
import {
  Table as TableIcon,
  Columns,
  Rows,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'
import { useCallback } from 'react'

interface TableToolbarProps {
  editor: Editor
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const canInsertTable = editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
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

  return (
    <div className="table-toolbar relative">
      <button
        onClick={insertTable}
        disabled={!canInsertTable}
        className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
        title="插入表格"
      >
        <TableIcon size={18} />
      </button>

      {isTableActive && (
        <div className="flex items-center gap-1 ml-2 border-l border-gray-300 dark:border-gray-600 pl-2">
          <button
            onClick={addColumnBefore}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="在左侧插入列"
          >
            <Columns size={18} className="rotate-180" />
          </button>
          <button
            onClick={addColumnAfter}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="在右侧插入列"
          >
            <Columns size={18} />
          </button>
          <button
            onClick={addRowBefore}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="在上方插入行"
          >
            <Rows size={18} className="rotate-180" />
          </button>
          <button
            onClick={addRowAfter}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="在下方插入行"
          >
            <Rows size={18} />
          </button>
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
          <button
            onClick={setColumnAlignmentLeft}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="左对齐"
          >
            <AlignLeft size={18} />
          </button>
          <button
            onClick={setColumnAlignmentCenter}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="居中对齐"
          >
            <AlignCenter size={18} />
          </button>
          <button
            onClick={setColumnAlignmentRight}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="右对齐"
          >
            <AlignRight size={18} />
          </button>
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
          <button
            onClick={deleteColumn}
            className="p-2 rounded hover:bg-red-200 dark:hover:bg-red-900 text-red-600"
            title="删除列"
          >
            <Trash2 size={18} />
          </button>
          <button
            onClick={deleteRow}
            className="p-2 rounded hover:bg-red-200 dark:hover:bg-red-900 text-red-600"
            title="删除行"
          >
            <Rows size={18} className="rotate-45" />
          </button>
          <button
            onClick={deleteTable}
            className="p-2 rounded hover:bg-red-200 dark:hover:bg-red-900 text-red-600"
            title="删除表格"
          >
            <Trash2 size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
