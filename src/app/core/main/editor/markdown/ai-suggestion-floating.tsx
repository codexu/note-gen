'use client'

import { Editor } from '@tiptap/react'
import { Check, X, Sparkles, Loader2, CircleX } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'

interface AISuggestionFloatingProps {
  editor: Editor
}

interface SuggestionData {
  originalText: string
  suggestedText: string
  type: string
  generatedRange?: { from: number; to: number }
}

interface PositionData {
  position: { top: number; left: number; right: number; bottom: number }
}

export function AISuggestionFloating({ editor }: AISuggestionFloatingProps) {
  const t = useTranslations('editor')
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const latestSuggestionRef = useRef<SuggestionData | null>(null)

  // Keep the ref in sync
  useEffect(() => {
    latestSuggestionRef.current = suggestion
  }, [suggestion])

  // 清理
  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort()
      }
    }
  }, [abortController])

  // Calculate position helper
  const calculatePosition = useCallback((dataPosition: { top: number; left: number; right: number; bottom: number }) => {
    const editorElement = document.querySelector('.ProseMirror')
    const scrollContainer = editorElement?.parentElement

    if (!scrollContainer) {
      return { top: dataPosition.bottom - 10, left: dataPosition.left }
    }

    const containerBounds = scrollContainer.getBoundingClientRect()
    const relativeTop = dataPosition.bottom - containerBounds.top + scrollContainer.scrollTop - 10
    const relativeLeft = dataPosition.left - containerBounds.left + scrollContainer.scrollLeft

    // 边界检测：left 在 [0, 容器宽度 - 菜单宽度] 范围内
    const currentMenuWidth = buttonRef.current?.offsetWidth || 180
    const maxLeft = Math.max(0, containerBounds.width - currentMenuWidth)
    const left = Math.min(relativeLeft, maxLeft)

    return { top: relativeTop, left }
  }, [])

  // Listen for AI suggestion events
  useEffect(() => {
    if (!editor) return

    // Show suggestion immediately with streaming state
    const handleStartStreaming = (data: {
      originalText: string
      type: string
      position: { top: number; left: number; right: number; bottom: number }
      controller?: AbortController
    }) => {
      setSuggestion({
        originalText: data.originalText,
        suggestedText: '',
        type: data.type,
      })

      const pos = calculatePosition(data.position)
      setPosition(pos)
      setIsVisible(true)
      setIsStreaming(true)

      if (data.controller) {
        setAbortController(data.controller)
      }
    }

    // Update streaming content and position as it arrives
    const handleUpdateContent = (data: {
      suggestedText: string
      position: { top: number; left: number; right: number; bottom: number }
    }) => {
      setSuggestion(prev => prev ? {
        ...prev,
        suggestedText: data.suggestedText,
      } : null)

      const pos = calculatePosition(data.position)
      setPosition(pos)
    }

    // Streaming completed, show accept/reject buttons
    const handleStreamingComplete = (data?: SuggestionData & PositionData & { generatedRange?: { from: number; to: number } }) => {
      if (data) {
        setSuggestion({
          originalText: data.originalText,
          suggestedText: data.suggestedText,
          type: data.type,
          generatedRange: data.generatedRange,
        })

        const pos = calculatePosition(data.position)
        setPosition(pos)
        setIsVisible(true)
      }
      setIsStreaming(false)
      setAbortController(null)
    }

    // 终止生成
    const handleAbortStreaming = () => {
      if (abortController) {
        abortController.abort()
      }
      setIsStreaming(false)
      setAbortController(null)

      // 恢复原始文本
      const current = latestSuggestionRef.current
      if (current) {
        editor.chain()
          .focus()
          .deleteSelection()
          .insertContent(current.originalText)
          .run()
      }

      setIsVisible(false)
      setSuggestion(null)
    }

    // Show suggestion after streaming completes
    const handleShowSuggestion = (data: SuggestionData & PositionData & { generatedRange?: { from: number; to: number } }) => {
      setSuggestion({
        originalText: data.originalText,
        suggestedText: data.suggestedText,
        type: data.type,
        generatedRange: data.generatedRange,
      })

      const pos = calculatePosition(data.position)
      setPosition(pos)
      setIsVisible(true)
      setIsStreaming(false)
    }

    emitter.on('start-ai-streaming', handleStartStreaming)
    emitter.on('update-ai-streaming-content', handleUpdateContent)
    emitter.on('ai-streaming-complete', handleStreamingComplete)
    emitter.on('show-ai-suggestion', handleShowSuggestion)
    emitter.on('abort-ai-streaming', handleAbortStreaming)

    return () => {
      emitter.off('start-ai-streaming', handleStartStreaming)
      emitter.off('update-ai-streaming-content', handleUpdateContent)
      emitter.off('ai-streaming-complete', handleStreamingComplete)
      emitter.off('show-ai-suggestion', handleShowSuggestion)
      emitter.off('abort-ai-streaming', handleAbortStreaming)
    }
  }, [editor, abortController, calculatePosition])

  const handleAccept = useCallback(() => {
    // Accept: keep the current AI-generated text (do nothing)
    setIsVisible(false)
    setSuggestion(null)
  }, [])

  const handleReject = useCallback(() => {
    const current = latestSuggestionRef.current
    if (!current) return

    // Reject: delete generated text and insert original
    if (current.generatedRange) {
      // Delete the generated text and insert original
      editor.chain()
        .focus()
        .deleteRange(current.generatedRange)
        .insertContent(current.originalText)
        .run()
    } else {
      // Fallback: try to delete selection and insert original
      editor.chain()
        .focus()
        .deleteSelection()
        .insertContent(current.originalText)
        .run()
    }

    setIsVisible(false)
    setSuggestion(null)
  }, [editor])

  const handleAbort = useCallback(() => {
    emitter.emit('abort-ai-streaming')
  }, [])

  // Don't render if not visible
  if (!isVisible) return null

  const typeLabels: Record<string, string> = {
    polish: t('bubbleMenu.polish'),
    concise: t('bubbleMenu.concise'),
    expand: t('bubbleMenu.expand'),
  }

  return (
    <div
      ref={buttonRef}
      className="absolute z-50 flex items-center gap-1 px-2 py-1.5 bg-primary text-primary-foreground rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {isStreaming ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs font-medium">{t('aiSuggestion.generating')}</span>
          <div className="w-px h-4 bg-primary/30 mx-1" />
          <button
            onClick={handleAbort}
            className="p-1 hover:bg-primary/80 rounded transition-colors"
            title={t('aiSuggestion.abort')}
          >
            <CircleX className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{suggestion && typeLabels[suggestion.type] ? typeLabels[suggestion.type] : t('bubbleMenu.ai')}</span>
          <div className="w-px h-4 bg-primary/30 mx-1" />
          <button
            onClick={handleAccept}
            className="p-1 hover:bg-primary/80 rounded transition-colors"
            title={t('aiSuggestion.accept')}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReject}
            className="p-1 hover:bg-primary/80 rounded transition-colors"
            title={t('aiSuggestion.reject')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

export default AISuggestionFloating
