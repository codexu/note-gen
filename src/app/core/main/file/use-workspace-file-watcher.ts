'use client'

import { appDataDir, join } from '@tauri-apps/api/path'
import { watch, type WatchEvent } from '@tauri-apps/plugin-fs'
import { useEffect } from 'react'

import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import { getSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/runtime'
import { enqueueStaticAssetSync } from '@/lib/sync/static-asset-sync-queue'
import {
  capturePluginWorkspaceBindingForWorkspace,
  emitPluginNoteChange,
} from '@/lib/plugins/broker'

function isStructuralEvent(event: WatchEvent) {
  if (event.type === 'any' || event.type === 'other') return true
  if ('create' in event.type || 'remove' in event.type) return true
  return 'modify' in event.type && event.type.modify.kind === 'rename'
}

function getChangedFilePaths(event: WatchEvent, paths: string[]): string[] {
  if (typeof event.type === 'string') return paths
  if ('create' in event.type) {
    return event.type.create.kind === 'folder' ? [] : paths
  }
  if (!('modify' in event.type)) return []
  if (event.type.modify.kind === 'metadata') {
    return ['write-time', 'any', 'other'].includes(event.type.modify.mode) ? paths : []
  }
  if (event.type.modify.kind !== 'rename') return paths

  const mode = event.type.modify.mode
  if (mode === 'from') return []
  if ((mode === 'both' || mode === 'any') && paths.length > 1) {
    return [paths[paths.length - 1]]
  }
  return paths
}

function toWorkspaceRelativeWatchPath(path: string, normalizedRoot: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//')
  const comparableRoot = isWindowsPath ? normalizedRoot.toLowerCase() : normalizedRoot
  const comparablePath = isWindowsPath ? normalizedPath.toLowerCase() : normalizedPath

  if (comparablePath.startsWith(`${comparableRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedPath)
    ? ''
    : normalizedPath.replace(/^\.?\//, '')
}

export function useWorkspaceFileWatcher() {
  const workspacePath = useSettingStore(state => state.workspacePath)

  useEffect(() => {
    let disposed = false
    let unwatch: (() => void) | undefined

    async function startWatching() {
      const workspaceRoot = workspacePath
        ? workspacePath
        : await join(await appDataDir(), 'article')
      const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')

      unwatch = await watch(workspaceRoot, event => {
        if (disposed) return
        if (workspacePath !== useSettingStore.getState().workspacePath) return
        void getSelfHostedSyncRuntime().wake('file-watcher')
        const pluginWorkspaceBinding = capturePluginWorkspaceBindingForWorkspace(
          workspacePath,
          Boolean(workspacePath),
        )
        const emitNoteChange = (change: Parameters<typeof emitPluginNoteChange>[0]) => {
          emitPluginNoteChange(change, {
            binding: pluginWorkspaceBinding,
            source: 'file-watcher',
          })
        }

        const relativePaths = event.paths
          .map(path => toWorkspaceRelativeWatchPath(path, normalizedRoot))
          .filter(path => path && !path.split('/').some(part => part.startsWith('.')))

        for (const relativePath of getChangedFilePaths(event, relativePaths)) {
          enqueueStaticAssetSync(relativePath)
        }

        // Ignore events that only point at hidden or out-of-workspace entries.
        // A truly pathless structural event still falls through to a full reload.
        if (event.paths.length > 0 && relativePaths.length === 0) return
        const notePaths = relativePaths.filter(path => path.toLowerCase().endsWith('.md'))

        if (!isStructuralEvent(event)) {
          for (const relativePath of relativePaths) {
            useArticleStore.getState().markFileDirty(relativePath)
          }
          for (const path of notePaths) emitNoteChange({ type: 'changed', path })
          return
        }

        if (event.type === 'any' || event.type === 'other') {
          for (const path of notePaths) emitNoteChange({ type: 'changed', path })
        }

        const state = useArticleStore.getState()
        if (typeof event.type !== 'string' && 'create' in event.type && event.type.create.kind === 'file') {
          for (const path of notePaths) emitNoteChange({ type: 'created', path })
          const updated = relativePaths.length > 0 && relativePaths
            .map(path => state.reconcileLocalFile(path, true))
            .every(Boolean)
          if (updated) return
        }

        if (typeof event.type !== 'string' && 'remove' in event.type && event.type.remove.kind === 'file') {
          for (const path of notePaths) emitNoteChange({ type: 'deleted', path })
          const updated = relativePaths.length > 0 && relativePaths
            .map(path => state.reconcileLocalFile(path, false))
            .every(Boolean)
          if (updated) return
        }

        if (
          typeof event.type !== 'string'
          && 'modify' in event.type
          && event.type.modify.kind === 'rename'
        ) {
          const mode = event.type.modify.mode
          if ((mode === 'both' || mode === 'any') && relativePaths.length >= 2) {
            const oldPath = relativePaths[0]
            const newPath = relativePaths[relativePaths.length - 1]
            if (oldPath.toLowerCase().endsWith('.md') && newPath.toLowerCase().endsWith('.md')) {
              emitNoteChange({ type: 'moved', path: newPath, previousPath: oldPath })
            }
            state.reconcileLocalFile(oldPath, false)
            state.reconcileLocalFile(newPath, true)
          }

          // Windows reports rename operations as separate `from`/`to` events, while
          // other platforms may provide both paths together. The event itself does
          // not reliably identify whether the moved entry is a file or directory,
          // so the optimistic reconciliation above is only immediate feedback. Let
          // the directory scan below make the file tree match the filesystem.
        }

        const parentPaths = new Set(relativePaths.map(path => {
          const parts = path.split('/')
          parts.pop()
          return parts.join('/')
        }))

        if (parentPaths.has('') || parentPaths.size === 0) {
          void useArticleStore.getState().loadFileTree({ skipRemoteSync: true })
          return
        }

        for (const parentPath of parentPaths) {
          void useArticleStore.getState().loadCollapsibleFiles(parentPath, {
            force: true,
            skipRemoteSync: true,
          })
        }
      }, {
        recursive: true,
        delayMs: 300,
      })
    }

    void startWatching().catch(error => {
      console.warn('Workspace file watcher unavailable:', error)
    })

    return () => {
      disposed = true
      unwatch?.()
    }
  }, [workspacePath])
}
