'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { ArrowUp, FileText, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import emitter from '@/lib/emitter'
import { getCurrentFolder } from '@/lib/path'
import { ensureLocalLibraryFile } from '@/lib/sync/remote-library'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { WIKI_ROOT_FOLDER, type WikiPage } from '@/types/wiki'

type Entry = { name: string; isDirectory: boolean }

export async function openWikiDirectoryEntry(path: string, isDirectory: boolean, contextId: string) {
  const current = captureWikiWorkspaceGuard()
  await assertWikiContextCurrent(contextId)
  if (!current()) return
  if (!isDirectory && !await ensureLocalLibraryFile(path)) throw new Error('WIKI_SOURCE_NOT_FOUND')
  if (!current()) return
  await useArticleStore.getState().setActiveFilePath(path, true, {
    createIfMissing: false, tabOpenMode: 'pinned', tabMetadata: { name: path.split('/').pop() || path, isFolder: isDirectory },
  })
}

export function WikiDirectoryFiles({ path, contextId, pages }: { path: string; contextId: string; pages: WikiPage[] }) {
  const t = useTranslations('wiki.folder')
  const wiki = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const tree = useArticleStore(state => state.fileTree)
  const folder = getCurrentFolder(path, tree)
  const folderNeedsLoading = Boolean(folder && !folder.childrenLoaded)
  const [local, setLocal] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)
  const isRoot = path === WIKI_ROOT_FOLDER

  useEffect(() => {
    if (folderNeedsLoading) void useArticleStore.getState().loadCollapsibleFiles(path).catch(() => {})
  }, [path, folderNeedsLoading])

  useEffect(() => {
    let active = true
    let revision = 0
    const current = captureWikiWorkspaceGuard()
    const refresh = async () => {
      const request = ++revision
      try {
        await assertWikiContextCurrent(contextId)
        const file = await getFilePathOptions(path)
        const entries = await exists(file.path, { baseDir: file.baseDir }) ? await readDir(file.path, { baseDir: file.baseDir }) : []
        if (!active || !current() || request !== revision) return
        setLocal(entries.filter(entry => !entry.isSymlink && !entry.name.startsWith('.') && (entry.isFile || entry.isDirectory)))
        setError(null)
      } catch (cause) {
        if (active && current() && request === revision) setError(errorMessage(cause))
      }
    }
    const within = (file: string) => file === path || (file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
    const onChange = (event: { path: string; previousPath?: string; kind?: string }) => {
      if (event.kind === 'rescan' || within(event.path) || (event.previousPath && within(event.previousPath))) void refresh()
    }
    const onMove = (event: { oldPath: string; newPath: string }) => onChange({ path: event.newPath, previousPath: event.oldPath })
    void refresh()
    emitter.on('workspace-file-changed', onChange)
    emitter.on('article-saved', onChange)
    emitter.on('editor-navigation-path-moved', onMove)
    emitter.on('editor-navigation-path-deleted', onChange)
    return () => {
      active = false
      emitter.off('workspace-file-changed', onChange)
      emitter.off('article-saved', onChange)
      emitter.off('editor-navigation-path-moved', onMove)
      emitter.off('editor-navigation-path-deleted', onChange)
    }
  }, [path, contextId, errorMessage])

  const entries = new Map((folder?.children ?? []).filter(entry => !entry.isLocale && !entry.isSymlink && !entry.name.startsWith('.'))
    .map(entry => [entry.name, { name: entry.name, isDirectory: entry.isDirectory }]))
  for (const entry of local ?? []) entries.set(entry.name, entry)
  const titles = new Map(pages.map(page => [page.filePath, page.title]))
  const items = [...entries.values()].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  const open = async (target: string, directory: boolean) => {
    const current = captureWikiWorkspaceGuard()
    try { await openWikiDirectoryEntry(target, directory, contextId) }
    catch (cause) { if (current()) toast.error(wiki('loadFailed'), { description: errorMessage(cause) }) }
  }
  const label = (name: string) => isRoot && name === '备份' ? t('backups')
    : isRoot && name === '主题' ? t('topics') : isRoot && name === '来源摘要' ? t('summaries') : name

  return <section className="flex flex-col gap-3" aria-label={t('files')}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-base font-medium">{t('files')}</h3>
      {!isRoot ? <Button variant="ghost" size="sm" onClick={() => void open(path.slice(0, path.lastIndexOf('/')), true)}>
        <ArrowUp data-icon="inline-start" />{t('upFolder')}
      </Button> : null}
    </div>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {items.slice(0, limit).map(entry => {
      const target = `${path}/${entry.name}`
      const Icon = entry.isDirectory ? Folder : FileText
      return <Button key={target} variant="outline" className="justify-start" onClick={() => void open(target, entry.isDirectory)}>
        <Icon data-icon="inline-start" /><span className="truncate" title={entry.name}>{titles.get(target) || label(entry.name)}</span>
      </Button>
    })}
    {items.length > limit ? <Button variant="ghost" size="sm" onClick={() => setLimit(value => value + 50)}>{t('showMore')}</Button> : null}
    {!items.length && !error ? <Empty className="p-4"><EmptyHeader><EmptyTitle>{local ? t('emptyFolder') : wiki('scopeLoading')}</EmptyTitle></EmptyHeader></Empty> : null}
  </section>
}
