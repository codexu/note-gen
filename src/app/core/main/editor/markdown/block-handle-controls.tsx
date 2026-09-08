'use client'

import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  CodeXml,
  Copy,
  Eraser,
  GripVertical,
  Pilcrow,
  Plus,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type EditorBlockConversionType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'

const EDITOR_BLOCK_CONVERSION_TYPES = new Set<EditorBlockConversionType>([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bulletList',
  'orderedList',
  'taskList',
])

function isEditorBlockConversionType(value: string): value is EditorBlockConversionType {
  return EDITOR_BLOCK_CONVERSION_TYPES.has(value as EditorBlockConversionType)
}

interface BlockHandleControlsProps {
  editor: Editor
  getActiveType: () => EditorBlockConversionType | null
  canConvert: () => boolean
  canMoveUp: () => boolean
  canMoveDown: () => boolean
  onAddBelow: (anchor: DOMRect) => void
  onCopyContent: () => void
  onCopyMarkdown: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onClearFormatting: () => void
  onDelete: () => void
  onConvert: (type: EditorBlockConversionType) => void
  onMenuOpenChange: (open: boolean) => void
}

export function BlockHandleControls({
  editor,
  getActiveType,
  canConvert,
  canMoveUp,
  canMoveDown,
  onAddBelow,
  onCopyContent,
  onCopyMarkdown,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onClearFormatting,
  onDelete,
  onConvert,
  onMenuOpenChange,
}: BlockHandleControlsProps) {
  const t = useTranslations('editor')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const onMenuOpenChangeRef = useRef(onMenuOpenChange)
  const focusEditorOnCloseRef = useRef(false)
  const activeType = getActiveType() ?? undefined
  const conversionDisabled = !canConvert()
  onMenuOpenChangeRef.current = onMenuOpenChange

  useEffect(() => () => {
    if (openRef.current) {
      onMenuOpenChangeRef.current(false)
    }
  }, [])

  const updateOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      focusEditorOnCloseRef.current = false
    }
    openRef.current = nextOpen
    setOpen(nextOpen)
    onMenuOpenChange(nextOpen)
  }

  const runMenuAction = (action: () => void) => {
    focusEditorOnCloseRef.current = true
    action()
  }

  const handleGripClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const completedDrag = event.currentTarget.dataset.editorBlockDragFinished === 'true'
    delete event.currentTarget.dataset.editorBlockDragFinished

    if (!completedDrag) {
      updateOpen(!open)
    }
  }

  const handleConvert = (value: string) => {
    if (isEditorBlockConversionType(value)) {
      focusEditorOnCloseRef.current = true
      onConvert(value)
    }
  }

  return (
    <ButtonGroup aria-label={t('blockHandle.controls')}>
      <DropdownMenu open={open} onOpenChange={updateOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            draggable={false}
            data-editor-block-drag-trigger
            aria-label={t('blockHandle.dragOrOpen')}
            title={t('blockHandle.dragOrOpen')}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onDragStart={(event) => event.preventDefault()}
            onClick={handleGripClick}
          >
            <GripVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className="w-44"
          onCloseAutoFocus={(event) => {
            if (focusEditorOnCloseRef.current) {
              event.preventDefault()
              focusEditorOnCloseRef.current = false
              if (!editor.isDestroyed) {
                editor.view.focus()
              }
            }
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => runMenuAction(onCopyContent)}>
              <ClipboardCopy />
              {t('blockHandle.copyContent')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runMenuAction(onCopyMarkdown)}>
              <CodeXml />
              {t('blockHandle.copyMarkdown')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runMenuAction(onDuplicate)}>
              <Copy />
              {t('blockHandle.duplicate')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!canMoveUp()} onSelect={() => runMenuAction(onMoveUp)}>
              <ArrowUp />
              {t('blockHandle.moveUp')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown()} onSelect={() => runMenuAction(onMoveDown)}>
              <ArrowDown />
              {t('blockHandle.moveDown')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={conversionDisabled}
                className="data-disabled:pointer-events-none data-disabled:opacity-50"
              >
                <Pilcrow />
                {t('blockHandle.turnInto')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent collisionPadding={8} className="min-w-40">
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup value={activeType} onValueChange={handleConvert}>
                    <DropdownMenuRadioItem value="paragraph">
                      {t('blockHandle.paragraph')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading1">
                      {t('slashCommand.items.heading1')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading2">
                      {t('slashCommand.items.heading2')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading3">
                      {t('slashCommand.items.heading3')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading4">
                      {t('slashCommand.items.heading4')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading5">
                      {t('slashCommand.items.heading5')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="heading6">
                      {t('slashCommand.items.heading6')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={activeType} onValueChange={handleConvert}>
                    <DropdownMenuRadioItem value="bulletList">
                      {t('slashCommand.items.bulletList')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="orderedList">
                      {t('slashCommand.items.orderedList')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="taskList">
                      {t('slashCommand.items.taskList')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={conversionDisabled} onSelect={() => runMenuAction(onClearFormatting)}>
              <Eraser />
              {t('blockHandle.clearFormatting')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => runMenuAction(onDelete)}>
              <Trash2 />
              {tCommon('delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        draggable={false}
        data-editor-block-add
        aria-label={t('blockHandle.addBelow')}
        title={t('blockHandle.addBelow')}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => onAddBelow(event.currentTarget.getBoundingClientRect())}
      >
        <Plus />
      </Button>
    </ButtonGroup>
  )
}
