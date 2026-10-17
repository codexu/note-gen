'use client'

import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { type Range } from '@tiptap/core'
import { Editor } from '@tiptap/react'
import { exitSuggestion } from '@tiptap/suggestion'
import { useTranslations } from 'next-intl'
import { SendHorizontal } from 'lucide-react'
import { SlashMenu, SlashMenuRef } from './slash-menu'
import type { SlashCommandItem } from './suggestion'
import { registerMenuKeyDownHandler } from './suggestion'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface MenuState {
  session: number
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

export const SlashCommandPortal = ({ editor }: { editor: Editor }) => {
  const t = useTranslations('editor.slashCommand.customPrompt')
  const [state, setState] = useState<MenuState>({
    session: 0,
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
  const menuSessionRef = useRef(0)
  const menuContainerRef = useRef<HTMLDivElement>(null)
  const customPromptRef = useRef<HTMLFormElement>(null)
  const customPromptInputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const hideMenu = useCallback(() => {
    menuSessionRef.current += 1
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

  useLayoutEffect(() => {
    hideMenu()
    hideCustomPrompt()
    const closeOwnedMenus = () => { hideMenu(); hideCustomPrompt() }
    editor.on('destroy', closeOwnedMenus)
    editor.on('unmount', closeOwnedMenus)
    return () => {
      menuSessionRef.current += 1
      editor.off('destroy', closeOwnedMenus)
      editor.off('unmount', closeOwnedMenus)
    }
  }, [editor, hideCustomPrompt, hideMenu])

  useLayoutEffect(() => {
    const showHandler = (e: Event) => {
      const event = e as CustomEvent<{
        editor: Editor
        range: Range
        clientRect: DOMRect
        query: string
        onSelectItem?: (item: SlashCommandItem) => void
      }>
      if (event.detail.editor !== editor || editor.isDestroyed) return
      menuSessionRef.current += 1
      const newPosition = calculateMenuPosition(event.detail.clientRect)
      setPosition(newPosition)
      setState({
        session: menuSessionRef.current,
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
      if (event.detail.editor !== editor || editor.isDestroyed) return
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

    const hideHandler = (event: Event) => {
      const owner = (event as CustomEvent<{ editor?: Editor }>).detail?.editor
      if (owner && owner !== editor) return
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
  }, [editor, hideMenu])

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
  useLayoutEffect(() => {
    if (state.visible && state.editor === editor && !editor.isDestroyed && menuRef.current) {
      const session = menuSessionRef.current
      const handler = (props: { event: KeyboardEvent }) => {
        if (session !== menuSessionRef.current || props.event.isComposing || editor.isDestroyed) return false
        return menuRef.current?.onKeyDown?.(props) ?? false
      }
      return registerMenuKeyDownHandler(editor.view, handler)
    }
  }, [editor, state.editor, state.session, state.visible])

  useLayoutEffect(() => {
    if (!state.visible || state.editor !== editor || editor.isDestroyed) {
      return
    }

    const session = menuSessionRef.current
    const handleKeyDown = (event: KeyboardEvent) => {
      if (session !== menuSessionRef.current || event.defaultPrevented || event.isComposing || editor.isDestroyed) return
      // Typing in the editor goes through Suggestion's handler. Only intercept
      // here for the block-insert menu or when focus is inside the menu itself.
      if (!state.onSelectItem && (!(event.target instanceof Node) || !menuContainerRef.current?.contains(event.target))) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!state.onSelectItem) exitSuggestion(editor.view)
        hideMenu()
        return
      }

      if (menuRef.current?.onKeyDown({ event })) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (session !== menuSessionRef.current || editor.isDestroyed) return
      if (!menuContainerRef.current?.contains(event.target as Node)) {
        if (!state.onSelectItem) exitSuggestion(editor.view)
        hideMenu()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [editor, hideMenu, state.editor, state.onSelectItem, state.session, state.visible])

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

  const slashMenuContext = state.visible && state.editor === editor && !editor.isDestroyed && state.editor && state.range && state.clientRect && position
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
            key={state.session}
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
