/**
 * F3 vault 索引服務（I/O 層）：
 * 1. 讀 app 資料目錄的快取（不寫進 vault）
 * 2. 列出全 vault 的 .md，只重讀新增或 mtime 改變的檔案
 * 3. 用 Tauri fs watch 增量更新；沒有路徑的事件才整份重掃
 * 解析與比對邏輯在 index-note.ts / index-core.ts。
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  stat,
  watch,
  writeTextFile,
  type WatchEvent,
} from '@tauri-apps/plugin-fs'
import { getAllMarkdownFiles } from '@/lib/files'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import useVaultIndexStore from '@/stores/vault-index'
import { indexNote, type IndexedNote } from './index-note'
import {
  indexReadConcurrency,
  listStatConcurrency,
  planScan,
  restoreIndexCache,
  scheduleVaultIndexSave,
  serializeIndexCache,
  toIndexablePath,
  type ListedFile,
} from './index-core'

const CACHE_DIR = 'vault-index'
const CACHE_SAVE_DELAY_MS = 2000

function cacheFileName(workspace: string): string {
  // 簡單的字串雜湊，讓每個工作區各有一份快取
  let hash = 5381
  for (let i = 0; i < workspace.length; i++) hash = ((hash << 5) + hash + workspace.charCodeAt(i)) >>> 0
  return `${CACHE_DIR}/${hash.toString(36)}.json`
}

async function loadCache(workspace: string): Promise<Map<string, IndexedNote>> {
  const file = cacheFileName(workspace)
  try {
    if (!await exists(file, { baseDir: BaseDirectory.AppData })) return new Map()
    return restoreIndexCache(JSON.parse(await readTextFile(file, { baseDir: BaseDirectory.AppData })), workspace)
  } catch (error) {
    console.warn('[vault-index] cache unreadable, rebuilding:', error)
    return new Map()
  }
}

/**
 * Issue #22：正式 build 看不到 console，把每次掃描與增量更新的時間寫到快取旁的
 * `<hash>.stats.json`，量啟動與索引效能時直接讀檔。`sinceLoadMs` 是網頁載入到這一刻的毫秒數。
 */
async function saveStats(workspace: string, stats: Record<string, unknown>): Promise<void> {
  try {
    if (!await exists(CACHE_DIR, { baseDir: BaseDirectory.AppData })) {
      await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
    }
    const payload = { ...stats, at: new Date().toISOString(), sinceLoadMs: Math.round(performance.now()) }
    await writeTextFile(cacheFileName(workspace).replace(/\.json$/, '.stats.json'), JSON.stringify(payload, null, 2), { baseDir: BaseDirectory.AppData })
  } catch (error) {
    console.warn('[vault-index] stats save failed:', error)
  }
}

async function saveCache(workspace: string, notes: Map<string, IndexedNote>): Promise<void> {
  if (!await exists(CACHE_DIR, { baseDir: BaseDirectory.AppData })) {
    await mkdir(CACHE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const payload = serializeIndexCache(workspace, notes.values(), Date.now())
  await writeTextFile(cacheFileName(workspace), JSON.stringify(payload), { baseDir: BaseDirectory.AppData })
}

async function readNote(relativePath: string): Promise<{ content: string, mtime: number } | null> {
  const options = await getFilePathOptions(relativePath)
  const fsOptions = options.baseDir ? { baseDir: options.baseDir } : undefined
  try {
    const [content, info] = await Promise.all([
      readTextFile(options.path, fsOptions),
      stat(options.path, fsOptions),
    ])
    return { content, mtime: info.mtime?.getTime() ?? 0 }
  } catch {
    // 讀檔期間被刪除或改名
    return null
  }
}

async function indexPaths(paths: string[]): Promise<{ indexed: IndexedNote[], missing: string[] }> {
  const indexed: IndexedNote[] = []
  const missing: string[] = []
  const workers = indexReadConcurrency(paths.length)
  if (workers === 0) return { indexed, missing }
  let cursor = 0
  async function worker() {
    while (cursor < paths.length) {
      const path = paths[cursor++]
      const file = await readNote(path)
      if (file) indexed.push(indexNote(path, file.content, file.mtime))
      else missing.push(path)
    }
  }
  await Promise.all(Array.from({ length: workers }, worker))
  return { indexed, missing }
}

function mtimeMs(mtime: Date | null | undefined): number {
  if (!mtime) return 0
  const ms = new Date(mtime).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/** 只 stat mtime，不讀內容。路徑規則與 getFilePathOptions 的相對路徑相同。 */
async function readListedMtime(workspace: { path: string, isCustom: boolean }, relativePath: string): Promise<number> {
  try {
    const info = workspace.isCustom
      ? await stat(await join(workspace.path, relativePath))
      : await stat(`article/${relativePath}`, { baseDir: BaseDirectory.AppData })
    return mtimeMs(info.mtime)
  } catch {
    return 0
  }
}

async function listVault(): Promise<ListedFile[]> {
  const files = await getAllMarkdownFiles(false)
  const workers = listStatConcurrency(files.length)
  if (workers === 0) return []
  const workspace = await getWorkspacePath()
  const listed: ListedFile[] = new Array(files.length)
  let cursor = 0
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++
      const relativePath = files[index].relativePath
      listed[index] = { path: relativePath, mtime: await readListedMtime(workspace, relativePath) }
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return listed
}

/** 資料夾被刪除、改名或搬入時，事件只帶資料夾路徑，要整份比對才能找出底下的筆記 */
function touchesFolder(event: WatchEvent, workspaceKey: string): boolean {
  const type = event.type
  const structural = typeof type === 'string'
    || 'create' in type
    || 'remove' in type
    || ('modify' in type && type.modify.kind === 'rename')
  if (!structural) return false
  return event.paths.some(path => {
    const normalized = path.replace(/\\/g, '/')
    if (!normalized.startsWith(`${workspaceKey}/`)) return false
    const relative = normalized.slice(workspaceKey.length + 1)
    if (relative.split('/').some(part => part.startsWith('.'))) return false
    return !/\.[^/]+$/.test(relative.split('/').pop() ?? '')
  })
}

export interface VaultIndexHandle {
  stop: () => void
  rescan: () => Promise<void>
}

const NOOP_HANDLE: VaultIndexHandle = { stop: () => {}, rescan: async () => {} }

/**
 * 啟動指定工作區的索引。workspacePath 為空字串時是預設工作區（AppData/article）。
 * 回傳的 stop() 會停止監看並寫出最後一次快取。
 *
 * Issue #75：啟動是非同步的，工作區可能在 resolve 前就換掉。傳入 signal 後，abort
 * 會立即停止這次啟動；另外每次寫入 store 或快取前都確認 store 仍屬於這個工作區，
 * 舊工作區的快取與掃描結果不會蓋掉新工作區。
 */
export async function startVaultIndex(workspacePath: string, signal?: AbortSignal): Promise<VaultIndexHandle> {
  const workspaceRoot = workspacePath || await join(await appDataDir(), 'article')
  if (signal?.aborted) return NOOP_HANDLE
  const workspaceKey = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  useVaultIndexStore.getState().reset(workspaceKey)

  let stopped = false
  let cancelSave: (() => void) | null = null
  let scanning: Promise<void> | null = null
  let unwatch: (() => void) | undefined

  /** 這次啟動仍有效，且 store 沒被別的工作區接手 */
  const owns = () => !stopped
    && !signal?.aborted
    && useVaultIndexStore.getState().workspace === workspaceKey

  const scheduleSave = () => {
    cancelSave?.()
    cancelSave = scheduleVaultIndexSave(() => {
      cancelSave = null
      if (!owns()) return
      void saveCache(workspaceKey, useVaultIndexStore.getState().notes)
        .catch(error => console.warn('[vault-index] cache save failed:', error))
    }, CACHE_SAVE_DELAY_MS)
  }

  const runScan = async (base: Map<string, IndexedNote>, fromCache: boolean) => {
    const started = performance.now()
    if (!owns()) return
    useVaultIndexStore.getState().setStatus('scanning')
    const listed = await listVault()
    if (!owns()) return
    const plan = planScan(base, listed)
    const { indexed, missing } = await indexPaths(plan.toIndex)
    if (!owns()) return

    const next = new Map(base)
    for (const path of [...plan.toRemove, ...missing]) next.delete(path)
    for (const note of indexed) next.set(note.path, note)
    const state = useVaultIndexStore.getState()
    // 掃描期間監看器可能已寫入更新的版本：mtime 較新的保留
    for (const [path, current] of state.notes) {
      const scanned = next.get(path)
      if (scanned && current.mtime > scanned.mtime) next.set(path, current)
    }
    state.replaceAll(next)
    state.setStatus('ready')
    const stats = {
      ms: Math.round(performance.now() - started),
      files: listed.length,
      indexed: indexed.length,
      fromCache,
    }
    state.setLastScan(stats)
    console.info(`[vault-index] ${stats.files} files in ${stats.ms}ms (${stats.indexed} read, cache ${fromCache ? 'hit' : 'miss'})`)
    void saveStats(workspaceKey, { kind: 'scan', ...stats })
    if (indexed.length > 0 || plan.toRemove.length > 0 || missing.length > 0) scheduleSave()
  }

  const reportScanError = (label: string) => (error: unknown) => {
    console.error(`[vault-index] ${label}:`, error)
    if (owns()) useVaultIndexStore.getState().setStatus('error', String(error))
  }

  const rescan = async () => {
    if (scanning) return scanning
    scanning = runScan(useVaultIndexStore.getState().notes, false)
      .catch(reportScanError('scan failed'))
      .finally(() => { scanning = null })
    return scanning
  }

  const handleEvent = async (event: WatchEvent) => {
    if (!owns()) return
    if (event.paths.length === 0 || touchesFolder(event, workspaceKey)) {
      await rescan()
      return
    }
    const paths = [...new Set(event.paths
      .map(path => toIndexablePath(path, workspaceKey))
      .filter((path): path is string => path !== null))]
    if (paths.length === 0) return
    const started = performance.now()
    const { indexed, missing } = await indexPaths(paths)
    if (!owns()) return
    const state = useVaultIndexStore.getState()
    state.remove(missing)
    state.upsert(indexed)
    void saveStats(workspaceKey, { kind: 'event', ms: Math.round(performance.now() - started), paths: paths.length, indexed: indexed.length, missing: missing.length })
    scheduleSave()
  }

  const stop = () => {
    if (stopped) return
    // 停止前先確認 store 還屬於這個工作區，才寫出最後一次快取
    const flush = cancelSave !== null && useVaultIndexStore.getState().workspace === workspaceKey
    stopped = true
    if (useVaultIndexStore.getState().rescan === rescan) useVaultIndexStore.getState().setRescan(null)
    unwatch?.()
    unwatch = undefined
    if (cancelSave) {
      cancelSave()
      cancelSave = null
    }
    if (flush) void saveCache(workspaceKey, useVaultIndexStore.getState().notes).catch(() => undefined)
  }
  signal?.addEventListener('abort', stop, { once: true })

  const cached = await loadCache(workspaceKey)
  if (!owns()) {
    stop()
    return NOOP_HANDLE
  }
  if (cached.size > 0) {
    // 先讓快取可查詢，再在背景比對差異
    useVaultIndexStore.getState().replaceAll(cached)
  }
  scanning = runScan(cached, cached.size > 0)
    .catch(reportScanError('initial scan failed'))
    .finally(() => { scanning = null })

  try {
    const stopWatching = await watch(workspaceRoot, event => { void handleEvent(event) }, { recursive: true, delayMs: 300 })
    if (stopped) stopWatching()
    else unwatch = stopWatching
  } catch (error) {
    console.warn('[vault-index] file watcher unavailable; index updates only on rescan:', error)
  }
  if (stopped) return NOOP_HANDLE

  useVaultIndexStore.getState().setRescan(rescan)
  return { rescan, stop }
}
