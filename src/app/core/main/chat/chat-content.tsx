import React from 'react'
import useChatStore from '@/stores/chat'
import useTagStore from '@/stores/tag'
import { BotMessageSquare, ChevronDown, X, Loader2, QuoteIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chat } from '@/db/chats'
import ChatPreview from './chat-preview'
import './chat.css'
import { NoteOutput } from './message-control/note-output'
import { MarkText } from './message-control/mark-text'
import { ChatClipboard } from './chat-clipboard'
import MessageControl from './message-control'
import ChatEmpty from './chat-empty'
import { useTranslations } from 'next-intl'
import ChatThinking from './chat-thinking'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { McpToolCallCard } from './mcp-tool-call'
import { AgentExecutionStatus } from './agent-execution-status'
import { AgentPanelWithRag } from './agent-panel-with-rag'
import { ChatImages } from "./chat-images"
import {
  buildChatImageContext,
  parseChatImageAnalyses,
  serializeChatImageAnalyses,
  type PersistedChatImageAnalysis,
} from '@/lib/chat-image-context'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { parsePersistedChatAttachments } from '@/lib/chat-attachments'
import { ChatAttachmentSummary } from './chat-file-attachments'
import emitter from '@/lib/emitter'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseModelChangeMarker } from './model-selection'
import { PluginChatMessageActions } from '@/components/plugins/plugin-embedded-views'

interface DisplayedConversationCompaction {
  revision: number
  coveredThroughChatId: number
  sourceTokenCount: number
  summaryTokenCount: number
  summary: string
}

const ChatContent = React.memo(function ChatContent() {
  const { chats, init, agentState, loading, currentConversationId } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations()
  const [compactionRunning, setCompactionRunning] = useState(false)
  const [latestCompaction, setLatestCompaction] = useState<DisplayedConversationCompaction | null>(null)
  const [expandedCompactionRevision, setExpandedCompactionRevision] = useState<number | null>(null)

  useEffect(() => {
    init(currentTagId)
  }, [currentTagId, init])

  useEffect(() => {
    let cancelled = false
    setCompactionRunning(false)
    setLatestCompaction(null)
    setExpandedCompactionRevision(null)

    if (!currentConversationId) {
      return
    }

    void import('@/db/conversation-compactions')
      .then(({ getLatestConversationCompaction }) =>
        getLatestConversationCompaction(currentConversationId)
      )
      .then(compaction => {
        if (!cancelled) {
          setLatestCompaction(compaction)
        }
      })
      .catch(error => {
        console.error('[ConversationCompaction] Failed to load display state:', error)
      })

    return () => {
      cancelled = true
    }
  }, [currentConversationId])

  useEffect(() => {
    const handleStatus = (event: {
      conversationId: number
      status: 'running' | 'completed' | 'failed'
      revision?: number
      coveredThroughChatId?: number
      sourceTokenCount?: number
      summaryTokenCount?: number
      summary?: string
    }) => {
      if (event.conversationId !== currentConversationId) {
        return
      }

      setCompactionRunning(event.status === 'running')
      if (
        event.status === 'completed'
        && typeof event.revision === 'number'
        && typeof event.coveredThroughChatId === 'number'
        && typeof event.sourceTokenCount === 'number'
        && typeof event.summaryTokenCount === 'number'
        && typeof event.summary === 'string'
      ) {
        setLatestCompaction({
          revision: event.revision,
          coveredThroughChatId: event.coveredThroughChatId,
          sourceTokenCount: event.sourceTokenCount,
          summaryTokenCount: event.summaryTokenCount,
          summary: event.summary,
        })
      }
    }

    emitter.on('conversation-compaction-status', handleStatus)
    return () => {
      emitter.off('conversation-compaction-status', handleStatus)
    }
  }, [currentConversationId])

  const activeCompaction = useMemo(() => {
    if (!latestCompaction) {
      return null
    }

    const lastClear = chats.findLast(chat => chat.type === 'clear')
    return lastClear && latestCompaction.coveredThroughChatId <= lastClear.id
      ? null
      : latestCompaction
  }, [chats, latestCompaction])

  const compactedMessageCount = useMemo(() => {
    if (!activeCompaction) {
      return 0
    }

    const lastClearIndex = chats.findLastIndex(chat => chat.type === 'clear')
    return chats
      .slice(lastClearIndex + 1)
      .filter(chat =>
        (chat.type === 'chat' || chat.type === 'note')
        && chat.id <= activeCompaction.coveredThroughChatId
      )
      .length
  }, [activeCompaction, chats])

  // 判断是否应该显示 loading：loading=true 且最后一个 AI 消息还没有内容
  const shouldShowLoading = useMemo(() => {
    if (!loading) return false
    if (compactionRunning) return false
    if (agentState.isRunning) return false

    const lastChat = chats[chats.length - 1]
    // 如果最后一个消息是 system 角色且有内容或思考内容，说明 AI 已经开始输出了
    if (lastChat?.role === 'system' && (lastChat.content || lastChat.thinking)) {
      return false
    }

    return true
  }, [loading, compactionRunning, agentState.isRunning, chats])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={8}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport id="chats-wrapper" className="overflow-x-hidden p-4">
          <MessageScrollerContent
            className={cn("items-end", chats.length === 0 && "h-full")}
          >
            {chats.length ? chats.map((chat) => (
              <React.Fragment key={chat.id}>
                <MessageScrollerItem
                  messageId={String(chat.id)}
                  scrollAnchor={chat.role === 'user'}
                  className="w-full"
                >
                  <Message chat={chat} />
                </MessageScrollerItem>
                {activeCompaction?.coveredThroughChatId === chat.id && (
                  <MessageScrollerItem className="w-full">
                    <div className="flex w-full flex-col gap-2 py-1 text-xs text-muted-foreground">
                      <div
                        className="flex w-full items-center gap-3"
                        title={`${activeCompaction.sourceTokenCount} → ${activeCompaction.summaryTokenCount} tokens`}
                      >
                        <Separator className="flex-1" />
                        <button
                          type="button"
                          className="flex items-center gap-1 transition-colors hover:text-foreground"
                          aria-expanded={expandedCompactionRevision === activeCompaction.revision}
                          onClick={() => setExpandedCompactionRevision(current => (
                            current === activeCompaction.revision ? null : activeCompaction.revision
                          ))}
                        >
                          <span>{t('record.chat.condensed.message', { count: compactedMessageCount })}</span>
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition-transform",
                              expandedCompactionRevision === activeCompaction.revision && "rotate-180"
                            )}
                          />
                        </button>
                        <Separator className="flex-1" />
                      </div>
                      {expandedCompactionRevision === activeCompaction.revision && (
                        <div className="mx-auto w-full max-w-2xl rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                          <div className="mb-2 font-medium">{t('record.chat.condensed.summary')}</div>
                          {activeCompaction.summary}
                        </div>
                      )}
                    </div>
                  </MessageScrollerItem>
                )}
              </React.Fragment>
            )) : (
              <MessageScrollerItem className="flex min-h-full w-full flex-1">
                <ChatEmpty />
              </MessageScrollerItem>
            )}

            {compactionRunning && (
              <MessageScrollerItem className="w-full">
                <div className="flex w-full items-center gap-3 py-1 text-xs text-muted-foreground">
                  <Separator className="flex-1" />
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('record.chat.condensing')}
                  </span>
                  <Separator className="flex-1" />
                </div>
              </MessageScrollerItem>
            )}

            {shouldShowLoading && (
              <MessageScrollerItem className="w-full">
                <div className="flex w-full min-w-0">
                  <div className="flex flex-1 items-center gap-2 text-sm leading-6 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>{t('record.chat.input.agent.thinking')}</span>
                  </div>
                </div>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
})
ChatContent.displayName = 'ChatContent'

const MessageWrapper = React.memo(function MessageWrapper({ chat, children }: { chat: Chat, children: React.ReactNode }) {
  const { deleteChat } = useChatStore()
  const [showDelete, setShowDelete] = useState(false)
  const isMobile = useIsMobile()

  const handleDelete = useCallback(() => {
    deleteChat(chat.id)
  }, [chat.id, deleteChat])
  const shouldShowDelete = showDelete

  // 用户消息：右对齐，带边框和背景
  if (chat.role === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div
          className="group relative max-w-[85%] rounded-lg border px-3 py-2"
          onMouseEnter={() => {
            if (!isMobile) setShowDelete(true)
          }}
          onMouseLeave={() => {
            if (!isMobile) setShowDelete(false)
          }}
          onClick={() => {
            if (isMobile) setShowDelete((prev) => !prev)
          }}
        >
          <div className='text-sm leading-6 wrap-break-word text-primary-foreground'>
            {children}
          </div>
          <div onClick={event => event.stopPropagation()}><PluginChatMessageActions conversationId={chat.conversationId} messageId={chat.id} role={chat.role} messageType={chat.type} /></div>
          {shouldShowDelete && (
            <Button
              onClick={(event) => {
                event.stopPropagation()
                handleDelete()
              }}
              size="icon"
              variant="ghost"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border shadow-sm"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  // AI 消息：左对齐，无边框，无图标
  return (
    <div className="flex w-full min-w-0">
      <div className='text-sm leading-6 flex-1 word-break min-w-0 overflow-hidden'>
        {children}
        <PluginChatMessageActions conversationId={chat.conversationId} messageId={chat.id} role={chat.role} messageType={chat.type} />
      </div>
    </div>
  )
})
MessageWrapper.displayName = 'MessageWrapper'

const Message = React.memo(function Message({ chat }: { chat: Chat }) {
  const t = useTranslations()
  const { chats, deleteChat, getMcpToolCallsByChatId, loading, agentState, saveChat } = useChatStore()
  const content = chat.content
  const isActiveAgentMessage = chat.role === 'system' && agentState.activeChatId === chat.id
  const latestChatId = chats[chats.length - 1]?.id
  const isLatestSystemMessage = chat.role === 'system' && latestChatId === chat.id
  const isGeneratingMessage = chat.role === 'system' && (
    (loading && isLatestSystemMessage) ||
    (isActiveAgentMessage && agentState.isRunning)
  )
  const liveAgentContent = isActiveAgentMessage && agentState.isFinalAnswerMode
    ? agentState.finalAnswerContent
    : undefined
  const hasLiveAgentTrace = Boolean(
    agentState.completedSteps?.length ||
    agentState.traceEvents?.some((event) => event.type !== 'final') ||
    agentState.pendingConfirmation
  )
  const isLiveAgentVisible = isActiveAgentMessage && (agentState.isRunning || agentState.isFinalAnswerMode || hasLiveAgentTrace)

  const handleRemoveClearContext = useCallback(() => {
    deleteChat(chat.id)
  }, [chat.id, deleteChat])

  // 解析 RAG 来源
  const ragSources = useMemo(() => {
    if (!chat.ragSources) return []
    try {
      return JSON.parse(chat.ragSources) as string[]
    } catch {
      return []
    }
  }, [chat.ragSources])

  // 解析 RAG 来源详情
  const ragSourceDetails = useMemo(() => {
    if (!chat.ragSourceDetails) return []
    try {
      return JSON.parse(chat.ragSourceDetails) as Array<{
        filepath: string
        filename: string
        content: string
        sourceKey?: string
        sourceType?: 'article' | 'record' | 'canvas'
        sourceId?: string
        locator?: {
          filePath?: string
          markId?: number
          tagId?: number
          canvasId?: string
          nodeIds?: string[]
        }
        updatedAt?: number
      }>
    } catch {
      return []
    }
  }, [chat.ragSourceDetails])

  // 获取该消息关联的 MCP 工具调用
  const mcpToolCalls = useMemo(() => getMcpToolCallsByChatId(chat.id), [chat.id, getMcpToolCallsByChatId])

  // 解析图片数组
  const images = useMemo(() => {
    if (!chat.images) return []
    try {
      return JSON.parse(chat.images) as string[]
    } catch {
      return []
    }
  }, [chat.images])
  const imageAnalyses = useMemo(
    () => parseChatImageAnalyses(chat.imageAnalyses),
    [chat.imageAnalyses]
  )
  const displayImageAnalyses = useMemo(
    () => images.map((imageUrl, index) => (
      imageAnalyses[index] ?? {
        imageId: `legacy-${chat.id}-${index}`,
        sourceUrl: imageUrl,
        name: `image-${index + 1}`,
        status: 'failed' as const,
        method: 'none' as const,
        errorCode: 'recognition_failed' as const,
        errorMessage: 'This image has not been analyzed yet.',
        updatedAt: chat.createdAt,
      }
    )),
    [chat.createdAt, chat.id, imageAnalyses, images]
  )
  const retryImageAnalysis = useCallback(async (
    analysis: PersistedChatImageAnalysis,
    index: number
  ) => {
    const pendingAnalyses = displayImageAnalyses.map(item => (
      item.imageId === analysis.imageId
        ? { ...item, status: 'pending' as const, errorCode: undefined, errorMessage: undefined }
        : item
    ))
    const pendingMessage = {
      ...chat,
      imageAnalyses: serializeChatImageAnalyses(pendingAnalyses),
    }
    await saveChat(pendingMessage, true)
    const result = await buildChatImageContext(
      [{
        id: analysis.imageId,
        url: images[index] || analysis.sourceUrl,
        name: analysis.name,
      }],
      chat.content?.trim() || t('record.chat.input.addAttachment.attachmentOnlyPrompt')
    )
    const completedAnalyses = displayImageAnalyses.map(item => (
      item.imageId === analysis.imageId
        ? result.analyses[0]
        : item
    ))
    await saveChat({
      ...chat,
      imageAnalyses: serializeChatImageAnalyses(completedAnalyses),
    }, true)
  }, [chat, displayImageAnalyses, images, saveChat, t])

  const attachments = useMemo(
    () => parsePersistedChatAttachments(chat.attachments),
    [chat.attachments]
  )

  // 解析引用数据
  const quoteData = useMemo(() => {
    if (!chat.quoteData) return null
    try {
      return JSON.parse(chat.quoteData) as {
        quote: string
        fullContent: string
        fileName: string
        startLine: number
        endLine: number
        from: number
        to: number
        articlePath: string
      }
    } catch {
      return null
    }
  }, [chat.quoteData])

  switch (chat.type) {
    case 'model_change': {
      const marker = parseModelChangeMarker(chat.content)
      if (!marker) return null
      const compactModelName = marker.toModel.split('/').filter(Boolean).at(-1) || marker.toModel
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Marker role="status" className="min-w-0 py-1">
              <MarkerIcon><BotMessageSquare /></MarkerIcon>
              <MarkerContent className="flex-1 truncate">
                {t('record.chat.input.modelSelect.changedTo', { model: compactModelName })}
              </MarkerContent>
              {marker.appliesNextTurn && (
                <Badge variant="secondary" className="shrink-0">
                  {t('record.chat.input.modelSelect.nextTurnBadge')}
                </Badge>
              )}
            </Marker>
          </TooltipTrigger>
          <TooltipContent>
            {t('record.chat.input.modelSelect.changed', {
              from: marker.fromModel,
              to: marker.toModel,
            })}
          </TooltipContent>
        </Tooltip>
      )
    }

    case 'clear':
      return <div className="w-full flex justify-center items-center gap-4 px-10">
        <Separator className='flex-1' />
        <div className="flex justify-center items-center gap-2 w-32 group h-8">
          <p className="text-sm text-center text-muted-foreground">{t('record.chat.input.clearContext.tooltip')}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 md:hidden md:group-hover:inline-flex"
            aria-label={t('common.delete')}
            onClick={handleRemoveClearContext}
          >
            <X />
          </Button>
        </div>
        <Separator className='flex-1' />
      </div>

    case 'clipboard':
      return <MessageWrapper chat={chat}>
        <ChatClipboard chat={chat} />
      </MessageWrapper>

    case 'note':
      return <MessageWrapper chat={chat}>
        {
          <div className='w-full overflow-x-hidden'>
            <div className='flex justify-between'>
              <p>{t('record.chat.content.organize')}</p>
            </div>
            <ChatThinking chat={chat} />
            {
              <div className={`${content ? 'note-wrapper border w-full overflow-y-auto overflow-x-hidden my-2 p-4 rounded-lg' : ''}`}>
                <ChatPreview text={content || ''} streaming={loading && chat.role === 'system'} />
              </div>
            }
            {!isGeneratingMessage && (
              <MessageControl chat={chat}>
                <NoteOutput chat={chat} />
              </MessageControl>
            )}
          </div>
        }
      </MessageWrapper>

    default:
      // 检查 AI 消息是否有实际内容（没有内容时不渲染）
      const hasContent = chat.role === 'system' && (
        !!content ||
        !!chat.thinking ||
        (chat.agentHistory && chat.agentHistory.length > 0) ||
        ragSources.length > 0 ||
        ragSourceDetails.length > 0 ||
        mcpToolCalls.length > 0 ||
        isLiveAgentVisible
      )

      // 用户消息或有内容的 AI 消息才渲染
      if (chat.role === 'system' && !hasContent) {
        return null
      }

      return <MessageWrapper chat={chat}>
        {chat.role === 'system' ? (
          // AI 消息：所有内容放在一个容器中
          <div className="w-full space-y-4">
            {/* 合并的 RAG 和 Agent 面板 - 只在有 agentHistory 时显示（历史模式） */}
            {/* 实时执行时，RAG 和 Agent 步骤在 AgentExecutionStatusWrapper 中统一显示 */}
            {chat.agentHistory && (
              <AgentPanelWithRag
                ragSources={ragSources}
                ragSourceDetails={ragSourceDetails}
                agentHistoryJson={chat.agentHistory}
              />
            )}

            {isLiveAgentVisible && (
              <div className="space-y-2">
                {(agentState.isRunning || hasLiveAgentTrace) && (
                  <AgentExecutionStatus />
                )}
              </div>
            )}

            {/* MCP 工具调用展示 */}
            {mcpToolCalls.length > 0 && (
              <div className="space-y-4">
                {mcpToolCalls.map(toolCall => (
                  <McpToolCallCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </div>
            )}

            <ChatThinking chat={chat} />
            <ChatPreview
              text={liveAgentContent ?? content ?? ''}
              streaming={isGeneratingMessage}
            />
            {!isGeneratingMessage && (
              <MessageControl chat={chat}>
                <MarkText chat={chat} />
              </MessageControl>
            )}
          </div>
        ) : (
          // 用户消息
          <div className="w-full space-y-3 text-primary">
            {/* 显示用户消息中的图片 */}
            {images.length > 0 && (
              <ChatImages
                images={images}
                analyses={displayImageAnalyses}
                onRetry={retryImageAnalysis}
              />
            )}
            <ChatAttachmentSummary attachments={attachments} />
            {/* 显示用户消息中的引用 */}
            {quoteData && (
              <div className="flex flex-col gap-1 text-[11px]">
                <div className="flex items-center gap-1">
                  <QuoteIcon className="size-3 text-primary/75" />
                  <span className="text-primary/75">
                    {quoteData.startLine !== -1 && quoteData.endLine !== -1 ? (
                      quoteData.startLine === quoteData.endLine ? (
                        t('record.chat.quote.lineSingle', { fileName: quoteData.fileName, line: quoteData.startLine })
                      ) : (
                        t('record.chat.quote.lineRange', { fileName: quoteData.fileName, startLine: quoteData.startLine, endLine: quoteData.endLine })
                      )
                    ) : (
                      t('record.chat.quote.noLine', { fileName: quoteData.fileName })
                    )}
                  </span>
                </div>
                <div className="text-primary/50 line-clamp-2 whitespace-pre-wrap pl-4">
                  {quoteData.fullContent}
                </div>
              </div>
            )}
            {content && (
              <div className="whitespace-pre-wrap">{content}</div>
            )}
          </div>
        )}
      </MessageWrapper>
  }
})
Message.displayName = 'Message'

export default ChatContent
