'use client'

import { Store } from '@tauri-apps/plugin-store'
import { useState, useEffect, useCallback, useRef } from 'react'
import { SyncPlatform } from '@/types/sync'

// 缓存 Store 实例
let storeInstance: Store | null = null
let storePromise: Promise<Store> | null = null

async function getStore(): Promise<Store> {
  if (storeInstance) return storeInstance
  if (storePromise) return storePromise

  storePromise = Store.load('store.json')
  storeInstance = await storePromise
  return storeInstance
}

export interface SyncPlatformStatus {
  hasToken: boolean
  isConnected: boolean
  repoName: string | null
  lastSync: number | null
}

export interface UseSyncSettingsReturn {
  // 加载状态
  isLoading: boolean
  error: string | null
  clearError: () => void

  // Token 操作
  getToken: (platform: SyncPlatform) => Promise<string | null>
  setToken: (platform: SyncPlatform, token: string) => Promise<void>

  // 各平台状态
  platformStatus: Record<SyncPlatform, SyncPlatformStatus>
  updatePlatformStatus: (platform: SyncPlatform, status: Partial<SyncPlatformStatus>) => void

  // 刷新所有平台状态
  refreshAllStatus: () => Promise<void>
}

const defaultPlatformStatus: SyncPlatformStatus = {
  hasToken: false,
  isConnected: false,
  repoName: null,
  lastSync: null,
}

export function useSyncSettings(): UseSyncSettingsReturn {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [platformStatus, setPlatformStatus] = useState<Record<SyncPlatform, SyncPlatformStatus>>({
    github: { ...defaultPlatformStatus },
    gitee: { ...defaultPlatformStatus },
    gitlab: { ...defaultPlatformStatus },
    gitea: { ...defaultPlatformStatus },
    s3: { ...defaultPlatformStatus },
    webdav: { ...defaultPlatformStatus },
  })

  const initialized = useRef(false)

  // 初始化加载所有平台状态
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const init = async () => {
      try {
        const store = await getStore()

        const platforms: SyncPlatform[] = ['github', 'gitee', 'gitlab', 'gitea', 's3', 'webdav']
        const statusMap: Record<SyncPlatform, SyncPlatformStatus> = { ...platformStatus }

        await Promise.all(
          platforms.map(async (platform) => {
            const tokenKey = `${platform}AccessToken` as const
            const token = await store.get<string>(tokenKey)

            statusMap[platform] = {
              hasToken: !!token,
              isConnected: false, // 需要各组件单独检查
              repoName: null,
              lastSync: null,
            }
          })
        )

        setPlatformStatus(statusMap)
      } catch (err) {
        console.error('Failed to init sync settings:', err)
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const getToken = useCallback(async (platform: SyncPlatform): Promise<string | null> => {
    try {
      const store = await getStore()
      const tokenKey = `${platform}AccessToken` as const
      const token = await store.get<string>(tokenKey)
      return token || null
    } catch (err) {
      console.error('Failed to get token:', err)
      return null
    }
  }, [])

  const setToken = useCallback(async (platform: SyncPlatform, token: string) => {
    try {
      const store = await getStore()
      const tokenKey = `${platform}AccessToken` as const
      await store.set(tokenKey, token)
      await store.save()

      setPlatformStatus((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          hasToken: !!token,
        },
      }))
    } catch (err) {
      console.error('Failed to set token:', err)
      setError(err instanceof Error ? err.message : 'Failed to save token')
    }
  }, [])

  const updatePlatformStatus = useCallback(
    (platform: SyncPlatform, status: Partial<SyncPlatformStatus>) => {
      setPlatformStatus((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          ...status,
        },
      }))
    },
    []
  )

  const refreshAllStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      const store = await getStore()
      const platforms: SyncPlatform[] = ['github', 'gitee', 'gitlab', 'gitea']

      await Promise.all(
        platforms.map(async (platform) => {
          const tokenKey = `${platform}AccessToken` as const
          const token = await store.get<string>(tokenKey)

          setPlatformStatus((prev) => ({
            ...prev,
            [platform]: {
              ...prev[platform],
              hasToken: !!token,
            },
          }))
        })
      )
    } catch (err) {
      console.error('Failed to refresh status:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh')
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    isLoading,
    error,
    clearError,
    getToken,
    setToken,
    platformStatus,
    updatePlatformStatus,
    refreshAllStatus,
  }
}
