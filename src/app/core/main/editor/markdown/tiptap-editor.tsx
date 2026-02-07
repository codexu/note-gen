'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import Dropcursor from '@tiptap/extension-dropcursor'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace'
import { useEffect, useRef, useCallback, useState } from 'react'
import { BubbleMenu as BubbleMenuComponent } from './bubble-menu'
import { toast } from '@/hooks/use-toast'
import { FloatingTableMenu } from './floating-table-menu'
import { FloatingImageMenu } from './floating-image-menu'
import { ImageExtension } from './image-extension'
import { MathInline, MathBlock } from './math-extension'
import { FixedToolbar } from './fixed-toolbar'
import './style.css'

const lowlight = createLowlight(common)

interface TipTapEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  aiEnabled?: boolean
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onAITranslate?: () => void
  onQuoteToChat?: () => void
}

export function TipTapEditor({
  initialContent,
  onChange,
  placeholder = '开始写作...',
  editable = true,
  aiEnabled = false,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onAITranslate,
  onQuoteToChat,
}: TipTapEditorProps) {
  const [aiCompletionEnabled, setAICompletionEnabled] = useState(aiEnabled)
  const isInitializedRef = useRef(false)
  const isExternalUpdateRef = useRef(false)

  const handleToggleAICompletion = useCallback((enabled: boolean) => {
    setAICompletionEnabled(enabled)
  }, [])

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

  const handleAITranslate = useCallback(() => {
    onAITranslate?.()
  }, [onAITranslate])

  const handleQuoteToChat = useCallback(() => {
    onQuoteToChat?.()
  }, [onQuoteToChat])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder,
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
      Dropcursor,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      ImageExtension,
      Markdown,
      MathInline,
      MathBlock,
    ],
    content: initialContent,
    editable,
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      isExternalUpdateRef.current = true
      onChange?.(markdown)
    },
  })

  // Initialize content only once - preserves undo/redo history when switching tabs
  useEffect(() => {
    if (editor && !isInitializedRef.current && initialContent) {
      const currentContent = editor.getMarkdown()
      if (initialContent !== currentContent) {
        editor.commands.setContent(initialContent, { contentType: 'markdown' })
      }
      isInitializedRef.current = true
    }
  }, [editor, initialContent])

  // Set editable state
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  // Handle drag and drop from marks
  const handleEditorDrop = useCallback((e: React.DragEvent) => {
    const markData = e.dataTransfer.getData('application/json')
    if (markData) {
      try {
        const mark = JSON.parse(markData)
        if (mark && mark.id !== undefined) {
          import('@/lib/mark-to-markdown').then(({ markToMarkdown }) => {
            const markdown = markToMarkdown(mark)
            editor?.commands.insertContent(markdown)
            toast({
              title: '已插入记录',
              description: mark.desc || mark.content?.slice(0, 50) || '记录内容'
            })
          })
        }
      } catch (error) {
        console.error('Failed to parse dropped mark:', error)
      }
    }
  }, [editor])

  if (!editor) {
    return null
  }

  return (
    <div className="tiptap-editor flex flex-col h-full">
      <BubbleMenuComponent
        editor={editor}
        onAIPolish={handleAIPolish}
        onAIConcise={handleAIConcise}
        onAIExpand={handleAIExpand}
        onAITranslate={handleAITranslate}
        onQuoteToChat={handleQuoteToChat}
      />

      <FloatingTableMenu editor={editor} />
      <FloatingImageMenu editor={editor} />

      <div
        className="flex-1 overflow-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleEditorDrop}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>

      <FixedToolbar
        editor={editor}
        aiCompletionEnabled={aiCompletionEnabled}
        onToggleAICompletion={handleToggleAICompletion}
      />
    </div>
  )
}

export default TipTapEditor
