import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'
import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import { useSkillsStore } from '@/stores/skills'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'
import { normalizeManagedWorkspacePath } from '@/lib/managed-workspace'
import type { CloudFolderConfig } from '@/types/sync'
import {
  getIOSWorkspaceFolderAccess, releaseIOSSyncFolder,
  restoreIOSSyncFolder, restoreIOSWorkspaceFolderAccess, setIOSWorkspaceFolderAccess,
  type IOSFolderAccess,
} from '@/lib/sync/cloud-folder'

const samePath = (left: string | null | undefined, right: string) => Boolean(left
  && normalizeManagedWorkspacePath(left) === normalizeManagedWorkspacePath(right))

let switchingWorkspace = false
let switchingWorkspacePath: string | null = null

/** iOS releases every bookmark for a URL together, including aliases of it. */
export async function releaseUnusedIOSFolderAccess(access?: IOSFolderAccess, retainedPath?: string): Promise<void> {
  if (!access?.bookmarkBase64 || samePath(retainedPath, access.path)
    || samePath(switchingWorkspacePath, access.path)) return
  try {
    const activeAccess = await getIOSWorkspaceFolderAccess()
    const store = await Store.load('store.json')
    const cloudFolder = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (samePath(activeAccess?.path, access.path)
      || samePath(useSettingStore.getState().workspacePath, access.path)
      || (cloudFolder?.bookmarkBase64 && samePath(cloudFolder.path, access.path))) return
    await releaseIOSSyncFolder(access.bookmarkBase64)
  } catch (error) {
    // Retain access if its ownership cannot be determined safely.
    console.error('Failed to release unused iOS folder access:', error)
  }
}

/** Apply a confirmed workspace selection, restoring the previous workspace on failure. */
export async function switchWorkspaceDirectory(
  path: string,
  selectedAccess?: IOSFolderAccess,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const isIOS = platform() === 'ios'
  if (switchingWorkspace) {
    await releaseUnusedIOSFolderAccess(selectedAccess)
    throw new Error('WORKSPACE_SWITCH_IN_PROGRESS')
  }
  switchingWorkspace = true
  switchingWorkspacePath = path
  const previousPath = useSettingStore.getState().workspacePath
  let previousAccess: IOSFolderAccess | null = null
  let nextAccess = selectedAccess
  let writingStarted = false
  let applied = false

  const assertActive = () => {
    if (options.signal?.aborted) throw new DOMException('Workspace selection was cancelled', 'AbortError')
  }

  async function prepare() {
    const article = useArticleStore.getState()
    if (!await prepareActiveEditorDeactivationDurably(article.activeFilePath)) {
      throw new Error('WORKSPACE_SAVE_PENDING')
    }
    await article.flushAllPendingArticleSaves()
    await article.settleAllVectorCalculations()
  }

  async function reload() {
    const article = useArticleStore.getState()
    await article.setActiveFilePath('', true, { deactivationAlreadyPrepared: true })
    const activePath = await article.loadWorkspaceCollapsibleList()
    await article.loadFileTree()
    if (activePath) await article.setActiveFilePath(activePath, true, { deactivationAlreadyPrepared: true, createIfMissing: false })
    await useSkillsStore.getState().refreshSkills()
  }

  try {
    assertActive()
    previousAccess = isIOS ? await getIOSWorkspaceFolderAccess() : null
    assertActive()
    if (previousPath === path) return
    await prepare()
    assertActive()
    if (isIOS && path) {
      if (selectedAccess && selectedAccess.path !== path) throw new Error('WORKSPACE_ACCESS_REQUIRED')
      // A failed earlier attempt may have released this draft's native access.
      nextAccess = selectedAccess
        ? await restoreIOSSyncFolder(selectedAccess.bookmarkBase64)
        : await restoreIOSWorkspaceFolderAccess(path) ?? undefined
      if (!nextAccess || nextAccess.path !== path) throw new Error('WORKSPACE_ACCESS_REQUIRED')
    }
    assertActive()
    if (useSettingStore.getState().workspacePath !== previousPath) throw new Error('WORKSPACE_SELECTION_CHANGED')
    // Closing the wizard may cancel preparation, but cannot interrupt a
    // confirmed selection once persistent changes have begun.
    writingStarted = true
    if (isIOS && path && nextAccess) {
      await setIOSWorkspaceFolderAccess(nextAccess)
    } else if (isIOS) {
      await setIOSWorkspaceFolderAccess(null)
    }
    await useSettingStore.getState().setWorkspacePath(path)
    await reload()
    await (await Store.load('store.json')).save()
    applied = true
    await releaseUnusedIOSFolderAccess(previousAccess ?? undefined)
  } catch (error) {
    if (writingStarted) {
      try {
        await prepare()
        if (isIOS) await setIOSWorkspaceFolderAccess(previousAccess)
        await useSettingStore.getState().setWorkspacePath(previousPath)
        await reload()
        await (await Store.load('store.json')).save()
      } catch (rollbackError) {
        console.error('Failed to restore the previous workspace:', rollbackError)
        throw new Error('WORKSPACE_ROLLBACK_FAILED')
      }
    }
    throw error
  } finally {
    switchingWorkspacePath = null
    if (!applied) await releaseUnusedIOSFolderAccess(nextAccess)
    switchingWorkspace = false
  }
}
