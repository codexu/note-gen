'use client'

import { useEffect, useState } from 'react'
import { initAllDatabases } from '@/db'
import emitter from '@/lib/emitter'
import { loadSelfHostedFileTreeStatus, type SelfHostedFileStatus } from '@/lib/self-hosted-sync/file-tree-status'
import { getCurrentWorkspaceRoot } from '@/lib/self-hosted-sync/workspaces'
import useSettingStore from '@/stores/setting'

const emptyStatus: ReadonlyMap<string, SelfHostedFileStatus> = new Map()

export function useSelfHostedFileTreeStatus() {
  const platform = useSettingStore(state => state.primaryBackupMethod)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const [snapshot, setSnapshot] = useState<{
    workspacePath: string | undefined
    status: ReadonlyMap<string, SelfHostedFileStatus>
  } | null>(null)

  useEffect(() => {
    if (platform !== 'selfHosted') {
      setSnapshot(null)
      return
    }

    let disposed = false
    let sequence = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      const request = ++sequence
      try {
        await initAllDatabases()
        const root = await getCurrentWorkspaceRoot()
        const status = await loadSelfHostedFileTreeStatus(root)
        if (!disposed && request === sequence) {
          setSnapshot(previous => {
            if (previous && previous.workspacePath === workspacePath && previous.status.size === status.size
              && [...status].every(([path, value]) => previous.status.get(path) === value)) {
              return previous
            }
            return { workspacePath, status }
          })
        }
      } catch (error) {
        if (!disposed && request === sequence) console.warn('[self-hosted-sync] File status refresh failed', error)
      }
    }
    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(() => { void refresh() }, 100)
    }

    void refresh()
    emitter.on('sync-engine-completed', schedule)
    emitter.on('article-saved', schedule)
    emitter.on('self-hosted-workspaces-discovered', schedule)
    emitter.on('self-hosted-conflicts-changed', schedule)
    return () => {
      disposed = true
      clearTimeout(timer)
      emitter.off('sync-engine-completed', schedule)
      emitter.off('article-saved', schedule)
      emitter.off('self-hosted-workspaces-discovered', schedule)
      emitter.off('self-hosted-conflicts-changed', schedule)
    }
  }, [platform, workspacePath])

  if (platform !== 'selfHosted') return undefined
  return snapshot && snapshot.workspacePath === workspacePath ? snapshot.status : emptyStatus
}
