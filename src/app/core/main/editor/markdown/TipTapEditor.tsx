'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace'
import { useEffect, useRef, useCallback } from 'react'
import { BubbleMenu as BubbleMenuComponent } from './BubbleMenu'
import { MarkdownInputRules } from './markdown-input-rules'
import './style.css'

const lowlight = createLowlight(common)

interface TipTapEditorProps {
  content: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onQuoteToChat?: () => void
}

export function TipTapEditor({
  content,
  onChange,
  placeholder = '开始写作...',
  editable = true,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onQuoteToChat,
}: TipTapEditorProps) {
  const lastContentRef = useRef(content)

  // Memoize callbacks before the editor check to avoid hooks rule violations
  const handleAIPolish = useCallback(() => {
    onAIPolish?.()
  }, [onAIPolish])

  const handleAIConcise = useCallback(() => {
    onAIConcise?.()
  }, [onAIConcise])

  const handleAIExpand = useCallback(() => {
    onAIExpand?.()
  }, [onAIExpand])

  const handleQuoteToChat = useCallback(() => {
    onQuoteToChat?.()
  }, [onQuoteToChat])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false,
        // Exclude duplicate extensions that we're adding separately
        link: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      CharacterCount,
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Typography,
      SearchAndReplace,
      // Markdown input rules
      MarkdownInputRules,
      // Markdown extension for import/export
      Markdown,
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      onChange?.(markdown)
    },
  })

  // Update content when prop changes (only if different from last known)
  useEffect(() => {
    if (editor && content !== lastContentRef.current) {
      const currentEditorContent = editor.getMarkdown()
      if (content !== currentEditorContent) {
        editor.commands.setContent(content, { contentType: 'markdown' })
      }
      lastContentRef.current = content
    }
  }, [content, editor])

  // Set editable state
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  if (!editor) {
    return null
  }

  return (
    <div className="tiptap-editor flex flex-col h-full">
      {/* Bubble Menu */}
      <BubbleMenuComponent
        editor={editor}
        onAIPolish={handleAIPolish}
        onAIConcise={handleAIConcise}
        onAIExpand={handleAIExpand}
        onQuoteToChat={handleQuoteToChat}
      />

      {/* Editor content */}
      <EditorContent editor={editor} className="flex-1 overflow-auto" />
    </div>
  )
}

export default TipTapEditor
