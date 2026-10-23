'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ask } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep } from 'lodash-es'

import { toast } from '@/hooks/use-toast'
import { isMobileDevice } from '@/lib/check'
import {
  activeEditorPathIsAffected,
  getCurrentEditorWorkspaceRoot,
  lockEditorPathsForMutation,
  markEditorPathMutation,
  prepareActiveEditorPathMutationDurably,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { deleteSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { supportsCloudFolderWorkspace } from '@/lib/sync/cloud-folder'
import { deleteRemoteFile, getRemoteFileMetadata } from '@/lib/sync/remote-library'
import { getCurrentSyncContext } from '@/lib/sync/sync-context'
import { getWorkspacePathMoveContext } from '@/lib/sync/workspace-path-moves'
import { waitForPendingFileUploads } from '@/lib/sync/workspace-remote-write-guard'
import useArticleStore from '@/stores/article'
import useFileDeletionStore from '@/stores/file-deletion'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import type { CloudFolderConfig, SyncPlatform } from '@/types/sync'
import { getSyncConfiguration } from './file-tree-action-policy'
import {
  flattenFileTree,
  getDeletionEntries,
  getRemoteDeletionEntries,
  type FileSelectionEntry,
} from './file-selection'
import {
  clearFolderRemoteState,
  deleteRemoteFolder,
  deleteVectorDocumentsByPaths,
} from './folder-item/delete-folder-utils'
import { moveEntryToSystemTrash } from './system-trash'

// Keep repeated shortcut/menu actions from opening multiple confirmation dialogs.
let deletionRequested = false

export function useFileDeletion() {
  const t = useTranslations('article.file.context')

  return useCallback(async (selection: FileSelectionEntry[]): Promise<void> => {
    const entries = getDeletionEntries(selection)
    if (entries.length === 0 || deletionRequested || useFileDeletionStore.getState().progress) return
    deletionRequested = true

    const workspacePath = useSettingStore.getState().workspacePath || ''
    const paths = entries.map(entry => entry.path)
    let started = false
    let unlock: (() => void) | null = null
    let completed = 0
    let queued = 0
    let remoteFailed = false
    const failedEntries: FileSelectionEntry[] = []
    const deletedPaths: string[] = []

    try {
      const store = await Store.load('store.json')
      const workspaceRoot = await getCurrentEditorWorkspaceRoot()
      const storedPlatform = await store.get<SyncPlatform>('primaryBackupMethod') || 'github'
      // Deletion must use an existing binding, never create a remote library as a preflight side effect.
      const configuration = storedPlatform === 'selfHosted'
        ? { platform: storedPlatform, configured: true }
        : await getSyncConfiguration()
      const platform = configuration.platform
      const context = await getWorkspacePathMoveContext()
      const syncContext = await getCurrentSyncContext()
      const cloudFolder = platform === 'cloudFolder'
        ? await store.get<CloudFolderConfig>('cloudFolderSyncConfig') : null
      // Files in a native cloud folder are propagated by that folder's own sync client.
      const nativeCloudFolder = platform === 'cloudFolder'
        && Boolean(cloudFolder && !supportsCloudFolderWorkspace(cloudFolder))
      const hasRemote = platform !== 'local' && (configuration.configured
        || getRemoteDeletionEntries(entries).length > 0)
      const assertContext = async () => {
        if ((useSettingStore.getState().workspacePath || '') !== workspacePath
          || await getCurrentEditorWorkspaceRoot() !== workspaceRoot
          || (await store.get<string>('primaryBackupMethod') || 'github') !== platform
          || await getWorkspacePathMoveContext() !== context
          || await store.get('platformSwitchRecovery')) {
          throw new Error('The workspace or sync configuration changed during deletion')
        }
      }
      const entriesAreBusy = () => {
        const state = useArticleStore.getState()
        const currentEntries = flattenFileTree(state.fileTree)
        const overlaps = (path: string) => paths.some(root => (
          activeEditorPathIsAffected(path, root, workspaceRoot)
          || activeEditorPathIsAffected(root, path, workspaceRoot)
        ))
        return currentEntries.some(entry => overlaps(entry.path) && (entry.item.loading || entry.item.isEditing))
          || Object.entries(state.pendingFileTreeRenames).some(([source, target]) => overlaps(source) || overlaps(target))
      }
      await assertContext()
      if (entriesAreBusy()) {
        toast({ title: t('deleteEntriesBusy'), variant: 'destructive' })
        return
      }
      const confirmed = await ask(t(hasRemote ? 'confirmDeleteEntriesWithRemote'
        : isMobileDevice() ? 'confirmDeleteEntriesPermanently' : 'confirmDeleteEntries', { count: entries.length }), {
        title: entries.length === 1 ? entries[0].name : t('deleteSelected', { count: entries.length }),
        kind: 'warning',
      })
      if (!confirmed) return
      await assertContext()
      if (entriesAreBusy()) {
        toast({ title: t('deleteEntriesBusy'), variant: 'destructive' })
        return
      }

      const article = useArticleStore.getState()
      if (!await prepareActiveEditorPathMutationDurably(article.activeFilePath, paths, workspaceRoot)) {
        toast({ title: t('deleteEntriesBusy'), variant: 'destructive' })
        return
      }
      await assertContext()
      if (entriesAreBusy()) {
        toast({ title: t('deleteEntriesBusy'), variant: 'destructive' })
        return
      }
      if (!useFileDeletionStore.getState().begin(paths, workspacePath, hasRemote, workspaceRoot)) return
      started = true

      const knownEntries = flattenFileTree(useArticleStore.getState().fileTree)
      const affectedPaths = new Set([
        ...paths,
        ...knownEntries.filter(entry => paths.some(path => activeEditorPathIsAffected(entry.path, path, workspaceRoot)))
          .map(entry => entry.path),
        ...useArticleStore.getState().openTabs
          .filter(tab => paths.some(path => activeEditorPathIsAffected(tab.path, path, workspaceRoot)))
          .map(tab => tab.path),
      ])
      unlock = lockEditorPathsForMutation([...affectedPaths], workspaceRoot)
      if (!unlock) {
        toast({ title: t('deleteEntriesBusy'), variant: 'destructive' })
        return
      }

      // Close all affected tabs before network work so a late editor save cannot recreate a deleted file.
      // Close the active entry last to avoid activating another entry from this batch as a fallback.
      const closeOrder = [...entries].sort((left, right) => (
        Number(activeEditorPathIsAffected(article.activeFilePath, left.path, workspaceRoot))
        - Number(activeEditorPathIsAffected(article.activeFilePath, right.path, workspaceRoot))
      ))
      for (const entry of closeOrder) {
        await assertContext()
        const state = useArticleStore.getState()
        if (entry.isDirectory) await state.cleanTabsByDeletedFolder(entry.path, workspaceRoot)
        else await state.cleanTabsByDeletedFile(entry.path, workspaceRoot)
      }
      if (hasRemote) await waitForPendingFileUploads(paths)

      for (const entry of entries) {
        let remoteCompleted = !hasRemote || nativeCloudFolder
        try {
          await assertContext()
          if (platform === 'selfHosted') {
            await runEditorPathWriteTransaction(entry.path, async () => {
              await assertContext()
              if (await deleteSelfHostedWorkspacePath(entry.path, entry.isDirectory ? 'folder' : 'file')) {
                queued += 1
              } else if (hasRemote) {
                throw new Error('The self-hosted workspace deletion could not be queued')
              } else {
                await moveEntryToSystemTrash(entry.path, workspaceRoot)
              }
              return true
            }, workspaceRoot)
            remoteCompleted = true
          } else {
            if (hasRemote && !nativeCloudFolder) {
              if (entry.isDirectory) {
                const result = await deleteRemoteFolder(entry.item, false, platform, assertContext)
                if (!result.attempted || result.failedPaths.length > 0) {
                  throw new Error('Remote folder deletion is incomplete')
                }
              } else {
                const metadata = await getRemoteFileMetadata(entry.path, 'workspace', platform)
                if (metadata) {
                  await assertContext()
                  const condition = platform === 'cloudFolder' && cloudFolder?.provider !== 'oneDrive'
                    ? undefined : { version: metadata.version }
                  if (!await deleteRemoteFile(entry.path, 'workspace', condition, platform, assertContext)) {
                    throw new Error('Remote file deletion failed')
                  }
                }
              }
              remoteCompleted = true
              // If removing the local entry fails, keep an accurate local-only row for retry.
              await assertContext()
              const tree = cloneDeep(useArticleStore.getState().fileTree)
              clearFolderRemoteState(tree, entry.path)
              useArticleStore.getState().setFileTree(tree)
            }
            await assertContext()
            await runEditorPathWriteTransaction(entry.path, async () => {
              await assertContext()
              await moveEntryToSystemTrash(entry.path, workspaceRoot)
              return true
            }, workspaceRoot)
          }

          await assertContext()
          useArticleStore.getState().removeLocalEntry(entry.path)
          for (const path of affectedPaths) {
            if (activeEditorPathIsAffected(path, entry.path, workspaceRoot)) markEditorPathMutation(path, workspaceRoot)
          }
          deletedPaths.push(entry.path)
          completed += 1

          const vectorFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
          for (const path of vectorFiles.keys()) {
            if (activeEditorPathIsAffected(path, entry.path, workspaceRoot)) vectorFiles.delete(path)
          }
          useArticleStore.setState({ vectorIndexedFiles: vectorFiles })
          try {
            await deleteVectorDocumentsByPaths([entry.path], entry.isDirectory ? entry.path : undefined)
          } catch (error) {
            console.error('Failed to remove deleted entries from the knowledge base:', error)
          }
        } catch (error) {
          failedEntries.push(entry)
          remoteFailed ||= platform !== 'selfHosted' && !remoteCompleted
          console.error(`Delete entry failed: ${entry.path}`, error)
        } finally {
          useFileDeletionStore.getState().advance()
        }
      }

      await assertContext()
      // Clear old sync identities in one write so recreating the same path starts as a new file.
      try {
        if (deletedPaths.length > 0) {
          const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
          for (const key of Object.keys(syncedShas)) {
            let path = syncContext.workspaceKey === '__default__' ? key : ''
            try {
              const value: unknown = JSON.parse(key)
              if (Array.isArray(value) && value.length === 4
                && value[0] === syncContext.workspaceKey && value[1] === syncContext.provider
                && value[2] === syncContext.repo && typeof value[3] === 'string') path = value[3]
              else if (Array.isArray(value)) path = ''
            } catch { /* Legacy unscoped paths belong to the default workspace. */ }
            if (deletedPaths.some(root => activeEditorPathIsAffected(path, root, workspaceRoot))) delete syncedShas[key]
          }
          await store.set('syncedFileShas', syncedShas)
          await store.save()
          for (const path of affectedPaths) {
            if (!deletedPaths.some(root => activeEditorPathIsAffected(path, root, workspaceRoot))) continue
            if (platform === 's3') useSyncStore.getState().removeS3FileEtag(path)
            if (platform === 'webdav') useSyncStore.getState().removeWebDAVFileEtag(path)
          }
        }
      } catch (error) {
        console.error('Failed to clear deleted sync metadata:', error)
      }
      const failedPaths = failedEntries.map(entry => entry.path)
      useArticleStore.getState().setSelectedFilePaths(failedPaths)
      toast({
        title: failedEntries.length > 0
          ? completed > 0 ? t('deleteEntriesResult', { deleted: completed, failed: failedEntries.length })
            : t('deleteEntriesFailed')
          : t(nativeCloudFolder ? 'deleteEntriesCloudFolder'
            : queued > 0 ? 'deleteEntriesQueued' : 'deleteEntriesSuccess', { count: completed }),
        description: remoteFailed ? t('deleteEntriesRemoteFailed') : undefined,
        variant: failedEntries.length > 0 ? 'destructive' : undefined,
      })
    } catch (error) {
      console.error('Unable to complete file deletion:', error)
      toast({ title: t('deleteEntriesFailed'), variant: 'destructive' })
    } finally {
      unlock?.()
      if (started) useFileDeletionStore.getState().finish()
      deletionRequested = false
    }
  }, [t])
}
