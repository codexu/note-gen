import { ensureLocalLibraryFile } from '@/lib/sync/remote-library'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from '@/lib/wiki/context'
import { ensureWikiIndexFile, getWikiPageFilePath } from '@/lib/wiki/files'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'

/** Open the Markdown source of a Wiki page in the existing article editor. */
export async function openWikiPage(pageId?: string, mobile = window.location.pathname.startsWith('/mobile'), expectedContextId?: string): Promise<string | null> {
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  const context = expectedContextId ? await assertWikiContextCurrent(expectedContextId) : await getWikiContext()
  const assertCurrent = async () => {
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  await assertCurrent()
  const path = pageId
    ? await getWikiPageFilePath(context.id, pageId)
    : await ensureWikiIndexFile(context.id)
  await assertCurrent()
  if (!path || !await ensureLocalLibraryFile(path)) return null
  await assertCurrent()

  const article = useArticleStore.getState()
  await article.ensurePathExpanded(path)
  await assertCurrent()
  await article.loadFileTree({ skipRemoteSync: true })
  await assertCurrent()
  await article.setActiveFilePath(path, true, mobile ? undefined : { tabOpenMode: 'pinned' })
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

/** The folder index is an ordinary Markdown note, not a dedicated Wiki view. */
export function openWikiFolder(mobile?: boolean, expectedContextId?: string): Promise<string | null> {
  return openWikiPage(undefined, mobile, expectedContextId)
}

