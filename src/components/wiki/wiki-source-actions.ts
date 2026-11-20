import { mkdir } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { WIKI_ROOT_FOLDER } from '@/types/wiki'
import { ensureLocalLibraryFile } from '@/lib/sync/remote-library'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from '@/lib/wiki/context'
import { ensureWikiIndexFile, getWikiPageFilePath } from '@/lib/wiki/files'
import { ensureWikiWorkspaceRelativePath } from '@/lib/wiki/path'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'

type WikiDestination = { kind: 'folder' } | { kind: 'page'; pageId?: string; version?: string } | { kind: 'file'; path: string }

async function openWikiDestination(destination: WikiDestination, mobile: boolean, expectedContextId?: string): Promise<string | null> {
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  const context = expectedContextId ? await assertWikiContextCurrent(expectedContextId) : await getWikiContext()
  const assertCurrent = async () => {
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  await assertCurrent()
  const directory = destination.kind === 'folder' && !mobile
  let path: string
  if (directory) {
    path = WIKI_ROOT_FOLDER
    const options = await getFilePathOptions(path)
    await assertCurrent()
    await mkdir(options.path, { baseDir: options.baseDir, recursive: true })
  } else {
    const filePath = destination.kind === 'file' ? ensureWikiWorkspaceRelativePath(destination.path)
      : destination.kind === 'page' && destination.pageId ? await getWikiPageFilePath(context.id, destination.pageId, destination.version)
        : await ensureWikiIndexFile(context.id)
    await assertCurrent()
    if (!filePath || !await ensureLocalLibraryFile(filePath)) return null
    path = filePath
  }
  await assertCurrent()

  const article = useArticleStore.getState()
  await article.ensurePathExpanded(path)
  await assertCurrent()
  await article.loadFileTree({ skipRemoteSync: true })
  await assertCurrent()
  await article.setActiveFilePath(path, true, {
    createIfMissing: false,
    tabOpenMode: mobile ? undefined : 'pinned',
    tabMetadata: directory ? { name: WIKI_ROOT_FOLDER, isFolder: true } : undefined,
  })
  await assertCurrent()
  if (useArticleStore.getState().activeFilePath !== path) return null
  article.setPendingFileRevealPath(path)
  if (!mobile) {
    const sidebar = useSidebarStore.getState()
    await sidebar.setLeftSidebarTab('files')
    await assertCurrent()
    if (!sidebar.leftSidebarVisible) await sidebar.toggleLeftSidebar()
    await assertCurrent()
    await sidebar.showCenterPanel()
  }
  await assertCurrent()
  return mobile ? '/mobile/writing' : '/core/main'
}

export function openWikiPage(pageId?: string, mobile = window.location.pathname.startsWith('/mobile'), expectedContextId?: string, pageVersion?: string) {
  return openWikiDestination({ kind: 'page', pageId, version: pageVersion }, mobile, expectedContextId)
}

export function openWikiFolder(mobile = window.location.pathname.startsWith('/mobile'), expectedContextId?: string) {
  return openWikiDestination({ kind: 'folder' }, mobile, expectedContextId)
}

/** A conflicted file may have lost the metadata normally used to resolve a Wiki page. */
export function openWikiConflictFile(path: string, mobile: boolean, expectedContextId: string) {
  return openWikiDestination({ kind: 'file', path }, mobile, expectedContextId)
}
