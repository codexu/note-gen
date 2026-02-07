'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Editor } from '@tiptap/react'
import { SlashMenu, SlashMenuRef } from './slash-menu'
import { setMenuKeyDownHandler } from './index'

interface MenuState {
  visible: boolean
  editor: Editor | null
  clientRect: DOMRect | null
  query: string
}

// Menu dimensions
const MENU_MAX_HEIGHT = 256 // max-h-64 = 256px
const MENU_MIN_WIDTH = 144 // min-w-36 = 144px
const MARGIN = 8

function calculateMenuPosition(clientRect: DOMRect): { top: number; left: number } {
  // Default position: below the cursor
  let top = clientRect.bottom + MARGIN
  let left = clientRect.left

  // Get viewport dimensions
  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth

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
  if (left + MENU_MIN_WIDTH > viewportWidth - MARGIN) {
    left = viewportWidth - MENU_MIN_WIDTH - MARGIN
  }

  // Ensure left is not negative
  left = Math.max(MARGIN, left)

  return { top, left }
}

export const SlashCommandPortal = () => {
  const [state, setState] = useState<MenuState>({
    visible: false,
    editor: null,
    clientRect: null,
    query: '',
  })
  const menuRef = useRef<SlashMenuRef>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const hideMenu = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }))
    setPosition(null)
  }, [])

  useEffect(() => {
    const showHandler = (e: Event) => {
      const event = e as CustomEvent<{
        editor: Editor
        clientRect: DOMRect
        query: string
      }>
      const newPosition = calculateMenuPosition(event.detail.clientRect)
      setPosition(newPosition)
      setState({
        visible: true,
        editor: event.detail.editor,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
      })
    }

    const updateHandler = (e: Event) => {
      const event = e as CustomEvent<{
        clientRect: DOMRect
        query: string
      }>
      setPosition(calculateMenuPosition(event.detail.clientRect))
      setState((prev) => ({
        ...prev,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
      }))
    }

    const hideHandler = () => {
      hideMenu()
    }

    document.addEventListener('slash-command-show', showHandler)
    document.addEventListener('slash-command-update', updateHandler)
    document.addEventListener('slash-command-hide', hideHandler)

    return () => {
      document.removeEventListener('slash-command-show', showHandler)
      document.removeEventListener('slash-command-update', updateHandler)
      document.removeEventListener('slash-command-hide', hideHandler)
    }
  }, [hideMenu])

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

  if (!state.visible || !state.editor || !state.clientRect || !position) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
    >
      <SlashMenu
        ref={menuRef}
        editor={state.editor}
        clientRect={state.clientRect}
        query={state.query}
      />
    </div>
  )
}

SlashCommandPortal.displayName = 'SlashCommandPortal'

export default SlashCommandPortal
