'use client'

import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Highlighter,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Sparkles,
  MessageCircle,
  Minimize2,
  Maximize2
} from 'lucide-react'
import { useCallback, useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface BubbleMenuProps {
  editor: Editor
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onQuoteToChat?: () => void
}

export function BubbleMenu({
  editor,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onQuoteToChat
}: BubbleMenuProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate menu position
  const updatePosition = useCallback(() => {
    const { selection } = editor.state
    const { from, to } = selection

    if (from === to) {
      setShow(false)
      return
    }

    // Get the coordinates of the selection
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

  const setLink = useCallback(() => {
    if (showLinkInput) {
      if (linkUrl === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      }
      setShowLinkInput(false)
      setLinkUrl('')
    } else {
      const previousUrl = editor.getAttributes('link').href
      setLinkUrl(previousUrl || '')
      setShowLinkInput(true)
    }
  }, [editor, linkUrl, showLinkInput])

  const toggleHeading = (level: 1 | 2 | 3) => {
    editor.chain().focus().toggleHeading({ level }).run()
  }

  const toggleBold = () => editor.chain().focus().toggleBold().run()
  const toggleItalic = () => editor.chain().focus().toggleItalic().run()
  const toggleStrike = () => editor.chain().focus().toggleStrike().run()
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run()
  const toggleCode = () => editor.chain().focus().toggleCode().run()
  const toggleHighlight = () => editor.chain().focus().toggleHighlight().run()
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run()
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run()
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run()
  const toggleTaskList = () => editor.chain().focus().toggleTaskList().run()
  const toggleCodeBlock = () => editor.chain().focus().toggleCodeBlock().run()

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs)

  if (!show) return null

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

      {/* 基础格式化工具栏 */}
      <div className="flex items-center gap-0.5 px-1 py-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border border-border rounded-lg shadow-lg">
        {/* 标题 */}
        <div className="relative group">
          <button
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors',
              isActive('heading', { level: 1 }) && 'bg-muted text-primary'
            )}
            onClick={() => toggleHeading(1)}
            title="标题1"
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors',
              isActive('heading', { level: 2 }) && 'bg-muted text-primary'
            )}
            onClick={() => toggleHeading(2)}
            title="标题2"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors',
              isActive('heading', { level: 3 }) && 'bg-muted text-primary'
            )}
            onClick={() => toggleHeading(3)}
            title="标题3"
          >
            <Heading3 className="w-4 h-4" />
          </button>
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 文本格式化 */}
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('bold') && 'bg-muted text-primary'
          )}
          onClick={toggleBold}
          title="粗体"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('italic') && 'bg-muted text-primary'
          )}
          onClick={toggleItalic}
          title="斜体"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('strike') && 'bg-muted text-primary'
          )}
          onClick={toggleStrike}
          title="删除线"
        >
          <Strikethrough className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('underline') && 'bg-muted text-primary'
          )}
          onClick={toggleUnderline}
          title="下划线"
        >
          <Underline className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('code') && 'bg-muted text-primary'
          )}
          onClick={toggleCode}
          title="行内代码"
        >
          <Code className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('highlight') && 'bg-muted text-primary'
          )}
          onClick={toggleHighlight}
          title="高亮"
        >
          <Highlighter className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 链接 */}
        <div className="relative">
          {showLinkInput ? (
            <div className="flex items-center gap-1 px-1">
              <input
                type="url"
                placeholder="输入链接地址"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setLink()
                  } else if (e.key === 'Escape') {
                    setShowLinkInput(false)
                    setLinkUrl('')
                  }
                }}
                className="w-32 px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <button
                className="p-1 rounded hover:bg-muted text-xs"
                onClick={setLink}
              >
                确认
              </button>
              <button
                className="p-1 rounded hover:bg-muted text-xs"
                onClick={() => {
                  setShowLinkInput(false)
                  setLinkUrl('')
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              className={cn(
                'p-1.5 rounded hover:bg-muted transition-colors',
                isActive('link') && 'bg-muted text-primary'
              )}
              onClick={setLink}
              title="链接"
            >
              <Link className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 块级元素 */}
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('blockquote') && 'bg-muted text-primary'
          )}
          onClick={toggleBlockquote}
          title="引用"
        >
          <Quote className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('bulletList') && 'bg-muted text-primary'
          )}
          onClick={toggleBulletList}
          title="无序列表"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('orderedList') && 'bg-muted text-primary'
          )}
          onClick={toggleOrderedList}
          title="有序列表"
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('taskList') && 'bg-muted text-primary'
          )}
          onClick={toggleTaskList}
          title="任务列表"
        >
          <CheckSquare className="w-4 h-4" />
        </button>
        <button
          className={cn(
            'p-1.5 rounded hover:bg-muted transition-colors',
            isActive('codeBlock') && 'bg-muted text-primary'
          )}
          onClick={toggleCodeBlock}
          title="代码块"
        >
          <Code className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* AI 操作 */}
        <div className="relative">
          <button
            className={cn(
              'p-1.5 rounded hover:bg-muted transition-colors text-primary',
              showAISubmenu && 'bg-muted'
            )}
            onClick={() => setShowAISubmenu(!showAISubmenu)}
            title="AI 操作"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {showAISubmenu && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-32 z-50">
              <button
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                onClick={() => {
                  setShowAISubmenu(false)
                  onAIPolish?.()
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>润色</span>
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                onClick={() => {
                  setShowAISubmenu(false)
                  onAIConcise?.()
                }}
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>精简</span>
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                onClick={() => {
                  setShowAISubmenu(false)
                  onAIExpand?.()
                }}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>扩展</span>
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                onClick={() => {
                  setShowAISubmenu(false)
                  onQuoteToChat?.()
                }}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>引用到聊天</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BubbleMenu
