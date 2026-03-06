'use client'

import { Editor } from '@tiptap/react'
import { Heading1, Heading2, Heading3 } from 'lucide-react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'


interface HeadingItem {
  level: number
  text: string
  id: string
  pos: number
  nodeSize: number
}

interface OutlineProps {
  editor: Editor
  isOpen: boolean
}

export function Outline({ editor, isOpen }: OutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  // Use ref to always get latest headings in event handlers
  const headingsRef = useRef<HeadingItem[]>([])
  // Track if editor is ready - use both ref and state
  const isEditorReadyRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  // Check if editor is ready - wait for view to be available
  useEffect(() => {
    if (!editor) {
      isEditorReadyRef.current = false
      return
    }

    // Check periodically if editor view is available
    const checkEditor = () => {
      // Check if editor is destroyed
      if (!editor || (editor as any).isDestroyed) {
        isEditorReadyRef.current = false
        return
      }

      // Check if editor view is ready
      if (editor.view && editor.view.dom && editor.view.dom.isConnected) {
        // Additional check: ensure DOM is actually mounted
        try {
          // This will throw if not ready
          editor.view.dom.getBoundingClientRect()
          isEditorReadyRef.current = true
          setIsReady(true)
        } catch {
          isEditorReadyRef.current = false
          setIsReady(false)
          setTimeout(checkEditor, 50)
          return
        }
      } else {
        isEditorReadyRef.current = false
        setIsReady(false)
        setTimeout(checkEditor, 50)
      }
    }

    checkEditor()
  }, [editor])

  // Keep ref in sync with state
  useEffect(() => {
    headingsRef.current = headings
  }, [headings])

  // Extract headings from the editor with position info
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const items: HeadingItem[] = []
    let index = 0

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level
        const text = node.textContent.trim() || `Heading ${level}`
        // Use index to create stable ID that doesn't depend on position
        const id = `heading-${index}-${level}-${text.slice(0, 20)}`
        const nodeSize = node.nodeSize
        items.push({
          level,
          text,
          id,
          pos,
          nodeSize,
        })
        index++
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
      const endPos = heading.pos + heading.nodeSize
      if (cursorPos >= heading.pos && cursorPos <= endPos) {
        return heading.id
      }
      // Also check if cursor is right after the heading (at the start of next content)
      if (i === headings.length - 1 && cursorPos <= endPos) {
        return heading.id
      }
    }

    // If cursor is before the first heading, find the first heading that comes after cursor
    if (cursorPos < headings[0]?.pos) {
      for (const heading of headings) {
        if (heading.pos >= cursorPos) {
          return heading.id
        }
      }
    }

    return headings[0]?.id || null
  }, [headings])

  // Update headings when editor content changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) {
      console.log('[Outline] useEffect extractHeadings: editor not ready')
      return
    }
    try {
      setHeadings(extractHeadings())
    } catch (e) {
      console.error('[Outline] Error in extractHeadings:', e)
    }
  }, [editor, extractHeadings])

  // Find active heading based on scroll position (viewport)
  const findActiveHeadingByScroll = useCallback((): string | null => {
    // Check if editor is fully initialized - use isEditorReadyRef
    if (!isEditorReadyRef.current || headings.length === 0) return null

    // Get the editor's scrollable element
    const editorElement = editor.view.dom as HTMLElement
    const scrollTop = editorElement.scrollTop
    const viewportTop = scrollTop + 100 // Add some offset for better UX

    // Find the first heading that is above or near the viewport top
    for (const heading of headings) {
      const domNode = editor.view.nodeDOM(heading.pos) as HTMLElement | undefined
      if (domNode) {
        const rect = domNode.getBoundingClientRect()
        const editorRect = editorElement.getBoundingClientRect()
        const relativeTop = rect.top - editorRect.top + scrollTop

        if (relativeTop <= viewportTop) {
          return heading.id
        }
      }
    }

    return headings[0]?.id || null
  }, [editor, headings])

  // Update active heading when selection or scroll changes
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const updateActiveHeading = () => {
      // First try to get heading from cursor position
      const { from } = editor.state.selection
      const activeId = findActiveHeading(from)
      setActiveHeadingId(activeId)
    }

    // Handle scroll - update based on viewport position
    const handleScroll = () => {
      const scrollActiveId = findActiveHeadingByScroll()
      if (scrollActiveId) {
        setActiveHeadingId(scrollActiveId)
      }
    }

    updateActiveHeading()
    editor.on('selectionUpdate', updateActiveHeading)
    editor.on('transaction', updateActiveHeading)

    // Add scroll listener to editor element
    const editorElement = editor.view.dom as HTMLElement
    editorElement.addEventListener('scroll', handleScroll)

    return () => {
      editor.off('selectionUpdate', updateActiveHeading)
      editor.off('transaction', updateActiveHeading)
      editorElement.removeEventListener('scroll', handleScroll)
    }
  }, [editor, findActiveHeading, findActiveHeadingByScroll, headings])

  // Scroll to heading when clicked
  const scrollToHeading = useCallback((id: string) => {
    // Use ref to get latest headings to avoid stale closure
    const currentHeadings = headingsRef.current
    const heading = currentHeadings.find(h => h.id === id)
    if (heading && editor) {
      // Try to find the heading position in the current document
      let foundPos: number | null = null

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent.trim() === heading.text && node.attrs.level === heading.level) {
          foundPos = pos
          return false // stop traversal
        }
      })

      if (foundPos !== null) {
        editor.commands.setTextSelection(foundPos)
        editor.commands.scrollIntoView()
      } else {
        // Fallback to stored position
        editor.commands.setTextSelection(heading.pos)
        editor.commands.scrollIntoView()
      }
    }
  }, [editor])

  // Auto-scroll to keep active heading visible
  useEffect(() => {
    if (activeHeadingId) {
      const activeElement = document.getElementById(`outline-${activeHeadingId}`)
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [activeHeadingId])

  // 如果编辑器还没准备好或没有打开Outline，直接返回 null
  if (!isOpen || !isReady) return null

  return (
    <div className="outline-panel w-64 border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-y-auto">
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
