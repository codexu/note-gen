import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, getChats, initChatsDb, insertChat, updateChat, updateChatsInsertedById } from '@/db/chats'
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';

interface ChatState {
  loading: boolean
  setLoading: (loading: boolean) => void

  isLinkMark: boolean // 是否关联记录
  setIsLinkMark: (isLinkMark: boolean) => void

  isPlaceholderEnabled: boolean // 是否启用AI提示占位符
  setPlaceholderEnabled: (isEnabled: boolean) => void

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
}

const useChatStore = create<ChatState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => {
    set({ loading })
  },

  isLinkMark: true,
  setIsLinkMark: (isLinkMark: boolean) => {
    set({ isLinkMark })
  },

  isPlaceholderEnabled: true,
  setPlaceholderEnabled: (isEnabled: boolean) => {
    set({ isPlaceholderEnabled: isEnabled })
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
        return chat
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
  }
}))

export default useChatStore