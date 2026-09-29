'use client'

import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns3,
  PanelLeftClose,
  PanelTopClose,
  Rows3,
  Table2,
  TextAlignJustify,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { PluginEditorToolbar } from '@/components/plugins/plugin-editor-toolbar'

interface FloatingTableMenuProps {
  editor: Editor
  pluginsEnabled?: boolean
}

interface FloatingPosition {
  left: number
  top: number
}

const MENU_EDGE_GAP = 8
const FALLBACK_MENU_WIDTH = 120
const FALLBACK_MENU_HEIGHT = 36

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function getSelectionCell(editor: Editor): HTMLElement | null {
  const { node } = editor.view.domAtPos(editor.state.selection.from)
  const element = node instanceof HTMLElement ? node : node.parentElement
  return element?.closest<HTMLElement>('td, th') ?? null
}

function TableMenuTrigger({
  children,
  label,
  variant = 'ghost',
}: {
  children: ReactNode
  label: string
  variant?: 'ghost' | 'destructive'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size="icon-sm" aria-label={label}>
            {children}
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function FloatingTableMenu({ editor, pluginsEnabled = false }: FloatingTableMenuProps) {
  const t = useTranslations('settings.shortcuts.editorShortcuts.commands')
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState<FloatingPosition>({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!editor.isActive('table')) {
      setShow(false)
      return
    }

    const editorElement = editor.view.dom
    const viewport = editorElement.closest<HTMLElement>('.editor-scroll-container')
    if (!viewport) {
      setShow(false)
      return
    }

    const viewportBounds = viewport.getBoundingClientRect()
    const cellBounds = getSelectionCell(editor)?.getBoundingClientRect()
    const selectionCoords = editor.view.coordsAtPos(editor.state.selection.from)
    const anchorBounds = cellBounds ?? selectionCoords
    const visibleBounds = {
      bottom: Math.min(viewportBounds.bottom, window.innerHeight),
      left: Math.max(viewportBounds.left, 0),
      right: Math.min(viewportBounds.right, window.innerWidth),
      top: Math.max(viewportBounds.top, 0),
    }

    const selectionIsVisible = (
      anchorBounds.bottom >= visibleBounds.top
      && anchorBounds.top <= visibleBounds.bottom
      && anchorBounds.right >= visibleBounds.left
      && anchorBounds.left <= visibleBounds.right
    )
    if (!selectionIsVisible) {
      setShow(false)
      return
    }

    const menuWidth = menuRef.current?.offsetWidth || FALLBACK_MENU_WIDTH
    const menuHeight = menuRef.current?.offsetHeight || FALLBACK_MENU_HEIGHT
    const minLeft = visibleBounds.left + MENU_EDGE_GAP
    const maxLeft = visibleBounds.right - MENU_EDGE_GAP - menuWidth
    const anchorCenter = (anchorBounds.left + anchorBounds.right) / 2
    const left = clamp(anchorCenter - menuWidth / 2, minLeft, maxLeft)

    const minTop = visibleBounds.top + MENU_EDGE_GAP
    const maxTop = visibleBounds.bottom - MENU_EDGE_GAP - menuHeight
    const topBelow = anchorBounds.bottom + MENU_EDGE_GAP
    const topAbove = anchorBounds.top - MENU_EDGE_GAP - menuHeight
    const top = topBelow <= maxTop
      ? topBelow
      : topAbove >= minTop
        ? topAbove
        : clamp(topBelow, minTop, maxTop)

    setPosition(current => (
      current.left === left && current.top === top ? current : { left, top }
    ))
    setShow(true)
  }, [editor])

  useLayoutEffect(() => {
    if (show) updatePosition()
  }, [show, updatePosition])

  useEffect(() => {
    const updateHandler = () => updatePosition()

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updateHandler)
    document.addEventListener('scroll', updateHandler, true)
    window.addEventListener('resize', updateHandler)
    updatePosition()

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updateHandler)
      document.removeEventListener('scroll', updateHandler, true)
      window.removeEventListener('resize', updateHandler)
    }
  }, [editor, updatePosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-slot="dropdown-menu-content"]')) return
      if (!editor.view.dom.contains(target)) setShow(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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
    setShow(false)
  }, [editor])

  const setColumnAlignment = useCallback((alignment: string) => {
    if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return
    editor.chain().focus().setCellAttribute('align', alignment).run()
  }, [editor])

  if (!show || typeof document === 'undefined') return null

  const cellAlignment = (
    editor.getAttributes('tableCell').align
    ?? editor.getAttributes('tableHeader').align
    ?? 'left'
  ) as string
  const rowMenuLabel = `${t('addRowBefore.title')} / ${t('addRowAfter.title')}`
  const columnMenuLabel = `${t('addColumnBefore.title')} / ${t('addColumnAfter.title')}`
  const alignmentMenuLabel = `${t('alignLeft.title')} / ${t('alignCenter.title')} / ${t('alignRight.title')}`
  const deleteMenuLabel = `${t('deleteRow.title')} / ${t('deleteColumn.title')} / ${t('deleteTable.title')}`

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{ left: position.left, top: position.top }}
    >
      <TooltipProvider delayDuration={300}>
      <ButtonGroup className="rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
        {pluginsEnabled ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'table' }} /> : null}
        <DropdownMenu>
          <TableMenuTrigger label={rowMenuLabel}>
            <Rows3 />
          </TableMenuTrigger>
          <DropdownMenuContent align="center" collisionPadding={MENU_EDGE_GAP}>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={addRowBefore} disabled={!editor.can().addRowBefore()}>
                <BetweenHorizontalStart />
                {t('addRowBefore.title')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={addRowAfter} disabled={!editor.can().addRowAfter()}>
                <BetweenHorizontalEnd />
                {t('addRowAfter.title')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <TableMenuTrigger label={columnMenuLabel}>
            <Columns3 />
          </TableMenuTrigger>
          <DropdownMenuContent align="center" collisionPadding={MENU_EDGE_GAP}>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={addColumnBefore} disabled={!editor.can().addColumnBefore()}>
                <BetweenVerticalStart />
                {t('addColumnBefore.title')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={addColumnAfter} disabled={!editor.can().addColumnAfter()}>
                <BetweenVerticalEnd />
                {t('addColumnAfter.title')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <TableMenuTrigger label={alignmentMenuLabel}>
            <TextAlignJustify />
          </TableMenuTrigger>
          <DropdownMenuContent align="center" collisionPadding={MENU_EDGE_GAP}>
            <DropdownMenuRadioGroup value={cellAlignment} onValueChange={setColumnAlignment}>
              <DropdownMenuRadioItem value="left">
                <AlignLeft />
                {t('alignLeft.title')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="center">
                <AlignCenter />
                {t('alignCenter.title')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="right">
                <AlignRight />
                {t('alignRight.title')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <TableMenuTrigger label={deleteMenuLabel} variant="destructive">
            <Trash2 />
          </TableMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={MENU_EDGE_GAP}>
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onSelect={deleteRow} disabled={!editor.can().deleteRow()}>
                <PanelTopClose />
                {t('deleteRow.title')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={deleteColumn} disabled={!editor.can().deleteColumn()}>
                <PanelLeftClose />
                {t('deleteColumn.title')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onSelect={deleteTable} disabled={!editor.can().deleteTable()}>
                <Table2 />
                {t('deleteTable.title')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      </TooltipProvider>
    </div>,
    document.body
  )
}

export default FloatingTableMenu
