'use client'

import { useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { useTranslations } from 'next-intl'
import { Type, Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { TEXT_COLORS, HIGHLIGHT_COLORS, normalizeTextColor } from './color-marks'

export function ColorMenu({ editor, highlight = false, owner }: { editor: Editor; highlight?: boolean; owner: string }) {
  const t = useTranslations('editor.bubbleMenu.colors')
  const menuLabel = useTranslations('editor.bubbleMenu')
  const mark = highlight ? 'highlight' : 'textColor'
  const colors = highlight ? HIGHLIGHT_COLORS : TEXT_COLORS
  const names = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
  const Icon = highlight ? Highlighter : Type
  const currentColor = normalizeTextColor(editor.getAttributes(mark).color)
  const indicatorColor = currentColor || (highlight ? 'hsl(var(--primary) / 0.3)' : 'currentColor')
  const selection = useRef<{ from: number; to: number; doc: Editor['state']['doc'] } | null>(null)
  const restoreFocus = useRef(false)
  const choose = (color: string) => {
    const saved = selection.current
    if (!saved || editor.isDestroyed || saved.doc !== editor.state.doc) return
    restoreFocus.current = true
    const chain = editor.chain().focus().setTextSelection({ from: saved.from, to: saved.to })
    if (color === 'clear') chain.unsetMark(mark).run()
    else chain.setMark(mark, { color: color === 'default' ? null : color }).run()
  }
  return (
    <DropdownMenu modal={false} onOpenChange={open => {
      if (!open) return
      const { from, to } = editor.state.selection
      selection.current = { from, to, doc: editor.state.doc }
      restoreFocus.current = false
    }}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={editor.isActive(mark) ? 'secondary' : 'ghost'} size="icon-sm" title={t(highlight ? 'highlight' : 'text')} aria-label={t(highlight ? 'highlight' : 'text')} className="relative">
          <Icon />
          <span aria-hidden="true" className="pointer-events-none absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full" style={{ backgroundColor: indicatorColor }} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-editor-bubble-menu-owner={owner} align="start" collisionPadding={8}
        onEscapeKeyDown={() => { restoreFocus.current = true }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (restoreFocus.current && !editor.isDestroyed) editor.view.focus()
        }}>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={currentColor || (editor.isActive(mark) ? 'default' : 'clear')}>
            <DropdownMenuRadioItem value="clear" onSelect={() => choose('clear')}>{t('clear')}</DropdownMenuRadioItem>
            {highlight && (
              <DropdownMenuRadioItem value="default" onSelect={() => choose('default')}>
                <Highlighter />{menuLabel('highlight')}
              </DropdownMenuRadioItem>
            )}
            {colors.map((color, index) => (
              <DropdownMenuRadioItem key={color} value={color} onSelect={() => choose(color)}>
                <span aria-hidden="true" className="size-4 rounded-sm border" style={{ backgroundColor: color }} />{t(names[index])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
