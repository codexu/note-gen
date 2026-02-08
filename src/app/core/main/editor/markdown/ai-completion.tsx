'use client'

import { Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, X, ChevronRight } from 'lucide-react'

interface AICompletionProps {
  editor: Editor
  isEnabled: boolean
  onComplete: (prompt: string) => Promise<string>
}

interface SuggestionItem {
  text: string
  icon?: React.ReactNode
}

// Used by ReactRenderer - keep for Tippy.js integration
export function AICompletionPopup({ items, onSelect, onDismiss }: {
  items: SuggestionItem[]
  onSelect: (item: SuggestionItem) => void
  onDismiss: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }, [items, selectedIndex, onSelect, onDismiss])

  useEffect(() => {
    listRef.current?.focus()
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (items.length === 0) return null

  return (
    <div
      ref={listRef}
      className="ai-completion-dropdown min-w-[280px] bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden"
      tabIndex={-1}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
        <Sparkles size={14} className="text-[hsl(var(--primary))]" />
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">AI 建议</span>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => onSelect(item)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[hsl(var(--muted))] transition-colors
              ${index === selectedIndex ? 'bg-[hsl(var(--muted))]' : ''}
            `}
          >
            {item.icon || <ChevronRight size={14} />}
            <span className="flex-1 truncate">{item.text}</span>
            {index === selectedIndex && (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">↵</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 bg-[hsl(var(--muted))] border-t border-[hsl(var(--border))]">
        <span className="text-xs text-[hsl(var(--muted-foreground))]">↑↓ 选择</span>
        <button onClick={onDismiss} className="text-xs hover:text-[hsl(var(--foreground))]">
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

export function useAIAutocomplete({ editor, isEnabled, onComplete }: AICompletionProps) {
  const popupRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_suggestions, setSuggestions] = useState<SuggestionItem[]>([])

  const showPopup = useCallback((items: SuggestionItem[], clientRect: DOMRect) => {
    if (popupRef.current) {
      popupRef.current.destroy()
    }

    const popup = document.createElement('div')
    document.body.appendChild(popup)

    // ReactRenderer references the component by name for Tippy.js integration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reactRenderer: any = new ReactRenderer(AICompletionPopup, {
      props: {
        items,
        onSelect: (item: SuggestionItem) => {
          insertCompletion(item.text)
          hidePopup()
        },
        onDismiss: hidePopup,
      },
      editor: editor,
    })

    popupRef.current = tippy('body', {
      getReferenceClientRect: () => clientRect,
      appendTo: () => document.body,
      content: popup,
      showOnCreate: true,
      interactive: true,
      trigger: 'manual',
      placement: 'bottom-start',
    })

    // Mount React component
    ;(reactRenderer as any).mount?.(popup)
  }, [editor])

  const hidePopup = useCallback(() => {
    if (popupRef.current) {
      popupRef.current.destroy()
      popupRef.current = null
    }
    setSuggestions([])
  }, [])

  const insertCompletion = useCallback((text: string) => {
    editor.commands.insertContent(text, { contentType: 'markdown' })
  }, [editor])

  // Trigger AI completion manually (e.g., via keyboard shortcut)
  const triggerCompletion = useCallback(async () => {
    if (!isEnabled) return

    const { from } = editor.state.selection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBefore = (editor.state.doc as any).textBefore(from, 50)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineBefore = (editor.state.doc as any).textAfter(from, '\n')

    // Show loading state
    const rect = editor.view.coordsAtPos(from) as DOMRect
    showPopup([
      { text: '正在思考...', icon: <Sparkles size={14} className="animate-pulse" /> }
    ], rect)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await onComplete((textBefore || '') + (lineBefore || ''))

      // Parse suggestions from result
      const suggestions = result
        .split('\n')
        .filter(line => line.trim())
        .map(line => ({ text: line.trim().replace(/^[-*•]\s*/, '') }))

      if (suggestions.length > 0) {
        const rect = editor.view.coordsAtPos(from) as DOMRect
        showPopup(suggestions, rect)
      } else {
        // Insert result directly if no suggestions
        insertCompletion(result)
        hidePopup()
      }
    } catch (error) {
      console.error('AI completion error:', error)
      hidePopup()
    }
  }, [editor, isEnabled, onComplete, showPopup, insertCompletion, hidePopup])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      hidePopup()
    }
  }, [hidePopup])

  return {
    triggerCompletion,
    hidePopup,
  }
}
