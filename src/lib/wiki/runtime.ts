import emitter, { type Events } from '@/lib/emitter'
import { getWorkspacePath, getDefaultArticleAbsolutePath } from '@/lib/workspace'
import { getWikiSettings } from './settings'
import {
  enqueueWikiSource, reconcileWikiSources, removeWikiSource, moveWikiArticleSources,
  resumeWikiQueue, stopWikiQueue,
} from './queue'
import { initWikiSyncRuntime } from './sync'
import { captureWikiWorkspaceGuard, getWikiContext } from './context'
import { listWikiSourceStates } from '@/db/wiki'
import { ensureWikiContextMigration } from './migration'
import useSettingStore from '@/stores/setting'
import { isWikiFolderPath } from './path'

/** Installed by the application shell, never by each Wiki page. */
export async function initWikiRuntime(): Promise<() => void> {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let reconciling: Promise<void> | null = null
  let requestedAgain = false
  let activeContextId: string | null = null
  const report = (error: unknown) => {
    if (error instanceof Error && error.message === 'WIKI_CONTEXT_CHANGED') return
    console.error('Wiki runtime:', error)
  }

  const reconcile = () => {
    if (disposed) return
    if (reconciling) { requestedAgain = true; return }
    reconciling = (async () => {
      do {
        requestedAgain = false
        const isCurrent = captureWikiWorkspaceGuard()
        const context = await getWikiContext()
        if (disposed || !isCurrent()) continue
        await ensureWikiContextMigration()
        if (disposed || !isCurrent()) continue
        activeContextId = context.id
        const settings = await getWikiSettings(context.id)
        if (disposed || !isCurrent()) continue
        if (!settings.enabled || !settings.started || settings.paused) stopWikiQueue()
        if (settings.enabled && settings.started) await reconcileWikiSources(context.id)
        if (disposed || !isCurrent()) continue
        if (settings.enabled && settings.started && !settings.paused) {
          await resumeWikiQueue({ expectedContextId: context.id })
        }
        if (disposed || !isCurrent()) continue
        if (settings.semanticSearchEnabled) {
          const { resumeKnowledgeIndexQueue } = await import('@/lib/knowledge-index')
          if (!disposed && isCurrent()) void resumeKnowledgeIndexQueue().catch(report)
        }
      } while (requestedAgain && !disposed)
    })().catch(report).finally(() => {
      reconciling = null
      if (requestedAgain && !disposed) scheduleReconcile()
    })
  }
  const scheduleReconcile = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; reconcile() }, 250)
  }
  const belongsToWorkspace = async (root?: string) => {
    if (!root) return true
    const workspace = await getWorkspacePath()
    const current = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
    return root.replaceAll('\\', '/').replace(/\/$/, '') === current.replaceAll('\\', '/').replace(/\/$/, '')
  }
  const onArticle = ({ path }: { path: string }) => {
    if (!isWikiFolderPath(path)) void enqueueWikiSource(`article:${path}`).catch(report)
  }
  const onRemote = ({ path, workspaceRoot }: { path: string; workspaceRoot?: string }) => {
    if (isWikiFolderPath(path)) return
    const isCurrent = captureWikiWorkspaceGuard()
    void belongsToWorkspace(workspaceRoot).then(matches => {
      if (matches && !disposed && isCurrent()) return enqueueWikiSource(`article:${path}`)
    }).catch(report)
  }
  const onDelete = ({ path, isFolder, workspaceRoot }: { path: string; isFolder: boolean; workspaceRoot?: string }) => {
    if (isWikiFolderPath(path)) return
    const isCurrent = captureWikiWorkspaceGuard()
    void (async () => {
      if (!await belongsToWorkspace(workspaceRoot) || !isCurrent() || disposed) return
      const context = await getWikiContext()
      for (const state of await listWikiSourceStates(context.id)) {
        if (!isCurrent() || disposed) return
        const sourcePath = state.source.locator.filePath
        if (state.sourceType === 'article' && sourcePath
          && (sourcePath === path || (isFolder && sourcePath.startsWith(`${path}/`)))) {
          await removeWikiSource(state.sourceKey, 'deleted', context.id)
        }
      }
    })().catch(report)
  }
  const onMove = ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
    if (isWikiFolderPath(newPath)) {
      if (!isWikiFolderPath(oldPath)) onDelete({ path: oldPath, isFolder: true })
      return
    }
    if (isWikiFolderPath(oldPath)) {
      // Moving a generated page out of Wiki does not make it an original:
      // enqueueWikiSource still applies its derived-document metadata guard.
      if (/\.md$/i.test(newPath)) onArticle({ path: newPath })
      else scheduleReconcile()
      return
    }
    void moveWikiArticleSources(oldPath, newPath, true).catch(report)
  }
  const onWorkspaceFile = (event: Events['workspace-file-changed']) => {
    const isCurrent = captureWikiWorkspaceGuard()
    void (async () => {
      if (!await belongsToWorkspace(event.workspaceRoot) || disposed || !isCurrent()) return
      if (event.kind === 'moved' && event.previousPath && isWikiFolderPath(event.path)) {
        if (!isWikiFolderPath(event.previousPath)) {
          onDelete({ path: event.previousPath, isFolder: true, workspaceRoot: event.workspaceRoot })
        }
        return
      }
      if (isWikiFolderPath(event.path)) return
      if (event.kind === 'rescan') {
        scheduleReconcile()
        return
      }
      const context = await getWikiContext()
      if (disposed || !isCurrent()) return
      if (event.kind === 'moved' && event.previousPath) {
        if (!isWikiFolderPath(event.previousPath)) {
          await moveWikiArticleSources(event.previousPath, event.path, true, context.id)
        }
        if (disposed || !isCurrent()) return
        if (/\.md$/i.test(event.path)) {
          // Editors often save by renaming a temporary file over the original.
          // That temporary path has no Wiki state to migrate, so inspect the
          // destination as a changed source as well.
          await enqueueWikiSource(`article:${event.path}`, { expectedContextId: context.id })
          if (!disposed && isCurrent()) await resumeWikiQueue({ expectedContextId: context.id })
        } else {
          scheduleReconcile()
        }
      } else if (event.kind === 'deleted') {
        onDelete({ path: event.path, isFolder: true, workspaceRoot: event.workspaceRoot })
      } else if (/\.md$/i.test(event.path)) {
        await enqueueWikiSource(`article:${event.path}`, { expectedContextId: context.id })
      }
    })().catch(report)
  }
  const onVisibility = () => { if (document.visibilityState === 'visible') scheduleReconcile() }
  const contextKeys = ['primaryBackupMethod', 'workspacePath', 'githubCustomSyncRepo', 'giteeCustomSyncRepo',
    'gitlabCustomSyncRepo', 'giteaCustomSyncRepo', 'githubUsername', 'gitlabUsername', 'giteaUsername',
    'gitlabCustomUrl', 'giteaCustomUrl', 's3SyncConfig', 'webdavSyncConfig', 'cloudFolderSyncConfig']
  const unsubscribeSettings = useSettingStore.subscribe((state, previous) => {
    const currentValues = state as unknown as Record<string, unknown>
    const previousValues = previous as unknown as Record<string, unknown>
    if (!contextKeys.some(key => currentValues[key] !== previousValues[key])) return
    if (currentValues.workspacePath !== previousValues.workspacePath) {
      // Invalidate the worker before any asynchronous context read, including
      // A -> B -> A transitions whose final context ID is unchanged.
      stopWikiQueue()
      activeContextId = null
      requestedAgain = true
      scheduleReconcile()
      return
    }
    const isCurrent = captureWikiWorkspaceGuard()
    void getWikiContext().then(context => {
      if (!disposed && isCurrent() && context.id !== activeContextId) { stopWikiQueue(); scheduleReconcile() }
    }).catch(report)
  })
  emitter.on('article-saved', onArticle)
  emitter.on('workspace-file-changed', onWorkspaceFile)
  emitter.on('sync-content-updated', onRemote)
  emitter.on('plugin-records-changed', scheduleReconcile)
  emitter.on('refresh-marks', scheduleReconcile)
  emitter.on('editor-navigation-path-deleted', onDelete)
  emitter.on('editor-navigation-path-moved', onMove)
  emitter.on('editor-file-path-changed', onMove)
  emitter.on('sync-engine-completed', scheduleReconcile)
  window.addEventListener('wiki-settings-changed', scheduleReconcile)
  window.addEventListener('wiki-synced', scheduleReconcile)
  document.addEventListener('visibilitychange', onVisibility)
  const stopSync = await initWikiSyncRuntime()
  scheduleReconcile()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    stopWikiQueue()
    unsubscribeSettings()
    stopSync()
    emitter.off('article-saved', onArticle)
    emitter.off('workspace-file-changed', onWorkspaceFile)
    emitter.off('sync-content-updated', onRemote)
    emitter.off('plugin-records-changed', scheduleReconcile)
    emitter.off('refresh-marks', scheduleReconcile)
    emitter.off('editor-navigation-path-deleted', onDelete)
    emitter.off('editor-navigation-path-moved', onMove)
    emitter.off('editor-file-path-changed', onMove)
    emitter.off('sync-engine-completed', scheduleReconcile)
    window.removeEventListener('wiki-settings-changed', scheduleReconcile)
    window.removeEventListener('wiki-synced', scheduleReconcile)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
