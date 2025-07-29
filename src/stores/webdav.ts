import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { invoke } from '@tauri-apps/api/core'

export enum WebDAVConnectionState {
  checking = 'checking',
  success = 'success',
  fail = 'failed',
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
  createWebDAVDir: (path: string) => Promise<void>
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

// 防抖函数
function simpleDebounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

const useWebDAVStore = create<WebDAVState>((set, get) => {
  let isTestingInProgress = false
  let shouldTestAgain = false

  const performConnectionTest = async (): Promise<boolean> => {
    // 防止重复执行
    if (isTestingInProgress) {
      shouldTestAgain = true
      return false
    }

    const { url, username, password, path } = get()
    
    // 检查配置完整性
    if (!url?.trim() || !username?.trim() || !password?.trim()) {
      set({ connectionState: WebDAVConnectionState.fail })
      return false
    }
    
    isTestingInProgress = true
    set({ connectionState: WebDAVConnectionState.checking })
    
    try {
      const result = await invoke<boolean>('webdav_test', {
        url,
        username,
        password,
        path
      })
      
      set({
        connectionState: result ? WebDAVConnectionState.success : WebDAVConnectionState.fail
      })
      return result

    } catch (_error) {
      console.error('Failed to test connection:', _error)
      set({ connectionState: WebDAVConnectionState.fail })
      return false

    } finally {
      isTestingInProgress = false

      // 如果在测试期间有新的测试请求，再次执行
      if (shouldTestAgain) {
        shouldTestAgain = false
        setTimeout(() => performConnectionTest(), 100)
      }
    }
  }

  // 使用防抖
  const debouncedTest = simpleDebounce(performConnectionTest, 300)

  return {
    url: '',
    setUrl: async (url: string) => {
      set({ url })
      try {
        const store = await Store.load('store.json')
        await store.set('webdavUrl', url)
      } catch (error) {
        console.error('Failed to save URL:', error)
      }
      debouncedTest()
    },

    username: '',
    setUsername: async (username: string) => {
      set({ username })
      try {
        const store = await Store.load('store.json')
        await store.set('webdavUsername', username)
      } catch (error) {
        console.error('Failed to save username:', error)
      }
      debouncedTest()
    },

    password: '',
    setPassword: async (password: string) => {
      set({ password })
      try {
        const store = await Store.load('store.json')
        await store.set('webdavPassword', password)
      } catch (error) {
        console.error('Failed to save password:', error)
      }
      debouncedTest()
    },

    path: '',
    setPath: async (path: string) => {
      set({ path })
      try {
        const store = await Store.load('store.json')
        await store.set('webdavPath', path)
      } catch (error) {
        console.error('Failed to save path:', error)
      }
      debouncedTest()
    },

    connectionState: WebDAVConnectionState.fail,
    setConnectionState: (connectionState) => {
      set({ connectionState })
    },

    testConnection: async () => {
      return performConnectionTest()
  },

  initWebDAVData: async () => {
      try {
    const store = await Store.load('store.json')
        const url = await store.get<string>('webdavUrl') || ''
        const username = await store.get<string>('webdavUsername') || ''
        const password = await store.get<string>('webdavPassword') || ''
        const path = await store.get<string>('webdavPath') || ''

        set({ url, username, password, path })
    
        if (url && username && password) {
          setTimeout(() => performConnectionTest(), 100)
        }
      } catch (error) {
        console.error('Failed to load WebDAV data:', error)
      }
  },

  backupState: false,
  setBackupState: (state: boolean) => {
    set({ backupState: state })
  },

  syncState: false,
  setSyncState: (state: boolean) => {
    set({ syncState: state })
  },

  backupToWebDAV: async () => {
      const { url, username, password, path, backupState } = get()

      if (backupState) {
        throw new Error('Backup is already in progress')
      }

      set({ backupState: true })

    try {
        return await invoke<string>('webdav_backup', {
          url, username, password, path
      })
    } finally {
        set({ backupState: false })
    }
  },

  syncFromWebDAV: async () => {
      const { url, username, password, path, syncState } = get()

      if (syncState) {
        throw new Error('Sync is already in progress')
      }

      set({ syncState: true })

    try {
        return await invoke<string>('webdav_sync', {
          url, username, password, path
      })
    } finally {
        set({ syncState: false })
      }
    },

    //创建WebDAVD目录
    createWebDAVDir: async (dirPath: string) => {
      const { url, username, password } = get()

      if (!url || !username || !password) {
        throw new Error('WebDAV connection parameters are incomplete')
      }

      await invoke('webdav_create_dir', {
        url, username, password, path: dirPath
      })
    }
  }
})

export default useWebDAVStore
