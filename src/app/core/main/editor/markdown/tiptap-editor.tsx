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
import Image from '@tiptap/extension-image'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace'
import UniqueId from '@tiptap/extension-unique-id'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import 'katex/dist/katex.min.css'
import { InlineMath, BlockMath } from './math-extension'
import { MermaidDiagram } from './mermaid-extension'
import { MathEditorDialog } from './math-editor-dialog'
import { useEffect, useRef, useCallback, useState } from 'react'
import { handleImageUpload } from '@/lib/image-handler'
import { useTranslations } from 'next-intl'
import { BubbleMenu as BubbleMenuComponent } from './bubble-menu'
import { ImageBubbleMenu } from './image-bubble-menu'
import { toast } from '@/hooks/use-toast'
import { FloatingTableMenu } from './floating-table-menu'
import { FooterBar } from './footer-bar/index'
import { SlashCommand, suggestionOptions } from './slash-command'
import { SlashCommandPortal } from './slash-command/slash-command-portal'
import { fetchCompletionStream } from '@/lib/ai/completion'
import { fetchAiPolishStream, fetchAiConciseStream, fetchAiExpandStream } from '@/lib/ai/rewrite'
import { AISuggestion } from './ai-suggestion'
import { AISuggestionFloating } from './ai-suggestion-floating'
import emitter from '@/lib/emitter'
import { QuoteMark } from './quote-mark'
import useSettingStore from '@/stores/setting'
import './style.css'

const lowlight = createLowlight(common)

// Helper function to convert 1-based line number to document position
function lineToPosition(doc: ProseMirrorNode, line: number): number {
  let pos = 0
  let currentLine = 1

  doc.descendants((node, nodePos) => {
    if (currentLine >= line) return false

    if (node.isText && node.text) {
      const lineBreaks = node.text.split('\n').length - 1
      if (currentLine + lineBreaks >= line) {
        const targetInNode = line - currentLine
        // Include the target line plus newlines before it
        const textBeforeTarget = node.text.split('\n').slice(0, targetInNode + 1).join('\n')
        pos = nodePos + textBeforeTarget.length
        return false
      }
      currentLine += lineBreaks
    } else if (!node.isInline) {
      currentLine++
    }
    return true
  })

  // 如果行号超出范围，返回文档末尾
  if (pos === 0 && line > 1) {
    return doc.content.size
  }
  return pos
}

// 自定义扩展：处理粘贴 Markdown 文本
const PasteMarkdown = Extension.create({
  name: 'pasteMarkdown',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
          handlePaste(_view, event, _slice) {
            void _view
            void _slice
            const text = (event as ClipboardEvent).clipboardData?.getData('text/plain')

            if (!text) {
              return false
            }

            // 检查文本是否看起来像 Markdown
            if (looksLikeMarkdown(text)) {
              // 使用 editor.commands.insertContent 插入 Markdown 内容
              editor.commands.insertContent(text, { contentType: 'markdown' })
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})


// 简单的启发式函数：检查文本是否看起来像 Markdown
function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/.test(text) || // 标题
    /\*\*[^*]+\*\*/.test(text) || // 粗体
    /\*[^*]+\*/.test(text) || // 斜体
    /\[.+\]\(.+\)/.test(text) || // 链接
    /^[-*+]\s/.test(text) || // 无序列表
    /^\d+\.\s/.test(text) || // 有序列表
    /^>\s/.test(text) || // 引用
    /^```[\s\S]*```$/.test(text) || // 代码块
    /`[^`]+`/.test(text) // 行内代码
  )
}

interface TipTapEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  activeFilePath?: string
  onQuoteToChat?: () => void
  onReady?: () => void
  onEditorReady?: (editor: any) => void
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function TipTapEditor({
  initialContent,
  onChange,
  placeholder,
  editable = true,
  activeFilePath = '',
  onQuoteToChat,
  onReady,
  onEditorReady,
  outlineOpen,
  onToggleOutline,
}: TipTapEditorProps) {
  const t = useTranslations('editor')
  const tMermaid = useTranslations('editor.mermaid.templates')
  const tImage = useTranslations('editor.image')

  const placeholderText = placeholder || t('placeholder')

  // 获取正文缩放设置
  const { contentTextScale } = useSettingStore()

  // 编辑器容器 ref，用于应用字体缩放
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Math dialog state
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathType, setMathType] = useState<'inline' | 'block'>('inline')

  const isInitializedRef = useRef(false)
  const initializedForPathRef = useRef<string | null>(null)
  const externalUpdateCounterRef = useRef(0)
  const pendingSyncUpdateRef = useRef<{ path: string; content: string } | null>(null)
  // Bug fix: Track when editor is ready (has caught up with content)
  const isReadyRef = useRef(false)
  // Bug fix: Track if this is the first onUpdate after initialization
  const isFirstUpdateRef = useRef(true)

  // Content version ref for race condition prevention between editor and agent
  const contentVersionRef = useRef(0)

  // When file path changes, reset initialization state to avoid old file content overwriting new file
  useEffect(() => {
    if (initializedForPathRef.current !== activeFilePath && activeFilePath) {
      isInitializedRef.current = false
      isReadyRef.current = false
      isFirstUpdateRef.current = true
      initializedForPathRef.current = activeFilePath
      pendingSyncUpdateRef.current = null
    }
  }, [activeFilePath])

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
        placeholder: placeholderText,
        showOnlyCurrent: true,
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
      Markdown.configure({
        indentation: {
          style: 'space',
          size: 2,
        },
      }),
      SlashCommand.configure({
        suggestion: suggestionOptions,
      }),
      QuoteMark,
      AISuggestion,
      UniqueId.configure({
        attributeName: 'data-id',
        types: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader'],
      }),
      InlineMath,
      BlockMath,
      MermaidDiagram,
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
      // 自定义粘贴 Markdown 扩展
      PasteMarkdown,
    ],
    content: initialContent,
    contentType: 'markdown',
    editable,
    onUpdate: ({ editor }) => {
      // Bug fix: Only trigger onChange if editor is ready (not during initialization)
      // Using counter to handle rapid successive updates
      if (externalUpdateCounterRef.current === 0 && isReadyRef.current) {
        const markdown = editor.getMarkdown()
        onChange?.(markdown)
        // Mark that we've processed the first update
        isFirstUpdateRef.current = false
        // Increment version on user content changes
        contentVersionRef.current++
      } else if (isFirstUpdateRef.current) {
        // Skip the very first update during initialization
      } else {
        // Skip other updates (counter > 0 means external update)
      }
    },
  })

  // 应用正文文字大小缩放
  useEffect(() => {
    if (!editor) return

    const applyFontSize = () => {
      if (editorContainerRef.current) {
        const proseMirror = editorContainerRef.current.querySelector('.ProseMirror') as HTMLElement
        if (proseMirror) {
          // 使用 16px 作为基础字体大小，根据 contentTextScale 进行缩放
          const baseFontSize = 16
          proseMirror.style.fontSize = `${(baseFontSize * contentTextScale) / 100}px`
        }
      }
    }

    // 立即应用一次
    applyFontSize()
  }, [contentTextScale, editor])

  // Track active file path for image uploads (ref to avoid re-initializing editor)
  const activeFilePathRef = useRef(activeFilePath)
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  // Track uploading images for loading state
  const uploadingImagesRef = useRef<Map<string, boolean>>(new Map())

  // Handle image paste and drop
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const imageFile = imageFiles[0]
      const uploadId = `paste-${Date.now()}`

      // Show loading state
      uploadingImagesRef.current.set(uploadId, true)

      // Prevent default to avoid base64 image being inserted
      event.preventDefault()

      handleImageUpload(imageFile, activeFilePathRef.current)
        .then(result => {
          editor.commands.insertContent({
            type: 'image',
            attrs: {
              src: result.src,
              alt: imageFile.name,
              relativeSrc: result.relativePath,
            },
          })
          toast({
            title: result.useImageHosting ? tImage('uploadSuccess') : tImage('saveSuccess'),
          })
        })
        .catch(error => {
          // 不插入任何内容，只显示错误提示
          console.error('Image upload failed:', error)
        })
        .finally(() => {
          uploadingImagesRef.current.delete(uploadId)
        })
    }

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const imageFile = imageFiles[0]
      const uploadId = `drop-${Date.now()}`

      // Show loading state
      uploadingImagesRef.current.set(uploadId, true)

      // Prevent default to avoid base64 image being inserted
      event.preventDefault()

      handleImageUpload(imageFile, activeFilePathRef.current)
        .then(result => {
          // Get drop position
          const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
          editor.commands.insertContentAt(pos?.pos || editor.state.selection.from, {
            type: 'image',
            attrs: {
              src: result.src,
              alt: imageFile.name,
              relativeSrc: result.relativePath,
            },
          })
          toast({
            title: result.useImageHosting ? tImage('uploadSuccess') : tImage('saveSuccess'),
          })
        })
        .catch(error => {
          // 不插入任何内容，只显示错误提示
          console.error('Image upload failed:', error)
        })
        .finally(() => {
          uploadingImagesRef.current.delete(uploadId)
        })
    }

    // Add event listeners to editor DOM element
    // Check if editor is fully initialized first
    if (!editor.view || !editor.view.dom) return
    const dom = editor.view.dom
    dom.addEventListener('paste', handlePaste as EventListener)
    dom.addEventListener('drop', handleDrop as EventListener)

    return () => {
      dom.removeEventListener('paste', handlePaste as EventListener)
      dom.removeEventListener('drop', handleDrop as EventListener)
    }
  }, [editor])

  // Handle copy event to output Markdown format
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handleCopy = (event: ClipboardEvent) => {
      const { from, to } = editor.state.selection

      // If there's no selection, let browser handle the default copy
      if (from === to) {
        return
      }

      // Check if markdown extension is available
      if (!editor.markdown) {
        return
      }

      // Get the selected content as Markdown
      const slice = editor.state.doc.slice(from, to)
      // Wrap in doc node for proper serialization
      const json = { type: 'doc', content: slice.content.toJSON() }
      const markdown = editor.markdown.serialize(json)

      // Write Markdown to clipboard
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', markdown)
        event.preventDefault()
      }
    }

    const dom = editor.view.dom
    dom.addEventListener('copy', handleCopy as EventListener)

    return () => {
      dom.removeEventListener('copy', handleCopy as EventListener)
    }
  }, [editor])

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
  // Bug fix: Only initialize if the editor is for the current file path
  useEffect(() => {
    if (!editor || !activeFilePath) return

    // Check if this is still the correct file path (handle race conditions)
    const currentPath = activeFilePath

    // Only initialize on first mount - subsequent content changes should not overwrite
    // user edits (e.g., when switching back to a previously edited tab)
    // Bug fix: Also check that we're initializing for the correct file path
    if (!isInitializedRef.current) {
      // Use setTimeout to avoid flushSync conflict during React render
      setTimeout(() => {
        // Check if the file path is still the same (handle race condition)
        if (activeFilePath !== currentPath) return

        if (initialContent) {
          editor.commands.setContent(initialContent || '', { contentType: 'markdown' })
        }
        // Mark as initialized to allow subsequent content updates
        isInitializedRef.current = true
        // Bug fix: Mark editor as ready AFTER content is set
        // This prevents onUpdate from firing with empty content during init
        isReadyRef.current = true
        // Notify mobile editor that editor is ready
        onReady?.()
        // Notify parent component about editor instance
        onEditorReady?.(editor)
      }, 0)
    }
  }, [editor, initialContent, onReady, onEditorReady, activeFilePath])

  // Handle remote file pull updates - update content when initialContent changes
  useEffect(() => {
    if (!editor || !isInitializedRef.current) return

    // Bug fix: Only update if content actually changed (from remote pull)
    // and if the initialContent belongs to the current file path
    const currentContent = editor.getMarkdown()
    const newContent = initialContent || ''

    // Bug fix: Use activeFilePath directly instead of ref to avoid race conditions
    // Also handle the case where initialContent changed from empty to non-empty
    if (activeFilePath) {
      // Update if content changed, including empty to non-empty transitions
      // But skip if both are empty (no meaningful change)
      if (newContent !== currentContent && (newContent || currentContent)) {
        // Bug fix: Mark editor as not ready during update to prevent onUpdate from firing
        isReadyRef.current = false
        externalUpdateCounterRef.current++
        // Use setTimeout to avoid flushSync conflict during React render
        setTimeout(() => {
          editor.commands.setContent(newContent, { contentType: 'markdown' })
          // Bug fix: Mark editor as ready after content is set
          isReadyRef.current = true
          // Reset the counter after a short delay
          setTimeout(() => {
            externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
          }, 100)
        }, 0)
      }
    }
  }, [initialContent, editor, activeFilePath])

  // Handle sync content updated from auto-sync
  useEffect(() => {
    const handleSyncContentUpdated = (event: { path: string; content: string }) => {
      // Bug fix: Only update if this is the active file
      if (!editor || !event || event.path !== activeFilePath) return

      // Bug fix: Skip if content hasn't actually changed
      const currentContent = editor.getMarkdown()
      if (currentContent === event.content) return

      // Bug fix: Set pending update and verify path when processing
      pendingSyncUpdateRef.current = event

      // Bug fix: Mark editor as not ready during update
      isReadyRef.current = false
      externalUpdateCounterRef.current++
      // Use setTimeout to avoid flushSync conflict during React render
      setTimeout(() => {
        editor.commands.setContent(event.content, { contentType: 'markdown' })
        // Bug fix: Mark editor as ready after content is set
        isReadyRef.current = true
        // Reset the counter and pending update after a short delay
        setTimeout(() => {
          // Only reset if this is still the same pending update
          if (pendingSyncUpdateRef.current === event) {
            pendingSyncUpdateRef.current = null
          }
          externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
        }, 100)
      }, 0)
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated as any)
    return () => {
      emitter.off('sync-content-updated', handleSyncContentUpdated as any)
    }
  }, [editor, activeFilePath])

  // Handle external content updates (e.g., from Agent tools)
  useEffect(() => {
    const handleExternalUpdate = (newContent: string) => {
      if (editor && externalUpdateCounterRef.current === 0) {
        // Bug fix: Skip if content hasn't actually changed
        const currentContent = editor.getMarkdown()
        if (currentContent === newContent) return

        // Bug fix: Mark editor as not ready during update
        isReadyRef.current = false
        // Set counter first to prevent circular updates
        externalUpdateCounterRef.current++
        // Use setTimeout to avoid flushSync conflict during React render
        setTimeout(() => {
          // Set content in editor with Markdown parsing
          editor.commands.setContent(newContent, { contentType: 'markdown' })
          // Bug fix: Mark editor as ready after content is set
          isReadyRef.current = true
          // Reset the counter after a short delay to handle rapid updates
          setTimeout(() => {
            externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
          }, 100)
        }, 0)
      }
    }

    emitter.on('external-content-update', handleExternalUpdate as any)
    return () => {
      emitter.off('external-content-update', handleExternalUpdate as any)
    }
  }, [editor])

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
            editor?.commands.insertContent(markdown, { contentType: 'markdown' })
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

  // Handle math formula insertion from slash menu
  useEffect(() => {
    if (!editor) return

    const handleInsertInlineMath = () => {
      setMathType('inline')
      setMathDialogOpen(true)
    }

    const handleInsertBlockMath = () => {
      setMathType('block')
      setMathDialogOpen(true)
    }

    document.addEventListener('tiptap-insert-inline-math', handleInsertInlineMath)
    document.addEventListener('tiptap-insert-block-math', handleInsertBlockMath)

    return () => {
      document.removeEventListener('tiptap-insert-inline-math', handleInsertInlineMath)
      document.removeEventListener('tiptap-insert-block-math', handleInsertBlockMath)
    }
  }, [editor])

  // Handle math dialog insert
  const handleMathInsert = useCallback((latex: string, type: 'inline' | 'block') => {
    if (!editor) return

    if (type === 'inline') {
      editor.chain().focus().insertContent({
        type: 'inlineMath',
        attrs: { latex },
      }).run()
    } else {
      editor.chain().focus().insertContent({
        type: 'blockMath',
        attrs: { latex },
      }).run()
    }
  }, [editor])

  // Editor tools event handlers for Agent integration
  useEffect(() => {
    // Get editor selection
    const handleGetSelection = ({ resolve }: { resolve: (data: { text: string; from: number; to: number; html?: string; startLine?: number; endLine?: number }) => void }) => {
      if (!editor) {
        resolve({ text: '', from: 0, to: 0, startLine: 1, endLine: 1 })
        return
      }

      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)

      // Calculate line numbers (1-indexed) by counting newlines before position
      const textBeforeFrom = editor.state.doc.textBetween(0, from)
      const startLine = (textBeforeFrom.match(/\n/g)?.length || 0) + 1

      const textBeforeTo = editor.state.doc.textBetween(0, to)
      const endLine = (textBeforeTo.match(/\n/g)?.length || 0) + 1

      resolve({
        text,
        from,
        to,
        html: editor.getHTML(),
        startLine,
        endLine,
      })
    }

    // Get editor content
    const handleGetContent = ({ resolve }: { resolve: (data: { markdown: string; html?: string; text: string; wordCount: number; charCount: number; totalLines?: number; version: number }) => void }) => {
      if (!editor) {
        resolve({ markdown: '', text: '', wordCount: 0, charCount: 0, totalLines: 1, version: 0 })
        return
      }

      const markdown = editor.getMarkdown()
      const text = editor.getText()
      const html = editor.getHTML()

      // Calculate total lines by counting newlines
      const totalLines = (text.match(/\n/g)?.length || 0) + 1

      resolve({
        markdown,
        html,
        text,
        wordCount: text.split(/\s+/).filter(w => w).length,
        charCount: text.length,
        totalLines,
        version: contentVersionRef.current,
      })
    }

    // Insert content at cursor
    const handleInsert = ({ content, resolve }: { content: string; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0 })
        return
      }

      try {
        // Insert content with markdown parsing
        // Wrap in setTimeout to avoid React lifecycle flushSync conflict
        setTimeout(() => {
          editor.commands.insertContent(content, { contentType: 'markdown' })

          // Use the actual cursor position after transaction
          const newPosition = editor.state.selection.from

          resolve({
            success: true,
            insertedLength: content.length,
            newCursorPosition: newPosition,
          })
        }, 0)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        resolve({ success: false, insertedLength: 0 })
      }
    }

    // Replace content in range
    const handleReplace = ({
      content,
      range,
      searchContent,
      occurrence,
      startLine,
      endLine,
      expectedVersion,
      resolve,
    }: {
      content?: string
      range?: { from: number; to: number }
      searchContent?: string
      occurrence?: number
      startLine?: number
      endLine?: number
      expectedVersion?: number
      resolve: (result: { success: boolean; insertedLength: number; message?: string; error?: string; newCursorPosition?: number; versionMismatch?: boolean }) => void
    }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0, error: 'Editor not initialized' })
        return
      }

      // Verify version if provided
      if (expectedVersion !== undefined && expectedVersion !== contentVersionRef.current) {
        resolve({ success: false, versionMismatch: true, insertedLength: 0, error: 'Content has changed, please get editor content again' })
        return
      }

      try {
        let { from, to } = editor.state.selection

        // Mode 1: Position-based (use current selection if not specified)
        if (range) {
          from = range.from
          to = range.to
        }
        // Mode 2: Text-based search
        else if (searchContent) {
          // Try to find searchContent in the document using a more robust method
          const doc = editor.state.doc
          const content = editor.state.doc.textContent
          const searchLower = searchContent.toLowerCase()
          const contentLower = content.toLowerCase()

          // Count occurrences to find the target one
          let currentOccurrence = 0
          let searchFrom = 0
          let foundIndex = -1

          while (currentOccurrence < (occurrence || 1)) {
            foundIndex = contentLower.indexOf(searchLower, searchFrom)
            if (foundIndex === -1) {
              resolve({ success: false, insertedLength: 0, error: `找不到文本 "${searchContent}"` })
              return
            }
            currentOccurrence++
            searchFrom = foundIndex + 1
          }

          // Now find the exact position in the ProseMirror doc
          // Use ProseMirror's descendant traversal to find text position
          let foundFrom = -1
          let foundTo = -1

          doc.descendants((node, pos) => {
            if (foundFrom !== -1) return false // Already found, stop traversal

            if (node.isText && node.text) {
              const idxInNode = node.text.toLowerCase().indexOf(searchLower)
              if (idxInNode !== -1) {
                foundFrom = pos + idxInNode
                foundTo = foundFrom + searchContent.length
                return false // Stop traversal
              }
            }
          })

          if (foundFrom === -1) {
            // Fallback: use approximate position from markdown
            foundFrom = foundIndex
            foundTo = foundIndex + searchContent.length
          }

          from = foundFrom
          to = foundTo
        }
        // Mode 3: Line-based
        else if (startLine !== undefined && endLine !== undefined) {
          const doc = editor.state.doc
          // Convert 1-based line numbers to positions
          from = lineToPosition(doc, startLine)
          to = lineToPosition(doc, endLine + 1)
        }
        // Fallback: use current selection (only if content is provided)
        else if (content) {
          // Don't change from/to, use current selection
        } else {
          resolve({ success: false, insertedLength: 0, error: '请提供 content、range、searchContent 或 startLine/endLine 参数' })
          return
        }

        const newContent = content || ''

        // Delete old content and insert new content with markdown parsing
        // Wrap in setTimeout to avoid React lifecycle flushSync conflict
        setTimeout(() => {
          editor.chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent(newContent, { contentType: 'markdown' })
            .run()

          // Increment version after successful replacement
          contentVersionRef.current++

          resolve({
            success: true,
            insertedLength: newContent.length,
            message: `成功替换 ${to - from} 个字符为 ${newContent.length} 个字符`,
            newCursorPosition: from + newContent.length,
          })
        }, 0)
      } catch (error) {
        resolve({ success: false, insertedLength: 0, error: String(error) })
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
        // Mark the selected text as quoted - use setTimeout to defer execution
        setTimeout(() => {
          editor.commands.setMark('quote')
        }, 0)
        // Add click handler to remove mark when clicking back on editor
        const removeQuoteOnClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement
          if (target.closest('.ProseMirror')) {
            setTimeout(() => {
              editor.commands.unsetMark('quote')
            }, 0)
            document.removeEventListener('mousedown', removeQuoteOnClick)
          }
        }
        setTimeout(() => {
          document.addEventListener('mousedown', removeQuoteOnClick)
        }, 100)
      }
    }

    // Track if listeners have been set up (for cleanup)
    let listenersSetup = false

    // Handle Mermaid diagram insertion
    const handleInsertMermaid = (event: CustomEvent) => {
      if (!editor) return
      const { type } = event.detail || {}

      // Get template from i18n
      const getTemplate = (diagramType: string) => {
        return tMermaid(diagramType) || tMermaid('flowchart')
      }

      const code = getTemplate(type || 'flowchart')

      // Insert mermaid diagram node
      editor.chain().focus().insertContent({
        type: 'mermaidDiagram',
        attrs: { code, type: type || 'flowchart' },
      }).run()
    }

    // Defer emitter and document listener registration to avoid flushSync conflict during React render
    const setupListeners = () => {
      // Check if editor is initialized before registering listeners
      if (!editor) return

      emitter.on('editor-get-selection', handleGetSelection)
      emitter.on('editor-get-content', handleGetContent)
      emitter.on('editor-insert', handleInsert)
      emitter.on('editor-replace', handleReplace)
      emitter.on('get-quote-from-editor', handleGetQuote)
      document.addEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
      listenersSetup = true
    }

    const cleanupListeners = () => {
      emitter.off('editor-get-selection', handleGetSelection)
      emitter.off('editor-get-content', handleGetContent)
      emitter.off('editor-insert', handleInsert)
      emitter.off('editor-replace', handleReplace)
      emitter.off('get-quote-from-editor', handleGetQuote)
      // Only remove event listener if it was actually added
      if (listenersSetup) {
        document.removeEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
        listenersSetup = false
      }
    }

    // Use setTimeout to defer listener registration until after React render completes
    setTimeout(setupListeners, 0)

    return cleanupListeners
  }, [editor, activeFilePath])

  if (!editor) {
    return null
  }

  return (
    <div ref={editorContainerRef} className="tiptap-editor relative flex flex-col h-full">
      {/* Editor content - scrollable area */}
      <div
        className="flex-1 overflow-x-hidden overflow-y-auto relative"
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

        <ImageBubbleMenu editor={editor} />

        <AISuggestionFloating editor={editor} />

        <FloatingTableMenu editor={editor} />

        <EditorContent editor={editor} className="h-full" />
      </div>

      {/* Bottom toolbar - always visible */}
      <FooterBar
        editor={editor}
        outlineOpen={outlineOpen}
        onToggleOutline={onToggleOutline}
      />

      <SlashCommandPortal />

      <MathEditorDialog
        open={mathDialogOpen}
        onOpenChange={setMathDialogOpen}
        onInsert={handleMathInsert}
        type={mathType}
        title={mathType === 'inline' ? '插入行内公式' : '插入块级公式'}
      />
    </div>
  )
}

export default TipTapEditor
