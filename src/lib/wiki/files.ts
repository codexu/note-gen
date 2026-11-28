import { invalidateKnowledgeLexicalCache } from '@/lib/knowledge-lexical-cache'
import { exists, mkdir, readTextFile, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  cacheWikiMarkdownConflict, cacheWikiMarkdownDocument, findWikiRevision, getWikiMeta, getWikiPage, getWikiRevision, listWikiPages,
  getActiveWikiRevisions, listWikiFilePageEntries, listWikiJobs, listWikiPageEntries, listWikiSourceStates, removeWikiJob, removeWikiMarkdownCache,
  recoverWikiMarkdownJob, setWikiMeta, upsertWikiJob, WIKI_METADATA_CONFLICT,
} from '@/db/wiki'
import emitter from '@/lib/emitter'
import { collectMarkdownFiles, getAllMarkdownFiles } from '@/lib/files'
import { createRelativeMarkdownHref } from '@/lib/markdown-file-link'
import {
  editorPathsReferToSameFile, getCurrentEditorWorkspaceRoot, getEditorPathMutationRevision,
  markEditorPathMutation, prepareActiveEditorDeactivation,
  prepareActiveEditorPathMutationDurably, runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { getFilePathOptions } from '@/lib/workspace'
import { deleteSelfHostedWorkspacePath, writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import { WIKI_ROOT_FOLDER, wikiPageVersion, type WikiContext, type WikiPage, type WikiSharedSettings, type WikiSourceRevision, type WikiTopicCitation } from '@/types/wiki'
import { captureWikiWorkspaceGuard, getWikiContext, subscribeWikiWorkspaceChanges } from './context'
import { ensureWikiWorkspaceRelativePath } from './path'
import { getWikiSettings, mergeWikiSyncedSettings } from './settings'
import { compareWikiKeys, resolveWikiSourceReference, wikiHash } from './sources'
import { parseWikiMarkdown, preserveWikiFrontmatter, preserveWikiMarkdownBody, refreshWikiNavigation, serializeWikiIndexFile, serializeWikiPageFile, type WikiPageLinkTarget } from './file-format'

export { WIKI_ROOT_FOLDER } from '@/types/wiki'
const DEFAULT_INDEX_PATH = `${WIKI_ROOT_FOLDER}/索引.md`
const CATALOG_KEY = 'markdown-catalog'
interface WikiFileEntry { id: string; path: string; inputHash: string; hash: string; conflicted?: boolean }
let fileOperations: Promise<void> = Promise.resolve()
let treeRefresh: ReturnType<typeof setTimeout> | null = null
interface FileInventory { paths: Set<string>; checkedAt: number; wholeWorkspace: boolean }
interface PageIdentity {
  id: string
  title: string
  filePath?: string
  hash: string
  status: WikiPage['status']
  revisionSourceId?: string
}
interface FileSnapshot {
  signature: string | null
  page?: PageIdentity
  indexSettings?: WikiSharedSettings
  invalidOrigin?: string
  projectedHash?: string
  sourceVersion?: number
  originalSignature?: string | null
}
interface WorkspaceFileCache {
  snapshots: Map<string, FileSnapshot>
  changedPaths: Map<string, number>
  inventory?: FileInventory
  missingIndexPath?: string
  navigationDirty?: boolean
  contextId?: string
  projectionRevision: number
}
let workspaceFiles: WorkspaceFileCache | undefined
let observingWorkspace = false
let fileEventRevision = 0
let structureRevision = 0
const DISCOVERY_INTERVAL = 60_000

function resetFileCache() {
  fileEventRevision += 1 + (workspaceFiles?.projectionRevision ?? 0)
  workspaceFiles = undefined
  if (treeRefresh) {
    clearTimeout(treeRefresh)
    treeRefresh = null
  }
  structureRevision++
}

function currentFileCache(contextId?: string): WorkspaceFileCache {
  if (!observingWorkspace) {
    observingWorkspace = true
    subscribeWikiWorkspaceChanges(resetFileCache)
  }
  if (contextId && workspaceFiles?.contextId && workspaceFiles.contextId !== contextId) resetFileCache()
  const cache: WorkspaceFileCache = workspaceFiles ??= { snapshots: new Map(), changedPaths: new Map(), projectionRevision: 0 }
  if (contextId) cache.contextId = contextId
  return cache
}

export function getWikiFileCacheRevision(contextId: string): number {
  const cache = currentFileCache()
  return fileEventRevision + (cache.contextId === contextId ? cache.projectionRevision : 0)
}

/** Structural events invalidate discovery, including Wiki files moved outside Wiki/. */
export function noteWikiFileStructureChanged(path = '', previousPath?: string) {
  if (!/\.md$/i.test(path) || (previousPath && !/\.md$/i.test(previousPath))) {
    currentFileCache().inventory = undefined
    invalidateKnowledgeLexicalCache()
    structureRevision++
    fileEventRevision++
  }
  if (path) noteWikiMarkdownFileChanged(path)
  if (previousPath) noteWikiMarkdownFileChanged(previousPath)
}

/** Events provide exact paths; ordinary source files need not be reread on every Wiki lookup. */
export function noteWikiMarkdownFileChanged(path: string) {
  if (!/\.md$/i.test(path)) return
  try {
    const safePath = ensureWikiWorkspaceRelativePath(path)
    invalidateKnowledgeLexicalCache(`article:${safePath}`)
    currentFileCache().changedPaths.set(safePath, ++fileEventRevision)
  } catch { /* Invalid paths never reach disk. */ }
}

/** Null means this filesystem has no dependable timestamp, so verify its contents instead. */
export async function getWikiArticleFileSignature(path: string): Promise<string | null> {
  const options = await getFilePathOptions(ensureWikiWorkspaceRelativePath(path))
  if (!await exists(options.path, { baseDir: options.baseDir })) return 'missing'
  const info = await stat(options.path, { baseDir: options.baseDir })
  if (!info.isFile) return '!non-file'
  return info.mtime ? [info.size, info.mtime.getTime(), info.birthtime?.getTime(), info.dev, info.ino].join(':') : null
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = fileOperations.then(operation, operation)
  fileOperations = next.then(() => {}, () => {})
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
  const isActive = () => editorPathsReferToSameFile(articleStore.getState().activeFilePath, safePath, workspaceRoot)
  let writtenRevision = 0
  const accepted = await runEditorPathWriteTransaction(safePath, async ({ hasQueuedSave }) => {
    await assertContext(contextId)
    assertCurrent()
    if (hasQueuedSave() || await readFile(safePath) !== before) return false
    assertCurrent()
    if (isActive() && !prepareActiveEditorDeactivation()) return false
    const revisionBeforeWrite = getEditorPathMutationRevision(safePath, workspaceRoot)
    await persist(text)
    assertCurrent()
    if (getEditorPathMutationRevision(safePath, workspaceRoot) !== revisionBeforeWrite
      || (isActive() && !prepareActiveEditorDeactivation()) || hasQueuedSave()) {
      if (before !== null) await persist(before)
      else {
        const journaled = await deleteSelfHostedWorkspacePath(capturedAbsolutePath, 'file')
        assertCurrent()
        if (!journaled) await remove(options.path, { baseDir: options.baseDir })
      }
      return false
    }
    markEditorPathMutation(safePath, workspaceRoot)
    writtenRevision = getEditorPathMutationRevision(safePath, workspaceRoot)
    return true
  }, workspaceRoot)
  if (!accepted) throw new Error('WIKI_FILE_EDITED')
  await assertContext(contextId)
  assertCurrent()
  const article = articleStore.getState()
  article.markFileDirty(safePath)
  const active = isActive()
  const hasOpenTab = active || article.openTabs.some(tab => editorPathsReferToSameFile(tab.path, safePath, workspaceRoot))
  // A local edit can arrive after the write transaction releases its gate.
  if (hasOpenTab && getEditorPathMutationRevision(safePath, workspaceRoot) === writtenRevision) {
    if (active) {
      articleStore.setState({ currentArticle: text })
      emitter.emit('editor-file-content-updated', { path: safePath, content: text })
      emitter.emit('external-content-update', text)
    } else {
      emitter.emit('sync-content-updated', { path: safePath, content: text, workspaceRoot })
    }
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

function defaultPagePath(page: Pick<WikiPage, 'id' | 'kind' | 'title'>) {
  return `${WIKI_ROOT_FOLDER}/${page.kind === 'source' ? '来源摘要' : '主题'}/${safeTitle(page.title)}-${wikiHash(page.id).slice(0, 10)}.md`
}

async function getCatalog(contextId: string) {
  return await getWikiMeta<WikiFileEntry[]>(contextId, CATALOG_KEY) ?? []
}

/** Only the unique managed frontmatter field identifies the owner of a broken document. */
function readDamagedPageOrigin(text: string): string | undefined {
  if (!text.includes('notegen-wiki-origin:')) return undefined
  const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)(?:\r?\n---(?:\r?\n|$)|$)/.exec(text)?.[1]
  if (!header) return undefined
  const fields = header.split(/\r?\n/).filter(line => line.startsWith('notegen-wiki-origin:'))
  if (fields.length !== 1) return undefined
  return /^notegen-wiki-origin:[ \t]*(["']?)((?:source|topic):[a-f0-9]{64})\1(?:[ \t]+#[^\r\n]*)?[ \t]*$/.exec(fields[0])?.[2]
}

async function rememberFile(contextId: string, entry: WikiFileEntry) {
  const catalog = await getCatalog(contextId)
  const next = [...catalog.filter(item => item.id !== entry.id), entry].sort((a, b) => compareWikiKeys(a.id, b.id))
  await setWikiMeta(contextId, CATALOG_KEY, next)
}

async function backupEditedFile(contextId: string, path: string, content: string) {
  const filename = path.split('/').pop()?.replace(/\.md$/i, '') || 'Wiki'
  const backupPath = `${WIKI_ROOT_FOLDER}/备份/${filename}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`
  // It remains an ordinary, readable note but must not be imported as a second live Wiki page.
  const backup = content.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    header => header.replace(/^notegen-wiki-data:/gm, 'notegen-wiki-backup:'))
  await writeFile(contextId, backupPath, backup, null)
}

async function writePage(page: WikiPage, revision?: WikiSourceRevision): Promise<WikiPage> {
  await assertContext(page.contextId)
  const catalog = await getCatalog(page.contextId)
  const catalogued = catalog.find(item => item.id === page.id)
  const cached = await getWikiPage(page.contextId, page.id)
  const reservedPaths = await getWikiMeta<Record<string, string>>(page.contextId, 'markdown-page-paths') ?? {}
  let path = catalogued?.path || reservedPaths[page.id] || page.filePath || defaultPagePath(page)
  const forceKey = `markdown-overwrite:${page.id}`
  const force = await getWikiMeta<boolean>(page.contextId, forceKey)
  const { default: articleStore } = await import('@/stores/article')
  await articleStore.getState().flushPendingArticleSave(path)
  let previousText = await readFile(path)
  if (previousText === null && catalogued && (!force || catalogued.conflicted)) {
    throw new Error('WIKI_FILE_DELETED')
  }
  let previous = previousText ? parseWikiMarkdown(previousText, page.contextId) : null
  const knownPath = catalogued?.path === path || reservedPaths[page.id] === path
  if (previousText !== null && knownPath && (previous?.kind !== 'page' || previous.page.id !== page.id)) {
    const damaged = !previous && readDamagedPageOrigin(previousText) === page.id
    if (damaged && page.status !== 'ready') {
      if (force && page.kind === 'topic' && page.status === 'archived') throw new Error(WIKI_METADATA_CONFLICT)
      return { ...(cached ?? page), filePath: path, status: 'archived', body: '' }
    }
    if (!force) throw new Error(damaged ? WIKI_METADATA_CONFLICT : 'WIKI_FILE_EDITED')
    if (!damaged && (previous || !catalogued || catalogued.conflicted)) throw new Error('WIKI_FILE_EDITED')
    if (page.status !== 'ready') return { ...page, filePath: path }
    await backupEditedFile(page.contextId, path, previousText)
  }
  // Never replace an unrelated user file, including a colliding index or imported file.
  if (previousText !== null && !knownPath && (previous?.kind !== 'page' || previous.page.id !== page.id)) {
    const base = defaultPagePath(page).replace(/\.md$/, '')
    let suffix = 1
    do { path = `${base}-${suffix++}.md`; previousText = await readFile(path) } while (previousText !== null)
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
  const pages = await listWikiPageEntries(page.contextId)
  const knownPages: WikiPageLinkTarget[] = [...pages.filter(item => item.id !== next.id), next]
  // Reserve topic filenames before they are compiled so source pages can link to them.
  for (const contribution of revision?.contributions ?? []) {
    const id = `topic:${contribution.topicKey}`
    if (!knownPages.some(item => item.id === id)) knownPages.push({
      id, kind: 'topic', title: contribution.title, sourceRefs: [],
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
async function reconcileFiles(context: WikiContext, findMoved = false): Promise<boolean> {
  const isCurrent = captureWikiWorkspaceGuard()
  const assertCurrent = () => { if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED') }
  await assertContext(context.id)
  assertCurrent()
  const cache = currentFileCache(context.id)
  const initialStructure = structureRevision
  const [catalog, settings] = await Promise.all([getCatalog(context.id), getWikiSettings(context.id)])
  const catalogById = new Map(catalog.map(entry => [entry.id, entry]))
  const catalogPaths = new Set(catalog.map(entry => `${entry.id}\0${entry.path}`))
  const inventory = cache.inventory
  const wholeWorkspace = findMoved || (settings.enabled && settings.started)
  const discover = findMoved || !inventory || inventory.wholeWorkspace !== wholeWorkspace || Date.now() - inventory.checkedAt >= DISCOVERY_INTERVAL
  const paths = discover ? new Set<string>() : inventory.paths
  if (discover) {
    if (wholeWorkspace) {
      for (const file of await getAllMarkdownFiles()) paths.add(file.relativePath)
    } else {
      const root = await getFilePathOptions(WIKI_ROOT_FOLDER)
      if (await exists(root.path, { baseDir: root.baseDir })) {
        for (const file of await collectMarkdownFiles(WIKI_ROOT_FOLDER)) paths.add(file.path)
      }
    }
  }
  assertCurrent()
  const hints = new Map(cache.changedPaths)
  const snapshots = cache.snapshots
  const candidates = new Set([...paths].filter(path => !snapshots.has(path) || path.startsWith(`${WIKI_ROOT_FOLDER}/`) || hints.has(path)))
  // A periodic stat also discovers externally edited notes if their watcher event was missed.
  if (discover) for (const path of paths) candidates.add(path)
  for (const path of hints.keys()) candidates.add(path)
  for (const entry of catalog) candidates.add(entry.path)
  const indexPath = await getWikiMeta<string>(context.id, 'markdown-index-path')
  if (indexPath) candidates.add(indexPath)
  const [cachedPages, sourceStates] = await Promise.all([listWikiFilePageEntries(context.id), listWikiSourceStates(context.id)])
  const pagesById = new Map(cachedPages.map(page => [page.id, page]))
  const sourcesById = new Map(sourceStates.map(source => [source.stableId, source]))
  assertCurrent()
  const entries: WikiFileEntry[] = []
  const changedTopics = new Set<string>()
  const updatedNoteTopics = new Set<string>()
  let repairNavigation = cache.navigationDirty ?? false
  const found = new Set<string>()
  const settingsFiles: Array<{ path: string; settings: WikiSharedSettings }> = []
  const pageFiles: Array<{ path: string; page: PageIdentity; snapshot: FileSnapshot }> = []
  // Deterministic path order also resolves duplicate copies without merging prose.
  for (const path of [...candidates].sort(compareWikiKeys)) {
    assertCurrent()
    const signature = await getWikiArticleFileSignature(path)
    const previous = snapshots.get(path)
    let snapshot = previous
    if (hints.has(path) || !signature || !previous || previous.signature !== signature) {
      const text = signature === '!non-file' || signature === 'missing' ? null : await readFile(path)
      assertCurrent()
      const document = text && /^notegen-wiki-data:/m.test(text) ? parseWikiMarkdown(text, context.id) : null
      // Parsed titles and IDs can be substring views that retain the entire Markdown buffer.
      snapshot = structuredClone({
        signature, indexSettings: document?.kind === 'index' ? document.settings : undefined,
        page: document?.kind === 'page' && text ? {
          id: document.page.id, title: document.page.title, filePath: document.page.filePath,
          hash: wikiHash(text), status: document.page.status, revisionSourceId: document.revision?.source.stableId,
        } : undefined,
        invalidOrigin: !document && text ? readDamagedPageOrigin(text) : undefined,
        sourceVersion: previous?.sourceVersion,
        originalSignature: previous?.originalSignature, projectedHash: previous?.projectedHash,
      })
      snapshots.set(path, snapshot)
    }
    if (snapshot?.page) pageFiles.push({ path, page: snapshot.page, snapshot })
    if (snapshot?.indexSettings) settingsFiles.push({ path, settings: snapshot.indexSettings })
  }
  const scannedIds = new Set(pageFiles.map(file => file.page.id))
  const indexMissing = indexPath && !settingsFiles.length && snapshots.get(indexPath)?.signature === 'missing'
  const recoverIndex = indexMissing && cache.missingIndexPath !== indexPath
  assertCurrent()
  if (initialStructure !== structureRevision) return reconcileFiles(context, findMoved)
  if (!(discover && wholeWorkspace) && (recoverIndex || catalog.some(entry => !scannedIds.has(entry.id)
    && snapshots.get(entry.path)?.invalidOrigin !== entry.id))) {
    // A missed rename (including a whole directory) is not a deletion. Look outside Wiki/
    // once before writing tombstones, even if compilation is currently disabled.
    return reconcileFiles(context, true)
  }
  cache.missingIndexPath = indexMissing && indexPath ? indexPath : undefined
  for (const file of settingsFiles) await mergeWikiSyncedSettings(context.id, file.settings)
  if (settingsFiles.length) {
    const path = settingsFiles.find(file => file.path === indexPath)?.path || settingsFiles[0].path
    if (path !== indexPath) await setWikiMeta(context.id, 'markdown-index-path', path)
  }
  pageFiles.sort((left, right) => {
    const leftKnown = catalogPaths.has(`${left.page.id}\0${left.path}`)
    const rightKnown = catalogPaths.has(`${right.page.id}\0${right.path}`)
    return Number(rightKnown) - Number(leftKnown) || compareWikiKeys(left.path, right.path)
  })
  let jobsAdded = false
  for (const { path, page: identity, snapshot } of pageFiles) {
    assertCurrent()
    if (found.has(identity.id)) continue
    found.add(identity.id)
    const oldPage = pagesById.get(identity.id)
    const oldEntry = catalogById.get(identity.id)
    const beforeState = identity.revisionSourceId ? sourcesById.get(identity.revisionSourceId) : undefined
    const sourceHint = identity.revisionSourceId?.startsWith('article:')
      ? identity.revisionSourceId.slice('article:'.length) : undefined
    const originalSignature = sourceHint ? await getWikiArticleFileSignature(sourceHint) : undefined
    assertCurrent()
    const originalChanged = sourceHint
      ? !originalSignature || snapshot.originalSignature !== originalSignature || hints.has(sourceHint)
      : discover
    if (sourceHint && originalChanged) cache.projectionRevision++
    if (oldPage?.filePath !== path || oldPage?.title !== identity.title || identity.filePath !== path) repairNavigation = true
    const changed = !oldEntry || oldEntry.conflicted || oldEntry.path !== path || oldEntry.hash !== identity.hash
      || snapshot.projectedHash !== identity.hash
    const needsRecovery = oldPage?.status === 'archived' && !oldPage.hasBody && identity.status !== 'archived'
    if (oldEntry && !changed && oldPage?.filePath === path && !needsRecovery
      && (!identity.revisionSourceId || (snapshot.sourceVersion === beforeState?.version && !originalChanged))) {
      entries.push({ ...oldEntry })
      continue
    }

    // The signature cache owns no Markdown bodies. Import only the selected copy, from disk.
    const text = await readFile(path)
    assertCurrent()
    if (!text || wikiHash(text) !== identity.hash) {
      snapshots.delete(path)
      throw new Error('WIKI_FILE_EDITED')
    }
    const document = parseWikiMarkdown(text, context.id)
    if (document?.kind !== 'page' || document.page.id !== identity.id) throw new Error('WIKI_FILE_EDITED')
    const page = { ...document.page, contextId: context.id, filePath: path }
    let revision = document.revision
    const entry = { id: page.id, path, inputHash: page.inputHash, hash: identity.hash }
    if (oldEntry && (oldEntry.conflicted || needsRecovery)) {
      repairNavigation = true
      if (page.sourceRefs.every(source => source.sourceType === 'article')
        && await recoverWikiMarkdownJob(page, oldEntry.inputHash)) jobsAdded = true
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
    const { sourceState: afterState, pageChanged } = await cacheWikiMarkdownDocument(page, revision, originalAvailable)
    if (afterState) sourcesById.set(afterState.stableId, afterState)
    snapshot.sourceVersion = afterState?.version
    snapshot.originalSignature = originalSignature
    snapshot.projectedHash = identity.hash
    if (changed || pageChanged || beforeState?.version !== afterState?.version) {
      cache.projectionRevision++
    }
    pagesById.set(identity.id, structuredClone({
      id: page.id, kind: page.kind, title: page.title, filePath: page.filePath, status: page.status,
      sourceRefs: page.sourceRefs, inputHash: page.inputHash, outputHash: page.outputHash, hasBody: Boolean(page.body),
    }))
    const activated = afterState?.status === 'ready' && (beforeState?.revisionId !== afterState.revisionId || beforeState?.status !== 'ready')
    if (revision?.source.sourceType === 'article' && (oldPage?.outputHash !== page.outputHash || activated)) {
      const oldRevision = beforeState?.revisionId ? await getWikiRevision(context.id, beforeState.revisionId) : null
      for (const contribution of [...revision.contributions, ...(oldRevision?.contributions ?? [])]) {
        changedTopics.add(contribution.topicKey)
        if (oldPage && oldPage.outputHash !== page.outputHash) updatedNoteTopics.add(contribution.topicKey)
      }
    }
    entries.push(entry)
  }
  const previousDeleted = await getWikiMeta<Record<string, string>>(context.id, 'markdown-deleted') ?? {}
  const previousDeletedPaths = await getWikiMeta<string[]>(context.id, 'markdown-deleted-paths') ?? []
  const deleted = { ...previousDeleted }
  const deletedPaths = new Set(previousDeletedPaths)
  for (const old of catalog) if (!found.has(old.id)) {
    if (snapshots.get(old.path)?.invalidOrigin === old.id) {
      assertCurrent()
      let page = await getWikiPage(context.id, old.id)
      const missingProjection = !page
      if (!page) {
        // A crash can leave a filename reservation committed ahead of its SQLite page.
        const topic = old.id.startsWith('topic:')
        const source = topic ? undefined : sourceStates.find(state => `source:${wikiHash(state.stableId)}` === old.id)?.source
          ?? (await findWikiRevision(context.id, old.inputHash))?.source
        if (topic || (source && `source:${wikiHash(source.stableId)}` === old.id)) {
          page = { id: old.id, contextId: context.id, kind: topic ? 'topic' : 'source', status: 'archived',
            title: source?.title || old.path.split('/').pop() || old.id, filePath: old.path, body: '', aliases: [],
            sourceRefs: source ? [source] : [], relatedPageIds: [], inputHash: old.inputHash, outputHash: wikiHash(''),
            updatedAt: Date.now(), topicKey: topic ? old.id.slice('topic:'.length) : undefined }
        }
      }
      const changed = page && await cacheWikiMarkdownConflict(page, missingProjection)
      if (!old.conflicted || changed) cache.projectionRevision++
      if (!old.conflicted) repairNavigation = true
      entries.push({ ...old, conflicted: true })
      delete deleted[old.id]
      continue
    }
    repairNavigation = true
    deleted[old.id] = old.inputHash
    deletedPaths.add(old.path)
    assertCurrent()
    const page = pagesById.get(old.id)
    if (page?.kind === 'source') for (const ref of page.sourceRefs) {
      if (ref.sourceType === 'article') {
        const state = sourcesById.get(ref.stableId)
        const revision = state?.revisionId ? await getWikiRevision(context.id, state.revisionId) : null
        for (const contribution of revision?.contributions ?? []) changedTopics.add(contribution.topicKey)
      }
      await setWikiMeta(context.id, `markdown-deleted-source:${ref.stableId}`, ref.contentHash)
    }
    await removeWikiMarkdownCache(context.id, old.id, old.inputHash)
    if (page?.kind === 'source') for (const ref of page.sourceRefs) {
      await removeWikiJob(context.id, `source:${ref.stableId}`, page.inputHash)
    }
    if (page?.kind === 'topic') await removeWikiJob(context.id, page.id, page.inputHash)
    pagesById.delete(old.id)
    cache.projectionRevision++
  }
  for (const id of found) delete deleted[id]
  for (const entry of entries) deletedPaths.delete(entry.path)
  if (repairNavigation) {
    cache.navigationDirty = false
    const livePages = [...pagesById.values()].filter(page => found.has(page.id))
    for (const entry of entries) {
      assertCurrent()
      const snapshot = snapshots.get(entry.path)
      if (snapshot?.page?.id !== entry.id) continue
      const text = await readFile(entry.path)
      assertCurrent()
      if (!text || wikiHash(text) !== entry.hash) {
        snapshots.delete(entry.path)
        cache.navigationDirty = true
        continue
      }
      const next = refreshWikiNavigation(text, entry.path, livePages)
      if (next === text) continue
      try {
        await writeFile(context.id, entry.path, next, text)
        snapshot.page.filePath = entry.path
        snapshot.signature = await getWikiArticleFileSignature(entry.path)
        entry.hash = wikiHash(next)
        snapshot.page.hash = entry.hash
      } catch (error) {
        if (!(error instanceof Error) || !['WIKI_FILE_EDITED', 'WIKI_FILE_DELETED'].includes(error.message)) throw error
        // An active editor owns its prose; retry only this managed block later.
        cache.navigationDirty = true
      }
    }
  }
  await assertContext(context.id)
  assertCurrent()
  if (JSON.stringify(catalog) !== JSON.stringify(entries)) await setWikiMeta(context.id, CATALOG_KEY, entries)
  if (JSON.stringify(deleted) !== JSON.stringify(previousDeleted)) await setWikiMeta(context.id, 'markdown-deleted', deleted)
  const sortedDeletedPaths = [...deletedPaths].sort(compareWikiKeys)
  if (JSON.stringify(sortedDeletedPaths) !== JSON.stringify(previousDeletedPaths)) {
    await setWikiMeta(context.id, 'markdown-deleted-paths', sortedDeletedPaths)
  }
  if (discover) {
    const retainedPaths = new Set(entries.map(entry => entry.path))
    for (const path of snapshots.keys()) {
      if (!paths.has(path) && !hints.has(path) && !retainedPaths.has(path) && path !== indexPath) snapshots.delete(path)
    }
  }
  // Cache imports may change topic dependencies (including handwritten edits).
  // Schedule jobs directly: calling a page writer while holding this file lock
  // would recursively acquire it. Current topic files are kept until rebuilt.
  if (changedTopics.size) {
    const settings = await getWikiSettings(context.id)
    const revisions = (await getActiveWikiRevisions(context.id)).filter(revision => revision.source.sourceType === 'article')
    const jobs = await listWikiJobs(context.id)
    const { buildWikiTopicInputHash } = await import('./compiler')
    for (const key of changedTopics) {
      const topic = await getWikiPage(context.id, `topic:${key}`)
      // Importing an existing file into an empty cache does not rewrite old topics.
      if (topic?.sourceRefs.some(source => source.sourceType !== 'article') && !updatedNoteTopics.has(key)) continue
      const generation = Math.max(settings.generation, topic?.generation ?? 0,
        await getWikiMeta<number>(context.id, `topic-generation:${key}`) ?? 0)
      const inputHash = buildWikiTopicInputHash(key, revisions, generation, settings.language)
      if (topic?.status === 'ready' && topic.inputHash === inputHash) continue
      if (deleted[`topic:${key}`] === inputHash) continue
      const previousJob = jobs.find(job => job.id === `topic:${key}`)
      if (previousJob?.error === WIKI_METADATA_CONFLICT) continue
      if (previousJob?.inputHash === inputHash) continue
      await upsertWikiJob({ id: `topic:${key}`, contextId: context.id, sourceKey: key, kind: 'topic',
        inputHash, status: 'pending', stage: 'topic', attempts: 0, readyAt: Date.now() + 1000,
        updatedAt: Date.now(), error: null })
      jobsAdded = true
    }
  }
  assertCurrent()
  if (discover && initialStructure === structureRevision) cache.inventory = { paths, checkedAt: Date.now(), wholeWorkspace }
  for (const [path, event] of hints) if (cache.changedPaths.get(path) === event) cache.changedPaths.delete(path)
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
  if (previous !== null && parseWikiMarkdown(previous, contextId)?.kind !== 'index') {
    // A user may be repairing the remembered index in source mode.
    if (rememberedPath === path) return path
    let suffix = 1
    do { path = `${WIKI_ROOT_FOLDER}/索引-${suffix++}.md`; previous = await readFile(path) } while (previous !== null)
  }
  const pages = (await listWikiPageEntries(contextId)).filter(page => page.status !== 'archived' && page.filePath)
  const link = (page: WikiPageLinkTarget) => {
    const title = page.title.replace(/[\r\n]+/g, ' ').replace(/([\\[\]*_`])/g, '\\$1')
    return `- [${title}](<${createRelativeMarkdownHref(path, page.filePath!)}>)`
  }
  const links = (kind: WikiPage['kind']) => pages.filter(page => page.kind === kind)
    .sort((a, b) => compareWikiKeys(a.title, b.title) || compareWikiKeys(a.id, b.id)).map(link)
  const text = serializeWikiIndexFile(sharedSettings(settings), { topic: links('topic'), source: links('source') }, previous)
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

async function readRegisteredWikiPage(contextId: string, pageId: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  if (context.id !== contextId || !isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  const readEntry = async () => {
    const entry = (await getCatalog(contextId)).find(item => item.id === pageId)
    if (!entry || !isCurrent()) return null
    const text = await readFile(entry.path)
    const document = text && parseWikiMarkdown(text, contextId)
    return isCurrent() && document && document.kind === 'page' && document.page.id === pageId
      ? { document, path: entry.path } : null
  }
  const existing = await readEntry()
  if (existing || !isCurrent()) return existing
  await reconcileWikiFiles(context)
  return readEntry()
}

export async function getWikiPageFilePath(contextId: string, pageId: string, version?: string): Promise<string | null> {
  const entry = await readRegisteredWikiPage(contextId, pageId)
  return entry && (!version || wikiPageVersion(entry.document.page) === version) ? entry.path : null
}

/** Read the supporting quotes from the matching Markdown, including manually edited excerpts. */
export async function readWikiTopicCitation(filePath: string, citation: WikiTopicCitation) {
  const isCurrent = captureWikiWorkspaceGuard()
  const topic = await getWikiPageForFilePath(filePath)
  if (!isCurrent() || topic?.kind !== 'topic' || topic.id !== citation.pageId) return null
  const source = topic.sourceRefs[citation.number - 1]
  if (!source || source.stableId !== citation.source.stableId || source.contentHash !== citation.source.contentHash) return null

  const pageId = `source:${wikiHash(source.stableId)}`
  // The topic can still point to an available original when its separate summary is missing.
  const entry = await readRegisteredWikiPage(topic.contextId, pageId).catch(() => null)
  if (!isCurrent()) return null
  const revision = entry?.document.revision
  const verified = revision && revision.source.stableId === source.stableId && revision.source.contentHash === source.contentHash
    ? revision : null
  const topicKey = topic.topicKey ?? topic.id.slice('topic:'.length)
  const quotes = verified?.contributions.filter(item => item.topicKey === topicKey)
    .flatMap(item => item.evidence.map(evidence => evidence.quote)).filter(quote => quote.trim()) ?? []
  return {
    contextId: topic.contextId, source, quotes: [...new Set(quotes)],
    summary: entry && verified ? { pageId, version: wikiPageVersion(entry.document.page) } : null,
  }
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
