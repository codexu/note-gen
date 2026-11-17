import { emitWikiUpdated, getWikiMeta, getWikiSourceState, markWikiSynced, setWikiMeta } from '@/db/wiki'
import { Store } from '@tauri-apps/plugin-store'
import { exists, readFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import { getEditorPathMutationRevision } from '@/lib/editor-deactivation'
import { getWorkspacePath, getDefaultArticleAbsolutePath, getFilePathOptions } from '@/lib/workspace'
import { isFileDeletionPending } from '@/stores/file-deletion'
import type { SyncPlatform } from '@/types/sync'
import type { WikiContext, WikiSourceReference } from '@/types/wiki'
import { WIKI_ROOT_FOLDER } from '@/types/wiki'
import { captureWikiWorkspaceGuard, getLegacyWikiContextId, getWikiContext } from './context'
import { ensureWikiWorkspaceRelativePath } from './path'
import { compareWikiKeys, resolveWikiSourceReference, wikiHash } from './sources'
import { fileSyncContentHash, getFileSyncProof, getFileSyncProofKey, recordFileSyncProof } from '@/lib/sync/file-sync-proof'
import { gitBlobVersion } from '@/lib/sync/remote-content-cache'

// Wiki Markdown is synchronized by the ordinary article sync pipeline. This
// coordinator only refreshes its disposable local cache and migrates old data.
const REFRESH_DELAY = 500
let running: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let rerunRequested = false
let attached = false
const refreshedAt = new Map<string, number>()
const remotePulls = new Map<string, Promise<void>>()
const remotePulledAt = new Map<string, number>()
interface RemoteFileProof { target: string; hash: string; version: string }

function foreground() { return typeof document === 'undefined' || document.visibilityState === 'visible' }

async function assertContext(context: WikiContext) {
  if ((await getWikiContext()).id !== context.id) throw new Error('WIKI_SYNC_CONTEXT_CHANGED')
}

/** Missing originals are unknown; a real ready Wiki file remains derived evidence. */
export async function isWikiSourceCurrent(source: WikiSourceReference): Promise<boolean> {
  const context = await getWikiContext()
  const state = await getWikiSourceState(context.id, source.stableId)
  if (state && ['deleted', 'excluded'].includes(state.status)) return false
  const original = await resolveWikiSourceReference(source)
  if (original) return original.source.contentHash === source.contentHash
  if (source.sourceType === 'record') {
    const { getDb } = await import('@/db')
    const deleted = await (await getDb()).select<Array<{ deleted: number }>>(
      'select deleted from marks where sourceId=$1 limit 1', [source.stableId.replace(/^record:/, '')])
    if (deleted[0]?.deleted) return false
  } else if (source.sourceType === 'canvas') {
    const { getCanvasProject } = await import('@/db/canvases')
    if ((await getCanvasProject(source.stableId.replace(/^canvas:/, '')))?.deletedAt) return false
  }
  const { getWikiPageFilePath, getWikiPageForFilePath } = await import('./files')
  const path = await getWikiPageFilePath(context.id, `source:${wikiHash(source.stableId)}`)
  if (!path) return false
  const page = await getWikiPageForFilePath(path)
  return page?.kind === 'source' && page.status === 'ready' && page.sourceRefs.length === 1
    && page.sourceRefs[0].stableId === source.stableId && page.sourceRefs[0].contentHash === source.contentHash
}

async function automaticPullAllowed(): Promise<boolean> {
  if (!foreground() || (typeof navigator !== 'undefined' && !navigator.onLine)) return false
  const store = await Store.load('store.json')
  if (await store.get('platformSwitchRecovery') || await store.get<string>('autoSync') === 'disabled'
    || await store.get<boolean>('autoPullOnOpen') === false) return false
  const config = await (await Store.load('sync_config.json')).get<{ autoSync?: boolean; autoPullOnOpen?: boolean }>('config')
  return config?.autoSync !== false && config?.autoPullOnOpen !== false
}

/** Pull only ordinary Wiki Markdown, using the existing guarded article reader. */
async function pullRemoteWikiFiles(context: WikiContext): Promise<void> {
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  if (context.provider === 'local' || context.provider === 'selfHosted' || !await automaticPullAllowed()) return
  const target = await getLegacyWikiContextId()
  const key = `${context.id}:${target}`
  const existing = remotePulls.get(key)
  if (existing) return existing
  if (Date.now() - (remotePulledAt.get(key) ?? 0) < 15_000) return
  remotePulledAt.set(key, Date.now())
  const operation = (async () => {
    const [{ listRemoteLibraryFiles, getRemoteFileMetadata }, { getSyncManager, isSyncConfigured }] = await Promise.all([
      import('@/lib/sync/remote-library'), import('@/lib/sync/sync-manager'),
    ])
    if (!await isSyncConfigured()) return
    await assertContext(context)
    const targetIsCurrent = async () => {
      const current = await getWikiContext()
      return workspaceIsCurrent() && current.id === context.id && current.provider === context.provider
        && await getLegacyWikiContextId() === target && await automaticPullAllowed()
    }
    if (!await targetIsCurrent()) return
    const catalog = await getWikiMeta<Array<{ path: string }>>(context.id, 'markdown-catalog') ?? []
    const indexPath = await getWikiMeta<string>(context.id, 'markdown-index-path')
    const knownPaths = new Set([...catalog.map(entry => entry.path), ...(indexPath ? [indexPath] : [])])
    const remoteFiles = new Map<string, { path: string; sha: string; size?: number }>()
    // A new library may not have a Wiki directory yet. Missing/offline remote
    // files are optional; locally available knowledge must remain usable.
    try {
      for (const file of await listRemoteLibraryFiles({ scope: 'workspace', folderPath: WIKI_ROOT_FOLDER,
        platform: context.provider as SyncPlatform })) remoteFiles.set(file.path, file)
    } catch (error) { console.warn('Wiki Markdown listing unavailable:', error) }
    for (const path of knownPaths) {
      if (path.startsWith(`${WIKI_ROOT_FOLDER}/`) || !/\.md$/i.test(path)) continue
      try {
        const metadata = await getRemoteFileMetadata(path, 'workspace', context.provider as SyncPlatform)
        if (metadata) remoteFiles.set(path, { path, sha: metadata.version ?? '', size: metadata.size })
      } catch { /* A moved remote note can be offline without invalidating local prose. */ }
    }
    const priority = (path: string) => path === indexPath || /\/索引(?:-\d+)?\.md$/i.test(path) ? 0
      : path.includes('/来源摘要/') ? 1 : 2
    const files = [...remoteFiles.values()].filter(file => /\.md$/i.test(file.path)
      && (file.size === undefined || file.size <= 16 * 1024 * 1024))
      .sort((left, right) => priority(left.path) - priority(right.path) || compareWikiKeys(left.path, right.path))
    const manager = getSyncManager()
    const pullFile = async (file: typeof files[number]) => {
      if (!await targetIsCurrent()) return
      const path = ensureWikiWorkspaceRelativePath(file.path)
      const deletedPaths = await getWikiMeta<string[]>(context.id, 'markdown-deleted-paths') ?? []
      if (isFileDeletionPending(path) || deletedPaths.some(deleted => path === deleted || path.startsWith(`${deleted}/`))) return
      const initialRevision = getEditorPathMutationRevision(path)
      const options = await getFilePathOptions(path)
      const localExists = await exists(options.path, { baseDir: options.baseDir })
      let expectedLocalHash: string | undefined
      if (!localExists && knownPaths.has(path)) return
      if (localExists) {
        // Ordinary pulls and pushes establish the same unchanged-content
        // proof as Wiki prefetch. A path/version alone cannot prove this.
        const proof = await getWikiMeta<RemoteFileProof>(context.id, `markdown-remote-file:${path}`)
        const proofKey = await getFileSyncProofKey(path, context.provider as SyncPlatform).catch(() => null)
        const receipt = proofKey ? await getFileSyncProof(proofKey) : null
        const bytes = await readFile(options.path, { baseDir: options.baseDir })
        const hash = await fileSyncContentHash(bytes)
        expectedLocalHash = hash
        const accepted = receipt?.hash === hash ? receipt
          : proof?.target === target && proof.hash === hash ? proof : null
        if (!accepted) {
          // A native Git blob ID binds these exact bytes to the CURRENT
          // remote target, so legacy pulls can safely establish a receipt.
          if (['github', 'gitee', 'gitlab', 'gitea'].includes(context.provider)
            && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(file.sha)
            && await gitBlobVersion(bytes, file.sha.length) === file.sha.toLowerCase()) {
            if (await targetIsCurrent()) await recordFileSyncProof(proofKey, bytes, file.sha, workspaceIsCurrent)
          }
          return
        }
        if (file.sha && accepted.version === file.sha) return
      }
      if (!await targetIsCurrent() || isFileDeletionPending(path)) return
      const result = await manager.pullFile(path, initialRevision,
        localExists ? { expectedHash: expectedLocalHash } : { expectedMissing: true })
      if (!result.success || result.action !== 'pull' || result.content === undefined || !await targetIsCurrent()) return
      await setWikiMeta(context.id, `markdown-remote-file:${path}`,
        { target, hash: await fileSyncContentHash(result.content), version: file.sha } satisfies RemoteFileProof)
      emitter.emit('sync-content-updated', { path, content: result.content })
    }
    // Import the shared index before source/topic documents on a new device.
    for (const group of [files.filter(file => priority(file.path) === 0), files.filter(file => priority(file.path) !== 0)]) {
      let next = 0
      const worker = async () => {
        while (next < group.length) {
          const file = group[next++]
          try { await pullFile(file) } catch (error) { console.warn('Wiki Markdown pull deferred:', file.path, error) }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, group.length) }, () => worker()))
    }
  })().catch(error => { console.warn('Wiki Markdown prefetch deferred:', error) })
    .finally(() => { remotePulls.delete(key); remotePulledAt.set(key, Date.now()) })
  remotePulls.set(key, operation)
  return operation
}

async function refreshWikiFiles(context: WikiContext, readOnly: boolean) {
  await assertContext(context)
  const dirtyVersion = await getWikiMeta<number>(context.id, 'dirty-version') ?? 0
  try {
    const { reconcileWikiFiles, flushWikiFiles } = await import('./files')
    await pullRemoteWikiFiles(context)
    // Read user/remote changes before considering any old SQLite data for
    // migration. A deleted or edited Markdown file must never be overwritten.
    await reconcileWikiFiles(context)
    if (!readOnly) await flushWikiFiles(context)
    await assertContext(context)
    refreshedAt.set(context.id, Date.now())
    if (!readOnly) await markWikiSynced(context.id, dirtyVersion)
    await setWikiMeta(context.id, 'sync-status', { phase: 'idle', error: null, completedAt: Date.now() })
    emitWikiUpdated()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== 'WIKI_SYNC_CONTEXT_CHANGED') {
      await setWikiMeta(context.id, 'sync-status', { phase: 'failed', error: message })
      emitWikiUpdated()
    }
    throw error
  }
}

function finishRefresh() {
  running = null
  if (rerunRequested) { rerunRequested = false; notifyWikiChanged() }
}

/** Compatibility name: saves files locally; normal article sync uploads them. */
export async function syncWikiNow(): Promise<void> {
  if (running) { rerunRequested = true; return running }
  running = (async () => refreshWikiFiles(await getWikiContext(), false))().finally(finishRefresh)
  return running
}

/** Reuse a received Markdown file before spending tokens rebuilding it. */
export async function pullWikiBeforeCompilation(context?: WikiContext): Promise<void> {
  if (running) await running
  const current = context ?? await getWikiContext()
  if (Date.now() - (refreshedAt.get(current.id) || 0) < 1000) return
  running = refreshWikiFiles(current, true).finally(finishRefresh)
  return running
}

export function notifyWikiChanged(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncWikiNow().catch(error => { console.warn('Wiki file refresh deferred:', error) })
  }, REFRESH_DELAY)
}

export function initWikiSyncRuntime(): () => void {
  if (attached || typeof window === 'undefined') return () => {}
  attached = true
  const onForeground = () => { if (foreground()) notifyWikiChanged() }
  const onArticle = ({ path }: { path: string }) => {
    const isCurrent = captureWikiWorkspaceGuard()
    void import('./files').then(({ noteWikiMarkdownFileChanged }) => {
      if (!attached || !isCurrent()) return
      noteWikiMarkdownFileChanged(path)
      notifyWikiChanged()
    })
  }
  const onRemote = ({ path, workspaceRoot, kind = 'changed', previousPath }: {
    path: string; workspaceRoot?: string; kind?: string; previousPath?: string
  }) => {
    const isCurrent = captureWikiWorkspaceGuard()
    void (async () => {
      if (workspaceRoot) {
        const workspace = await getWorkspacePath()
        const currentRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
        const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '')
        if (normalize(workspaceRoot) !== normalize(currentRoot)) return
      }
      if (attached && isCurrent()) {
        const { noteWikiMarkdownFileChanged, noteWikiFileStructureChanged } = await import('./files')
        if (!attached || !isCurrent()) return
        if (kind === 'changed') noteWikiMarkdownFileChanged(path)
        else noteWikiFileStructureChanged(path, previousPath)
        notifyWikiChanged()
      }
    })().catch(error => console.warn('Wiki file refresh deferred:', error))
  }
  const onMoved = ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
    onRemote({ path: newPath, previousPath: oldPath, kind: 'moved' })
  }
  const onDeleted = ({ path, workspaceRoot }: { path: string; workspaceRoot?: string }) => {
    onRemote({ path, workspaceRoot, kind: 'deleted' })
  }
  emitter.on('article-saved', onArticle)
  emitter.on('sync-content-updated', onRemote)
  emitter.on('sync-pulled', onRemote)
  emitter.on('workspace-file-changed', onRemote)
  emitter.on('sync-success', notifyWikiChanged)
  emitter.on('sync-engine-completed', notifyWikiChanged)
  emitter.on('editor-file-path-changed', onMoved)
  emitter.on('editor-navigation-path-moved', onMoved)
  emitter.on('editor-navigation-path-deleted', onDeleted)
  document.addEventListener('visibilitychange', onForeground)
  const interval = setInterval(onForeground, 60_000)
  notifyWikiChanged()
  return () => {
    attached = false
    if (timer) { clearTimeout(timer); timer = null }
    clearInterval(interval)
    emitter.off('article-saved', onArticle)
    emitter.off('sync-content-updated', onRemote)
    emitter.off('sync-pulled', onRemote)
    emitter.off('workspace-file-changed', onRemote)
    emitter.off('sync-success', notifyWikiChanged)
    emitter.off('sync-engine-completed', notifyWikiChanged)
    emitter.off('editor-file-path-changed', onMoved)
    emitter.off('editor-navigation-path-moved', onMoved)
    emitter.off('editor-navigation-path-deleted', onDeleted)
    document.removeEventListener('visibilitychange', onForeground)
  }
}
