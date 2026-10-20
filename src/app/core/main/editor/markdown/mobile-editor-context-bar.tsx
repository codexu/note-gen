'use client'

import type { MouseEvent, PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { buildMobileEditorContextBarViewModel } from './mobile-editor-context-bar-view-model'

type MobileContextMode = 'text' | 'image' | 'table'

type MobileContextAction =
  | 'undo'
  | 'redo'
  | 'ai'
  | 'bold'
  | 'highlight'
  | 'more'
  | 'image-src'
  | 'image-alt'
  | 'delete-image'
  | 'add-row'
  | 'add-column'
  | 'align'

interface MobileEditorContextBarProps {
  mode: MobileContextMode
  previewText?: string
  activeActions?: string[]
  onAction: (action: MobileContextAction) => void
}

export function MobileEditorContextBar({
  mode,
  previewText,
  activeActions = [],
  onAction,
}: MobileEditorContextBarProps) {
  void mode
  void previewText
  const viewModel = buildMobileEditorContextBarViewModel(activeActions)
  const preventFocusSteal = (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
  }

  return (
    <div className="mobile-editor-context-bar border-b border-border bg-background/95 px-2 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className={cn('flex gap-1 overflow-x-auto', viewModel.hideScrollbar && 'scrollbar-hide')}>
        {viewModel.items.map((item) => {
          const typedAction = item.action as MobileContextAction
          const Icon = item.icon

          return (
            <Button
              key={typedAction}
              type="button"
              aria-label={item.label}
              title={item.label}
              variant={viewModel.buttonVariant}
              size={viewModel.buttonSize}
              className={cn(
                'size-9 min-h-9 min-w-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                typedAction === 'delete-image' && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
              )}
              onPointerDown={preventFocusSteal}
              onMouseDown={preventFocusSteal}
              onClick={() => onAction(typedAction)}
            >
              <Icon className="size-4" />
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default MobileEditorContextBar
