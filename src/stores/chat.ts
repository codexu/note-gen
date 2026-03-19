import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats, updateChatCondensedContent, getChatsByConversation } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { getRemoteFileContent } from '@/lib/sync/remote-file';
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { AgentState, ToolCall } from '@/lib/agent/types'
import { LinkedResource } from '@/lib/files'
import type { Conversation } from '@/db/conversations'
import { S3Config, WebDAVConfig } from '@/types/sync'

export interface PendingQuote {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
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
  loading: boolean
  setLoading: (loading: boolean) => void

  isCondensing: boolean // 压缩状态
  _condenseLock: boolean // 内部锁，防止并发压缩
  maybeCondense: () => void // 触发压缩检查（异步，不阻塞）

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
  agentAutoApproveRuntimeSkillId: string | null
  setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => void

  // Placeholder 状态
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // 关联的文件或文件夹（用于 Agent 工具调用时判断内容是否已在上下文中）
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void

  // 关联文件的行号预览（用于 AI 对话时快速了解文件结构）
  linkedResourcePreview: string | null
  setLinkedResourcePreview: (preview: string | null) => void

  pendingQuote: PendingQuote | null
  setPendingQuote: (quote: PendingQuote | null) => void
  clearPendingQuote: () => void

  onboardingPromptDraft: string | null
  setOnboardingPromptDraft: (prompt: string | null) => void

  // === 新增：会话管理 ===
  // 当前会话
  currentConversationId: number | null
  conversations: Conversation[]

  // 会话初始化和管理
  initConversations: () => Promise<void> // 初始化会话列表
  createConversation: (title?: string) => Promise<number> // 创建新会话
  switchConversation: (id: number) => Promise<void> // 切换会话
  updateConversationTitle: (id: number, title: string) => Promise<void> // 更新会话标题
  deleteConversation: (id: number) => Promise<void> // 删除会话
  toggleConversationPin: (id: number) => Promise<boolean> // 切换会话置顶状态
  startNewConversation: () => Promise<void> // 开始新对话（保存当前会话后创建新会话）
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

    // 防并发：已有压缩任务在执行，直接返回
    if (state._condenseLock) {
      return
    }

    // 添加版本号引用，防止竞态条件
    const versionRef = { current: 0 }
    const currentVersion = ++versionRef.current

    const { chats } = state

    // 获取最后一次清除后的消息
    const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
    const chatsAfterClear = lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)

    // 使用 IIFE 立即执行异步函数，不等待结果
    ;(async () => {
      // 动态导入 condense 模块（避免循环依赖）
      const { shouldCondense, condenseChats } = await import('@/lib/ai/condense')

      // 版本号检查：防止被新版本覆盖
      if (currentVersion !== versionRef.current) {
        return
      }

      if (!(await shouldCondense(chatsAfterClear))) {
        return
      }

      // 再次检查版本号
      if (currentVersion !== versionRef.current) {
        return
      }

      // 设置锁和压缩状态
      set({ _condenseLock: true, isCondensing: true })

      try {
        // 为每条消息生成摘要并存储
        const condensedResults = await condenseChats(chatsAfterClear)

        // 版本号检查：防止在压缩过程中被新版本覆盖
        if (currentVersion !== versionRef.current) {
          return
        }

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
      } catch (error) {
        // 静默失败，不影响用户体验
        console.error('[ChatStore] 压缩失败:', error)
      } finally {
        set({ _condenseLock: false, isCondensing: false })
      }
    })()
  },

  agentState: {
    activeChatId: undefined,
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
        activeChatId: undefined,
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
  agentAutoApproveRuntimeSkillId: null,
  setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => {
    set({ agentAutoApproveRuntimeSkillId: skillId })
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

  pendingQuote: null,
  setPendingQuote: (pendingQuote: PendingQuote | null) => {
    set({ pendingQuote })
  },
  clearPendingQuote: () => {
    set({ pendingQuote: null })
  },

  onboardingPromptDraft: null,
  setOnboardingPromptDraft: (prompt: string | null) => {
    set({ onboardingPromptDraft: prompt })
  },

  chats: [],
  // 兼容旧代码：init 方法现在会初始化会话列表并切换到第一个会话
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  init: async (_tagId: number) => {
    await initChatsDb()
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
    const { currentConversationId } = get()

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
    if (isSave) {
      await updateChat(chat)
    }
  },
  deleteChat: async (id) => {
    const chats = get().chats
    const newChats = chats.filter(item => item.id !== id)
    set({ chats: newChats })
    await deleteChat(id)

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
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
    set({ chats: [] })
    // 清空聊天记录时同步清理 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
    get().clearPendingQuote()

    // 更新会话的消息数量
    const { currentConversationId } = get()
    if (currentConversationId) {
      // 获取当前消息数量
      const { chats } = get()
      const count = chats.length

      // 删除数据库中的记录
      const db = await import('@/db').then(m => m.getDb())
      await db.execute("delete from chats where conversationId = $1", [currentConversationId])

      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -count)
      await get().initConversations()
    } else {
      // 兼容旧代码：如果没有 conversationId，使用 tagId
      await clearChatsByTagId(tagId)
    }
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
    const fullPath = `${path}/${filename}`;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: fullPath, repo: githubRepo })
        res = await uploadGithubFile({
          file: jsonToBase64(chats),
          repo: githubRepo,
          path: fullPath,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: fullPath, repo: giteeRepo })
        res = await uploadGiteeFile({
          file: jsonToBase64(chats),
          repo: giteeRepo,
          path: fullPath,
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
          file: jsonToBase64(chats),
          repo: giteaRepo,
          path,
          filename,
          sha: giteaChatFile?.sha || '',
        })
        break;
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const existingFile = await s3HeadObject(s3Config, s3Key)
          if (existingFile) {
            await s3Delete(s3Config, s3Key)
          }
          res = await s3Upload(s3Config, s3Key, JSON.stringify(chats, null, 2))
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const existingFile = await webdavHeadObject(webdavConfig, webdavKey)
          if (existingFile) {
            await webdavDelete(webdavConfig, webdavKey)
          }
          res = await webdavUpload(webdavConfig, webdavKey, JSON.stringify(chats, null, 2))
        }
        break;
      }
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
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const s3Result = await s3Download(s3Config, s3Key)
          if (s3Result) {
            // S3 返回的 content 是字符串，直接解析
            result = JSON.parse(s3Result.content)
          }
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const webdavResult = await webdavDownload(webdavConfig, webdavKey)
          if (webdavResult) {
            result = JSON.parse(webdavResult.content)
          }
        }
        break;
      }
    }
    // S3/WebDAV 已经直接解析到 result 了，这里处理 Git 平台
    if (files) {
      const configJson = decodeBase64ToString(getRemoteFileContent(files, `${path}/${filename}`))
      result = JSON.parse(configJson)
    }
    if (result.length > 0) {
      await deleteAllChats()
      await insertChats(result)
    }
    set({ syncState: false })
    return result
  },

  // === 新增：会话管理方法 ===
  currentConversationId: null,
  conversations: [],

  initConversations: async () => {
    const { getAllConversations } = await import('@/db/conversations')
    const conversations = await getAllConversations()
    set({ conversations })
  },

  createConversation: async (title = '新对话') => {
    const { createConversation: createConv } = await import('@/db/conversations')
    const id = await createConv(title)
    // 设置为当前会话并刷新会话列表
    set({ currentConversationId: id })
    await get().initConversations()
    return id
  },

  switchConversation: async (id: number) => {
    // 先同步消息数量，确保 messageCount 与实际消息数量一致
    const { syncConversationMessageCount } = await import('@/db/conversations')
    await syncConversationMessageCount(id)
    // 然后加载消息
    const { getChatsByConversation } = await import('@/db/chats')
    const data = await getChatsByConversation(id)
    set({ currentConversationId: id, chats: data, pendingQuote: null })
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
          chats: [],
          pendingQuote: null,
          agentAutoApproveConversationId: null,
          agentAutoApproveRuntimeSkillId: null
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
      pendingQuote: null,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeSkillId: null
    })
    // 清空 Agent 状态
    get().resetAgentState()
    get().clearMcpToolCalls()
  },
}))

export default useChatStore
