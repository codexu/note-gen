'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, useRef, Suspense, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Send, Settings, Users, Square, RefreshCw } from 'lucide-react'
import { 
  TavernGroup, 
  TavernCard, 
  TavernMessage,
  TavernGroupMember,
  getGroupById,
  getGroupMembers,
  getMessagesByChatId,
  insertMessage,
  getChatsByCardId,
  insertChat,
  updateMessage,
} from '@/db/tavern'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { buildGroupContext, GroupMemberWithCard } from '@/lib/tavern/group-context-builder'
import { TavernPersona, getDefaultPersona } from '@/db/tavern'
import { streamTavernResponse, checkAIServiceAvailable } from '@/lib/tavern'

type MemberWithCard = TavernGroupMember & TavernCard

function GroupChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const groupId = searchParams.get('id')
  
  const [group, setGroup] = useState<TavernGroup | null>(null)
  const [members, setMembers] = useState<MemberWithCard[]>([])
  const [messages, setMessages] = useState<TavernMessage[]>([])
  const [chatId, setChatId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [currentSpeaker, setCurrentSpeaker] = useState<MemberWithCard | null>(null)
  const [persona, setPersona] = useState<TavernPersona | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const scrollRef = useRef<HTMLDivElement>(null)
  
  // 加载 Persona
  useEffect(() => {
    async function loadPersona() {
      const defaultPersona = await getDefaultPersona()
      setPersona(defaultPersona)
    }
    loadPersona()
  }, [])

  useEffect(() => {
    loadData()
  }, [groupId])
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])
  
  const loadData = async () => {
    if (!groupId) {
      setIsLoading(false)
      return
    }
    
    try {
      const groupData = await getGroupById(parseInt(groupId))
      
      if (groupData) {
        setGroup(groupData)
        const membersData = await getGroupMembers(groupData.id)
        setMembers(membersData)
        
        // 获取或创建群组聊天会话
        if (membersData.length > 0) {
          const chats = await getChatsByCardId(membersData[0].cardId)
          const groupChat = chats.find(c => c.groupId === groupData.id)
          
          if (groupChat) {
            setChatId(groupChat.id)
            const messagesData = await getMessagesByChatId(groupChat.id)
            setMessages(messagesData)
          } else {
            const newChatId = await insertChat({
              cardId: membersData[0].cardId,
              groupId: groupData.id,
              name: `${groupData.name} 聊天`,
              metadata: '{}',
              integrity: crypto.randomUUID(),
            })
            if (newChatId !== undefined) {
              setChatId(newChatId)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load group chat:', error)
    } finally {
      setIsLoading(false)
    }
  }
  
  const getMemberByCardId = (cardId: number) => {
    return members.find(m => m.cardId === cardId)
  }
  
  const handleSend = async () => {
    if (!input.trim() || !groupId || !group || !chatId || isGenerating) return
    
    const messageId = await insertMessage({
      chatId,
      role: 'user',
      name: 'User',
      content: input.trim(),
    })
    
    if (messageId === undefined) return
    
    const userMessage: TavernMessage = {
      id: messageId,
      chatId,
      role: 'user',
      name: 'User',
      content: input.trim(),
      isHidden: false,
      swipeId: 0,
      swipes: '[]',
      sendDate: Date.now(),
      genStarted: null,
      genFinished: null,
      forceAvatar: '',
      originalAvatar: '',
      swipeInfo: '[]',
      extra: '{}',
      createdAt: Date.now(),
    }
    
    setMessages(prev => [...prev, userMessage])
    setInput('')
    
    // 获取自动对话轮数 (存储在 generationType 中)
    const autoTurns = group.generationType || 1
    
    setIsGenerating(true)
    abortControllerRef.current = new AbortController()
    
    try {
      let currentMessages = [...messages, userMessage]
      
      // 多轮自动对话
      for (let turn = 0; turn < autoTurns; turn++) {
        if (abortControllerRef.current?.signal.aborted) break
        
        const nextMember = selectNextMember(group, currentMessages, currentMessages[currentMessages.length - 1])
        if (!nextMember) break
        
        // 跳过静音成员
        if (nextMember.isMuted) continue
        
        setCurrentSpeaker(nextMember)
        setStreamingContent('')
        
        const response = await generateGroupResponseStream(
          nextMember, 
          currentMessages,
          (chunk) => {
            setStreamingContent(prev => prev + chunk)
          },
          abortControllerRef.current.signal,
          turn === 0 ? userMessage.content : undefined // 只有第一轮传递用户输入
        )
        
        if (response && !abortControllerRef.current?.signal.aborted) {
          const aiMessageId = await insertMessage({
            chatId,
            role: 'assistant',
            name: nextMember.name,
            content: response,
          })
          
          if (aiMessageId === undefined) break
          
          const aiMessage: TavernMessage = {
            id: aiMessageId,
            chatId,
            role: 'assistant',
            name: nextMember.name,
            content: response,
            isHidden: false,
            swipeId: 0,
            swipes: JSON.stringify([response]),
            sendDate: Date.now(),
            genStarted: null,
            genFinished: null,
            forceAvatar: nextMember.avatarPath || '',
            originalAvatar: nextMember.cardId.toString(),
            swipeInfo: '[]',
            extra: '{}',
            createdAt: Date.now(),
          }
          
          setMessages(prev => [...prev, aiMessage])
          currentMessages = [...currentMessages, aiMessage]
          setStreamingContent('')
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to generate response:', error)
      }
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setCurrentSpeaker(null)
      abortControllerRef.current = null
    }
  }
  
  // 停止生成
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])
  
  const selectNextMember = (
    group: TavernGroup,
    history: TavernMessage[],
    _lastMessage: TavernMessage
  ): MemberWithCard | null => {
    if (members.length === 0) return null
    
    const activeMembers = members.filter(m => m.isActive)
    if (activeMembers.length === 0) return members[0]
    
    if (group.activationStrategy === 1) {
      const lastCardId = [...history].reverse().find(m => m.originalAvatar)?.originalAvatar
      if (!lastCardId) {
        return activeMembers[0]
      }
      const currentIndex = activeMembers.findIndex(m => m.cardId.toString() === lastCardId)
      const nextIndex = (currentIndex + 1) % activeMembers.length
      return activeMembers[nextIndex]
    } else {
      const lastCardId = [...history].reverse().find(m => m.originalAvatar)?.originalAvatar
      let candidates = activeMembers
      if (!group.allowSelfResponses && lastCardId) {
        candidates = candidates.filter(m => m.cardId.toString() !== lastCardId)
      }
      if (candidates.length === 0) candidates = activeMembers
      const randomIndex = Math.floor(Math.random() * candidates.length)
      return candidates[randomIndex]
    }
  }
  
  const generateGroupResponseStream = async (
    member: MemberWithCard,
    history: TavernMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    userInput?: string
  ): Promise<string | null> => {
    if (!group || !persona) return null
    
    // 检查 AI 服务是否可用
    const isAvailable = await checkAIServiceAvailable()
    if (!isAvailable) {
      console.error('AI service not available')
      return null
    }
    
    try {
      // 使用新的群聊上下文构建器
      const contextResult = await buildGroupContext(
        group,
        members as GroupMemberWithCard[],
        member as GroupMemberWithCard,
        history,
        persona,
        userInput,
        {
          maxContext: 8192,
          maxResponse: 2048,
          includeWorldInfo: true,
          includeAuthorsNote: true,
        }
      )
      
      let fullContent = ''
      
      await streamTavernResponse(
        contextResult.messages,
        (content: string) => {
          // streamTavernResponse 返回的是累积内容，需要计算增量
          const chunk = content.slice(fullContent.length)
          fullContent = content
          if (chunk) onChunk(chunk)
        },
        undefined,
        { temperature: 0.7 },
        signal
      )
      
      return fullContent
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw error
      }
      console.error('Failed to generate response:', error)
      return null
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }
  
  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">群组不存在</p>
        <Button onClick={() => router.push('/core/tavern/groups')}>
          返回群组列表
        </Button>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push('/core/tavern/groups')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{group.name}</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              {members.length} 成员
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push(`/core/tavern/groups/edit?id=${groupId}`)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4 max-w-3xl mx-auto">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>开始与群组成员对话吧！</p>
              <p className="text-sm mt-2">
                成员: {members.filter(m => m.isActive && !m.isMuted).map(m => m.name).join(', ') || '无'}
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === 'user'
              const member = message.originalAvatar ? getMemberByCardId(parseInt(message.originalAvatar)) : null
              
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    isUser && 'flex-row-reverse'
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {member?.avatarPath ? (
                      <AvatarImage src={convertFileSrc(member.avatarPath)} />
                    ) : null}
                    <AvatarFallback>{isUser ? 'U' : (member?.name?.[0] || '?')}</AvatarFallback>
                  </Avatar>
                  <div className={cn('flex flex-col gap-1', isUser && 'items-end')}>
                    {!isUser && (
                      <span className="text-xs text-muted-foreground">
                        {message.name}
                      </span>
                    )}
                    <Card className={cn(
                      'p-3 max-w-[80%]',
                      isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    )}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </Card>
                  </div>
                </div>
              )
            })
          )}
          
          {/* 流式输出显示 */}
          {isGenerating && currentSpeaker && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                {currentSpeaker.avatarPath ? (
                  <AvatarImage src={convertFileSrc(currentSpeaker.avatarPath)} />
                ) : null}
                <AvatarFallback>{currentSpeaker.name[0]}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  {currentSpeaker.name}
                  <Badge variant="secondary" className="text-xs">生成中</Badge>
                </span>
                <Card className="p-3 bg-muted max-w-[80%]">
                  <p className="text-sm whitespace-pre-wrap">
                    {streamingContent || '...'}
                    <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
                  </p>
                </Card>
              </div>
            </div>
          )}
          
          {/* 等待下一个发言者 */}
          {isGenerating && !currentSpeaker && !streamingContent && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback>...</AvatarFallback>
              </Avatar>
              <Card className="p-3 bg-muted">
                <div className="flex gap-1">
                  <span className="animate-bounce">.</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                </div>
              </Card>
            </div>
          )}
        </div>
      </ScrollArea>
      
      <div className="p-4 border-t">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            disabled={isGenerating}
            className="flex-1"
          />
          {isGenerating ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="destructive" onClick={handleStop}>
                    <Square className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>停止生成</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function GroupChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    }>
      <GroupChatContent />
    </Suspense>
  )
}
