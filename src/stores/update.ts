import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { check, Update } from '@tauri-apps/plugin-updater'

interface UpdateState {
  hasUpdate: boolean
  setHasUpdate: (hasUpdate: boolean) => void
  
  update: Update | null
  setUpdate: (update: Update | null) => void
  
  latestVersion: string
  setLatestVersion: (version: string) => void
  
  ignoredVersion: string
  setIgnoredVersion: (version: string) => Promise<void>
  
  checkForUpdates: () => Promise<void>
  ignoreCurrentVersion: () => Promise<void>
  
  initUpdateStore: () => Promise<void>
}

const useUpdateStore = create<UpdateState>((set, get) => ({
  hasUpdate: false,
  setHasUpdate: (hasUpdate) => set({ hasUpdate }),
  
  update: null,
  setUpdate: (update) => set({ update }),
  
  latestVersion: '',
  setLatestVersion: (version) => set({ latestVersion: version }),
  
  ignoredVersion: '',
  setIgnoredVersion: async (version) => {
    const store = await Store.load('store.json')
    await store.set('ignoredVersion', version)
    await store.save()
    set({ ignoredVersion: version })
  },
  
  checkForUpdates: async () => {
    try {
      const update = await check({
        headers: {
          'X-AccessKey': 'wHi8Tkuc5i6v1UCAuVk48A',
        },
        timeout: 5000,
      })
      
      if (update) {
        const { ignoredVersion } = get()
        set({ 
          update,
          latestVersion: update.version,
          hasUpdate: update.version !== ignoredVersion
        })
      } else {
        set({ 
          update: null,
          hasUpdate: false
        })
      }
    } catch {
      // 检查更新失败，忽略错误
    }
  },
  
  ignoreCurrentVersion: async () => {
    const { latestVersion } = get()
    if (latestVersion) {
      await get().setIgnoredVersion(latestVersion)
      set({ hasUpdate: false })
    }
  },
  
  initUpdateStore: async () => {
    const store = await Store.load('store.json')
    const ignoredVersion = await store.get('ignoredVersion') as string
    if (ignoredVersion) {
      set({ ignoredVersion })
    }
  }
}))

export default useUpdateStore
