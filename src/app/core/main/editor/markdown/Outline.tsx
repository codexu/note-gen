'use client'

import { Editor } from '@tiptap/react'
import { List, Heading1, Heading2, Heading3 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

interface HeadingItem {
  level: number
  text: string
  id: string
}

interface OutlineProps {
  editor: Editor
  isOpen: boolean
  onClose: () => void
}

export function Outline({ editor, isOpen, onClose }: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])

  // Extract headings from the editor
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const items: HeadingItem[] = []

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level
        const text = node.textContent.trim() || `Heading ${level}`
        const id = `heading-${pos}-${level}`
        items.push({ level, text, id })
      }
    })

    return items
  }, [editor])

  // Update headings when editor content changes
  useEffect(() => {
    setHeadings(extractHeadings())
  }, [editor, extractHeadings])

  // Scroll to heading when clicked
  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // If element doesn't exist, try to find by position
      const heading = headings.find(h => h.id === id)
      if (heading) {
        // Find the heading position in the document
        let foundPos = -1
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'heading' && `heading-${pos}-${node.attrs.level}` === id) {
            foundPos = pos
            return false
          }
        })

        if (foundPos >= 0) {
          editor.commands.setTextSelection(foundPos)
          editor.commands.scrollIntoView()
        }
      }
    }
    onClose()
  }

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
                onClick={() => scrollToHeading(heading.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[hsl(var(--muted))] flex items-center gap-2 truncate
                  ${heading.level === 1 ? 'font-semibold' : ''}
                  ${heading.level === 2 ? 'pl-4' : ''}
                  ${heading.level === 3 ? 'pl-6 text-xs' : ''}
                `}
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
