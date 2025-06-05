import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'

export enum WebDAVConnectionState {
  checking = '检测中',
  success = '可用',
  fail = '不可用',
}

interface WebDAVState {
  url: string
  setUrl: (url: string) => Promise<void>

  username: string
  setUsername: (username: string) => Promise<void>

  password: string
  setPassword: (password: string) => Promise<void>

  path: string
  setPath: (path: string) => Promise<void>

  connectionState: WebDAVConnectionState
  setConnectionState: (state: WebDAVConnectionState) => void

  testConnection: () => Promise<boolean>
  initWebDAVData: () => Promise<void>

  backupState: boolean
  setBackupState: (state: boolean) => void

  syncState: boolean
  setSyncState: (state: boolean) => void
  
  backupToWebDAV: () => Promise<string>
  syncFromWebDAV: () => Promise<string>
}

const useWebDAVStore = create<WebDAVState>((set, get) => ({
  url: '',
  setUrl: async (url: string) => {
    set({ url })
    const store = await Store.load('store.json')
    await store.set('webdavUrl', url)
    get().testConnection()
  },

  username: '',
  setUsername: async (username: string) => {
    set({ username })
    const store = await Store.load('store.json')
    await store.set('webdavUsername', username)
    get().testConnection()
  },

  password: '',
  setPassword: async (password: string) => {
    set({ password })
    const store = await Store.load('store.json')
    await store.set('webdavPassword', password)
    get().testConnection()
  },

  path: '',
  setPath: async (path: string) => {
    set({ path })
    const store = await Store.load('store.json')
    await store.set('webdavPath', path)
    get().testConnection()
  },

  connectionState: WebDAVConnectionState.fail,
  setConnectionState: (connectionState) => {
    set({ connectionState })
  },

  testConnection: async () => {
    const { url, username, password, path } = get()
    
    if (!url || !username || !password) {
      set({ connectionState: WebDAVConnectionState.fail })
      return false
    }
    
    set({ connectionState: WebDAVConnectionState.checking })
    
    try {
      const result = await invoke<boolean>('webdav_test', {
        url,
        username,
        password,
        path
      })
      
      set({ connectionState: result ? WebDAVConnectionState.success : WebDAVConnectionState.fail })
      return result
    } catch (error) {
      console.info('WebDAV connection test failed:', error)
      set({ connectionState: WebDAVConnectionState.fail })
      return false
    }
  },

  initWebDAVData: async () => {
    const store = await Store.load('store.json')
    
    const url = await store.get<string>('webdavUrl')
    if (url) set({ url })
    
    const username = await store.get<string>('webdavUsername')
    if (username) set({ username })
    
    const password = await store.get<string>('webdavPassword')
    if (password) set({ password })
    
    const path = await store.get<string>('webdavPath')
    if (path) set({ path })
    
    get().testConnection()
  },

  backupState: false,
  setBackupState: (state: boolean) => {
    set({ backupState: state })
  },

  syncState: false,
  setSyncState: (state: boolean) => {
    set({ syncState: state })
  },

  // 备份到WebDAV
  backupToWebDAV: async () => {
    const { url, username, password, path } = get()
    get().setBackupState(true)
    try {
      const result = await invoke<string>('webdav_backup', {
        url,
        username,
        password,
        path
      })

      return result
    } catch (error) {
      console.error('WebDAV connection test failed:', error)
      return ''
    } finally {
      get().setBackupState(false)
    }
  },

  // 从WebDAV同步
  syncFromWebDAV: async () => {
    const { url, username, password, path } = get()
    get().setSyncState(true)
    try {
      const result = await invoke<string>('webdav_sync', {
        url,
        username,
        password,
        path
      })
      
      return result
    } catch (error) {
      console.error('WebDAV connection test failed:', error)
      return ''
    } finally {
      get().setSyncState(false)
    }
  }
}))

export default useWebDAVStore
