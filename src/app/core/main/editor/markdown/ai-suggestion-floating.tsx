'use client'

import { Editor } from '@tiptap/react'
import { Brain, Check, ChevronRight, CircleX, Loader2, Sparkles, X } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import { setAiSuggestionShortcutVisible } from '@/lib/ai-suggestion-shortcut-state'
import { clearAiSuggestionHighlight, setAiSuggestionHighlight } from './ai-suggestion-highlight'

interface AISuggestionFloatingProps {
  editor: Editor
  onPendingChange?: (pending: boolean) => void
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

function getScrollContainer(editor: Editor) {
  const root = editor.view.dom.closest('.tiptap-editor')
  return root?.querySelector('.overflow-y-auto') as HTMLElement | null
}

function getEditorRoot(editor: Editor) {
  return editor.view.dom.closest('.tiptap-editor') as HTMLElement | null
}

function calculateFloatingPosition(
  editor: Editor,
  anchorPosition: { top: number; left: number; right: number; bottom: number },
  panelWidth: number,
  panelHeight: number,
) {
  const scrollContainer = getScrollContainer(editor)

  if (!scrollContainer) {
    const editorRoot = getEditorRoot(editor)

    if (!editorRoot) {
      return { top: anchorPosition.bottom + 12, left: Math.max(12, anchorPosition.left - panelWidth / 2) }
    }

    const rootBounds = editorRoot.getBoundingClientRect()
    const centeredLeft = (rootBounds.width - panelWidth) / 2
    const minLeft = 12
    const maxLeft = rootBounds.width - panelWidth - 12
    const preferredTop = anchorPosition.bottom - rootBounds.top + 12

    return {
      top: Math.max(preferredTop, 12),
      left: Math.min(Math.max(centeredLeft, minLeft), Math.max(minLeft, maxLeft)),
    }
  }

  const containerBounds = scrollContainer.getBoundingClientRect()
  const centeredLeft = scrollContainer.scrollLeft + (containerBounds.width - panelWidth) / 2
  const minLeft = scrollContainer.scrollLeft + 12
  const maxLeft = scrollContainer.scrollLeft + containerBounds.width - panelWidth - 12

  const relativeAnchorTop = anchorPosition.bottom - containerBounds.top + scrollContainer.scrollTop
  const preferredTop = relativeAnchorTop + 12
  const maxTop = scrollContainer.scrollTop + containerBounds.height - panelHeight - 12
  const minTop = scrollContainer.scrollTop + 12

  return {
    top: Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop)),
    left: Math.min(Math.max(centeredLeft, minLeft), Math.max(minLeft, maxLeft)),
  }
}

export function AISuggestionFloating({ editor, onPendingChange }: AISuggestionFloatingProps) {
  const t = useTranslations('editor')
  const tCommon = useTranslations()
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingText, setThinkingText] = useState('')
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const thinkingContentRef = useRef<HTMLDivElement>(null)
  const latestSuggestionRef = useRef<SuggestionData | null>(null)
  const anchorPositionRef = useRef<{ top: number; left: number; right: number; bottom: number } | null>(null)

  useEffect(() => {
    latestSuggestionRef.current = suggestion
  }, [suggestion])

  useEffect(() => {
    setAiSuggestionShortcutVisible(isVisible)
    onPendingChange?.(isVisible)

    return () => {
      setAiSuggestionShortcutVisible(false)
      onPendingChange?.(false)
    }
  }, [isVisible, onPendingChange])

  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort()
      }
    }
  }, [abortController])

  useEffect(() => {
    return () => {
      clearAiSuggestionHighlight(editor)
    }
  }, [editor])

  const updatePosition = useCallback(() => {
    if (!anchorPositionRef.current) {
      return
    }

    const panelWidth = panelRef.current?.offsetWidth || 320
    const panelHeight = panelRef.current?.offsetHeight || (thinkingText ? 132 : 52)
    setPosition(calculateFloatingPosition(editor, anchorPositionRef.current, panelWidth, panelHeight))
  }, [editor, thinkingText])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    updatePosition()
    const scrollContainer = getScrollContainer(editor)
    const handleLayoutChange = () => updatePosition()
    scrollContainer?.addEventListener('scroll', handleLayoutChange)
    window.addEventListener('resize', handleLayoutChange)

    return () => {
      scrollContainer?.removeEventListener('scroll', handleLayoutChange)
      window.removeEventListener('resize', handleLayoutChange)
    }
  }, [editor, isVisible, updatePosition])

  useEffect(() => {
    updatePosition()
  }, [thinkingText, isThinkingExpanded, isStreaming, suggestion?.suggestedText, updatePosition])

  useEffect(() => {
    if (isStreaming && thinkingText) {
      setIsThinkingExpanded(true)
    }
  }, [isStreaming, thinkingText])

  useEffect(() => {
    if (!isStreaming || !isThinkingExpanded || !thinkingContentRef.current) {
      return
    }

    thinkingContentRef.current.scrollTop = thinkingContentRef.current.scrollHeight
  }, [isStreaming, isThinkingExpanded, thinkingText])

  useEffect(() => {
    if (!editor) return

    const handleStartStreaming = (data: {
      originalText: string
      type: string
      position: { top: number; left: number; right: number; bottom: number }
      controller?: AbortController
    }) => {
      clearAiSuggestionHighlight(editor)
      anchorPositionRef.current = data.position
      setSuggestion({
        originalText: data.originalText,
        suggestedText: '',
        type: data.type,
      })
      setThinkingText('')
      setIsThinkingExpanded(false)
      setIsVisible(true)
      setIsStreaming(true)
      if (data.controller) {
        setAbortController(data.controller)
      }
    }

    const handleUpdateThinkingContent = (data: {
      thinkingText: string
      position: { top: number; left: number; right: number; bottom: number }
    }) => {
      anchorPositionRef.current = anchorPositionRef.current || data.position
      setThinkingText(data.thinkingText)
    }

    const handleUpdateContent = (data: {
      suggestedText: string
      position: { top: number; left: number; right: number; bottom: number }
    }) => {
      anchorPositionRef.current = anchorPositionRef.current
        ? {
            ...anchorPositionRef.current,
            top: data.position.top,
            bottom: data.position.bottom,
          }
        : data.position

      if (data.suggestedText) {
        setIsThinkingExpanded(false)
      }
      setSuggestion(prev => prev ? {
        ...prev,
        suggestedText: data.suggestedText,
      } : null)
    }

    const handleStreamingComplete = (data?: SuggestionData & PositionData) => {
      if (data) {
        anchorPositionRef.current = data.position
        setAiSuggestionHighlight(editor, data.generatedRange)
        setSuggestion({
          originalText: data.originalText,
          suggestedText: data.suggestedText,
          type: data.type,
          generatedRange: data.generatedRange,
        })
        setIsVisible(true)
      } else {
        clearAiSuggestionHighlight(editor)
      }

      setIsStreaming(false)
      setAbortController(null)
    }

    const handleAbortStreaming = () => {
      if (abortController) {
        abortController.abort()
      }

      setIsStreaming(false)
      setAbortController(null)

      const current = latestSuggestionRef.current
      clearAiSuggestionHighlight(editor)
      if (current) {
        editor.chain()
          .focus()
          .deleteSelection()
          .insertContent(current.originalText)
          .run()
      }

      anchorPositionRef.current = null
      setThinkingText('')
      setIsVisible(false)
      setSuggestion(null)
    }

    const handleShowSuggestion = (data: SuggestionData & PositionData & { editor: Editor }) => {
      if (data.editor !== editor) return

      anchorPositionRef.current = data.position
      setAiSuggestionHighlight(editor, data.generatedRange)
      setSuggestion({
        originalText: data.originalText,
        suggestedText: data.suggestedText,
        type: data.type,
        generatedRange: data.generatedRange,
      })
      setIsVisible(true)
      setIsStreaming(false)
    }

    emitter.on('start-ai-streaming', handleStartStreaming)
    emitter.on('update-ai-thinking-content', handleUpdateThinkingContent)
    emitter.on('update-ai-streaming-content', handleUpdateContent)
    emitter.on('ai-streaming-complete', handleStreamingComplete)
    emitter.on('show-ai-suggestion', handleShowSuggestion)
    emitter.on('abort-ai-streaming', handleAbortStreaming)

    return () => {
      emitter.off('start-ai-streaming', handleStartStreaming)
      emitter.off('update-ai-thinking-content', handleUpdateThinkingContent)
      emitter.off('update-ai-streaming-content', handleUpdateContent)
      emitter.off('ai-streaming-complete', handleStreamingComplete)
      emitter.off('show-ai-suggestion', handleShowSuggestion)
      emitter.off('abort-ai-streaming', handleAbortStreaming)
    }
  }, [editor, abortController])

  const handleAccept = useCallback(() => {
    clearAiSuggestionHighlight(editor)
    anchorPositionRef.current = null
    setThinkingText('')
    setIsVisible(false)
    setSuggestion(null)
  }, [editor])

  const handleReject = useCallback(() => {
    const current = latestSuggestionRef.current
    if (!current) return

    clearAiSuggestionHighlight(editor)

    if (current.generatedRange) {
      const command = editor.chain()
        .focus()
        .deleteRange(current.generatedRange)

      if (current.originalText) {
        command.insertContent(current.originalText)
      }

      command.run()
    } else {
      const command = editor.chain()
        .focus()
        .deleteSelection()

      if (current.originalText) {
        command.insertContent(current.originalText)
      }

      command.run()
    }

    anchorPositionRef.current = null
    setThinkingText('')
    setIsVisible(false)
    setSuggestion(null)
  }, [editor])

  const handleAbort = useCallback(() => {
    emitter.emit('abort-ai-streaming')
  }, [])

  useEffect(() => {
    if (!isVisible || isStreaming) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        handleAccept()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        handleReject()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleAccept, handleReject, isStreaming, isVisible])

  useEffect(() => {
    emitter.on('accept-ai-suggestion', handleAccept)
    emitter.on('reject-ai-suggestion', handleReject)

    return () => {
      emitter.off('accept-ai-suggestion', handleAccept)
      emitter.off('reject-ai-suggestion', handleReject)
    }
  }, [handleAccept, handleReject])

  if (!isVisible) return null

  const typeLabels: Record<string, string> = {
    polish: t('bubbleMenu.polish'),
    concise: t('bubbleMenu.concise'),
    expand: t('bubbleMenu.expand'),
    translate: t('bubbleMenu.translate'),
    continue: t('slashCommand.items.continue'),
    section: t('slashCommand.items.generateSection'),
    summary: t('slashCommand.items.summarize'),
    custom: t('slashCommand.items.customInstruction'),
  }

  const showThinkingPanel = Boolean(thinkingText)
  const currentLabel = suggestion && typeLabels[suggestion.type] ? typeLabels[suggestion.type] : t('bubbleMenu.ai')
  const rejectLabel = suggestion?.originalText ? t('aiSuggestion.reject') : t('aiSuggestion.undo')

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[320px] max-w-[calc(100%-24px)] rounded-xl border border-border/60 bg-background/96 text-foreground shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {showThinkingPanel && (
        <div className="border-b border-border/60">
          <button
            type="button"
            onClick={() => setIsThinkingExpanded(prev => !prev)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin text-blue-500" />
            ) : (
              <Brain className="size-4 text-blue-500" />
            )}
            <span className="flex-1 text-sm text-muted-foreground">
              {tCommon('ai.thinking')}
            </span>
            <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
          </button>

          {isThinkingExpanded && (
            <div
              ref={thinkingContentRef}
              className="max-h-36 overflow-y-auto px-3 pb-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words"
            >
              {thinkingText}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <span className="flex-1 text-sm font-medium">
          {isStreaming ? t('aiSuggestion.generating') : currentLabel}
        </span>
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="rounded-md p-1 transition-colors hover:bg-muted"
            title={t('aiSuggestion.abort')}
            type="button"
          >
            <CircleX className="size-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={handleAccept}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={t('aiSuggestion.accept')}
              type="button"
            >
              <Check className="size-4" />
            </button>
            <button
              onClick={handleReject}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={rejectLabel}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AISuggestionFloating
