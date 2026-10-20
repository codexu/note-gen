import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { check, Update } from '@tauri-apps/plugin-updater'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { compareVersions, extractVersionText } from '@/lib/version'

export const MOBILE_UPDATE_MANIFEST_URL = 'https://download.notegen.top/updates/latest.json'
export const ANDROID_DOWNLOAD_URL = 'https://notegen.top/download'
export const IOS_TESTFLIGHT_URL = 'https://testflight.apple.com/join/8KjFRTCq'

export interface MobileUpdateInfo {
  version: string
  notes: string
  pubDate: string
}

type MobileUpdateStatus = 'idle' | 'checking' | 'ready' | 'error'

interface MobileUpdateManifest {
  version?: unknown
  notes?: unknown
  pub_date?: unknown
}

interface UpdateState {
  hasUpdate: boolean
  setHasUpdate: (hasUpdate: boolean) => void
  
  update: Update | null
  setUpdate: (update: Update | null) => void
  
  latestVersion: string
  setLatestVersion: (version: string) => void

  mobileUpdate: MobileUpdateInfo | null
  mobileUpdateStatus: MobileUpdateStatus
  mobileUpdateError: string
  checkForMobileUpdates: (currentVersion: string) => Promise<MobileUpdateInfo | null>
  
  ignoredVersion: string
  setIgnoredVersion: (version: string) => Promise<void>
  clearIgnoredVersion: () => Promise<void>
  
  checkForUpdates: (options?: { throwOnError?: boolean }) => Promise<void>
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

  mobileUpdate: null,
  mobileUpdateStatus: 'idle',
  mobileUpdateError: '',
  checkForMobileUpdates: async (currentVersion) => {
    set({ mobileUpdateStatus: 'checking', mobileUpdateError: '' })

    try {
      const response = await httpFetch(MOBILE_UPDATE_MANIFEST_URL, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Update manifest request failed: ${response.status}`)
      }

      const manifest = await response.json() as MobileUpdateManifest
      const version = typeof manifest.version === 'string'
        ? extractVersionText(manifest.version)
        : null

      if (!version) {
        throw new Error('Update manifest does not contain a valid version')
      }

      const info: MobileUpdateInfo = {
        version,
        notes: typeof manifest.notes === 'string' ? manifest.notes : '',
        pubDate: typeof manifest.pub_date === 'string' ? manifest.pub_date : '',
      }
      const { ignoredVersion } = get()
      const hasUpdate = compareVersions(version, currentVersion) > 0
        && version !== ignoredVersion

      set({
        mobileUpdate: hasUpdate ? info : null,
        mobileUpdateStatus: 'ready',
        latestVersion: version,
        hasUpdate,
      })

      return hasUpdate ? info : null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        mobileUpdate: null,
        mobileUpdateStatus: 'error',
        mobileUpdateError: message,
        hasUpdate: false,
      })
      throw error
    }
  },
  
  ignoredVersion: '',
  setIgnoredVersion: async (version) => {
    const store = await Store.load('store.json')
    await store.set('ignoredVersion', version)
    await store.save()
    set({ ignoredVersion: version })
  },
  clearIgnoredVersion: async () => {
    const store = await Store.load('store.json')
    await store.set('ignoredVersion', '')
    await store.save()

    const { update } = get()
    set({ ignoredVersion: '', hasUpdate: Boolean(update) })
  },
  
  checkForUpdates: async (options) => {
    try {
      const update = await check({
        timeout: 5000,
      })
      
      if (update) {
        const { ignoredVersion } = get()
        const hasUpdate = update.version !== ignoredVersion

        set({ 
          update,
          latestVersion: update.version,
          hasUpdate
        })
      } else {
        set({ 
          update: null,
          hasUpdate: false
        })
      }
    } catch (error) {
      // 启动时保持静默，设置页由调用方显示带上下文的错误。
      if (options?.throwOnError) throw error
    }
  },
  
  ignoreCurrentVersion: async () => {
    const { latestVersion } = get()
    if (latestVersion) {
      await get().setIgnoredVersion(latestVersion)
      set({ hasUpdate: false, mobileUpdate: null })
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
