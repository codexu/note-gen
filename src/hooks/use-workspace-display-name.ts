'use client'

import { useCallback, useEffect } from 'react'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import { useWorkspaceNamesStore } from '@/stores/workspace-names'
import { initAllDatabases } from '@/db'

let loading: Promise<void> | undefined

export function useWorkspaceDisplayName() {
  const names = useWorkspaceNamesStore(state => state.names)
  useEffect(() => {
    loading ??= initAllDatabases()
      .then(() => import('@/lib/self-hosted-sync/workspaces'))
      .then(module => module.refreshCachedWorkspaceNames())
      .catch(error => {
        loading = undefined
        console.warn('[workspace] Unable to load cached workspace names', error)
      })
  }, [])
  return useCallback((path: string, defaultName: string) => (
    getWorkspaceDisplayName(path, defaultName, names)
  ), [names])
}
