'use client'

import { useEditorState, type Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

import { PluginEditorToolbar } from '@/components/plugins/plugin-editor-toolbar'

interface TableContextToolbarProps {
  editor: Editor
  pluginsEnabled?: boolean
}

const MENU_EDGE_GAP = 8

function TableToolbarButton({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={event => { if (event.button === 0) event.preventDefault() }}
          onClick={onClick}
        >
          <span className={active ? 'text-primary' : undefined}>{children}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TableContextToolbar({ editor, pluginsEnabled = false }: TableContextToolbarProps) {
  const t = useTranslations('settings.shortcuts.editorShortcuts.commands')
  const labels = useTranslations('editor.tableToolbar')
  const menuOwner = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false })
  const tableState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => currentEditor.isDestroyed ? null : ({
      active: currentEditor.isEditable && currentEditor.isActive('table'),
      tablePosition: (() => {
        const { $from } = currentEditor.state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'table') return $from.before(depth)
        }
        return null
      })(),
      alignment: (currentEditor.getAttributes('tableCell').align
        ?? currentEditor.getAttributes('tableHeader').align
        ?? 'left') as string,
      canAddColumnBefore: currentEditor.can().addColumnBefore(),
      canAddColumnAfter: currentEditor.can().addColumnAfter(),
      canAddRowBefore: currentEditor.can().addRowBefore(),
      canAddRowAfter: currentEditor.can().addRowAfter(),
      canDeleteColumn: currentEditor.can().deleteColumn(),
      canDeleteRow: currentEditor.can().deleteRow(),
      canDeleteTable: currentEditor.can().deleteTable(),
    }),
  })

  const tablePosition = tableState?.tablePosition
  const tableActive = tableState?.active ?? false

  useLayoutEffect(() => {
    if (!tableActive || tablePosition == null || editor.isDestroyed) return
    const editorElement = editor.view.dom
    const viewport = editorElement.closest<HTMLElement>('[data-editor-viewport-root="true"]')
      ?? editorElement.closest<HTMLElement>('.editor-scroll-container')
    const tableNode = editor.view.nodeDOM(tablePosition)
    if (!(tableNode instanceof HTMLElement) || !viewport) return
    const table = tableNode.matches('table') ? tableNode : tableNode.querySelector('table')
    if (!table) return
    const frame = table.closest<HTMLElement>('.tableWrapper') ?? table
    const menu = menuRef.current
    if (!menu) return
    editorElement.dataset.tableMenuOwner = menuOwner

    const updatePosition = () => {
      if (editor.isDestroyed || !frame.isConnected) return
      const height = menu.offsetHeight
      const bounds = frame.getBoundingClientRect()
      const viewportBounds = viewport.getBoundingClientRect()
      const minLeft = Math.max(0, viewportBounds.left) + MENU_EDGE_GAP
      const right = Math.min(window.innerWidth, viewportBounds.right) - MENU_EDGE_GAP
      menu.style.maxWidth = `${Math.max(0, right - minLeft)}px`
      const left = Math.max(minLeft, Math.min(bounds.left, right - menu.offsetWidth))
      const minTop = Math.max(0, viewportBounds.top) + MENU_EDGE_GAP
      const bottom = Math.min(window.innerHeight, viewportBounds.bottom) - MENU_EDGE_GAP
      const maxTop = Math.max(minTop, bottom - height)
      let top = Math.max(minTop, Math.min(bounds.top - height - MENU_EDGE_GAP, maxTop))
      const bubble = editorElement.parentElement?.querySelector<HTMLElement>('[data-editor-bubble-menu]')
      if (bubble) {
        const bubbleBounds = bubble.getBoundingClientRect()
        if (left < bubbleBounds.right && left + menu.offsetWidth > bubbleBounds.left
          && top < bubbleBounds.bottom + MENU_EDGE_GAP && top + height > bubbleBounds.top) {
          const aboveBubble = bubbleBounds.top - height - MENU_EDGE_GAP
          const belowBubble = bubbleBounds.bottom + MENU_EDGE_GAP
          if (aboveBubble >= minTop) top = aboveBubble
          else if (belowBubble <= maxTop) top = belowBubble
        }
      }
      const visible = bounds.right > minLeft && bounds.left < right
        && bounds.bottom > minTop && bounds.top < bottom
        && top + height <= bottom
      setPosition(current => current.left === left && current.top === top && current.visible === visible
        ? current : { left, top, visible })
    }
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (editorElement.contains(target)) return
      if (target.closest('[data-editor-table-menu]')?.getAttribute('data-editor-table-menu') === menuOwner) return
      const bubble = target.closest('[data-editor-bubble-menu]')
      if (bubble && editorElement.parentElement?.contains(bubble)) return
      setPosition(current => ({ ...current, visible: false }))
    }
    const observer = new ResizeObserver(updatePosition)
    observer.observe(frame)
    observer.observe(menu)
    observer.observe(viewport)
    editor.on('transaction', updatePosition)
    editor.on('focus', updatePosition)
    editorElement.addEventListener('notegen-selection-menu-position', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', handleOutsideClick)
    window.addEventListener('resize', updatePosition)
    updatePosition()
    return () => {
      observer.disconnect()
      editor.off('transaction', updatePosition)
      editor.off('focus', updatePosition)
      editorElement.removeEventListener('notegen-selection-menu-position', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('resize', updatePosition)
      if (editorElement.dataset.tableMenuOwner === menuOwner) delete editorElement.dataset.tableMenuOwner
    }
  }, [editor, menuOwner, tableActive, tablePosition])

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

  const setColumnAlignment = useCallback((alignment: string) => {
    if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return
    editor.chain().focus().setCellAttribute('align', alignment).run()
  }, [editor])

  if (!tableState?.active) return null

  return createPortal(
    <div
      id={menuOwner}
      ref={menuRef}
      data-editor-table-menu={menuOwner}
      className="fixed z-50 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
    >
      <TooltipProvider delayDuration={300}>
        <ButtonGroup className="max-w-full flex-wrap items-center gap-1">
          <ButtonGroup aria-label={labels('row')}>
            <TableToolbarButton label={t('addRowBefore.title')} onClick={addRowBefore} disabled={!tableState.canAddRowBefore}>
              <BetweenHorizontalStart />
            </TableToolbarButton>
            <TableToolbarButton label={t('addRowAfter.title')} onClick={addRowAfter} disabled={!tableState.canAddRowAfter}>
              <BetweenHorizontalEnd />
            </TableToolbarButton>
            <TableToolbarButton label={t('deleteRow.title')} onClick={deleteRow} disabled={!tableState.canDeleteRow}>
              <TableRowsSplit className="text-destructive" />
            </TableToolbarButton>
          </ButtonGroup>
          <ButtonGroupSeparator />
          <ButtonGroup aria-label={labels('column')}>
            <TableToolbarButton label={t('addColumnBefore.title')} onClick={addColumnBefore} disabled={!tableState.canAddColumnBefore}>
              <BetweenVerticalStart />
            </TableToolbarButton>
            <TableToolbarButton label={t('addColumnAfter.title')} onClick={addColumnAfter} disabled={!tableState.canAddColumnAfter}>
              <BetweenVerticalEnd />
            </TableToolbarButton>
            <TableToolbarButton label={t('deleteColumn.title')} onClick={deleteColumn} disabled={!tableState.canDeleteColumn}>
              <TableColumnsSplit className="text-destructive" />
            </TableToolbarButton>
          </ButtonGroup>
          <ButtonGroupSeparator />
          <ButtonGroup aria-label={labels('alignment')}>
            <TableToolbarButton label={t('alignLeft.title')} onClick={() => setColumnAlignment('left')} active={tableState.alignment === 'left'}>
              <AlignLeft />
            </TableToolbarButton>
            <TableToolbarButton label={t('alignCenter.title')} onClick={() => setColumnAlignment('center')} active={tableState.alignment === 'center'}>
              <AlignCenter />
            </TableToolbarButton>
            <TableToolbarButton label={t('alignRight.title')} onClick={() => setColumnAlignment('right')} active={tableState.alignment === 'right'}>
              <AlignRight />
            </TableToolbarButton>
          </ButtonGroup>
          <ButtonGroupSeparator />
          <TableToolbarButton label={t('deleteTable.title')} onClick={deleteTable} disabled={!tableState.canDeleteTable}>
            <Trash2 className="text-destructive" />
          </TableToolbarButton>
          {pluginsEnabled ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'table' }} display="inline" /> : null}
        </ButtonGroup>
      </TooltipProvider>
    </div>,
    editor.view.dom.ownerDocument.body
  )
}

export default TableContextToolbar
