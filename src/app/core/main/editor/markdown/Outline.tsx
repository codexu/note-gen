'use client'

import { Editor } from '@tiptap/react'
import { List, Heading1, Heading2, Heading3 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface HeadingItem {
  level: number
  text: string
  id: string
  startPos: number
  endPos: number
}

interface OutlineProps {
  editor: Editor
  isOpen: boolean
  onClose: () => void
}

export function Outline({ editor, isOpen, onClose }: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)

  // Extract headings from the editor with position info
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const items: HeadingItem[] = []

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level
        const text = node.textContent.trim() || `Heading ${level}`
        const id = `heading-${pos}-${level}`
        const nodeSize = node.nodeSize
        items.push({
          level,
          text,
          id,
          startPos: pos,
          endPos: pos + nodeSize,
        })
      }
    })

    return items
  }, [editor])

  // Find the active heading based on cursor position
  const findActiveHeading = useCallback((cursorPos: number): string | null => {
    if (headings.length === 0) return null

    // Find the heading that contains the cursor position
    for (let i = headings.length - 1; i >= 0; i--) {
      const heading = headings[i]
      if (cursorPos >= heading.startPos && cursorPos <= heading.endPos) {
        return heading.id
      }
      // Also check if cursor is right after the heading (at the start of next content)
      if (i === headings.length - 1 && cursorPos <= heading.endPos) {
        return heading.id
      }
    }

    // If cursor is before the first heading, find the first heading that comes after cursor
    if (cursorPos < headings[0]?.startPos) {
      for (const heading of headings) {
        if (heading.startPos >= cursorPos) {
          return heading.id
        }
      }
    }

    return headings[0]?.id || null
  }, [headings])

  // Update headings when editor content changes
  useEffect(() => {
    setHeadings(extractHeadings())
  }, [editor, extractHeadings])

  // Update active heading when selection changes
  useEffect(() => {
    if (!editor) return

    const updateActiveHeading = () => {
      const { from } = editor.state.selection
      const activeId = findActiveHeading(from)
      setActiveHeadingId(activeId)
    }

    updateActiveHeading()
    editor.on('selectionUpdate', updateActiveHeading)
    editor.on('transaction', updateActiveHeading)

    return () => {
      editor.off('selectionUpdate', updateActiveHeading)
      editor.off('transaction', updateActiveHeading)
    }
  }, [editor, findActiveHeading, headings])

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((id: string) => {
    const heading = headings.find(h => h.id === id)
    if (heading) {
      // Set cursor at the start of the heading
      editor.commands.setTextSelection(heading.startPos)
      editor.commands.scrollIntoView()
    }
    onClose()
  }, [editor, headings, onClose])

  // Auto-scroll to keep active heading visible
  useEffect(() => {
    if (activeHeadingId) {
      const activeElement = document.getElementById(`outline-${activeHeadingId}`)
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [activeHeadingId])

  if (!isOpen) return null

  return (
    <div className="outline-panel w-64 border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-y-auto">
      <div className="flex items-center justify-between p-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <List size={16} />
          <span className="font-medium text-sm">大纲</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[hsl(var(--muted))]"
        >
          <List size={14} className="rotate-90" />
        </button>
      </div>

      {headings.length === 0 ? (
        <div className="p-4 text-sm text-[hsl(var(--muted-foreground))] text-center">
          暂无标题
        </div>
      ) : (
        <ul className="p-2 space-y-1">
          {headings.map((heading) => (
            <li key={heading.id}>
              <button
                id={`outline-${heading.id}`}
                onClick={() => scrollToHeading(heading.id)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[hsl(var(--muted))] flex items-center gap-2 truncate transition-colors',
                  heading.level === 1 ? 'font-semibold' : '',
                  activeHeadingId === heading.id
                    ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                    : ''
                )}
                style={{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }}
              >
                {heading.level === 1 && <Heading1 size={14} />}
                {heading.level === 2 && <Heading2 size={14} />}
                {heading.level === 3 && <Heading3 size={14} />}
                <span className="truncate">{heading.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Outline
