'use client'

import { useState, useEffect, useRef, useCallback, useMemo, memo, TouchEvent } from 'react'
import {
  TavernCard,
  TavernChat,
  TavernMessage,
  TavernMessageExtra,
  TavernPersona,
  TavernPreset,
  insertChat,
  insertMessage,
  getMessagesByChatId,
  getChatsByCardId,
  updateChatTimestamp,
  getPresets,
  getCardBoundPreset,
  bindPresetToCard,
  updateMessage,
  deleteMessage,
  getLastMessage,
} from '@/db/tavern'
import { 
  buildTavernContext,
  buildUnifiedContext,
  AIMessage, 
  streamTavernResponse,
  checkAIServiceAvailable,
  StreamingProcessor,
  StreamingState,
  formatGenerationTimer,
  switchSwipe,
  deleteSwipe,
  addSwipe,
  type ContextBuildOptions,
} from '@/lib/tavern'
import { useTavernAuthorsNoteStore } from '@/stores/tavern-authors-note'
import { useTavernChatBackupStore } from '@/stores/tavern-chat-backup'
import { useTavernLogitBiasStore } from '@/stores/tavern-logit-bias'
import { useTavernCfgScaleStore } from '@/stores/tavern-cfg-scale'
import { useTavernImageCaptionStore, ImageAttachment } from '@/stores/tavern-image-caption'
import { useBackgroundsStore } from '@/stores/tavern-backgrounds'
import { useStatsStore, countWords } from '@/stores/tavern-stats'
import { usePromptManagerStore } from '@/stores/tavern-prompt-manager'
import { AuthorsNotePanel } from './authors-note-panel'
import { TokenCounter } from './token-counter'
import { BookmarksPanel } from './bookmarks-panel'
import { QuickReplyBar } from './quick-reply-bar'
import { ChatBackupsPanel } from './chat-backups-panel'
import { LogitBiasPanel } from './logit-bias-panel'
import { CfgScalePanel } from './cfg-scale-panel'
import { MemoryPanel } from './memory-panel'
import { TranslatePanel } from './translate-panel'
import { ImageCaptionPanel } from './image-caption-panel'
import { TTSPanel } from './tts-panel'
import { ExpressionsPanel } from './expressions-panel'
import { AttachmentsPanel } from './attachments-panel'
import { VectorsPanel } from './vectors-panel'
import { MacrosVariablesPanel } from './macros-variables-panel'
import { ToolCallingPanel } from './tool-calling-panel'
import { ReasoningSettingsPanel } from './reasoning-settings-panel'
import { BackgroundsPanel } from './backgrounds-panel'
import { StatsPanel } from './stats-panel'
import { GalleryPanel } from './gallery-panel'
import { DataMaidPanel } from './data-maid-panel'
import { PromptManagerPanel } from './prompt-manager-panel'
import { PersonaIndicator } from './persona-indicator'
import { BranchIndicator } from './branch-indicator'
import { MessageBranchButton } from './message-branch-button'
import { ProfileSelector } from './connection-profiles'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { 
  Send, 
  MoreVertical, 
  Info, 
  RefreshCw, 
  ArrowLeft, 
  Settings2, 
  Pencil,
  Square,
  ChevronLeft,
  ChevronRight,
  Clock,
  Brain,
  ChevronDown,
  Plus,
  Trash2,
  FastForward,
  User,
  Image as ImageIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useRouter } from 'next/navigation'

interface ChatWindowProps {
  card: TavernCard
  chat: TavernChat | null
  persona: TavernPersona
  onChatSelect: (chat: TavernChat | null) => void
  onToggleInfo: () => void
  onBack?: () => void
  isMobile?: boolean
  /** Persona 变更回调 */
  onPersonaChange?: (persona: TavernPersona) => void
}

export function ChatWindow({
  card,
  chat,
  persona,
  onChatSelect,
  onToggleInfo,
  onBack,
  isMobile = false,
  onPersonaChange,
}: ChatWindowProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<TavernMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null)
  const [presets, setPresets] = useState<TavernPreset[]>([])
  const [currentPreset, setCurrentPreset] = useState<TavernPreset | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamingProcessorRef = useRef<StreamingProcessor | null>(null)
  
  // Author's Note 状态
  const { getEffectiveConfig: getAuthorsNoteConfig } = useTavernAuthorsNoteStore()
  
  // Chat Backup 状态
  const { shouldBackup, createBackup } = useTavernChatBackupStore()
  
  // Logit Bias 状态
  const { toApiFormat: getLogitBias } = useTavernLogitBiasStore()
  
  // CFG Scale 状态
  const { isEnabled: isCfgEnabled, getCombinedPrompts: getCfgPrompts } = useTavernCfgScaleStore()
  
  // 背景状态
  const { getCurrentBackground, globalFitting, globalOpacity, globalBlur, globalBrightness } = useBackgroundsStore()
  
  // 统计状态
  const { recordMessage } = useStatsStore()
  
  // 手势状态
  const touchStartX = useRef<number>(0)
  const touchStartY = useRef<number>(0)

  // 加载预设列表和角色绑定的预设
  useEffect(() => {
    async function loadPresets() {
      const allPresets = await getPresets()
      // 只显示 Completion 类型的预设
      const completionPresets = allPresets.filter(p => {
        try {
          const data = JSON.parse(p.data)
          return data.type === 'completion'
        } catch {
          return false
        }
      })
      setPresets(completionPresets)
      
      // 获取角色绑定的预设
      const boundPreset = await getCardBoundPreset(card)
      if (boundPreset) {
        setCurrentPreset(boundPreset)
      } else if (completionPresets.length > 0) {
        // 没有绑定时使用默认预设
        const defaultPreset = completionPresets.find(p => p.isDefault) || completionPresets[0]
        setCurrentPreset(defaultPreset)
      }
    }
    loadPresets()
  }, [card])

  // 切换预设
  const handlePresetChange = useCallback(async (preset: TavernPreset) => {
    setCurrentPreset(preset)
    // 绑定预设到角色卡
    await bindPresetToCard(card.id, preset.id)
  }, [card.id])

  // 加载或创建聊天会话
  useEffect(() => {
    async function initChat() {
      if (!card) return

      // 获取该角色的所有聊天会话
      const chats = await getChatsByCardId(card.id)

      if (chats.length > 0) {
        // 使用最新的聊天会话
        onChatSelect(chats[0])
      } else {
        // 创建新的聊天会话
        const chatId = await insertChat({
          cardId: card.id,
          groupId: null,
          name: `与 ${card.name} 的对话`,
          metadata: '',
          integrity: '',
        })
        
        // 添加初始消息
        if (card.firstMes) {
          await insertMessage({
            chatId: chatId!,
            role: 'assistant',
            name: card.name,
            content: card.firstMes,
            isHidden: false,
            swipeId: 0,
            swipes: JSON.stringify([card.firstMes]),
          })
        }

        const newChats = await getChatsByCardId(card.id)
        if (newChats.length > 0) {
          onChatSelect(newChats[0])
        }
      }
    }
    initChat()
  }, [card, onChatSelect])

  // 加载消息
  useEffect(() => {
    async function loadMessages() {
      if (!chat) {
        setMessages([])
        return
      }
      const msgs = await getMessagesByChatId(chat.id)
      setMessages(msgs)
    }
    loadMessages()
  }, [chat])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !chat || isGenerating) return

    const userContent = inputValue.trim()
    setInputValue('')
    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoning('')
    setStreamingState(null)

    try {
      // 1. 保存用户消息
      await insertMessage({
        chatId: chat.id,
        role: 'user',
        name: persona.name,
        content: userContent,
        isHidden: false,
        swipeId: 0,
        swipes: JSON.stringify([userContent]),
        sendDate: Date.now(),
      })
      
      // 记录用户消息统计
      recordMessage({
        characterId: card.id.toString(),
        isUser: true,
        wordCount: countWords(userContent),
      })

      // 刷新消息列表
      const updatedMessages = await getMessagesByChatId(chat.id)
      setMessages(updatedMessages)

      // 2. 构建上下文 - 使用 V2 统一接口
      const authorsNoteConfig = getAuthorsNoteConfig(card.id, chat.id)
      const contextResult = await buildUnifiedContext(
        card,
        persona,
        updatedMessages,
        userContent,
        {
          maxContext: 8192,
          maxResponse: 1024,
          authorsNote: authorsNoteConfig.enabled ? authorsNoteConfig : null,
        }
      )
      const aiMessages = contextResult.messages

      // 3. 创建 StreamingProcessor
      const processor = new StreamingProcessor(
        {
          type: 'normal',
          chatId: chat.id,
          characterName: card.name,
          userName: persona.name,
          showReasoning: true,
        },
        {
          onContentUpdate: (content, state) => {
            setStreamingContent(content)
            setStreamingState({ ...state })
          },
          onReasoningUpdate: (reasoning, state) => {
            setStreamingReasoning(reasoning)
            setStreamingState({ ...state })
          },
          onFinish: async () => {
            // 更新聊天时间戳
            await updateChatTimestamp(chat.id)
            // 刷新消息列表
            const finalMessages = await getMessagesByChatId(chat.id)
            setMessages(finalMessages)
            // 记录统计
            const lastMsg = finalMessages[finalMessages.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              recordMessage({
                characterId: card.id.toString(),
                isUser: false,
                wordCount: countWords(lastMsg.content),
                genTime: lastMsg.genFinished && lastMsg.genStarted 
                  ? lastMsg.genFinished - lastMsg.genStarted 
                  : undefined,
              })
            }
            // 检查是否需要自动备份
            if (shouldBackup(chat.id, finalMessages.length)) {
              createBackup(chat.id, card.name)
            }
          },
          onStop: async () => {
            // 用户停止时也刷新消息
            await updateChatTimestamp(chat.id)
            const finalMessages = await getMessagesByChatId(chat.id)
            setMessages(finalMessages)
          },
        }
      )
      streamingProcessorRef.current = processor

      // 4. 调用 AI
      const isAvailable = await checkAIServiceAvailable()
      
      if (isAvailable) {
        await processor.start()
        await streamTavernResponse(
          aiMessages,
          async (content) => {
            const prevLen = processor.getState().content.length
            const chunk = content.slice(prevLen)
            if (chunk) {
              await processor.processChunk(chunk)
            }
          },
          undefined,
          { temperature: 0.9 },
          processor.getSignal()
        )
        await processor.finish()
      } else {
        // AI 服务不可用，使用模拟响应
        await processor.start()
        await simulateAIResponse(aiMessages, async (chunk) => {
          await processor.processChunk(chunk)
        })
        await processor.finish()
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      streamingProcessorRef.current?.handleError(error as Error)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setStreamingReasoning('')
      setStreamingState(null)
      streamingProcessorRef.current = null
    }
  }, [inputValue, chat, isGenerating, card, persona])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // 移动端手势处理
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [isMobile])

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return
    
    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = touchEndX - touchStartX.current
    const deltaY = touchEndY - touchStartY.current
    
    // 确保是水平滑动而不是垂直滚动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0 && onBack) {
        // 右滑 - 返回角色列表
        onBack()
      } else if (deltaX < 0) {
        // 左滑 - 显示角色信息
        onToggleInfo()
      }
    }
  }, [isMobile, onBack, onToggleInfo])

  // 缓存头像 URL
  const avatarUrl = useMemo(
    () => card.avatarPath ? convertFileSrc(card.avatarPath) : undefined,
    [card.avatarPath]
  )

  // 停止生成
  const handleStop = useCallback(() => {
    if (streamingProcessorRef.current) {
      streamingProcessorRef.current.stop()
    }
  }, [])

  // 重新生成最后一条 AI 消息
  const handleRegenerate = useCallback(async () => {
    if (!chat || messages.length === 0 || isGenerating) return
    
    // 找到最后一条 AI 消息
    const lastAiMsgIndex = messages.findLastIndex(m => m.role === 'assistant')
    if (lastAiMsgIndex < 0) return
    
    const lastAiMsg = messages[lastAiMsgIndex]
    const previousMessages = messages.slice(0, lastAiMsgIndex)
    
    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoning('')
    setStreamingState(null)
    
    try {
      // 构建上下文 - 使用 V2 统一接口
      const authorsNoteConfig = getAuthorsNoteConfig(card.id, chat.id)
      const contextResult = await buildUnifiedContext(
        card,
        persona,
        previousMessages,
        '',
        {
          maxContext: 8192,
          maxResponse: 1024,
          authorsNote: authorsNoteConfig.enabled ? authorsNoteConfig : null,
        }
      )
      
      const processor = new StreamingProcessor(
        {
          type: 'regenerate',
          chatId: chat.id,
          messageId: lastAiMsg.id,
          characterName: card.name,
          userName: persona.name,
          showReasoning: true,
        },
        {
          onContentUpdate: (content, state) => {
            setStreamingContent(content)
            setStreamingState({ ...state })
          },
          onReasoningUpdate: (reasoning, state) => {
            setStreamingReasoning(reasoning)
            setStreamingState({ ...state })
          },
          onFinish: async (state) => {
            // 添加为新的 swipe
            await addSwipe(lastAiMsg.id, state.content, {
              reasoning: state.reasoning || undefined,
              reasoningDuration: state.reasoningDuration || undefined,
              tokenCount: state.tokenCount,
            })
            await updateChatTimestamp(chat.id)
            const finalMessages = await getMessagesByChatId(chat.id)
            setMessages(finalMessages)
          },
        }
      )
      streamingProcessorRef.current = processor
      
      // 调用 AI
      const isAvailable = await checkAIServiceAvailable()
      
      if (isAvailable) {
        await processor.start()
        await streamTavernResponse(
          contextResult.messages,
          async (content) => {
            const prevLen = processor.getState().content.length
            const chunk = content.slice(prevLen)
            if (chunk) await processor.processChunk(chunk)
          },
          undefined,
          { temperature: 0.9 },
          processor.getSignal()
        )
        await processor.finish()
      } else {
        await processor.start()
        await simulateAIResponse(contextResult.messages, async (chunk) => {
          await processor.processChunk(chunk)
        })
        await processor.finish()
      }
    } catch (error) {
      console.error('重新生成失败:', error)
      streamingProcessorRef.current?.handleError(error as Error)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setStreamingReasoning('')
      setStreamingState(null)
      streamingProcessorRef.current = null
    }
  }, [chat, messages, isGenerating, card, persona])

  // 继续生成 (Continue)
  const handleContinue = useCallback(async () => {
    if (!chat || messages.length === 0 || isGenerating) return
    
    // 找到最后一条 AI 消息
    const lastAiMsg = messages.findLast(m => m.role === 'assistant')
    if (!lastAiMsg) return
    
    setIsGenerating(true)
    setStreamingContent(lastAiMsg.content) // 从现有内容开始
    setStreamingReasoning('')
    setStreamingState(null)
    
    try {
      // 构建上下文 - 使用 V2 统一接口
      const authorsNoteConfig = getAuthorsNoteConfig(card.id, chat.id)
      const contextResult = await buildUnifiedContext(
        card,
        persona,
        messages,
        '',
        {
          maxContext: 8192,
          maxResponse: 1024,
          authorsNote: authorsNoteConfig.enabled ? authorsNoteConfig : null,
        }
      )
      
      const processor = new StreamingProcessor(
        {
          type: 'continue',
          chatId: chat.id,
          messageId: lastAiMsg.id,
          characterName: card.name,
          userName: persona.name,
          continuePrefix: lastAiMsg.content,
          showReasoning: true,
        },
        {
          onContentUpdate: (content, state) => {
            setStreamingContent(lastAiMsg.content + content)
            setStreamingState({ ...state })
          },
          onFinish: async (state) => {
            // 更新消息内容
            const newContent = lastAiMsg.content + state.content
            const swipes: string[] = JSON.parse(lastAiMsg.swipes || '[]')
            swipes[lastAiMsg.swipeId || 0] = newContent
            await updateMessage(lastAiMsg.id, {
              content: newContent,
              swipes: JSON.stringify(swipes),
              genFinished: Date.now(),
            })
            await updateChatTimestamp(chat.id)
            const finalMessages = await getMessagesByChatId(chat.id)
            setMessages(finalMessages)
          },
        }
      )
      streamingProcessorRef.current = processor
      
      // 调用 AI
      const isAvailable = await checkAIServiceAvailable()
      
      if (isAvailable) {
        await processor.start()
        await streamTavernResponse(
          contextResult.messages,
          async (content) => {
            const prevLen = processor.getState().content.length
            const chunk = content.slice(prevLen)
            if (chunk) await processor.processChunk(chunk)
          },
          undefined,
          { temperature: 0.9 },
          processor.getSignal()
        )
        await processor.finish()
      }
    } catch (error) {
      console.error('继续生成失败:', error)
      streamingProcessorRef.current?.handleError(error as Error)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setStreamingState(null)
      streamingProcessorRef.current = null
    }
  }, [chat, messages, isGenerating, card, persona])

  // 扮演用户 (Impersonate)
  const handleImpersonate = useCallback(async () => {
    if (!chat || isGenerating) return
    
    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoning('')
    setStreamingState(null)
    
    try {
      // 构建上下文 - 使用 V2 统一接口
      const authorsNoteConfig = getAuthorsNoteConfig(card.id, chat.id)
      const contextResult = await buildUnifiedContext(
        card,
        persona,
        messages,
        '',
        {
          maxContext: 8192,
          maxResponse: 1024,
          authorsNote: authorsNoteConfig.enabled ? authorsNoteConfig : null,
        }
      )
      
      // 添加 impersonate 提示
      const impersonatePrompt: AIMessage = {
        role: 'system',
        content: `Write ${persona.name}'s next reply in this fictional roleplay chat.`,
      }
      const aiMessages = [...contextResult.messages, impersonatePrompt]
      
      const processor = new StreamingProcessor(
        {
          type: 'impersonate',
          chatId: chat.id,
          characterName: card.name,
          userName: persona.name,
          showReasoning: false,
        },
        {
          onContentUpdate: (content, state) => {
            setStreamingContent(content)
            setStreamingState({ ...state })
          },
          onFinish: async (state) => {
            // 将生成的内容填入输入框
            setInputValue(state.content)
          },
        }
      )
      streamingProcessorRef.current = processor
      
      // 调用 AI
      const isAvailable = await checkAIServiceAvailable()
      
      if (isAvailable) {
        await processor.start()
        await streamTavernResponse(
          aiMessages,
          async (content) => {
            const prevLen = processor.getState().content.length
            const chunk = content.slice(prevLen)
            if (chunk) await processor.processChunk(chunk)
          },
          undefined,
          { temperature: 0.9 },
          processor.getSignal()
        )
        await processor.finish()
      }
    } catch (error) {
      console.error('Impersonate 失败:', error)
      streamingProcessorRef.current?.handleError(error as Error)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setStreamingState(null)
      streamingProcessorRef.current = null
    }
  }, [chat, messages, isGenerating, card, persona])

  // Swipe 切换
  const handleSwipe = useCallback(async (messageId: number, direction: 'left' | 'right') => {
    const message = messages.find(m => m.id === messageId)
    if (!message) return

    const swipes: string[] = JSON.parse(message.swipes || '[]')
    if (swipes.length <= 1) return

    const currentSwipeId = message.swipeId || 0
    let newSwipeId: number

    if (direction === 'left') {
      newSwipeId = currentSwipeId > 0 ? currentSwipeId - 1 : swipes.length - 1
    } else {
      newSwipeId = currentSwipeId < swipes.length - 1 ? currentSwipeId + 1 : 0
    }

    await switchSwipe(messageId, newSwipeId)
    
    // 刷新消息
    if (chat) {
      const updatedMessages = await getMessagesByChatId(chat.id)
      setMessages(updatedMessages)
    }
  }, [messages, chat])

  // 删除 swipe
  const handleDeleteSwipe = useCallback(async (messageId: number, swipeId: number) => {
    if (isGenerating) return
    
    await deleteSwipe(messageId, swipeId)
    
    // 刷新消息
    if (chat) {
      const updatedMessages = await getMessagesByChatId(chat.id)
      setMessages(updatedMessages)
    }
  }, [chat, isGenerating])

  // 生成新 swipe (重新生成并添加为新的 swipe)
  const handleGenerateSwipe = useCallback(async (messageId: number) => {
    if (!chat || isGenerating) return
    
    const message = messages.find(m => m.id === messageId)
    if (!message || message.role !== 'assistant') return
    
    // 找到这条消息之前的所有消息
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex < 0) return
    
    const previousMessages = messages.slice(0, messageIndex)
    
    setIsGenerating(true)
    setStreamingContent('')
    setStreamingReasoning('')
    setStreamingState(null)
    
    try {
      // 构建上下文 - 使用 V2 统一接口
      const authorsNoteConfig = getAuthorsNoteConfig(card.id, chat.id)
      const contextResult = await buildUnifiedContext(
        card,
        persona,
        previousMessages,
        '', // 没有新的用户输入
        {
          maxContext: 8192,
          maxResponse: 1024,
          authorsNote: authorsNoteConfig.enabled ? authorsNoteConfig : null,
        }
      )
      const aiMessages = contextResult.messages
      
      // 创建 StreamingProcessor
      const processor = new StreamingProcessor(
        {
          type: 'swipe',
          chatId: chat.id,
          messageId: messageId,
          characterName: card.name,
          userName: persona.name,
          showReasoning: true,
        },
        {
          onContentUpdate: (content, state) => {
            setStreamingContent(content)
            setStreamingState({ ...state })
          },
          onReasoningUpdate: (reasoning, state) => {
            setStreamingReasoning(reasoning)
            setStreamingState({ ...state })
          },
          onFinish: async (state) => {
            // 添加新的 swipe
            await addSwipe(messageId, state.content, {
              reasoning: state.reasoning || undefined,
              reasoningDuration: state.reasoningDuration || undefined,
              tokenCount: state.tokenCount,
            })
            // 刷新消息
            const finalMessages = await getMessagesByChatId(chat.id)
            setMessages(finalMessages)
          },
        }
      )
      streamingProcessorRef.current = processor
      
      // 调用 AI
      const isAvailable = await checkAIServiceAvailable()
      
      if (isAvailable) {
        await processor.start()
        await streamTavernResponse(
          aiMessages,
          async (content) => {
            const prevLen = processor.getState().content.length
            const chunk = content.slice(prevLen)
            if (chunk) {
              await processor.processChunk(chunk)
            }
          },
          undefined,
          { temperature: 0.9 },
          processor.getSignal()
        )
        await processor.finish()
      } else {
        await processor.start()
        await simulateAIResponse(aiMessages, async (chunk) => {
          await processor.processChunk(chunk)
        })
        await processor.finish()
      }
    } catch (error) {
      console.error('生成新 swipe 失败:', error)
      streamingProcessorRef.current?.handleError(error as Error)
    } finally {
      setIsGenerating(false)
      setStreamingContent('')
      setStreamingReasoning('')
      setStreamingState(null)
      streamingProcessorRef.current = null
    }
  }, [chat, messages, isGenerating, card, persona])

  // 编辑消息
  const handleEditMessage = useCallback(async (messageId: number, newContent: string) => {
    if (isGenerating || !chat) return
    
    const message = messages.find(m => m.id === messageId)
    if (!message) return
    
    try {
      // 更新消息内容和 swipes
      const swipes: string[] = JSON.parse(message.swipes || '[]')
      const currentSwipeId = message.swipeId || 0
      swipes[currentSwipeId] = newContent
      
      await updateMessage(messageId, {
        content: newContent,
        swipes: JSON.stringify(swipes),
      })
      
      // 刷新消息列表
      const updatedMessages = await getMessagesByChatId(chat.id)
      setMessages(updatedMessages)
    } catch (error) {
      console.error('编辑消息失败:', error)
    }
  }, [chat, messages, isGenerating])

  // 删除消息
  const handleDeleteMessage = useCallback(async (messageId: number) => {
    if (isGenerating || !chat) return
    
    if (!confirm('确定要删除这条消息吗？')) return
    
    try {
      await deleteMessage(messageId)
      
      // 刷新消息列表
      const updatedMessages = await getMessagesByChatId(chat.id)
      setMessages(updatedMessages)
    } catch (error) {
      console.error('删除消息失败:', error)
    }
  }, [chat, isGenerating])

  return (
    <TooltipProvider>
    <div 
      className="flex flex-col h-full"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          {/* 移动端返回按钮 */}
          {isMobile && onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="-ml-2">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl} alt={card.name} />
            <AvatarFallback>{card.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-semibold">{card.name}</h2>
            <p className="text-xs text-muted-foreground">
              {card.personality?.slice(0, 30) || '角色扮演'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Persona 指示器 */}
          <PersonaIndicator
            persona={persona}
            card={card}
            chat={chat}
            onPersonaChange={onPersonaChange}
            compact
          />
          {/* 分支指示器 */}
          <BranchIndicator
            chatId={chat?.id ?? null}
            onSwitchChat={async (newChatId) => {
              const newChats = await getChatsByCardId(card.id)
              const newChat = newChats.find(c => c.id === newChatId)
              if (newChat) {
                onChatSelect(newChat)
              }
            }}
            compact
          />
          {/* Token 计数器 */}
          <TokenCounter
            messages={messages.map(m => ({ content: m.content }))}
            inputValue={inputValue}
            maxTokens={4096}
            reserveTokens={1024}
            compact
          />
          {/* Author's Note 按钮 */}
          <AuthorsNotePanel
            cardId={card.id}
            chatId={chat?.id}
            compact
          />
          {/* 聊天书签 */}
          <BookmarksPanel
            chatId={chat?.id}
            onRestore={async () => {
              // 恢复后刷新消息列表
              if (chat) {
                const updatedMessages = await getMessagesByChatId(chat.id)
                setMessages(updatedMessages)
              }
            }}
            compact
          />
          {/* 聊天备份 */}
          <ChatBackupsPanel
            chatId={chat?.id}
            cardName={card.name}
            onRestore={async (newChatId) => {
              // 恢复后切换到新聊天
              const newChats = await getChatsByCardId(card.id)
              const newChat = newChats.find(c => c.id === newChatId)
              if (newChat) {
                onChatSelect(newChat)
              }
            }}
            compact
          />
          {/* Logit Bias */}
          <LogitBiasPanel
            cardId={card.id}
            compact
          />
          {/* CFG Scale */}
          <CfgScalePanel
            cardId={card.id}
            chatId={chat?.id}
            compact
          />
          {/* Memory/Summary */}
          <MemoryPanel
            cardId={card.id}
            chatId={chat?.id}
            messages={messages}
            compact
          />
          {/* 翻译 */}
          <TranslatePanel
            cardId={card.id}
            compact
          />
          {/* 图片描述 */}
          <ImageCaptionPanel
            cardId={card.id}
            compact
          />
          {/* TTS 语音合成 */}
          <TTSPanel
            cardId={card.id}
            compact
          />
          {/* 表情立绘 */}
          <ExpressionsPanel
            cardId={card.id}
            compact
          />
          {/* 附件管理 */}
          <AttachmentsPanel
            chatId={chat?.id}
            compact
          />
          {/* 向量检索 (RAG) */}
          <VectorsPanel compact />
          {/* 宏与变量 */}
          <MacrosVariablesPanel chatId={chat?.id} compact />
          {/* 工具调用 */}
          <ToolCallingPanel compact />
          {/* 思考过程设置 */}
          <ReasoningSettingsPanel />
          {/* 聊天背景 */}
          <BackgroundsPanel chatId={chat?.id?.toString()} />
          {/* 聊天统计 */}
          <StatsPanel 
            characterId={card.id.toString()} 
            characterName={card.name} 
          />
          {/* 角色画廊 */}
          <GalleryPanel 
            characterId={card.id.toString()} 
            characterName={card.name} 
          />
          {/* 数据清理 */}
          <DataMaidPanel />
          {/* Prompt Manager */}
          <PromptManagerPanel cardId={card.id} compact />
          {/* API 配置切换 */}
          <ProfileSelector cardId={card.id} compact />
          {/* 预设选择器 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                <Settings2 className="h-4 w-4" />
                <span className="max-w-[80px] truncate hidden sm:inline">
                  {currentPreset?.name || '选择预设'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>采样预设</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {presets.length === 0 ? (
                <DropdownMenuItem disabled>
                  <span className="text-muted-foreground">暂无预设</span>
                </DropdownMenuItem>
              ) : (
                presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => handlePresetChange(preset)}
                    className={cn(
                      currentPreset?.id === preset.id && 'bg-accent'
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="truncate">{preset.name}</span>
                      {preset.isDefault && (
                        <span className="text-xs text-muted-foreground ml-2">默认</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" onClick={onToggleInfo}>
            <Info className="h-5 w-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/core/tavern/editor?id=${card.id}`)}>
                <Pencil className="h-4 w-4 mr-2" />
                编辑角色
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRegenerate} disabled={isGenerating || messages.length === 0}>
                <RefreshCw className="h-4 w-4 mr-2" />
                重新生成
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleContinue} disabled={isGenerating || messages.length === 0}>
                <FastForward className="h-4 w-4 mr-2" />
                继续生成
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImpersonate} disabled={isGenerating}>
                <User className="h-4 w-4 mr-2" />
                扮演用户
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 消息区域 - 带背景 */}
      {(() => {
        const background = getCurrentBackground(chat?.id?.toString())
        const backgroundStyle = background?.url ? {
          backgroundImage: `url(${background.url})`,
          backgroundSize: globalFitting === 'cover' ? 'cover' 
            : globalFitting === 'contain' ? 'contain'
            : globalFitting === 'stretch' ? '100% 100%'
            : globalFitting === 'tile' ? 'auto'
            : 'auto',
          backgroundPosition: 'center',
          backgroundRepeat: globalFitting === 'tile' ? 'repeat' : 'no-repeat',
          opacity: globalOpacity / 100,
          filter: `blur(${globalBlur}px) brightness(${globalBrightness / 100})`,
        } : {}
        
        return (
          <div className="flex-1 relative overflow-hidden">
            {/* 背景层 */}
            {background?.url && (
              <div 
                className="absolute inset-0 pointer-events-none"
                style={backgroundStyle}
              />
            )}
            {/* 内容层 */}
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4 max-w-3xl mx-auto relative z-10">
            {messages.map((msg, index) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isUser={msg.role === 'user'}
                avatarUrl={msg.role === 'assistant' ? avatarUrl : undefined}
                onSwipe={handleSwipe}
                onGenerate={handleGenerateSwipe}
                onDelete={handleDeleteSwipe}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                isGenerating={isGenerating}
                chatId={chat?.id}
                messageIndex={index}
                messages={messages}
                onSwitchChat={async (newChatId) => {
                  const newChats = await getChatsByCardId(card.id)
                  const newChat = newChats.find(c => c.id === newChatId)
                  if (newChat) {
                    onChatSelect(newChat)
                  }
                }}
              />
            ))}
            {/* 流式输出 */}
            {isGenerating && (streamingContent || streamingReasoning) && (
              <MessageBubble
                message={{
                  id: -1,
                  chatId: chat?.id || 0,
                  role: 'assistant',
                  name: card.name,
                  content: streamingContent,
                  isHidden: false,
                  swipeId: 0,
                  swipes: '[]',
                  sendDate: streamingState?.genStarted || Date.now(),
                  genStarted: streamingState?.genStarted || null,
                  genFinished: null,
                  forceAvatar: '',
                  originalAvatar: '',
                  swipeInfo: '[]',
                  extra: streamingReasoning ? JSON.stringify({ reasoning: streamingReasoning }) : '',
                  createdAt: Date.now(),
                }}
                isUser={false}
                avatarUrl={avatarUrl}
                isStreaming
                streamingState={streamingState}
              />
            )}
              </div>
            </ScrollArea>
          </div>
        )
      })()}

      {/* 生成状态栏 */}
      {isGenerating && streamingState && (
        <div className="px-4 py-2 border-t border-border bg-muted/50">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{streamingState.elapsedTime.toFixed(1)}s</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>生成时间</p>
                </TooltipContent>
              </Tooltip>
              {streamingState.tokenCount > 0 && (
                <span className="text-xs">
                  {streamingState.tokenCount} tokens
                  {streamingState.tokenRate > 0 && ` (${streamingState.tokenRate.toFixed(1)} t/s)`}
                </span>
              )}
              {streamingReasoning && (
                <div className="flex items-center gap-1 text-amber-500">
                  <Brain className="h-4 w-4" />
                  <span>思考中...</span>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              className="h-7 gap-1"
            >
              <Square className="h-3 w-3" />
              停止
            </Button>
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className="p-4 border-t border-border">
        {/* 快捷回复栏 */}
        <QuickReplyBar
          cardId={card.id}
          charName={card.name}
          userName={persona.name}
          onSend={(message) => {
            setInputValue(message)
            // 自动发送
            setTimeout(() => {
              if (textareaRef.current) {
                textareaRef.current.focus()
              }
            }, 0)
          }}
          disabled={isGenerating}
          className="mb-2"
        />
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`发送消息给 ${card.name}...`}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
            disabled={isGenerating}
          />
          <Button
            onClick={isGenerating ? handleStop : handleSend}
            disabled={!isGenerating && !inputValue.trim()}
            size="icon"
            className="h-11 w-11 flex-shrink-0"
            variant={isGenerating ? 'destructive' : 'default'}
          >
            {isGenerating ? (
              <Square className="h-5 w-5" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}

// 消息气泡组件
interface MessageBubbleProps {
  message: TavernMessage
  isUser: boolean
  avatarUrl?: string
  isStreaming?: boolean
  streamingState?: StreamingState | null
  onSwipe?: (messageId: number, direction: 'left' | 'right') => void
  onGenerate?: (messageId: number) => void
  onDelete?: (messageId: number, swipeId: number) => void
  onEditMessage?: (messageId: number, newContent: string) => void
  onDeleteMessage?: (messageId: number) => void
  isGenerating?: boolean
  // 分支功能
  chatId?: number
  messageIndex?: number
  messages?: TavernMessage[]
  onSwitchChat?: (chatId: number) => void
}

const MessageBubble = memo(function MessageBubble({ 
  message, 
  isUser, 
  avatarUrl, 
  isStreaming,
  streamingState,
  onSwipe,
  onGenerate,
  onDelete,
  onEditMessage,
  onDeleteMessage,
  isGenerating = false,
  // 分支功能
  chatId,
  messageIndex,
  messages: allMessages,
  onSwitchChat,
}: MessageBubbleProps) {
  const [isReasoningOpen, setIsReasoningOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  
  // 解析 swipe 信息
  const swipes: string[] = useMemo(() => {
    try {
      return JSON.parse(message.swipes || '[]')
    } catch {
      return []
    }
  }, [message.swipes])
  
  const hasMultipleSwipes = swipes.length > 1
  const currentSwipeId = message.swipeId || 0
  
  // 解析 extra 信息
  const extra: TavernMessageExtra | null = useMemo(() => {
    try {
      return message.extra ? JSON.parse(message.extra) : null
    } catch {
      return null
    }
  }, [message.extra])
  
  // 生成计时器
  const timerInfo = useMemo(() => {
    if (isStreaming && streamingState) {
      return {
        timerValue: `${streamingState.elapsedTime.toFixed(1)}s`,
        timerTitle: '生成中...',
      }
    }
    if (message.genStarted) {
      return formatGenerationTimer(
        message.genStarted,
        message.genFinished || null,
        extra?.tokenCount,
        extra?.reasoningDuration
      )
    }
    return null
  }, [message.genStarted, message.genFinished, extra, isStreaming, streamingState])

  // 保存编辑
  const handleSaveEdit = useCallback(() => {
    if (onEditMessage && editContent.trim() !== message.content) {
      onEditMessage(message.id, editContent.trim())
    }
    setIsEditing(false)
  }, [message.id, message.content, editContent, onEditMessage])

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content)
    setIsEditing(false)
  }, [message.content])

  // 开始编辑
  const handleStartEdit = useCallback(() => {
    setEditContent(message.content)
    setIsEditing(true)
  }, [message.content])

  // 键盘事件
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit()
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveEdit()
    }
  }, [handleCancelEdit, handleSaveEdit])
  
  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser && 'flex-row-reverse'
      )}
    >
      {/* 头像 */}
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarImage src={avatarUrl} />
        <AvatarFallback className="text-xs">
          {message.name?.charAt(0) || (isUser ? 'U' : 'A')}
        </AvatarFallback>
      </Avatar>

      {/* 消息内容 */}
      <div className="flex flex-col max-w-[80%]">
        {/* Reasoning 折叠区 */}
        {(extra?.reasoning || (isStreaming && streamingState?.reasoning)) && (
          <Collapsible open={isReasoningOpen} onOpenChange={setIsReasoningOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 mb-1 text-xs text-amber-600 dark:text-amber-400',
                  isUser && 'self-end'
                )}
              >
                <Brain className="h-3 w-3" />
                <span>思考过程</span>
                <ChevronDown className={cn(
                  'h-3 w-3 transition-transform',
                  isReasoningOpen && 'rotate-180'
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className={cn(
                'rounded-lg px-3 py-2 mb-2 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 border border-amber-200 dark:border-amber-800',
                isUser && 'ml-auto'
              )}>
                <p className="whitespace-pre-wrap break-words">
                  {extra?.reasoning || streamingState?.reasoning}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        
        {/* 消息气泡 */}
        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-md'
              : 'bg-muted rounded-tl-md'
          )}
        >
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="min-h-[60px] text-sm bg-background text-foreground"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  取消
                </Button>
                <Button size="sm" onClick={handleSaveEdit}>
                  保存
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content}
              {isStreaming && (
                <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </p>
          )}
        </div>
        
        {/* 底部信息栏: 操作按钮 + Swipe 控件 + 计时器 */}
        {!isStreaming && !isEditing && (
          <div className={cn(
            'flex items-center gap-2 mt-1 text-xs text-muted-foreground',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            isUser && 'justify-end'
          )}>
            {/* 编辑/删除/分支按钮 */}
            <div className="flex items-center gap-1">
              {onEditMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleStartEdit}
                      disabled={isGenerating}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>编辑消息</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {onDeleteMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => onDeleteMessage(message.id)}
                      disabled={isGenerating}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>删除消息</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* 分支按钮 */}
              {chatId && messageIndex !== undefined && allMessages && (
                <MessageBranchButton
                  chatId={chatId}
                  messageId={message.id}
                  messageIndex={messageIndex}
                  messages={allMessages}
                  onSwitchChat={onSwitchChat}
                  disabled={isGenerating}
                  compact
                />
              )}
            </div>

            {/* AI 消息的 Swipe 控件 */}
            {!isUser && (hasMultipleSwipes || timerInfo || onGenerate) && (
              <>
                {(onEditMessage || onDeleteMessage) && (hasMultipleSwipes || onGenerate) && (
                  <div className="w-px h-4 bg-border" />
                )}
                <div className="flex items-center gap-1">
                  {/* 左箭头 */}
                  {hasMultipleSwipes && onSwipe && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onSwipe(message.id, 'left')}
                      disabled={isGenerating}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  )}
                  
                  {/* 计数 */}
                  {swipes.length > 0 && (
                    <span className="min-w-[40px] text-center tabular-nums">
                      {currentSwipeId + 1} / {swipes.length}
                    </span>
                  )}
                  
                  {/* 右箭头 */}
                  {hasMultipleSwipes && onSwipe && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onSwipe(message.id, 'right')}
                      disabled={isGenerating}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                  
                  {/* 分隔符 */}
                  {hasMultipleSwipes && (onGenerate || onDelete) && (
                    <div className="w-px h-4 bg-border mx-1" />
                  )}
                  
                  {/* 生成新 swipe */}
                  {onGenerate && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onGenerate(message.id)}
                          disabled={isGenerating}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>生成新回复</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  
                  {/* 删除当前 swipe */}
                  {onDelete && hasMultipleSwipes && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => onDelete(message.id, currentSwipeId)}
                          disabled={isGenerating}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>删除此回复</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                
                {/* 计时器 */}
                {timerInfo && timerInfo.timerValue && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 cursor-help">
                        <Clock className="h-3 w-3" />
                        <span>{timerInfo.timerValue}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="whitespace-pre-line">
                      {timerInfo.timerTitle}
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

// 模拟 AI 响应 (临时，后续需要连接真实 AI)
async function simulateAIResponse(
  messages: AIMessage[],
  onChunk: (chunk: string) => void
): Promise<string> {
  // 模拟打字效果
  const response = `这是一个模拟的 AI 响应。在实际使用中，这里会连接到 note-gen 的 AI 服务。

收到的上下文包含 ${messages.length} 条消息。

请配置 AI 服务以启用真实对话功能。`

  for (const char of response) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    onChunk(char)
  }

  return response
}
