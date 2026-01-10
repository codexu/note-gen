import useChatStore from '@/stores/chat'
import useTagStore from '@/stores/tag'
import { ArrowDownToLine, X } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { RagSources } from './rag-sources'
import { McpToolCallCard } from './mcp-tool-call'
import { AgentExecutionStatus } from './agent-execution-status'
import { AgentHistory } from './agent-history'
import { ChatImages } from "./chat-images"

export default function ChatContent() {
  const { chats, init, agentState } = useChatStore()
  const { currentTagId } = useTagStore()
  const [isOnBottom, setIsOnBottom] = useState(true)

  function handleScroll() {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    setIsOnBottom(md.scrollHeight - md.scrollTop - md.clientHeight < 1)
  }

  useEffect(() => {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    md.addEventListener('scroll', handleScroll)
    return () => {
      md.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    init(currentTagId)
  }, [currentTagId])

  // 监听消息变化，在底部时自动滚动
  useEffect(() => {
    if (isOnBottom) {
      scrollToBottom()
    }
  }, [chats, isOnBottom])

  // Agent 执行时自动滚动到底部
  useEffect(() => {
    if (agentState.isRunning) {
      scrollToBottom()
    }
  }, [agentState.currentThought, agentState.thoughtHistory, agentState.pendingConfirmation])

  return <div id="chats-wrapper" className="flex-1 relative overflow-y-auto overflow-x-hidden w-full flex flex-col items-end p-4 gap-6">
    {
      chats.length ? chats.map((chat) => {
        return <Message key={chat.id} chat={chat} />
      }) : <ChatEmpty />
    }
    
    {/* Agent 执行状态 - 在底部实时显示，包裹在 MessageWrapper 中保持布局一致 */}
    <AgentExecutionStatusWrapper />
    {
      !isOnBottom && <Button variant="outline" className='sticky bottom-0 size-8 right-0' onClick={scrollToBottom}>
        <ArrowDownToLine className='size-4' />
      </Button>
    }
  </div>
}

function MessageWrapper({ chat, children }: { chat: Chat, children: React.ReactNode }) {
  const { deleteChat } = useChatStore()
  const [showDelete, setShowDelete] = useState(false)

  const handleDelete = () => {
    deleteChat(chat.id)
  }
  
  // 用户消息：右对齐，带边框和背景
  if (chat.role === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div 
          className="group relative max-w-[85%] rounded-lg border bg-primary px-3 py-2"
          onMouseEnter={() => setShowDelete(true)}
          onMouseLeave={() => setShowDelete(false)}
        >
          <div className='text-sm leading-6 break-words text-primary-foreground'>
            {children}
          </div>
          {showDelete && (
            <Button 
              onClick={handleDelete} 
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
}

function AgentExecutionStatusWrapper() {
  const { agentState } = useChatStore()
  
  // 只在 Agent 运行时显示
  if (!agentState.isRunning) {
    return null
  }

  return (
    <div className="flex w-full min-w-0">
      <div className='text-sm leading-6 flex-1 break-words min-w-0 overflow-hidden'>
        <AgentExecutionStatus />
      </div>
    </div>
  )
}

function Message({ chat }: { chat: Chat }) {
  const t = useTranslations()
  const { deleteChat, getMcpToolCallsByChatId, agentState } = useChatStore()
  const content = chat.content

  const handleRemoveClearContext = () => {
    deleteChat(chat.id)
  }

  // 解析 RAG 引用的文件名
  const ragSources = chat.ragSources ? (() => {
    try {
      return JSON.parse(chat.ragSources) as string[]
    } catch {
      return []
    }
  })() : []
  
  // 获取该消息关联的 MCP 工具调用
  const mcpToolCalls = getMcpToolCallsByChatId(chat.id)
  
  // 解析图片数组
  const images = chat.images ? (() => {
    try {
      return JSON.parse(chat.images) as string[]
    } catch {
      return []
    }
  })() : []
  
  // 解析引用数据
  const quoteData = chat.quoteData ? (() => {
    try {
      return JSON.parse(chat.quoteData) as {
        quote: string
        fullContent: string
        fileName: string
        startLine: number
        endLine: number
        articlePath: string
      }
    } catch {
      return null
    }
  })() : null
  
  // 如果是空内容的 AI 消息且 Agent 正在运行，不显示（避免双头像）
  if (chat.role === 'system' && !chat.content && agentState.isRunning) {
    return null
  }

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
                <ChatPreview text={content || ''} />
              </div>
            }
            <MessageControl chat={chat}>
              <NoteOutput chat={chat} />
            </MessageControl>
          </div>
        }
      </MessageWrapper>

    default:
      return <MessageWrapper chat={chat}>
        <div className="w-full">
          {/* Agent 执行历史 - 显示保存的历史记录 */}
          {chat.role === 'system' && chat.agentHistory && (
            <AgentHistory historyJson={chat.agentHistory} />
          )}
          
          {/* MCP 工具调用展示 */}
          {mcpToolCalls.length > 0 && (
            <div className="space-y-4 mb-4">
              {mcpToolCalls.map(toolCall => (
                <McpToolCallCard key={toolCall.id} toolCall={toolCall} />
              ))}
            </div>
          )}
          {/* 显示用户消息中的图片 */}
          {chat.role === 'user' && images.length > 0 && (
            <ChatImages images={images} />
          )}
          {/* 显示用户消息中的引用 */}
          {chat.role === 'user' && quoteData && (
            <div className="mb-2 p-2 border-l-2 border-primary bg-muted/50 rounded">
              <div className="text-xs text-primary-foreground/80 mb-1 font-medium">
                {quoteData.startLine !== -1 && quoteData.endLine !== -1 ? (
                  quoteData.startLine === quoteData.endLine ? (
                    `引用自 ${quoteData.fileName} 第 ${quoteData.startLine} 行`
                  ) : (
                    `引用自 ${quoteData.fileName} 第 ${quoteData.startLine}-${quoteData.endLine} 行`
                  )
                ) : (
                  `引用自 ${quoteData.fileName}`
                )}
              </div>
              <div className="text-xs text-primary-foreground/70 line-clamp-3 whitespace-pre-wrap">
                {quoteData.fullContent}
              </div>
            </div>
          )}
          {chat.role === 'user' && content && (
            <div className="whitespace-pre-wrap">{content}</div>
          )}
          {chat.role === 'system' && (
            <>
              <ChatThinking chat={chat} />
              <ChatPreview text={content || ''} />
              <RagSources sources={ragSources} />
              <MessageControl chat={chat}>
                <MarkText chat={chat} />
              </MessageControl>
            </>
          )}
        </div>
      </MessageWrapper>
  }
}
