import { create } from 'zustand'
import { Chat, clearChatsByConversationId, clearChatsByTagId, deleteChat, insertChat, updateChat, updateChatsInsertedById, getChatsByConversation } from '@/db/chats'
import { initAllDatabases } from '@/db'
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { AgentState, ToolCall } from '@/lib/agent/types'
import { LinkedResource } from '@/lib/files'
import type { Conversation } from '@/db/conversations'
import type { ChatReasoningOverride } from '@/lib/ai/chat-reasoning'

export interface PendingQuote {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  selectionToken?: string
  articlePath: string
}

export interface MobileActiveContexts {
  articlePath: string | null
  markId: number | null
  canvasId: string | null
}

function getPendingQuoteIdentity(quote: PendingQuote | null) {
  if (!quote) {
    return ''
  }

  return [
    quote.articlePath,
    quote.from,
    quote.to,
    quote.selectionToken || '',
    quote.startLine,
    quote.endLine,
    quote.fullContent,
  ].join('|')
}

// MCP 工具调用记录（临时，不保存到数据库）
export interface McpToolCall {
  id: string
  chatId: number // 关联的 chat ID
  toolName: string
  serverId: string
  serverName: string
  params: Record<string, any>
  result: string
  status: 'calling' | 'success' | 'error'
  timestamp: number
}

interface ChatState {
  reasoningOverride: ChatReasoningOverride | null
  setReasoningOverride: (value: ChatReasoningOverride | null) => void
  loading: boolean
  setLoading: (loading: boolean) => void

  // 兼容旧代码：按标签加载（内部映射到默认会话）
  chats: Chat[]
  init: (tagId: number) => Promise<void> // 初始化 chats
  insert: (chat: Omit<Chat, 'id' | 'createdAt'>) => Promise<Chat | null> // 插入一条 chat
  updateChat: (chat: Chat) => void // 更新一条 chat
  saveChat: (chat: Chat, isSave?: boolean) => Promise<void> // 保存一条 chat，用于动态 AI 回复结束后保存数据库
  deleteChat: (id: number) => Promise<void> // 删除一条 chat

  locale: string
  getLocale: () => Promise<void>
  setLocale: (locale: string) => void

  clearChats: (tagId: number) => Promise<void> // 清空 chats（兼容旧代码）
  updateInsert: (id: number) => Promise<void> // 更新 inserted

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadChats: () => Promise<boolean>
  downloadChats: () => Promise<Chat[]>

  // MCP 工具调用记录（临时缓存）
  mcpToolCalls: McpToolCall[]
  addMcpToolCall: (toolCall: McpToolCall) => void
  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => void
  getMcpToolCallsByChatId: (chatId: number) => McpToolCall[]
  clearMcpToolCalls: () => void

  // Agent 模式
  agentState: AgentState
  setAgentState: (state: Partial<AgentState>) => void
  resetAgentState: () => void
  addAgentToolCall: (toolCall: ToolCall) => void
  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => void
  agentAutoApproveConversationId: number | null
  setAgentAutoApproveConversationId: (conversationId: number | null) => void
  agentAutoApproveRuntimeScriptKey: string | null
  setAgentAutoApproveRuntimeScriptKey: (permissionKey: string | null) => void

  // Placeholder 状态
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // 关联的文件或文件夹（用于 Agent 工具调用时判断内容是否已在上下文中）
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void

  // 关联文件的行号预览（用于 AI 对话时快速了解文件结构）
  linkedResourcePreview: string | null
  setLinkedResourcePreview: (preview: string | null) => void

  mobileActiveContexts: MobileActiveContexts
  setMobileActiveContexts: (contexts: Partial<MobileActiveContexts>) => void

  pendingQuote: PendingQuote | null
  setPendingQuote: (quote: PendingQuote | null) => void
  clearPendingQuote: () => void

  editorSelectionQuote: PendingQuote | null
  setEditorSelectionQuote: (quote: PendingQuote | null) => void
  clearEditorSelectionQuote: () => void

  onboardingPromptDraft: string | null
  setOnboardingPromptDraft: (prompt: string | null) => void

  // === 新增：会话管理 ===
  // 当前会话
  currentConversationId: number | null
  conversations: Conversation[]
  isTemporaryConversation: boolean // 临时会话仅保存在内存中

  // 会话初始化和管理
  initConversations: () => Promise<void> // 初始化会话列表
  createConversation: (title?: string) => Promise<number> // 创建新会话
  switchConversation: (id: number) => Promise<void> // 切换会话
  updateConversationTitle: (id: number, title: string) => Promise<void> // 更新会话标题
  deleteConversation: (id: number) => Promise<void> // 删除会话
  toggleConversationPin: (id: number) => Promise<boolean> // 切换会话置顶状态
  startNewConversation: () => Promise<void> // 开始新对话（保存当前会话后创建新会话）
  startTemporaryConversation: () => void // 开始不保存记录的临时会话
}

let nextTemporaryChatId = -1

const useChatStore = create<ChatState>((set, get) => ({
  reasoningOverride: null,
  setReasoningOverride: (reasoningOverride) => set({ reasoningOverride }),
  loading: false,

  setLoading: (loading: boolean) => {
    set({ loading })
  },

  agentState: {
    activeChatId: undefined,
    activeModelId: undefined,
    activeModelName: undefined,
    runId: undefined,
    status: 'idle',
    isRunning: false,
    isThinking: false,
    currentThought: '',
    thoughtHistory: [],
    completedSteps: [],
    currentAction: undefined,
    currentObservation: undefined,
    toolCalls: [],
    traceEvents: [],
    changes: [],
    maxIterations: 15,
    currentIteration: 0,
    pendingConfirmation: undefined,
    confirmationHistory: [],
    loadedSkills: undefined,
    selectedSkills: undefined,
    currentStepStartTime: undefined,
    ragSources: undefined,
    ragSourceDetails: undefined,
  },

  setAgentState: (state: Partial<AgentState>) => {
    set({ agentState: { ...get().agentState, ...state } })
  },

  resetAgentState: () => {
    set({
      agentState: {
        activeChatId: undefined,
        activeModelId: undefined,
        activeModelName: undefined,
        runId: undefined,
        status: 'idle',
        isRunning: false,
        isThinking: false,
        currentThought: '',
        thoughtHistory: [],
        completedSteps: [],
        currentAction: '',
        currentObservation: '',
        toolCalls: [],
        traceEvents: [],
        changes: [],
        maxIterations: 15,
        currentIteration: 0,
        pendingConfirmation: undefined,
        confirmationHistory: [],
        loadedSkills: undefined,
        selectedSkills: undefined,
        currentStepStartTime: undefined,
        // 每次运行由 Agent 按需检索，不能沿用上一轮的参考笔记。
        ragSources: undefined,
        ragSourceDetails: undefined,
        // 重置 Final Answer 模式
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
      }
    })
  },

  addAgentToolCall: (toolCall: ToolCall) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: [...agentState.toolCalls, toolCall]
      }
    })
  },

  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: agentState.toolCalls.map(call =>
          call.id === id ? { ...call, ...updates } : call
        )
      }
    })
  },

  agentAutoApproveConversationId: null,
  setAgentAutoApproveConversationId: (conversationId: number | null) => {
    set({ agentAutoApproveConversationId: conversationId })
  },
  agentAutoApproveRuntimeScriptKey: null,
  setAgentAutoApproveRuntimeScriptKey: (permissionKey: string | null) => {
    set({ agentAutoApproveRuntimeScriptKey: permissionKey })
  },

  isPlaceholderEnabled: true,
  setPlaceholderEnabled: (enabled: boolean) => {
    set({ isPlaceholderEnabled: enabled })
  },

  linkedResource: null,
  setLinkedResource: (resource: LinkedResource | null) => {
    set({ linkedResource: resource })
  },

  linkedResourcePreview: null,
  setLinkedResourcePreview: (preview: string | null) => {
    set({ linkedResourcePreview: preview })
  },

  mobileActiveContexts: {
    articlePath: null,
    markId: null,
    canvasId: null,
  },
  setMobileActiveContexts: (contexts) => {
    set(state => ({
      mobileActiveContexts: {
        ...state.mobileActiveContexts,
        ...contexts,
      },
    }))
  },

  pendingQuote: null,
  setPendingQuote: (pendingQuote: PendingQuote | null) => {
    set({ pendingQuote })
  },
  clearPendingQuote: () => {
    set({ pendingQuote: null })
  },

  editorSelectionQuote: null,
  setEditorSelectionQuote: (editorSelectionQuote: PendingQuote | null) => {
    set((state) => {
      if (getPendingQuoteIdentity(state.editorSelectionQuote) === getPendingQuoteIdentity(editorSelectionQuote)) {
        return state
      }

      return { editorSelectionQuote }
    })
  },
  clearEditorSelectionQuote: () => {
    set({ editorSelectionQuote: null })
  },

  onboardingPromptDraft: null,
  setOnboardingPromptDraft: (prompt: string | null) => {
    set({ onboardingPromptDraft: prompt })
  },

  chats: [],
  // 兼容旧代码：init 方法现在会初始化会话列表并切换到第一个会话
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  init: async (_tagId: number) => {
    set({ isTemporaryConversation: false })
    // 子组件的 effect 可能早于布局初始化执行，查询会话前必须等待所有表和迁移就绪。
    await initAllDatabases()
    // 先初始化会话列表
    await get().initConversations()

    const { currentConversationId, conversations } = get()

    // 如果没有当前会话
    if (!currentConversationId) {
      if (conversations.length > 0) {
        // 有历史会话，切换到第一个
        await get().switchConversation(conversations[0].id)
      }
      // 如果没有历史会话，保持空状态，不创建新会话
    } else {
      // 加载当前会话的聊天记录
      const data = await getChatsByConversation(currentConversationId)
      set({ chats: data })
    }
  },
  insert: async (chat) => {
    const { currentConversationId, isTemporaryConversation } = get()

    if (isTemporaryConversation) {
      const data: Chat = {
        ...chat,
        id: nextTemporaryChatId--,
        conversationId: undefined,
        createdAt: Date.now(),
      }
      set({ chats: [...get().chats, data] })
      return data
    }

    // 确保有 conversationId，如果没有则创建新会话
    let conversationId = chat.conversationId || currentConversationId
    if (!conversationId) {
      // 没有当前会话，创建一个新会话
      const { createConversation } = await import('@/db/conversations')
      conversationId = await createConversation('新对话')
      // 设置为当前会话并刷新会话列表
      set({ currentConversationId: conversationId })
      await get().initConversations()
    }

    const res = await insertChat({ ...chat, conversationId })
    let data: Chat
    if (res.lastInsertId) {
      data =  {
        id: res.lastInsertId,
        createdAt: Date.now(),
        ...chat,
        conversationId
      }
      const chats = get().chats
      const newChats = [...chats, data]
      set({ chats: newChats })

      // 更新会话的消息数量和更新时间
      if (conversationId) {
        const { updateConversationMessageCount, updateConversationTime, updateConversationTitle, getConversation } = await import('@/db/conversations')
        await updateConversationMessageCount(conversationId, 1)
        await updateConversationTime(conversationId)

        // 如果是当前会话的第一条用户消息，用消息内容作为标题
        // 从数据库获取最新的会话状态，而不是使用内存中的旧数据
        const currentConv = await getConversation(conversationId)
        if (currentConv && currentConv.messageCount === 1 && chat.role === 'user' && chat.content) {
          // 直接使用用户输入的前30个字符作为标题
          const title = chat.content
            .replace(/\n/g, ' ')  // 移除换行符
            .trim()
            .slice(0, 30)

          if (title && title !== currentConv.title) {
            await updateConversationTitle(conversationId, title)
          }
        }

        // 刷新会话列表
        await get().initConversations()
      }

      return data
    }
    return null
  },
  updateChat: (chat) => {
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === chat.id) {
        // 合并更新，只覆盖非 undefined 的字段，保留已存在的字段（如 ragSources）
        const result = { ...item }
        for (const key in chat) {
          if ((chat as any)[key] !== undefined) {
            (result as any)[key] = (chat as any)[key]
          }
        }
        return result
      }
      return item
    })
    set({ chats: newChats })
  },
  saveChat: async (chat, isSave = false) => {
    get().updateChat(chat)
    if (isSave && !get().isTemporaryConversation) {
      await updateChat(chat)
    }
  },
  deleteChat: async (id) => {
    const chats = get().chats
    const newChats = chats.filter(item => item.id !== id)
    set({ chats: newChats })

    if (get().isTemporaryConversation) {
      return
    }

    await deleteChat(id)

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
      const { deleteConversationCompactions } = await import('@/db/conversation-compactions')
      await deleteConversationCompactions(currentConversationId)
      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -1)
      await get().initConversations()
    }
  },


  locale: locales[0],
  getLocale: async () => {
    const store = await Store.load('store.json');
    const res = (await store.get<string>('note_locale')) || locales[0]
    set({ locale: res })
  },
  setLocale: async (locale) => {
    set({ locale })
    const store = await Store.load('store.json');
    await store.set('note_locale', locale)
  },

  // 兼容旧代码：clearChats 现在会清空当前会话的聊天记录
  clearChats: async (tagId) => {
    const isTemporaryConversation = get().isTemporaryConversation
    set({ chats: [] })
    // 清空聊天记录时同步清理 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
    get().clearPendingQuote()
    get().clearEditorSelectionQuote()

    if (isTemporaryConversation) {
      return
    }

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
      // 获取当前消息数量
      const { chats } = get()
      const count = chats.length

      // 删除数据库中的记录
      await clearChatsByConversationId(currentConversationId)
      const { deleteConversationCompactions } = await import('@/db/conversation-compactions')
      await deleteConversationCompactions(currentConversationId)

      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -count)
      await get().initConversations()
    } else {
      // 兼容旧代码：如果没有 conversationId，使用 tagId
      await clearChatsByTagId(tagId)
    }
  },

  updateInsert: async (id) => {
    if (!get().isTemporaryConversation) {
      await updateChatsInsertedById(id)
    }
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === id) {
        item.inserted = true
      }
      return item
    })
    set({ chats: newChats })
  },

  // 同步
  syncState: false,
  setSyncState: (syncState) => {
    set({ syncState })
  },
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => {
    set({ lastSyncTime })
  },
  uploadChats: async () => {
    set({ syncState: true })
    try {
      const { uploadConversations } = await import('@/lib/sync/conversation-sync')
      return await uploadConversations()
    } finally {
      set({ syncState: false })
    }
  },
  // MCP 工具调用记录
  mcpToolCalls: [],

  addMcpToolCall: (toolCall: McpToolCall) => {
    const mcpToolCalls = get().mcpToolCalls
    set({ mcpToolCalls: [...mcpToolCalls, toolCall] })
  },

  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => {
    const mcpToolCalls = get().mcpToolCalls.map(call =>
      call.id === id ? { ...call, ...updates } : call
    )
    set({ mcpToolCalls })
  },

  getMcpToolCallsByChatId: (chatId: number) => {
    return get().mcpToolCalls.filter(call => call.chatId === chatId)
  },

  clearMcpToolCalls: () => {
    set({ mcpToolCalls: [] })
  },

  downloadChats: async () => {
    set({ syncState: true })
    try {
      const { downloadConversations } = await import('@/lib/sync/conversation-sync')
      await downloadConversations({ allowMissingRemote: true })
      return get().chats
    } finally {
      set({ syncState: false })
    }
  },

  // === 新增：会话管理方法 ===
  currentConversationId: null,
  conversations: [],
  isTemporaryConversation: false,

  initConversations: async () => {
    const { getAllConversations } = await import('@/db/conversations')
    const conversations = await getAllConversations()
    set({ conversations })
  },

  createConversation: async (title = '新对话') => {
    const { createConversation: createConv } = await import('@/db/conversations')
    const id = await createConv(title)
    // 设置为当前会话并刷新会话列表
    set({ currentConversationId: id, isTemporaryConversation: false, reasoningOverride: null })
    await get().initConversations()
    return id
  },

  switchConversation: async (id: number) => {
    const previousConversationId = get().currentConversationId
    if (previousConversationId && previousConversationId !== id) {
      const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
      scheduleConversationMemoryExtraction(previousConversationId)
    }
    // 先同步消息数量，确保 messageCount 与实际消息数量一致
    const { syncConversationMessageCount } = await import('@/db/conversations')
    await syncConversationMessageCount(id)
    // 然后加载消息
    const { getChatsByConversation } = await import('@/db/chats')
    const data = await getChatsByConversation(id)
    set({
      currentConversationId: id,
      reasoningOverride: previousConversationId === id ? get().reasoningOverride : null,
      chats: data,
      isTemporaryConversation: false,
      pendingQuote: null,
      editorSelectionQuote: null,
    })
    // 刷新会话列表以确保 UI 显示最新的会话状态
    await get().initConversations()
  },

  updateConversationTitle: async (id: number, title: string) => {
    const { updateConversationTitle: updateTitle } = await import('@/db/conversations')
    await updateTitle(id, title)
    // 刷新会话列表
    await get().initConversations()
  },

  deleteConversation: async (id: number) => {
    const { deleteConversation: deleteConv } = await import('@/db/conversations')
    await deleteConv(id)

    const { currentConversationId, conversations, switchConversation } = get()

    // 如果删除的是当前会话，切换到另一个会话
    if (id === currentConversationId) {
      const remainingConversations = conversations.filter(c => c.id !== id)
      if (remainingConversations.length > 0) {
        await switchConversation(remainingConversations[0].id)
      } else {
        // 没有其他会话了，清空状态，不创建新会话
        set({
          currentConversationId: null,
          reasoningOverride: null,
          chats: [],
          isTemporaryConversation: false,
          pendingQuote: null,
          editorSelectionQuote: null,
          agentAutoApproveConversationId: null,
          agentAutoApproveRuntimeScriptKey: null
        })
        get().resetAgentState()
        get().clearMcpToolCalls()
      }
    }

    // 刷新会话列表
    await get().initConversations()
  },

  toggleConversationPin: async (id: number) => {
    const { toggleConversationPin: togglePin } = await import('@/db/conversations')
    const isPinned = await togglePin(id)
    // 刷新会话列表
    await get().initConversations()
    return isPinned
  },

  startNewConversation: async () => {
    const { currentConversationId } = get()
    if (currentConversationId) {
      const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
      scheduleConversationMemoryExtraction(currentConversationId)
    }

    // 如果当前会话无消息，删除它（从数据库查询最新状态）
    if (currentConversationId) {
      const { getConversation } = await import('@/db/conversations')
      const currentConv = await getConversation(currentConversationId)
      if (currentConv && currentConv.messageCount === 0) {
        // 空会话，直接删除
        const { deleteConversation: deleteConv } = await import('@/db/conversations')
        await deleteConv(currentConversationId)
      }
      // 刷新会话列表
      await get().initConversations()
    }

    // 清空聊天，不立即创建新会话
    // 等到用户发送第一条消息时才创建会话
    set({
      currentConversationId: null,
      chats: [],
      isTemporaryConversation: false,
      reasoningOverride: null,
      pendingQuote: null,
      editorSelectionQuote: null,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeScriptKey: null
    })
    // 清空 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
  },

  startTemporaryConversation: () => {
    set({
      currentConversationId: null,
      chats: [],
      isTemporaryConversation: true,
      reasoningOverride: null,
      pendingQuote: null,
      editorSelectionQuote: null,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeScriptKey: null,
    })
    get().resetAgentState()
    get().clearMcpToolCalls()
  },
}))

export default useChatStore
