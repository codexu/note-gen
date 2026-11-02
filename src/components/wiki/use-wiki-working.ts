'use client'

import useSettingStore from '@/stores/setting'
import { useWikiActivityStore } from '@/stores/wiki-activity'

/** No path means the whole workspace; folders include their descendants. */
export function useWikiWorking(path?: string, kind: 'file' | 'folder' = 'file'): boolean {
  const workspacePath = useSettingStore(state => state.workspacePath)
  const workspaceKey = workspacePath
    ? `custom:${workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')}`
    : 'default:article'
  const relativePath = path?.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')

  return useWikiActivityStore(state => {
    const active = state.active
    if (!active || active.workspaceKey !== workspaceKey) return false
    if (relativePath === undefined) return true
    return active.articlePaths.some(source => source === relativePath
      || (kind === 'folder' && (!relativePath || source.startsWith(`${relativePath}/`))))
  })
}
