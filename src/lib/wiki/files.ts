import { exists, mkdir, readTextFile, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  cacheWikiMarkdownDocument, getWikiMeta, getWikiPage, getWikiRevision, listWikiPages,
  getActiveWikiRevisions, listWikiJobs, listWikiSourceStates, removeWikiJob, removeWikiMarkdownCache,
  setWikiMeta, upsertWikiJob,
} from '@/db/wiki'
import emitter from '@/lib/emitter'
import { getAllMarkdownFiles } from '@/lib/files'
import { createRelativeMarkdownHref } from '@/lib/markdown-file-link'
import {
  getCurrentEditorWorkspaceRoot, markEditorPathMutation, prepareActiveEditorDeactivation,
  prepareActiveEditorPathMutationDurably, runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { getFilePathOptions } from '@/lib/workspace'
import { deleteSelfHostedWorkspacePath, writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import { WIKI_ROOT_FOLDER, type WikiContext, type WikiPage, type WikiSharedSettings, type WikiSourceRevision } from '@/types/wiki'
import { captureWikiWorkspaceGuard, getWikiContext } from './context'
import { ensureWikiWorkspaceRelativePath } from './path'
import { getWikiSettings, mergeWikiSyncedSettings } from './settings'
import { compareWikiKeys, resolveWikiSourceReference, wikiHash } from './sources'
import { parseWikiMarkdown, preserveWikiFrontmatter, preserveWikiMarkdownBody, refreshWikiNavigation, serializeWikiIndexFile, serializeWikiPageFile } from './file-format'

export { WIKI_ROOT_FOLDER } from '@/types/wiki'
const DEFAULT_INDEX_PATH = `${WIKI_ROOT_FOLDER}/索引.md`
const CATALOG_KEY = 'markdown-catalog'
interface WikiFileEntry { id: string; path: string; inputHash: string; hash: string }
let fileOperations: Promise<unknown> = Promise.resolve()
let treeRefresh: ReturnType<typeof setTimeout> | null = null
interface FileInventory { paths: Set<string>; checkedAt: number }
interface FileSnapshot {
  signature: string | null
  text: string | null
  document: NonNullable<ReturnType<typeof parseWikiMarkdown>> | null
  hash?: string
  sourceVersion?: number
}
const discoveredPaths = new Map<string, FileInventory>()
const fileSnapshots = new Map<string, Map<string, FileSnapshot>>()
const fileCacheRevisions = new Map<string, number>()
const navigationDirty = new Set<string>()
const changedFilePaths = new Set<string>()
const DISCOVERY_INTERVAL = 60_000

export function getWikiFileCacheRevision(contextId: string): number {
  return fileCacheRevisions.get(contextId) ?? 0
}

/** Structural events invalidate discovery, including Wiki files moved outside Wiki/. */
export function noteWikiFileStructureChanged(path = '', previousPath?: string) {
  if (!/\.md$/i.test(path) || (previousPath && !/\.md$/i.test(previousPath))) discoveredPaths.clear()
  if (path) noteWikiMarkdownFileChanged(path)
  if (previousPath) noteWikiMarkdownFileChanged(previousPath)
}

/** Events provide exact paths; ordinary source files need not be reread on every Wiki lookup. */
export function noteWikiMarkdownFileChanged(path: string) {
  if (!/\.md$/i.test(path)) return
  try { changedFilePaths.add(ensureWikiWorkspaceRelativePath(path)) } catch { /* Invalid paths never reach disk. */ }
}

async function fileSignature(path: string): Promise<string | null> {
  const options = await getFilePathOptions(ensureWikiWorkspaceRelativePath(path))
  if (!await exists(options.path, { baseDir: options.baseDir })) return null
  const info = await stat(options.path, { baseDir: options.baseDir })
  if (!info.isFile) return '!non-file'
  return info.mtime ? `${info.size}:${info.mtime.getTime()}:${info.birthtime?.getTime() ?? ''}` : null
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = fileOperations.then(operation, operation)
  fileOperations = next.catch(() => {})
  return next
}

async function assertContext(contextId: string) {
  if ((await getWikiContext()).id !== contextId) throw new Error('WIKI_CONTEXT_CHANGED')
}

async function readFile(path: string): Promise<string | null> {
  const safePath = ensureWikiWorkspaceRelativePath(path)
  const options = await getFilePathOptions(safePath)
  if (!await exists(options.path, { baseDir: options.baseDir })) return null
  // An I/O failure is not a deletion. Let callers retain the last known cache.
  return readTextFile(options.path, { baseDir: options.baseDir })
}

function refreshFileTree() {
  if (treeRefresh) clearTimeout(treeRefresh)
  treeRefresh = setTimeout(() => {
    treeRefresh = null
    void import('@/stores/article').then(({ default: store }) =>
      store.getState().loadFileTree({ skipRemoteSync: true })).catch(console.error)
  }, 300)
}

/** Use the same journal, dirty flag and saved event as ordinary notes. */
async function writeFile(contextId: string, path: string, text: string, expectedText?: string | null) {
  const isCurrent = captureWikiWorkspaceGuard()
  const assertCurrent = () => { if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED') }
  await assertContext(contextId)
  assertCurrent()
  const safePath = ensureWikiWorkspaceRelativePath(path)
  const { default: articleStore } = await import('@/stores/article')
  const workspaceRoot = await getCurrentEditorWorkspaceRoot()
  assertCurrent()
  if (!await prepareActiveEditorPathMutationDurably(articleStore.getState().activeFilePath, [safePath], workspaceRoot)) {
    throw new Error('WIKI_FILE_EDITED')
  }
  await assertContext(contextId)
  assertCurrent()
  const before = await readFile(safePath)
  assertCurrent()
  if (expectedText !== undefined && before !== expectedText) throw new Error(before === null ? 'WIKI_FILE_DELETED' : 'WIKI_FILE_EDITED')
  const options = await getFilePathOptions(safePath)
  assertCurrent()
  const capturedAbsolutePath = `${workspaceRoot.replace(/[/\\]+$/, '')}/${safePath}`
  const directory = safePath.split('/').slice(0, -1).join('/')
  if (directory) {
    const parent = await getFilePathOptions(directory)
    assertCurrent()
    await mkdir(parent.path, { baseDir: parent.baseDir, recursive: true })
  }
  const persist = async (value: string) => {
    assertCurrent()
    const journaled = await writeSelfHostedWorkspaceText(capturedAbsolutePath, value)
    assertCurrent()
    if (!journaled) await writeTextFile(options.path, value, { baseDir: options.baseDir })
  }
  assertCurrent()
  markEditorPathMutation(safePath, workspaceRoot)
  const accepted = await runEditorPathWriteTransaction(safePath, async ({ hasQueuedSave }) => {
    await assertContext(contextId)
    assertCurrent()
    if (hasQueuedSave() || await readFile(safePath) !== before) return false
    assertCurrent()
    const active = articleStore.getState().activeFilePath === safePath
    if (active && !prepareActiveEditorDeactivation()) return false
    await persist(text)
    assertCurrent()
    if (hasQueuedSave() || (active && !prepareActiveEditorDeactivation())) {
      if (before !== null) await persist(before)
      else {
        const journaled = await deleteSelfHostedWorkspacePath(capturedAbsolutePath, 'file')
        assertCurrent()
        if (!journaled) await remove(options.path, { baseDir: options.baseDir })
      }
      return false
    }
    markEditorPathMutation(safePath, workspaceRoot)
    return true
  }, workspaceRoot)
  if (!accepted) throw new Error('WIKI_FILE_EDITED')
  await assertContext(contextId)
  assertCurrent()
  const article = articleStore.getState()
  article.markFileDirty(safePath)
  if (article.activeFilePath === safePath) {
    articleStore.setState({ currentArticle: text })
    emitter.emit('editor-file-content-updated', { path: safePath, content: text })
    emitter.emit('external-content-update', text)
  }
  emitter.emit('article-saved', { path: safePath, content: text })
  refreshFileTree()
}

function sharedSettings(settings: Awaited<ReturnType<typeof getWikiSettings>>): WikiSharedSettings {
  const { enabled, started, language, languageClock, generation, scopes } = settings
  return { enabled, started, language, languageClock, generation, scopes }
}

function safeTitle(title: string) {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 70) || 'Wiki'
}

function defaultPagePath(page: WikiPage) {
  return `${WIKI_ROOT_FOLDER}/${page.kind === 'source' ? '来源摘要' : '主题'}/${safeTitle(page.title)}-${wikiHash(page.id).slice(0, 10)}.md`
}

async function getCatalog(contextId: string) {
  return await getWikiMeta<WikiFileEntry[]>(contextId, CATALOG_KEY) ?? []
}

async function rememberFile(contextId: string, entry: WikiFileEntry) {
  const catalog = await getCatalog(contextId)
  const next = [...catalog.filter(item => item.id !== entry.id), entry].sort((a, b) => compareWikiKeys(a.id, b.id))
  await setWikiMeta(contextId, CATALOG_KEY, next)
}

function markdownBody(text: string) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()
}

async function backupEditedFile(contextId: string, path: string, content: string) {
  const filename = path.split('/').pop()?.replace(/\.md$/i, '') || 'Wiki'
  const backupPath = `${WIKI_ROOT_FOLDER}/备份/${filename}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`
  // It remains an ordinary, readable note but must not be imported as a second live Wiki page.
  await writeFile(contextId, backupPath, content.replace(/^notegen-wiki-data:/m, 'notegen-wiki-backup:'), null)
}

async function writePage(page: WikiPage, revision?: WikiSourceRevision): Promise<WikiPage> {
  await assertContext(page.contextId)
  const catalog = await getCatalog(page.contextId)
  const cached = await getWikiPage(page.contextId, page.id)
  const reservedPaths = await getWikiMeta<Record<string, string>>(page.contextId, 'markdown-page-paths') ?? {}
  let path = catalog.find(item => item.id === page.id)?.path || reservedPaths[page.id] || page.filePath || defaultPagePath(page)
  const forceKey = `markdown-overwrite:${page.id}`
  const force = await getWikiMeta<boolean>(page.contextId, forceKey)
  const { default: articleStore } = await import('@/stores/article')
  await articleStore.getState().flushPendingArticleSave(path)
  let previousText = await readFile(path)
  if (!previousText && catalog.some(entry => entry.id === page.id) && !force) {
    throw new Error('WIKI_FILE_DELETED')
  }
  let previous = previousText ? parseWikiMarkdown(previousText, page.contextId) : null
  const knownPath = catalog.some(entry => entry.id === page.id && entry.path === path) || reservedPaths[page.id] === path
  if (previousText && knownPath && (previous?.kind !== 'page' || previous.page.id !== page.id)) {
    if (!force) throw new Error('WIKI_FILE_EDITED')
    if (page.status !== 'ready') return { ...page, filePath: path }
    await backupEditedFile(page.contextId, path, previousText)
  }
  // Never replace an unrelated user file, including a colliding index or imported file.
  if (previousText && !knownPath && (previous?.kind !== 'page' || previous.page.id !== page.id)) {
    const base = defaultPagePath(page).replace(/\.md$/, '')
    let suffix = 1
    do { path = `${base}-${suffix++}.md`; previousText = await readFile(path) } while (previousText)
    previous = null
  }
  const current = previous?.kind === 'page' ? previous : null
  let next = { ...page, filePath: path }
  if (current && next.status !== 'ready') {
    // Invalidating a source changes eligibility, never erases a person's document.
    next = { ...current.page, status: next.status, updatedAt: next.updatedAt, filePath: path }
    revision = current.revision
  } else if (current?.edited && !force) {
    throw new Error('WIKI_FILE_EDITED')
  }
  if (current?.edited && force && next.status === 'ready' && previousText) await backupEditedFile(page.contextId, path, previousText)
  if (next.kind === 'source' && !revision) {
    const state = (await listWikiSourceStates(page.contextId)).find(item => next.sourceRefs.some(ref => ref.stableId === item.stableId))
    if (state?.revisionId) revision = await getWikiRevision(page.contextId, state.revisionId) ?? undefined
  }
  const pages = await listWikiPages(page.contextId)
  const knownPages = [...pages.filter(item => item.id !== next.id), next]
  // Reserve topic filenames before they are compiled so source pages can link to them.
  for (const contribution of revision?.contributions ?? []) {
    const id = `topic:${contribution.topicKey}`
    if (!knownPages.some(item => item.id === id)) knownPages.push({
      id, contextId: page.contextId, kind: 'topic', title: contribution.title,
      aliases: contribution.aliases, body: '', sourceRefs: [], inputHash: page.inputHash,
      outputHash: wikiHash(''), updatedAt: page.updatedAt, status: 'stale', relatedPageIds: [],
      topicKey: contribution.topicKey,
    })
  }
  const allPages = knownPages.map(item => ({ ...item,
    filePath: catalog.find(entry => entry.id === item.id)?.path || (item.id === next.id ? path : undefined)
      || reservedPaths[item.id] || item.filePath || defaultPagePath(item) }))
  await setWikiMeta(page.contextId, 'markdown-page-paths', Object.fromEntries(allPages.map(item => [item.id, item.filePath])))
  let text = serializeWikiPageFile(next, revision, path, allPages,
    current?.edited && next.status !== 'ready' ? current.generatedBodyHash : undefined)
  // Preserve edited prose during status-only updates, including any extra handwritten sections.
  if (current && next.status !== 'ready' && previousText) text = preserveWikiMarkdownBody(text, previousText)
  else if (current && previousText) text = preserveWikiFrontmatter(text, previousText)
  if (text !== previousText) await writeFile(page.contextId, path, text, previousText)
  await rememberFile(page.contextId, { id: next.id, path, inputHash: next.inputHash, hash: wikiHash(text) })
  if (force && next.status === 'ready') await setWikiMeta(page.contextId, forceKey, false)
  const deleted = await getWikiMeta<Record<string, string>>(page.contextId, 'markdown-deleted') ?? {}
  if (deleted[next.id]) {
    delete deleted[next.id]
    await setWikiMeta(page.contextId, 'markdown-deleted', deleted)
  }
  if (next.kind === 'source') for (const ref of next.sourceRefs) {
    await setWikiMeta(page.contextId, `markdown-deleted-source:${ref.stableId}`, null)
  }
  const deletedPaths = await getWikiMeta<string[]>(page.contextId, 'markdown-deleted-paths') ?? []
  if (deletedPaths.includes(path)) await setWikiMeta(page.contextId, 'markdown-deleted-paths', deletedPaths.filter(item => item !== path))
  // Updating the index is deferred until the DB projection has been committed.
  if (cached?.filePath !== path) refreshFileTree()
  return next
}

export function writeWikiPageFile(page: WikiPage, revision?: WikiSourceRevision): Promise<WikiPage> {
  return serialize(() => writePage(page, revision))
}

/** Scan files first. A cache miss or deletion can never resurrect old SQLite prose. */
async function reconcileFiles(context: WikiContext) {
  const isCurrent = captureWikiWorkspaceGuard()
  const assertCurrent = () => { if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED') }
  await assertContext(context.id)
  assertCurrent()
  const catalog = await getCatalog(context.id)
  const catalogById = new Map(catalog.map(entry => [entry.id, entry]))
  const catalogPaths = new Set(catalog.map(entry => `${entry.id}\0${entry.path}`))
  const inventory = discoveredPaths.get(context.id)
  const discover = !inventory || Date.now() - inventory.checkedAt >= DISCOVERY_INTERVAL
  const paths = discover ? new Set((await getAllMarkdownFiles()).map(file => file.relativePath)) : inventory.paths
  assertCurrent()
  if (discover) discoveredPaths.set(context.id, { paths, checkedAt: Date.now() })
  const hints = new Set(changedFilePaths)
  changedFilePaths.clear()
  const snapshots = fileSnapshots.get(context.id) ?? new Map<string, FileSnapshot>()
  fileSnapshots.set(context.id, snapshots)
  const candidates = new Set([...paths].filter(path => !snapshots.has(path) || path.startsWith(`${WIKI_ROOT_FOLDER}/`) || hints.has(path)))
  // Periodic discovery also revisits previously ordinary notes: an external
  // editor may have turned one into a Wiki document without a watcher event.
  if (discover) for (const path of paths) candidates.add(path)
  for (const path of hints) candidates.add(path)
  for (const entry of catalog) candidates.add(entry.path)
  const indexPath = await getWikiMeta<string>(context.id, 'markdown-index-path')
  if (indexPath) candidates.add(indexPath)
  const [cachedPages, sourceStates] = await Promise.all([listWikiPages(context.id), listWikiSourceStates(context.id)])
  const pagesById = new Map(cachedPages.map(page => [page.id, page]))
  const sourcesById = new Map(sourceStates.map(source => [source.stableId, source]))
  assertCurrent()
  const entries: WikiFileEntry[] = []
  const changedTopics = new Set<string>()
  let repairNavigation = navigationDirty.has(context.id)
  const found = new Set<string>()
  const settingsFiles: Array<{ path: string; settings: WikiSharedSettings }> = []
  const documents: Array<{ path: string; text: string; document: NonNullable<ReturnType<typeof parseWikiMarkdown>>; snapshot: FileSnapshot; changed: boolean }> = []
  // Deterministic path order also resolves duplicate copies without merging prose.
  for (const path of [...candidates].sort(compareWikiKeys)) {
    assertCurrent()
    const signature = await fileSignature(path)
    const previous = snapshots.get(path)
    let snapshot = previous
    if (discover || hints.has(path) || !signature || !previous || previous.signature !== signature) {
      const text = signature === '!non-file' ? null : await readFile(path)
      assertCurrent()
      const document = text && /^notegen-wiki-data:/m.test(text) ? parseWikiMarkdown(text, context.id) : null
      snapshot = { signature, text: document ? text : null, document,
        hash: document && text ? wikiHash(text) : undefined, sourceVersion: previous?.sourceVersion }
      snapshots.set(path, snapshot)
    }
    if (snapshot?.text && snapshot.document) documents.push({ path, text: snapshot.text, document: snapshot.document,
      snapshot, changed: previous?.text !== snapshot.text || catalogById.get(snapshot.document.kind === 'page' ? snapshot.document.page.id : '')?.path !== path })
  }
  for (const { path, document } of documents) if (document.kind === 'index') {
    settingsFiles.push({ path, settings: document.settings })
  }
  for (const file of settingsFiles) await mergeWikiSyncedSettings(context.id, file.settings)
  if (settingsFiles.length) {
    const previousIndex = await getWikiMeta<string>(context.id, 'markdown-index-path')
    const path = settingsFiles.find(file => file.path === previousIndex)?.path || settingsFiles[0].path
    await setWikiMeta(context.id, 'markdown-index-path', path)
  }
  documents.sort((left, right) => {
    const leftId = left.document.kind === 'page' ? left.document.page.id : null
    const rightId = right.document.kind === 'page' ? right.document.page.id : null
    const leftKnown = catalogPaths.has(`${leftId}\0${left.path}`)
    const rightKnown = catalogPaths.has(`${rightId}\0${right.path}`)
    return Number(rightKnown) - Number(leftKnown) || compareWikiKeys(left.path, right.path)
  })
  for (const { path, text, document, snapshot, changed } of documents) {
    assertCurrent()
    if (document.kind !== 'page' || found.has(document.page.id)) continue
    found.add(document.page.id)
    const page = { ...document.page, contextId: context.id, filePath: path }
    let revision = document.revision
    const beforeState = revision ? sourcesById.get(revision.source.stableId) : undefined
    const oldPage = pagesById.get(page.id)
    if (oldPage?.filePath !== path || oldPage?.title !== page.title || document.page.filePath !== path) repairNavigation = true
    const entry = { id: page.id, path, inputHash: page.inputHash, hash: snapshot.hash ?? wikiHash(text) }
    const sourceHint = revision?.source.locator.filePath
    if (!discover && !changed && oldPage?.filePath === path && (!revision || (snapshot.sourceVersion === beforeState?.version
      && (!sourceHint || !hints.has(sourceHint))))) {
      entries.push(entry)
      continue
    }
    let originalAvailable = true
    if (revision) {
      const original = await resolveWikiSourceReference(revision.source)
      // A missing original may be an offline or lazily downloaded file. The
      // actual Wiki document remains usable as derived knowledge in that case.
      originalAvailable = !original || original.source.contentHash === revision.source.contentHash
      if (originalAvailable && original) {
        revision = { ...revision, source: original.source }
        page.sourceRefs = page.sourceRefs.map(ref => ref.stableId === original.source.stableId ? original.source : ref)
      }
    }
    // Availability and local record IDs may change even when this file does not.
    assertCurrent()
    const afterState = await cacheWikiMarkdownDocument(page, revision, originalAvailable)
    if (afterState) sourcesById.set(afterState.stableId, afterState)
    snapshot.sourceVersion = afterState?.version
    if (changed || JSON.stringify(oldPage) !== JSON.stringify(page) || beforeState?.version !== afterState?.version) {
      fileCacheRevisions.set(context.id, getWikiFileCacheRevision(context.id) + 1)
    }
    pagesById.set(page.id, page)
    const activated = afterState?.status === 'ready' && (beforeState?.revisionId !== afterState.revisionId || beforeState?.status !== 'ready')
    if (revision && (oldPage?.outputHash !== page.outputHash || activated)) {
      for (const contribution of revision.contributions) changedTopics.add(contribution.topicKey)
      const oldRevision = beforeState?.revisionId ? await getWikiRevision(context.id, beforeState.revisionId) : null
      for (const contribution of oldRevision?.contributions ?? []) changedTopics.add(contribution.topicKey)
    }
    entries.push(entry)
  }
  const deleted = await getWikiMeta<Record<string, string>>(context.id, 'markdown-deleted') ?? {}
  const deletedPaths = new Set(await getWikiMeta<string[]>(context.id, 'markdown-deleted-paths') ?? [])
  for (const old of catalog) if (!found.has(old.id)) {
    repairNavigation = true
    deleted[old.id] = old.inputHash
    deletedPaths.add(old.path)
    assertCurrent()
    const page = pagesById.get(old.id)
    if (page?.kind === 'source') for (const ref of page.sourceRefs) {
      const state = sourcesById.get(ref.stableId)
      const revision = state?.revisionId ? await getWikiRevision(context.id, state.revisionId) : null
      for (const contribution of revision?.contributions ?? []) changedTopics.add(contribution.topicKey)
      await setWikiMeta(context.id, `markdown-deleted-source:${ref.stableId}`, ref.contentHash)
    }
    await removeWikiMarkdownCache(context.id, old.id, old.inputHash)
    if (page?.kind === 'source') for (const ref of page.sourceRefs) {
      await removeWikiJob(context.id, `source:${ref.stableId}`, page.inputHash)
    }
    if (page?.kind === 'topic') await removeWikiJob(context.id, page.id, page.inputHash)
    pagesById.delete(old.id)
    fileCacheRevisions.set(context.id, getWikiFileCacheRevision(context.id) + 1)
  }
  for (const id of found) delete deleted[id]
  for (const entry of entries) deletedPaths.delete(entry.path)
  if (repairNavigation) {
    navigationDirty.delete(context.id)
    const livePages = [...pagesById.values()].filter(page => found.has(page.id))
    for (const entry of entries) {
      assertCurrent()
      const snapshot = snapshots.get(entry.path)
      if (!snapshot?.text || snapshot.document?.kind !== 'page') continue
      const next = refreshWikiNavigation(snapshot.text, entry.path, livePages)
      if (next === snapshot.text) continue
      try {
        await writeFile(context.id, entry.path, next, snapshot.text)
        snapshot.text = next
        snapshot.document = parseWikiMarkdown(next, context.id)
        snapshot.signature = await fileSignature(entry.path)
        entry.hash = wikiHash(next)
        snapshot.hash = entry.hash
      } catch (error) {
        if (!(error instanceof Error) || !['WIKI_FILE_EDITED', 'WIKI_FILE_DELETED'].includes(error.message)) throw error
        // An active editor owns its prose; retry only this managed block later.
        navigationDirty.add(context.id)
      }
    }
  }
  await assertContext(context.id)
  await setWikiMeta(context.id, CATALOG_KEY, entries)
  await setWikiMeta(context.id, 'markdown-deleted', deleted)
  await setWikiMeta(context.id, 'markdown-deleted-paths', [...deletedPaths].sort(compareWikiKeys))
  if (discover) {
    const retainedPaths = new Set(entries.map(entry => entry.path))
    for (const path of snapshots.keys()) {
      if (!paths.has(path) && !hints.has(path) && !retainedPaths.has(path) && path !== indexPath) snapshots.delete(path)
    }
  }
  // Cache imports may change topic dependencies (including handwritten edits).
  // Schedule jobs directly: calling a page writer while holding this file lock
  // would recursively acquire it. Current topic files are kept until rebuilt.
  let jobsAdded = false
  if (changedTopics.size) {
    const settings = await getWikiSettings(context.id)
    const revisions = await getActiveWikiRevisions(context.id)
    const jobs = await listWikiJobs(context.id)
    const { buildWikiTopicInputHash } = await import('./compiler')
    for (const key of changedTopics) {
      const topic = await getWikiPage(context.id, `topic:${key}`)
      const generation = Math.max(settings.generation, topic?.generation ?? 0,
        await getWikiMeta<number>(context.id, `topic-generation:${key}`) ?? 0)
      const inputHash = buildWikiTopicInputHash(key, revisions, generation, settings.language)
      if (topic?.status === 'ready' && topic.inputHash === inputHash) continue
      if (deleted[`topic:${key}`] === inputHash) continue
      const previousJob = jobs.find(job => job.id === `topic:${key}`)
      if (previousJob?.inputHash === inputHash) continue
      await upsertWikiJob({ id: `topic:${key}`, contextId: context.id, sourceKey: key, kind: 'topic',
        inputHash, status: 'pending', stage: 'topic', attempts: 0, readyAt: Date.now() + 1000,
        updatedAt: Date.now(), error: null })
      jobsAdded = true
    }
  }
  return jobsAdded
}

export function reconcileWikiFiles(context: WikiContext): Promise<void> {
  const isCurrent = captureWikiWorkspaceGuard()
  return serialize(() => isCurrent() ? reconcileFiles(context) : Promise.resolve(false)).then(async jobsAdded => {
    if (!jobsAdded || !isCurrent()) return
    const settings = await getWikiSettings(context.id)
    if ((await getWikiContext()).id !== context.id || !isCurrent() || !settings.enabled || !settings.started || settings.paused) return
    const { resumeWikiQueue } = await import('./queue')
    if (!isCurrent()) return
    // The worker can itself be waiting for this refresh. Let it finish or
    // cancel before the resumed workspace waits for that worker to settle.
    void resumeWikiQueue({ expectedContextId: context.id }).catch(error => {
      if (!isCurrent() || (error instanceof Error && error.message === 'WIKI_CONTEXT_CHANGED')) return
      console.error('Failed to resume Wiki after refreshing Markdown:', error)
    })
  })
}

export function refreshWikiFileCache(context: WikiContext): Promise<void> {
  return reconcileWikiFiles(context)
}

async function ensureIndex(contextId: string, explicit = false): Promise<string> {
  await assertContext(contextId)
  const settings = await getWikiSettings(contextId)
  const rememberedPath = await getWikiMeta<string>(contextId, 'markdown-index-path')
  let path = rememberedPath || DEFAULT_INDEX_PATH
  let previous = await readFile(path)
  const deletedPaths = await getWikiMeta<string[]>(contextId, 'markdown-deleted-paths') ?? []
  if (!explicit && previous === null && (rememberedPath || deletedPaths.some(item => path === item || path.startsWith(`${item}/`)))) return path
  let parsed = previous ? parseWikiMarkdown(previous, contextId) : null
  if (previous && parsed?.kind !== 'index') {
    let suffix = 1
    do { path = `${WIKI_ROOT_FOLDER}/索引-${suffix++}.md`; previous = await readFile(path) } while (previous)
    parsed = null
  }
  const pages = (await listWikiPages(contextId)).filter(page => page.status !== 'archived' && page.filePath)
  const zh = settings.language.startsWith('zh')
  const link = (page: WikiPage) => `- [${page.title.replace(/[\[\]\n]/g, ' ')}](${createRelativeMarkdownHref(path, page.filePath!)})`
  const section = (kind: WikiPage['kind'], title: string) => [
    `## ${title}`, '', ...pages.filter(page => page.kind === kind).sort((a, b) => compareWikiKeys(a.title, b.title)).map(link),
  ].join('\n')
  const body = parsed?.kind === 'index' && parsed.edited && previous ? markdownBody(previous) : [
    '# Wiki', '', zh ? '这些 Markdown 文件由 AI 根据选定资料整理，可在文件树中直接阅读和编辑。' : 'These Markdown notes are organized from your selected sources. Read and edit them in the file tree.',
    '', section('topic', zh ? '主题' : 'Topics'), '', section('source', zh ? '来源摘要' : 'Source summaries'),
  ].join('\n')
  let text = serializeWikiIndexFile(body, sharedSettings(settings),
    parsed?.kind === 'index' && parsed.edited ? parsed.generatedBodyHash : undefined)
  if (parsed?.kind === 'index' && previous) text = parsed.edited
    ? preserveWikiMarkdownBody(text, previous) : preserveWikiFrontmatter(text, previous)
  if (text !== previous) await writeFile(contextId, path, text, previous)
  await setWikiMeta(contextId, 'markdown-index-path', path)
  if (explicit && deletedPaths.length) await setWikiMeta(contextId, 'markdown-deleted-paths',
    deletedPaths.filter(item => item !== path && !path.startsWith(`${item}/`)))
  return path
}

export function ensureWikiIndexFile(contextId: string): Promise<string> {
  return serialize(async () => { await reconcileFiles(await getWikiContext()); return ensureIndex(contextId, true) })
}

/** Only maintain the Markdown index; compiled bodies are persisted at commit time. */
export function flushWikiFiles(context: WikiContext): Promise<void> {
  return serialize(async () => {
    const settings = await getWikiSettings(context.id)
    if (settings.started || (await getCatalog(context.id)).length) await ensureIndex(context.id)
  })
}

export async function getWikiPageFilePath(contextId: string, pageId: string): Promise<string | null> {
  await assertContext(contextId)
  let entry = (await getCatalog(contextId)).find(item => item.id === pageId)
  if (!entry) {
    await reconcileWikiFiles(await getWikiContext())
    entry = (await getCatalog(contextId)).find(item => item.id === pageId)
  }
  if (!entry) return null
  let text = await readFile(entry.path)
  let parsed = text ? parseWikiMarkdown(text, contextId) : null
  if (parsed?.kind === 'page' && parsed.page.id === pageId) return entry.path
  await reconcileWikiFiles(await getWikiContext())
  entry = (await getCatalog(contextId)).find(item => item.id === pageId)
  if (!entry) return null
  text = await readFile(entry.path)
  parsed = text ? parseWikiMarkdown(text, contextId) : null
  return parsed?.kind === 'page' && parsed.page.id === pageId ? entry.path : null
}

export async function getWikiPageForFilePath(path: string): Promise<WikiPage | null> {
  const context = await getWikiContext()
  const text = await readFile(path)
  const parsed = text ? parseWikiMarkdown(text, context.id) : null
  return parsed?.kind === 'page' ? { ...parsed.page, filePath: path } : null
}

/** One-time compatibility migration. Missing files are never repopulated afterward. */
export function migrateWikiCacheToFiles(context: WikiContext, fromContextId: string): Promise<void> {
  return serialize(async () => {
    const marker = `markdown-storage-migrated:${fromContextId}`
    if (await getWikiMeta<boolean>(context.id, marker)) return
    // Capture old cache before importing files, which can prune missing projections.
    const oldPages = await listWikiPages(fromContextId)
    const oldStates = await listWikiSourceStates(fromContextId)
    await reconcileFiles(context)
    const known = new Set((await getCatalog(context.id)).map(entry => entry.id))
    for (const old of oldPages) {
      if (known.has(old.id) || old.status === 'archived' || !old.body.trim()) continue
      let revision: WikiSourceRevision | undefined
      if (old.kind === 'source') {
        const state = oldStates.find(item => old.sourceRefs.some(ref => ref.stableId === item.stableId))
        revision = state?.revisionId ? await getWikiRevision(fromContextId, state.revisionId) ?? undefined : undefined
        if (!revision) continue
        revision = { ...revision, contextId: context.id }
      }
      const page = await writePage({ ...old, contextId: context.id, filePath: undefined }, revision)
      await cacheWikiMarkdownDocument(page, revision)
      known.add(page.id)
    }
    if (known.size || (await getWikiSettings(context.id)).started) await ensureIndex(context.id)
    await setWikiMeta(context.id, marker, true)
  })
}
