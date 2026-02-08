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
import UniqueId from '@tiptap/extension-unique-id'
import { useEffect, useRef, useCallback, useState } from 'react'
import { BubbleMenu as BubbleMenuComponent } from './bubble-menu'
import { toast } from '@/hooks/use-toast'
import { FloatingTableMenu } from './floating-table-menu'
import { FloatingImageMenu } from './floating-image-menu'
import { ImageExtension } from './image-extension'
import { MathInline, MathBlock } from './math-extension'
import { FooterBar } from './footer-bar/index'
import { SlashCommand, suggestionOptions } from './slash-command'
import { SlashCommandPortal } from './slash-command/slash-command-portal'
import { fetchCompletionStream } from '@/lib/ai/completion'
import { fetchAiPolishStream, fetchAiConciseStream, fetchAiExpandStream } from '@/lib/ai/rewrite'
import { AISuggestion } from './ai-suggestion'
import { AISuggestionFloating } from './ai-suggestion-floating'
import emitter from '@/lib/emitter'
import { QuoteMark } from './quote-mark'
import './style.css'

const lowlight = createLowlight(common)

interface TipTapEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  aiEnabled?: boolean
  activeFilePath?: string
  onQuoteToChat?: () => void
}

export function TipTapEditor({
  initialContent,
  onChange,
  placeholder = '开始写作...',
  editable = true,
  aiEnabled = false,
  activeFilePath = '',
  onQuoteToChat,
}: TipTapEditorProps) {
  const [aiCompletionEnabled, setAICompletionEnabled] = useState(aiEnabled)
  const isInitializedRef = useRef(false)
  const isExternalUpdateRef = useRef(false)

  const handleToggleAICompletion = useCallback((enabled: boolean) => {
    setAICompletionEnabled(enabled)
  }, [])

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
      SlashCommand.configure({
        suggestion: suggestionOptions,
      }),
      QuoteMark,
      AISuggestion,
      UniqueId.configure({
        attributeName: 'data-id',
        types: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader'],
      }),
    ],
    content: initialContent,
    editable,
    onUpdate: ({ editor }) => {
      // Only trigger onChange if this is NOT an external update
      if (!isExternalUpdateRef.current) {
        const markdown = editor.getMarkdown()
        onChange?.(markdown)
      }
    },
  })

  // Handle AI Polish - improve selected text (with streaming and suggestion mode)
  const handleAIPolish = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'polish',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiPolishStream(
        selectedText,
        (chunk) => {
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal
      )

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'polish',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    }
  }, [editor])

  // Handle AI Concise - simplify selected text (with streaming and suggestion mode)
  const handleAIConcise = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'concise',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiConciseStream(
        selectedText,
        (chunk) => {
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal
      )

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'concise',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    }
  }, [editor])

  // Handle AI Expand - expand selected text (with streaming and suggestion mode)
  const handleAIExpand = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'expand',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiExpandStream(
        selectedText,
        (chunk) => {
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal
      )

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'expand',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    }
  }, [editor])

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

  // Handle AI continue writing
  useEffect(() => {
    let abortController: AbortController | null = null

    const handleAIContinue = async () => {
      if (!editor) return

      // Get content before cursor as context
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(0, from, '\n')

      // Get last 500 characters as context
      const context = textBefore.slice(-500)

      if (!context.trim()) {
        toast({
          title: '续写失败',
          description: '请先输入一些内容',
          variant: 'destructive',
        })
        return
      }

      // Create new AbortController for this request
      abortController = new AbortController()

      // Insert loading indicator at cursor position
      const loadingMark = editor.state.schema.marks.strong
      if (!loadingMark) {
        // If no strong mark available, insert simple text
        editor.chain().focus().insertContent('...').run()
      } else {
        editor.chain().focus().insertContent('···').run()
      }

      // Track accumulated result for streaming
      let accumulatedResult = ''
      const startPosition = from

      try {
        await fetchCompletionStream(
          context,
          (chunk, isFirst) => {
            if (isFirst) {
              // Delete the loading indicator before inserting first chunk
              const { to } = editor.state.selection
              editor.chain().focus().deleteRange({ from: to - 3, to }).run()
            }
            // Insert chunk as plain text during streaming
            editor.chain().focus().insertContent(chunk).run()
            accumulatedResult += chunk
          },
          abortController.signal
        )

        // Streaming complete - replace content with proper Markdown parsing
        if (accumulatedResult) {
          editor.chain()
            .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
            .insertContent(accumulatedResult, { contentType: 'markdown' })
            .run()
        }
      } catch (error) {
        // Delete loading indicator on error
        const { to } = editor.state.selection
        editor.chain().focus().deleteRange({ from: to - 3, to }).run()

        // Show error toast (but not for aborted requests)
        if (error instanceof Error && error.message !== 'Request was aborted.') {
          toast({
            title: '续写失败',
            description: error.message || '网络错误',
            variant: 'destructive',
          })
        }
      }
    }

    document.addEventListener('tiptap-ai-continue', handleAIContinue)
    return () => {
      document.removeEventListener('tiptap-ai-continue', handleAIContinue)
      abortController?.abort()
    }
  }, [editor])

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

  // Handle external content updates (e.g., from Agent tools)
  useEffect(() => {
    const handleExternalUpdate = (newContent: string) => {
      if (editor && !isExternalUpdateRef.current) {
        // Set flag first to prevent circular updates
        isExternalUpdateRef.current = true
        // Set content in editor
        editor.commands.setContent(newContent, { contentType: 'markdown' })
        // Directly call onChange with the new content (bypassing onUpdate to avoid timing issues)
        onChange?.(newContent)
      }
      // Reset the flag after a short delay to handle rapid updates
      setTimeout(() => {
        isExternalUpdateRef.current = false
      }, 100)
    }

    emitter.on('external-content-update', handleExternalUpdate)
    return () => {
      emitter.off('external-content-update', handleExternalUpdate)
    }
  }, [editor, onChange])

  // Editor tools event handlers for Agent integration
  useEffect(() => {
    // Get editor selection
    const handleGetSelection = ({ resolve }: { resolve: (data: { text: string; from: number; to: number; html?: string }) => void }) => {
      if (!editor) {
        resolve({ text: '', from: 0, to: 0 })
        return
      }

      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)

      resolve({
        text,
        from,
        to,
        html: editor.getHTML(),
      })
    }

    // Get editor content
    const handleGetContent = ({ resolve }: { resolve: (data: { markdown: string; html?: string; text: string; wordCount: number; charCount: number }) => void }) => {
      if (!editor) {
        resolve({ markdown: '', text: '', wordCount: 0, charCount: 0 })
        return
      }

      const markdown = editor.getMarkdown()
      const text = editor.getText()
      const html = editor.getHTML()

      resolve({
        markdown,
        html,
        text,
        wordCount: text.split(/\s+/).filter(w => w).length,
        charCount: text.length,
      })
    }

    // Insert content at cursor
    const handleInsert = ({ content, resolve }: { content: string; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0 })
        return
      }

      try {
        const { from } = editor.state.selection

        // Insert content
        editor.chain().focus().insertContent(content).run()

        // Calculate new cursor position
        const newPosition = from + content.length

        resolve({
          success: true,
          insertedLength: content.length,
          newCursorPosition: newPosition,
        })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        resolve({ success: false, insertedLength: 0 })
      }
    }

    // Replace content in range
    const handleReplace = ({
      content,
      range,
      resolve,
    }: {
      content: string
      range?: { from: number; to: number }
      resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void
    }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0 })
        return
      }

      try {
        let { from, to } = editor.state.selection

        // Use specified range if provided
        if (range) {
          from = range.from
          to = range.to
        }

        // Delete old content and insert new content
        editor.chain()
          .focus()
          .deleteRange({ from, to })
          .insertContent(content)
          .run()

        resolve({
          success: true,
          insertedLength: content.length,
          newCursorPosition: from + content.length,
        })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        resolve({ success: false, insertedLength: 0 })
      }
    }

    // Get quote from editor for chat
    const handleGetQuote = () => {
      if (!editor) return
      const { from, to } = editor.state.selection
      if (from !== to) {
        const quote = editor.state.doc.textBetween(from, to)
        const fileName = activeFilePath?.split('/').pop() || ''
        emitter.emit('insert-quote', {
          quote,
          fullContent: quote,
          fileName,
          startLine: -1,
          endLine: -1,
          articlePath: activeFilePath || '',
        })
        // Mark the selected text as quoted
        editor.commands.setMark('quote')
        // Add click handler to remove mark when clicking back on editor
        const removeQuoteOnClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement
          if (target.closest('.ProseMirror')) {
            editor.commands.unsetMark('quote')
            document.removeEventListener('mousedown', removeQuoteOnClick)
          }
        }
        setTimeout(() => {
          document.addEventListener('mousedown', removeQuoteOnClick)
        }, 100)
      }
    }

    emitter.on('editor-get-selection', handleGetSelection)
    emitter.on('editor-get-content', handleGetContent)
    emitter.on('editor-insert', handleInsert)
    emitter.on('editor-replace', handleReplace)
    emitter.on('get-quote-from-editor', handleGetQuote)

    return () => {
      emitter.off('editor-get-selection', handleGetSelection)
      emitter.off('editor-get-content', handleGetContent)
      emitter.off('editor-insert', handleInsert)
      emitter.off('editor-replace', handleReplace)
      emitter.off('get-quote-from-editor', handleGetQuote)
    }
  }, [editor, activeFilePath])

  if (!editor) {
    return null
  }

  return (
    <div className="tiptap-editor relative flex flex-col h-full">
      {/* Editor content - scrollable area */}
      <div
        className="flex-1 overflow-auto relative"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleEditorDrop}
      >
        <BubbleMenuComponent
          editor={editor}
          onAIPolish={handleAIPolish}
          onAIConcise={handleAIConcise}
          onAIExpand={handleAIExpand}
          onQuoteToChat={onQuoteToChat}
        />

        <AISuggestionFloating editor={editor} />

        <FloatingTableMenu editor={editor} />
        <FloatingImageMenu editor={editor} />

        <EditorContent editor={editor} className="h-full" />
      </div>

      {/* Bottom toolbar - always visible */}
      <FooterBar
        editor={editor}
        aiCompletionEnabled={aiCompletionEnabled}
        onToggleAICompletion={handleToggleAICompletion}
      />

      <SlashCommandPortal />
    </div>
  )
}

export default TipTapEditor
