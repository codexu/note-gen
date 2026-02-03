import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, getChats, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats, updateChatCondensedContent } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { AgentState, ToolCall } from '@/lib/agent/types'
import { LinkedResource } from '@/lib/files'

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
  loading: boolean
  setLoading: (loading: boolean) => void

  isCondensing: boolean // 压缩状态
  _condenseLock: boolean // 内部锁，防止并发压缩
  maybeCondense: () => void // 触发压缩检查（异步，不阻塞）

  isLinkMark: boolean // 是否关联记录
  setIsLinkMark: (isLinkMark: boolean) => void
  initIsLinkMark: () => void // 初始化关联状态

  chats: Chat[]
  init: (tagId: number) => Promise<void> // 初始化 chats
  insert: (chat: Omit<Chat, 'id' | 'createdAt'>) => Promise<Chat | null> // 插入一条 chat
  updateChat: (chat: Chat) => void // 更新一条 chat
  saveChat: (chat: Chat, isSave?: boolean) => Promise<void> // 保存一条 chat，用于动态 AI 回复结束后保存数据库
  deleteChat: (id: number) => Promise<void> // 删除一条 chat

  locale: string
  getLocale: () => Promise<void>
  setLocale: (locale: string) => void

  clearChats: (tagId: number) => Promise<void> // 清空 chats
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
  
  // Placeholder 状态
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // 关联的文件或文件夹（用于 Agent 工具调用时判断内容是否已在上下文中）
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void
}

const useChatStore = create<ChatState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => {
    set({ loading })
  },

  isCondensing: false,
  _condenseLock: false,

  maybeCondense: () => {
    const state = get()

    console.log('[ChatStore] maybeCondense 被调用', {
      _condenseLock: state._condenseLock,
      总消息数: state.chats.length
    })

    // 防并发：已有压缩任务在执行，直接返回
    if (state._condenseLock) {
      console.log('[ChatStore] 压缩锁已启用，跳过本次检查')
      return
    }

    const { chats } = state

    // 获取最后一次清除后的消息
    const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
    const chatsAfterClear = lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)

    console.log('[ChatStore] 待检查的消息数:', chatsAfterClear.length)

    // 使用 IIFE 立即执行异步函数，不等待结果
    ;(async () => {
      // 动态导入 condense 模块（避免循环依赖）
      const { shouldCondense, condenseChats } = await import('@/lib/ai/condense')

      if (!(await shouldCondense(chatsAfterClear))) {
        console.log('[ChatStore] 不需要压缩，退出')
        return
      }

      console.log('[ChatStore] 触发压缩，设置锁')

      // 设置锁和压缩状态
      set({ _condenseLock: true, isCondensing: true })

      try {
        // 为每条消息生成摘要并存储
        const condensedResults = await condenseChats(chatsAfterClear)

        for (const result of condensedResults) {
          if (result.summary) {
            // 更新数据库中的摘要内容
            await updateChatCondensedContent(result.chatId, result.summary)

            // 更新 state 中的消息
            set({
              chats: get().chats.map(c =>
                c.id === result.chatId
                  ? { ...c, condensedContent: result.summary || undefined, condensedAt: Date.now() }
                  : c
              )
            })
          }
        }

        console.log('[ChatStore] 压缩完成，已更新', condensedResults.length, '条消息的摘要')
      } catch (error) {
        // 静默失败，不影响用户体验
        console.error('[ChatStore] 压缩失败:', error)
      } finally {
        console.log('[ChatStore] 释放压缩锁')
        set({ _condenseLock: false, isCondensing: false })
      }
    })()
  },

  isLinkMark: (typeof window !== 'undefined' ? localStorage.getItem('isLinkMark') === 'true' : true),
  setIsLinkMark: (isLinkMark: boolean) => {
    set({ isLinkMark })
    if (typeof window !== 'undefined') {
      localStorage.setItem('isLinkMark', String(isLinkMark))
    }
  },
  initIsLinkMark: () => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('isLinkMark')
      if (stored === null) {
        localStorage.setItem('isLinkMark', 'true')
        set({ isLinkMark: true })
      } else {
        set({ isLinkMark: stored === 'true' })
      }
    }
  },

  agentState: {
    isRunning: false,
    isThinking: false,
    currentThought: '',
    thoughtHistory: [],
    completedSteps: [],
    currentAction: undefined,
    currentObservation: undefined,
    toolCalls: [],
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
    const currentState = get().agentState
    set({
      agentState: {
        isRunning: false,
        isThinking: false,
        currentThought: '',
        thoughtHistory: [],
        completedSteps: [],
        currentAction: '',
        currentObservation: '',
        toolCalls: [],
        maxIterations: 15,
        currentIteration: 0,
        pendingConfirmation: undefined,
        confirmationHistory: [],
        loadedSkills: undefined,
        selectedSkills: undefined,
        currentStepStartTime: undefined,
        // 保留 RAG 字段，因为它们应该在整个 Agent 执行期间显示
        ragSources: currentState.ragSources,
        ragSourceDetails: currentState.ragSourceDetails,
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

  isPlaceholderEnabled: true,
  setPlaceholderEnabled: (enabled: boolean) => {
    set({ isPlaceholderEnabled: enabled })
  },

  linkedResource: null,
  setLinkedResource: (resource: LinkedResource | null) => {
    set({ linkedResource: resource })
  },

  chats: [],
  init: async (tagId: number) => {
    await initChatsDb()
    const data = await getChats(tagId)
    set({ chats: data })
  },
  insert: async (chat) => {
    const res = await insertChat(chat)
    let data: Chat
    if (res.lastInsertId) {
      data =  {
        id: res.lastInsertId,
        createdAt: Date.now(),
        ...chat
      }
      const chats = get().chats
      const newChats = [...chats, data]
      set({ chats: newChats })
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
    if (isSave) {
      await updateChat(chat)
    }
  },
  deleteChat: async (id) => {
    const chats = get().chats
    const newChats = chats.filter(item => item.id !== id)
    set({ chats: newChats })
    await deleteChat(id)
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

  clearChats: async (tagId) => {
    set({ chats: [] })
    await clearChatsByTagId(tagId)
    // 清空聊天记录时同步清理 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
  },

  updateInsert: async (id) => {
    await updateChatsInsertedById(id)
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
    const path = '.data'
    const filename = 'chats.json'
    const chats = await getAllChats()
    const store = await Store.load('store.json');
    const jsonToBase64 = (data: Chat[]) => {
      return Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    }
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = false
    let files: any;
    let res;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo })
        res = await uploadGithubFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: githubRepo,
          path,
          filename,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo })
        res = await uploadGiteeFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: giteeRepo,
          path,
          filename,
          sha: files?.sha,
        })
        break;
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        files = await gitlabGetFiles({ path, repo: gitlabRepo })
        const chatFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGitlabFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: gitlabRepo,
          path,
          filename,
          sha: chatFile?.sha || '',
        })
        break;
      case 'gitea':
        const giteaRepo = await getSyncRepoName('gitea')
        files = await giteaGetFiles({ path, repo: giteaRepo })
        const giteaChatFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGiteaFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: giteaRepo,
          path,
          filename,
          sha: giteaChatFile?.sha || '',
        })
        break;
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
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
    const path = '.data'
    const filename = 'chats.json'
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = []
    let files;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo2 = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo2 })
        break;
      case 'gitee':
        const giteeRepo2 = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo2 })
        break;
      case 'gitlab':
        const gitlabRepo2 = await getSyncRepoName('gitlab')
        files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepo2 })
        break;
      case 'gitea':
        const giteaRepo2 = await getSyncRepoName('gitea')
        files = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepo2 })
        break;
    }
    if (files) {
      const configJson = decodeBase64ToString(files.content)
      result = JSON.parse(configJson)
    }
    await deleteAllChats()
    await insertChats(result)
    set({ syncState: false })
    return result
  }
}))

export default useChatStore