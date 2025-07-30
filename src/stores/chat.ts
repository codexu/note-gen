import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, getChats, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/gitlab';
import { RepoNames } from '@/lib/github.types';
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

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadChats: () => Promise<boolean>
  downloadChats: () => Promise<Chat[]>
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
    let files;
    let res;
    switch (primaryBackupMethod) {
      case 'github':
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: RepoNames.sync })
        res = await uploadGithubFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: RepoNames.sync,
          path,
          filename,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: RepoNames.sync })
        res = await uploadGiteeFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: RepoNames.sync,
          path,
          filename,
          sha: files?.sha,
        })
        if (res) {
          result = true
        }
        break;
      case 'gitlab':
        files = await gitlabGetFiles({ path, repo: RepoNames.sync })
        const chatFile = files?.find(file => file.name === filename)
        res = await uploadGitlabFile({
          ext: 'json',
          file: jsonToBase64(chats),
          repo: RepoNames.sync,
          path,
          filename,
          sha: chatFile?.sha || '',
        })
        break;
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
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
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: RepoNames.sync })
        break;
      case 'gitee':
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: RepoNames.sync })
        break;
      case 'gitlab':
        files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: RepoNames.sync })
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