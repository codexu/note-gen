'use client'

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { type Range } from '@tiptap/core'
import { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { SendHorizontal } from 'lucide-react'
import { SlashMenu, SlashMenuRef } from './slash-menu'
import type { SlashCommandItem } from './suggestion'
import { setMenuKeyDownHandler } from './index'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface MenuState {
  visible: boolean
  editor: Editor | null
  range: Range | null
  clientRect: DOMRect | null
  query: string
  onSelectItem?: (item: SlashCommandItem) => void
}

interface CustomPromptState {
  visible: boolean
  position: { top: number; left: number } | null
  value: string
}

// Menu dimensions
const MENU_MAX_HEIGHT = 288 // max-h-72 = 288px
const MENU_WIDTH = 416 // 26rem = 416px
const MARGIN = 8

function calculateMenuPosition(clientRect: DOMRect): { top: number; left: number } {
  // Default position: below the cursor
  let top = clientRect.bottom + MARGIN
  let left = clientRect.left

  // Get viewport dimensions
  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth
  const menuWidth = Math.min(MENU_WIDTH, viewportWidth - MARGIN * 2)

  // Check if menu would overflow bottom of screen
  const availableHeightBelow = viewportHeight - clientRect.bottom - MARGIN
  const availableHeightAbove = clientRect.top - MARGIN

  if (availableHeightBelow < MENU_MAX_HEIGHT && availableHeightAbove > availableHeightBelow) {
    // Show above the cursor instead
    top = clientRect.top - MENU_MAX_HEIGHT - MARGIN
  }

  // Ensure top is not negative
  top = Math.max(MARGIN, top)

  // Ensure left doesn't overflow right edge
  if (left + menuWidth > viewportWidth - MARGIN) {
    left = viewportWidth - menuWidth - MARGIN
  }

  // Ensure left is not negative
  left = Math.max(MARGIN, left)

  return { top, left }
}

export const SlashCommandPortal = () => {
  const t = useTranslations('editor.slashCommand.customPrompt')
  const [state, setState] = useState<MenuState>({
    visible: false,
    editor: null,
    range: null,
    clientRect: null,
    query: '',
  })
  const [customPrompt, setCustomPrompt] = useState<CustomPromptState>({
    visible: false,
    position: null,
    value: '',
  })
  const menuRef = useRef<SlashMenuRef>(null)
  const menuContainerRef = useRef<HTMLDivElement>(null)
  const customPromptRef = useRef<HTMLFormElement>(null)
  const customPromptInputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const hideMenu = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }))
    setPosition(null)
  }, [])

  const hideCustomPrompt = useCallback(() => {
    setCustomPrompt({
      visible: false,
      position: null,
      value: '',
    })
  }, [])

  useEffect(() => {
    const showHandler = (e: Event) => {
      const event = e as CustomEvent<{
        editor: Editor
        range: Range
        clientRect: DOMRect
        query: string
        onSelectItem?: (item: SlashCommandItem) => void
      }>
      const newPosition = calculateMenuPosition(event.detail.clientRect)
      setPosition(newPosition)
      setState({
        visible: true,
        editor: event.detail.editor,
        range: event.detail.range,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
        onSelectItem: event.detail.onSelectItem,
      })
    }

    const updateHandler = (e: Event) => {
      const event = e as CustomEvent<{
        editor: Editor
        range: Range
        clientRect: DOMRect
        query: string
      }>
      setPosition(calculateMenuPosition(event.detail.clientRect))
      setState((prev) => ({
        ...prev,
        editor: event.detail.editor,
        range: event.detail.range,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
        onSelectItem: undefined,
      }))
    }

    const hideHandler = () => {
      hideMenu()
    }

    const showCustomPromptHandler = (e: Event) => {
      const event = e as CustomEvent<{
        clientRect: DOMRect
      }>
      setCustomPrompt({
        visible: true,
        position: calculateMenuPosition(event.detail.clientRect),
        value: '',
      })
      hideMenu()
    }

    document.addEventListener('slash-command-show', showHandler)
    document.addEventListener('slash-command-update', updateHandler)
    document.addEventListener('slash-command-hide', hideHandler)
    document.addEventListener('tiptap-ai-custom-instruction-open', showCustomPromptHandler)

    return () => {
      document.removeEventListener('slash-command-show', showHandler)
      document.removeEventListener('slash-command-update', updateHandler)
      document.removeEventListener('slash-command-hide', hideHandler)
      document.removeEventListener('tiptap-ai-custom-instruction-open', showCustomPromptHandler)
    }
  }, [hideMenu])

  useEffect(() => {
    if (!customPrompt.visible) {
      return
    }

    const animationFrame = requestAnimationFrame(() => {
      customPromptInputRef.current?.focus()
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [customPrompt.visible])

  useEffect(() => {
    if (!customPrompt.visible) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (customPromptRef.current?.contains(event.target as Node)) {
        return
      }
      hideCustomPrompt()
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [customPrompt.visible, hideCustomPrompt])

  // Register keyDown handler when menu becomes visible
  useEffect(() => {
    if (state.visible && menuRef.current) {
      const handler = (props: { event: KeyboardEvent }) => {
        return menuRef.current?.onKeyDown?.(props) ?? false
      }
      setMenuKeyDownHandler(handler)

      return () => {
        setMenuKeyDownHandler(null)
      }
    }
  }, [state.visible])

  useEffect(() => {
    if (!state.visible || !state.onSelectItem) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        hideMenu()
        return
      }

      if (menuRef.current?.onKeyDown({ event })) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuContainerRef.current?.contains(event.target as Node)) {
        hideMenu()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [hideMenu, state.onSelectItem, state.visible])

  const handleCustomPromptSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const instruction = customPrompt.value.trim()
    if (!instruction) {
      return
    }

    document.dispatchEvent(new CustomEvent('tiptap-ai-generate', {
      detail: {
        action: 'custom',
        instruction,
      },
    }))
    hideCustomPrompt()
  }, [customPrompt.value, hideCustomPrompt])

  const handleCustomPromptKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      hideCustomPrompt()
    }
  }, [hideCustomPrompt])

  const slashMenuContext = state.visible && state.editor && state.range && state.clientRect && position
    ? {
        editor: state.editor,
        range: state.range,
        clientRect: state.clientRect,
        position,
      }
    : null
  const customPromptPosition = customPrompt.visible ? customPrompt.position : null

  if (!slashMenuContext && !customPromptPosition) return null

  return (
    <>
      {slashMenuContext && (
        <div
          ref={menuContainerRef}
          style={{
            position: 'fixed',
            top: slashMenuContext.position.top,
            left: slashMenuContext.position.left,
            zIndex: 9999,
          }}
        >
          <SlashMenu
            ref={menuRef}
            editor={slashMenuContext.editor}
            range={slashMenuContext.range}
            clientRect={slashMenuContext.clientRect}
            query={state.query}
            onSelectItem={state.onSelectItem
              ? (item) => {
                  state.onSelectItem?.(item)
                  hideMenu()
                }
              : undefined}
          />
        </div>
      )}
      {customPromptPosition && (
        <div
          style={{
            position: 'fixed',
            top: customPromptPosition.top,
            left: customPromptPosition.left,
            zIndex: 9999,
          }}
        >
          <form
            ref={customPromptRef}
            className="flex w-[min(26rem,calc(100vw-1rem))] items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60"
            onSubmit={handleCustomPromptSubmit}
          >
            <Input
              ref={customPromptInputRef}
              aria-label={t('ariaLabel')}
              className="h-8"
              placeholder={t('placeholder')}
              value={customPrompt.value}
              onChange={(event) => setCustomPrompt((prev) => ({ ...prev, value: event.target.value }))}
              onKeyDown={handleCustomPromptKeyDown}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!customPrompt.value.trim()}
            >
              <SendHorizontal data-icon="inline-start" />
              {t('submit')}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

SlashCommandPortal.displayName = 'SlashCommandPortal'

export default SlashCommandPortal
