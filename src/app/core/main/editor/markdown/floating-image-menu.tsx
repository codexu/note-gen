'use client'

import { Editor } from '@tiptap/react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface FloatingImageMenuProps {
  editor: Editor
}

export function FloatingImageMenu({ editor }: FloatingImageMenuProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate menu position based on image selection
  const updatePosition = useCallback(() => {
    const { from } = editor.state.selection

    // Check if we're selecting an image
    const isImageSelected = editor.isActive('image')

    if (!isImageSelected) {
      setShow(false)
      return
    }

    // Get the image node and its position
    let imagePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && isImageSelected) {
        imagePos = pos
        return false
      }
    })

    if (imagePos < 0) {
      setShow(false)
      return
    }

    // Get the coordinates
    const coords = editor.view.coordsAtPos(from)

    setPosition({
      top: coords.top - 10,
      left: coords.left + (coords.right - coords.left) / 2
    })

    setShow(true)
  }, [editor])

  // Update position on selection change
  useEffect(() => {
    const updateHandler = () => updatePosition()

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updateHandler)

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updateHandler)
    }
  }, [editor, updatePosition])

  // Hide menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShow(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isImageSelected = editor.isActive('image')

  const setImageAlign = useCallback((align: 'left' | 'center' | 'right') => {
    const { from, to } = editor.state.selection
    if (from === to) return

    // Remove existing float/display styles and add new alignment
    editor.chain().focus().updateAttributes('image', {
      style: `display: block; float: ${align}; margin: ${align === 'center' ? '0 auto' : '0 1rem'}; max-width: 100%;`
    }).run()
  }, [editor])

  const deleteImage = useCallback(() => {
    editor.chain().focus().deleteSelection().run()
    setShow(false)
  }, [editor])

  const resizeImage = useCallback((delta: number) => {
    const { from, to } = editor.state.selection
    if (from === to) return

    // Get current width
    const attrs = editor.getAttributes('image')
    let currentWidth = 100 // default percentage
    if (attrs.style) {
      const match = attrs.style.match(/max-width:\s*(\d+)%/)
      if (match) {
        currentWidth = parseInt(match[1])
      }
    }

    const newWidth = Math.max(20, Math.min(100, currentWidth + delta))
    editor.chain().focus().updateAttributes('image', {
      style: `max-width: ${newWidth}%`
    }).run()
  }, [editor])

  const setFullWidth = useCallback(() => {
    editor.chain().focus().updateAttributes('image', {
      style: 'max-width: 100%'
    }).run()
  }, [editor])

  if (!show || !isImageSelected) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -100%)'
      }}
    >
      {/* Arrow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full">
        <div className="w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-border" />
      </div>

      {/* Image toolbar */}
      <div className="flex items-center gap-0.5 px-1 py-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border rounded-lg shadow-lg">
        {/* Resize controls */}
        <button
          onClick={() => resizeImage(-10)}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => resizeImage(10)}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={setFullWidth}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="100% 宽度"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Alignment */}
        <button
          onClick={() => setImageAlign('left')}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="左对齐"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => setImageAlign('center')}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="居中对齐"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          onClick={() => setImageAlign('right')}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="右对齐"
        >
          <AlignRight className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Delete */}
        <button
          onClick={deleteImage}
          className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
          title="删除图片"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export default FloatingImageMenu
