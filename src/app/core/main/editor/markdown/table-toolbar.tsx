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
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'

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
    <div className="table-toolbar relative flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={insertTable}
        disabled={!canInsertTable}
        title="插入表格"
      >
        <TableIcon />
      </Button>

      {isTableActive && (
        <ButtonGroup>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addColumnBefore}
            title="在左侧插入列"
          >
            <Columns className="rotate-180" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addColumnAfter}
            title="在右侧插入列"
          >
            <Columns />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addRowBefore}
            title="在上方插入行"
          >
            <Rows className="rotate-180" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addRowAfter}
            title="在下方插入行"
          >
            <Rows />
          </Button>
          <ButtonGroupSeparator />
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentLeft}
            title="左对齐"
          >
            <AlignLeft />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentCenter}
            title="居中对齐"
          >
            <AlignCenter />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentRight}
            title="右对齐"
          >
            <AlignRight />
          </Button>
          <ButtonGroupSeparator />
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteColumn}
            title="删除列"
          >
            <Trash2 />
          </Button>
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteRow}
            title="删除行"
          >
            <Rows className="rotate-45" />
          </Button>
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteTable}
            title="删除表格"
          >
            <Trash2 />
          </Button>
        </ButtonGroup>
      )}
    </div>
  )
}
