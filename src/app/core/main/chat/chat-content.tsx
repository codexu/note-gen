import React from 'react'
import useChatStore from '@/stores/chat'
import useTagStore from '@/stores/tag'
import { ArrowDownToLine, X, Loader2, QuoteIcon } from 'lucide-react'
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
import { scrollToBottom } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { McpToolCallCard } from './mcp-tool-call'
import { AgentExecutionStatus } from './agent-execution-status'
import { AgentPanelWithRag } from './agent-panel-with-rag'
import { ChatImages } from "./chat-images"
import { useIsMobile } from '@/hooks/use-mobile'

const ChatContent = React.memo(function ChatContent() {
  const { chats, init, agentState, loading } = useChatStore()
  const { currentTagId } = useTagStore()
  const [isOnBottom, setIsOnBottom] = useState(true)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

  const handleScroll = useCallback(() => {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    const onBottom = md.scrollHeight - md.scrollTop - md.clientHeight < 1
    setIsOnBottom(onBottom)

    // 当用户滚动到顶部时，禁用自动滚动；滚动到底部时，启用自动滚动
    if (onBottom) {
      setAutoScrollEnabled(true)
    } else {
      setAutoScrollEnabled(false)
    }
  }, [])

  // 手动滚动到底部并启用自动滚动
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
    setAutoScrollEnabled(true)
  }, [])

  useEffect(() => {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    md.addEventListener('scroll', handleScroll)
    return () => {
      md.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  useEffect(() => {
    init(currentTagId)
  }, [currentTagId, init])

  // 监听消息变化，仅在启用自动滚动时才滚动
  useEffect(() => {
    if (autoScrollEnabled) {
      scrollToBottom()
    }
  }, [chats, autoScrollEnabled])

  // Agent 执行时，仅在启用自动滚动时才滚动到底部
  useEffect(() => {
    if (autoScrollEnabled && agentState.isRunning) {
      scrollToBottom()
    }
  }, [agentState.currentThought, agentState.thoughtHistory, agentState.pendingConfirmation, agentState.isRunning, autoScrollEnabled])

  // Loading 状态变化时，仅在启用自动滚动时才滚动到底部
  useEffect(() => {
    if (autoScrollEnabled && loading) {
      scrollToBottom()
    }
  }, [loading, autoScrollEnabled])

  // 判断是否应该显示 loading：loading=true 且最后一个 AI 消息还没有内容
  const shouldShowLoading = useMemo(() => {
    if (!loading) return false
    if (agentState.isRunning) return false

    const lastChat = chats[chats.length - 1]
    // 如果最后一个消息是 system 角色且有内容或思考内容，说明 AI 已经开始输出了
    if (lastChat?.role === 'system' && (lastChat.content || lastChat.thinking)) {
      return false
    }

    return true
  }, [loading, agentState.isRunning, chats])

  return <div id="chats-wrapper" className="flex-1 relative overflow-y-auto overflow-x-hidden w-full flex flex-col items-end p-4 gap-6">
    {
      chats.length ? chats.map((chat) => {
        return <Message key={chat.id} chat={chat} />
      }) : <ChatEmpty />
    }

    {/* Loading 指示器 - 服务器等待时显示 */}
    {shouldShowLoading && (
      <div className="flex w-full min-w-0 -mt-6">
        <div className='text-sm leading-6 flex-1 flex items-center gap-2 text-muted-foreground'>
          <Loader2 className="size-4 animate-spin" />
          <span>正在思考...</span>
        </div>
      </div>
    )}

    {
      !isOnBottom && <Button variant="outline" className='sticky bottom-0 size-8 right-0' onClick={handleScrollToBottom}>
        <ArrowDownToLine className='size-4' />
      </Button>
    }
  </div>
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
      </div>
    </div>
  )
})
MessageWrapper.displayName = 'MessageWrapper'

const Message = React.memo(function Message({ chat }: { chat: Chat }) {
  const t = useTranslations()
  const { deleteChat, getMcpToolCallsByChatId, loading, agentState } = useChatStore()
  const content = chat.content
  const isActiveAgentMessage = chat.role === 'system' && agentState.activeChatId === chat.id
  const isLiveAgentVisible = isActiveAgentMessage && (agentState.isRunning || agentState.isFinalAnswerMode)

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
    case 'clear':
      return <div className="w-full flex justify-center items-center gap-4 px-10">
        <Separator className='flex-1' />
        <div className="flex justify-center items-center gap-2 w-32 group h-8">
          <p className="text-sm text-center text-muted-foreground">{t('record.chat.input.clearContext.tooltip')}</p>
          <X className="size-4 hidden group-hover:flex cursor-pointer" onClick={handleRemoveClearContext} />
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
            <MessageControl chat={chat}>
              <NoteOutput chat={chat} />
            </MessageControl>
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
                {!agentState.isFinalAnswerMode && (agentState.isRunning || agentState.completedSteps?.length > 0 || agentState.thoughtHistory?.length > 0) && (
                  <AgentExecutionStatus />
                )}
                {agentState.isFinalAnswerMode && agentState.finalAnswerContent && (
                  <ChatPreview
                    text={agentState.finalAnswerContent}
                    streaming={loading && isActiveAgentMessage}
                  />
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
            <ChatPreview text={content || ''} streaming={loading && isActiveAgentMessage} />
            <MessageControl chat={chat}>
              <MarkText chat={chat} />
            </MessageControl>
          </div>
        ) : (
          // 用户消息
          <div className="w-full space-y-3 text-primary">
            {/* 显示用户消息中的图片 */}
            {images.length > 0 && <ChatImages images={images} />}
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
