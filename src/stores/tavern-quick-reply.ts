import { create } from 'zustand'
import {
  TavernQuickReplySet,
  TavernQuickReply,
  getQuickReplySets,
  getEnabledQuickReplySets,
  getQuickRepliesBySetId,
  getVisibleQuickRepliesBySetId,
  insertQuickReplySet,
  updateQuickReplySet,
  deleteQuickReplySet,
  insertQuickReply,
  updateQuickReply,
  deleteQuickReply,
  getAutoExecuteQuickReplies,
} from '@/db/tavern'

interface QuickReplyWithSet extends TavernQuickReply {
  setName: string
  setColor: string
}

interface TavernQuickReplyState {
  // 数据
  sets: TavernQuickReplySet[]
  repliesBySet: Map<number, TavernQuickReply[]>
  isLoading: boolean
  
  // 初始化
  init: () => Promise<void>
  
  // 集合操作
  loadSets: () => Promise<void>
  createSet: (name: string, scope?: 'global' | 'character', cardId?: number) => Promise<number | undefined>
  updateSet: (id: number, updates: Partial<TavernQuickReplySet>) => Promise<void>
  deleteSet: (id: number) => Promise<void>
  
  // 快捷回复操作
  loadReplies: (setId: number) => Promise<void>
  createReply: (setId: number, label: string, message: string) => Promise<number | undefined>
  updateReply: (id: number, updates: Partial<TavernQuickReply>) => Promise<void>
  deleteReply: (id: number, setId: number) => Promise<void>
  
  // 获取可见的快捷回复 (用于 UI 显示)
  getVisibleReplies: (cardId?: number) => Promise<QuickReplyWithSet[]>
  
  // 获取自动执行的快捷回复
  getAutoExecuteReplies: (
    trigger: 'startup' | 'user' | 'ai' | 'chatChange',
    cardId?: number
  ) => Promise<TavernQuickReply[]>
  
  // 宏替换
  replaceMacros: (
    message: string,
    context: {
      charName?: string
      userName?: string
      chatId?: number
    }
  ) => string
}

export const useTavernQuickReplyStore = create<TavernQuickReplyState>((set, get) => ({
  sets: [],
  repliesBySet: new Map(),
  isLoading: false,
  
  init: async () => {
    await get().loadSets()
  },
  
  loadSets: async () => {
    set({ isLoading: true })
    try {
      const sets = await getQuickReplySets()
      set({ sets })
      
      // 预加载所有集合的快捷回复
      const repliesBySet = new Map<number, TavernQuickReply[]>()
      for (const s of sets) {
        const replies = await getQuickRepliesBySetId(s.id)
        repliesBySet.set(s.id, replies)
      }
      set({ repliesBySet })
    } finally {
      set({ isLoading: false })
    }
  },
  
  createSet: async (name, scope = 'global', cardId) => {
    const id = await insertQuickReplySet({
      name,
      scope,
      cardId: cardId || null,
      color: '',
      isEnabled: true,
      sortOrder: get().sets.length,
    })
    await get().loadSets()
    return id
  },
  
  updateSet: async (id, updates) => {
    await updateQuickReplySet(id, updates)
    await get().loadSets()
  },
  
  deleteSet: async (id) => {
    await deleteQuickReplySet(id)
    await get().loadSets()
  },
  
  loadReplies: async (setId) => {
    const replies = await getQuickRepliesBySetId(setId)
    const repliesBySet = new Map(get().repliesBySet)
    repliesBySet.set(setId, replies)
    set({ repliesBySet })
  },
  
  createReply: async (setId, label, message) => {
    const replies = get().repliesBySet.get(setId) || []
    const id = await insertQuickReply({
      setId,
      label,
      icon: '',
      title: label,
      message,
      isHidden: false,
      executeOnStartup: false,
      executeOnUser: false,
      executeOnAi: false,
      executeOnChatChange: false,
      preventAutoExecute: true,
      sortOrder: replies.length,
    })
    await get().loadReplies(setId)
    return id
  },
  
  updateReply: async (id, updates) => {
    await updateQuickReply(id, updates)
    // 找到对应的 setId 并刷新
    for (const [setId, replies] of get().repliesBySet) {
      if (replies.some(r => r.id === id)) {
        await get().loadReplies(setId)
        break
      }
    }
  },
  
  deleteReply: async (id, setId) => {
    await deleteQuickReply(id)
    await get().loadReplies(setId)
  },
  
  getVisibleReplies: async (cardId) => {
    const enabledSets = await getEnabledQuickReplySets(cardId)
    const result: QuickReplyWithSet[] = []
    
    for (const s of enabledSets) {
      const replies = await getVisibleQuickRepliesBySetId(s.id)
      for (const r of replies) {
        result.push({
          ...r,
          setName: s.name,
          setColor: s.color,
        })
      }
    }
    
    return result
  },
  
  getAutoExecuteReplies: async (trigger, cardId) => {
    return await getAutoExecuteQuickReplies(trigger, cardId)
  },
  
  replaceMacros: (message, context) => {
    let result = message
    
    // 基础宏替换
    if (context.charName) {
      result = result.replace(/\{\{char\}\}/gi, context.charName)
    }
    if (context.userName) {
      result = result.replace(/\{\{user\}\}/gi, context.userName)
    }
    
    // 时间宏
    const now = new Date()
    result = result.replace(/\{\{time\}\}/gi, now.toLocaleTimeString())
    result = result.replace(/\{\{date\}\}/gi, now.toLocaleDateString())
    
    // 随机数宏 {{random::min::max}}
    result = result.replace(/\{\{random::(\d+)::(\d+)\}\}/gi, (_, min, max) => {
      const minNum = parseInt(min)
      const maxNum = parseInt(max)
      return String(Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum)
    })
    
    // 简单随机数 {{random}} (0-100)
    result = result.replace(/\{\{random\}\}/gi, () => {
      return String(Math.floor(Math.random() * 101))
    })
    
    return result
  },
}))
