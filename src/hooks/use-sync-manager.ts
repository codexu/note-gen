'use client'

import * as React from 'react'
import { getSyncManager, SyncResult } from '@/lib/sync/sync-manager'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

interface UseSyncManagerOptions {
  autoRefresh?: boolean
  refreshInterval?: number
}

export function useSyncManager(path?: string, options: UseSyncManagerOptions = {}) {
  const { autoRefresh = false, refreshInterval = 30000 } = options
  const [status, setStatus] = React.useState<'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown' | 'syncing' | 'offline'>('unknown')
  const [lastSyncTime, setLastSyncTime] = React.useState<number>(0)
  const [isPending, setIsPending] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const manager = React.useMemo(() => getSyncManager(), [])

  const checkStatus = async (filePath: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const syncStatus = await manager.getFileSyncStatus(filePath)
      setStatus(syncStatus)

      const state = manager.getState()
      setLastSyncTime(state.lastSyncTime)
      setIsPending(state.pendingSync)
    } catch (err) {
      console.error('Failed to check sync status:', err)
      setStatus('unknown')
      setError(err instanceof Error ? err.message : 'Failed to check status')
    } finally {
      setIsLoading(false)
    }
  }

  const sync = async (): Promise<SyncResult | null> => {
    if (!path) return null

    setStatus('syncing')
    setIsLoading(true)

    try {
      const result = await manager.syncFile(path)
      await checkStatus(path)
      return result
    } catch (err) {
      console.error('Sync failed:', err)
      setStatus('conflict')
      setError(err instanceof Error ? err.message : 'Sync failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }

  const push = async (): Promise<SyncResult | null> => {
    if (!path) return null

    setIsLoading(true)
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      const result = await manager.pushFile(path, content)
      await checkStatus(path)
      return result
    } catch (err) {
      console.error('Push failed:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  const pull = async (): Promise<SyncResult | null> => {
    if (!path) return null

    setIsLoading(true)
    try {
      const result = await manager.pullFile(path)
      await checkStatus(path)
      return result
    } catch (err) {
      console.error('Pull failed:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  // 自动刷新状态
  React.useEffect(() => {
    if (!autoRefresh || !path) return

    checkStatus(path)

    const interval = setInterval(() => {
      checkStatus(path)
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [path, autoRefresh, refreshInterval])

  // 初始检查
  React.useEffect(() => {
    if (path) {
      checkStatus(path)
    }
  }, [path])

  return {
    status,
    lastSyncTime,
    isPending,
    isLoading,
    error,
    checkStatus,
    sync,
    push,
    pull,
    getConfig: () => manager.getConfig(),
    updateConfig: (config: any) => manager.updateConfig(config),
  }
}
