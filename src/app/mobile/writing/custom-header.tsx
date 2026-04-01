'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaseDirectory, exists, mkdir, remove, rename as fsRename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import type { Editor } from '@tiptap/react'
import { ChevronLeft, FilePlus, Folder, FolderPlus, List, Pencil, Redo2, RefreshCw, Search, SearchCode, Trash2, Undo2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { getFilePathOptions } from '@/lib/workspace'
import { EntryListItem } from './entry-list-item'
import { NameInputDialog } from './name-input-dialog'
import { BrowserEntry } from './types'
import { getChildrenByPath, getNodeByPath, isMarkdownFile, normalizePath, parentPath } from './browser-utils'
import { deleteFile } from '@/lib/sync/github'
import { deleteFile as deleteGiteeFile } from '@/lib/sync/gitee'
import { deleteFile as deleteGitlabFile } from '@/lib/sync/gitlab'
import { deleteFile as deleteGiteaFile } from '@/lib/sync/gitea'
import { s3Delete } from '@/lib/sync/s3'
import { webdavDelete } from '@/lib/sync/webdav'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { RepoNames } from '@/lib/sync/github.types'
import { Store } from '@tauri-apps/plugin-store'
import { S3Config, WebDAVConfig } from '@/types/sync'

interface WritingHeaderProps {
  editor: Editor | null
}

function shouldLoadRemoteOnTreeRefresh(options?: { isCreateFlow?: boolean }) {
  return options?.isCreateFlow !== true
}

export function WritingHeader({ editor }: WritingHeaderProps) {
  const t = useTranslations('record.chat.input.fileLink')
  const tFile = useTranslations('article.file')
  const tContext = useTranslations('article.file.context')
  const tMobile = useTranslations('article.file.mobile')
  const tToolbar = useTranslations('article.file.toolbar')
  const {
    activeFilePath,
    setActiveFilePath,
    readArticle,
    fileTree,
    fileTreeLoading,
    loadFileTree,
    loadRemoteSyncFiles,
    loadCollapsibleFiles,
    loadFolderRemoteFiles,
    setCollapsibleList,
  } = useArticleStore()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentDir, setCurrentDir] = useState('')
  const [folderLoading, setFolderLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [entryMetaMap, setEntryMetaMap] = useState<Record<string, { modifiedAt?: string; size?: number }>>({})
  const hasInitializedDrawerRef = useRef(false)

  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)

  const [renameTarget, setRenameTarget] = useState<BrowserEntry | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [undoRedoState, setUndoRedoState] = useState({ undo: false, redo: false })

  const normalizedActivePath = normalizePath(activeFilePath)

  const canUndo = editor ? undoRedoState.undo : false
  const canRedo = editor ? undoRedoState.redo : false

  useEffect(() => {
    if (!editor) {
      setUndoRedoState({ undo: false, redo: false })
      return
    }

    setUndoRedoState({
      undo: editor.can().undo(),
      redo: editor.can().redo(),
    })

    const handleUndoRedoChanged = (state: { undo: boolean; redo: boolean }) => {
      setUndoRedoState(state)
    }

    emitter.on('editor-undo-redo-changed', handleUndoRedoChanged)
    return () => {
      emitter.off('editor-undo-redo-changed', handleUndoRedoChanged)
    }
  }, [editor])

  const currentDirLabel = useMemo(() => {
    if (!currentDir) return tMobile('root')
    return currentDir.split('/').pop() || currentDir
  }, [currentDir, tMobile])

  const currentFolderNode = useMemo(() => getNodeByPath(fileTree, currentDir), [fileTree, currentDir])

  const rawEntries = useMemo(() => {
    const children = getChildrenByPath(fileTree, currentDir)
    return children
      .filter((node) => node.isDirectory || isMarkdownFile(node))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
  }, [fileTree, currentDir])

  const visibleEntries = useMemo(() => {
    const mapped: BrowserEntry[] = rawEntries.map((node) => {
      const relativePath = currentDir ? `${currentDir}/${node.name}` : node.name
      const children = node.children ?? []
      const fileCount = children.length > 0 ? children.filter((item) => item.isFile).length : undefined
      const folderCount = children.length > 0 ? children.filter((item) => item.isDirectory).length : undefined

      return {
        name: node.name,
        type: node.isDirectory ? 'folder' : 'file',
        relativePath: normalizePath(relativePath),
        isLocale: node.isLocale,
        sha: node.sha,
        isLoading: node.loading,
        modifiedAt: node.modifiedAt,
        size: (node as any).size,
        fileCount,
        folderCount,
      }
    })

    if (!searchQuery.trim()) return mapped
    const query = searchQuery.toLowerCase()
    return mapped.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(query) ||
        entry.relativePath.toLowerCase().includes(query)
      )
    })
  }, [rawEntries, currentDir, searchQuery])

  useEffect(() => {
    if (!drawerOpen) return

    const localEntries = rawEntries.filter((node) => node.isLocale)
    if (localEntries.length === 0) return

    const loadEntryMeta = async () => {
      const updates: Record<string, { modifiedAt?: string; size?: number }> = {}

      for (const node of localEntries) {
        const relativePath = normalizePath(currentDir ? `${currentDir}/${node.name}` : node.name)
        const hasModifiedAt = !!node.modifiedAt
        const hasSize = node.isFile && typeof (node as any).size === 'number'

        if (hasModifiedAt && hasSize) continue

        try {
          const pathOptions = await getFilePathOptions(relativePath)
          const fileStat = pathOptions.baseDir
            ? await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
            : await stat(pathOptions.path)

          updates[relativePath] = {
            modifiedAt: fileStat.mtime?.toISOString(),
            size: fileStat.size,
          }
        } catch {
        }
      }

      if (Object.keys(updates).length > 0) {
        setEntryMetaMap((prev) => ({ ...prev, ...updates }))
      }
    }

    loadEntryMeta()
  }, [drawerOpen, rawEntries, currentDir])

  const formatDateTime = useCallback((value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }, [])

  const formatSize = useCallback((bytes?: number) => {
    if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return ''
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024
      index += 1
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
  }, [])

  const getEntrySubtitle = useCallback((entry: BrowserEntry) => {
    const meta = entryMetaMap[entry.relativePath]
    const modifiedAt = entry.modifiedAt || meta?.modifiedAt
    const size = typeof entry.size === 'number' ? entry.size : meta?.size

    if (!entry.isLocale) {
      if (entry.type === 'file') {
        const metaParts = [formatDateTime(modifiedAt), formatSize(size)].filter(Boolean)
        return metaParts.length > 0
          ? `${tMobile('remoteFileNotPulled')} · ${metaParts.join(' · ')}`
          : tMobile('remoteFileNotPulled')
      }

      const remoteFolderSummary = (
        typeof entry.fileCount === 'number' &&
        typeof entry.folderCount === 'number'
      )
        ? tMobile('folderChildren', { files: entry.fileCount, folders: entry.folderCount })
        : tMobile('remoteFolderOnly')
      const modifiedLabel = formatDateTime(modifiedAt)
      return modifiedLabel ? `${remoteFolderSummary} · ${modifiedLabel}` : remoteFolderSummary
    }

    if (entry.type === 'file') {
      const parts = [formatDateTime(modifiedAt), formatSize(size)].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : tMobile('file')
    }

    const folderSummary = (
      typeof entry.fileCount === 'number' &&
      typeof entry.folderCount === 'number'
    )
      ? tMobile('folderChildren', { files: entry.fileCount, folders: entry.folderCount })
      : tMobile('folder')

    const modifiedLabel = formatDateTime(modifiedAt)
    return modifiedLabel ? `${folderSummary} · ${modifiedLabel}` : folderSummary
  }, [entryMetaMap, formatDateTime, formatSize, tMobile])

  const isBrowserLoading = fileTreeLoading || folderLoading || isRefreshing || !!currentFolderNode?.loading

  const refreshTree = useCallback(async (
    dir: string,
    options: { includeRemote?: boolean } = {}
  ) => {
    const { includeRemote = true } = options
    setIsRefreshing(true)
    try {
      const parts = dir.split('/').filter(Boolean)
      const pathsToExpand = parts.map((_, index) => parts.slice(0, index + 1).join('/'))

      for (const path of pathsToExpand) {
        await setCollapsibleList(path, true)
      }

      await loadFileTree({ skipRemoteSync: true })
      if (includeRemote) {
        await loadRemoteSyncFiles()
      }

      if (!dir) {
        return
      }

      for (const path of pathsToExpand) {
        await loadCollapsibleFiles(path)
        if (includeRemote) {
          await loadFolderRemoteFiles(path)
        }
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [loadFileTree, loadRemoteSyncFiles, loadCollapsibleFiles, loadFolderRemoteFiles, setCollapsibleList])

  useEffect(() => {
    if (!drawerOpen) {
      hasInitializedDrawerRef.current = false
      return
    }

    if (hasInitializedDrawerRef.current) return
    hasInitializedDrawerRef.current = true

    const initialDir = parentPath(normalizedActivePath)
    setCurrentDir(initialDir)
    setSearchQuery('')

    const init = async () => {
      if (fileTree.length === 0) {
        await loadFileTree()
      }
      if (initialDir) {
        await setCollapsibleList(initialDir, true)
        await loadCollapsibleFiles(initialDir)
      }
    }

    init()
  }, [drawerOpen, normalizedActivePath, loadFileTree, loadCollapsibleFiles, setCollapsibleList, fileTree.length])

  const ensureLocalFolder = useCallback(async (dir: string) => {
    if (!dir) return
    const parentPathOptions = await getFilePathOptions(dir)
    const parentExists = parentPathOptions.baseDir
      ? await exists(parentPathOptions.path, { baseDir: parentPathOptions.baseDir })
      : await exists(parentPathOptions.path)

    if (!parentExists) {
      if (parentPathOptions.baseDir) {
        await mkdir(parentPathOptions.path, { baseDir: parentPathOptions.baseDir, recursive: true })
      } else {
        await mkdir(parentPathOptions.path, { recursive: true })
      }
    }
  }, [])

  const enterFolder = async (path: string) => {
    setFolderLoading(true)
    try {
      await setCollapsibleList(path, true)
      await loadCollapsibleFiles(path)
      await loadFolderRemoteFiles(path)
      setCurrentDir(path)
      setSearchQuery('')
    } finally {
      setFolderLoading(false)
    }
  }

  const openEntry = async (entry: BrowserEntry) => {
    if (entry.type === 'folder') {
      await enterFolder(entry.relativePath)
      return
    }

    await setActiveFilePath(entry.relativePath)
    await readArticle(entry.relativePath)
    setDrawerOpen(false)
  }

  const handleCreateConfirm = async () => {
    if (!createType || creating) return

    const rawName = createName.trim()
    if (!rawName) return

    setCreating(true)
    try {
      await ensureLocalFolder(currentDir)

      if (createType === 'file') {
        let fileNameToCreate = rawName
        if (!fileNameToCreate.endsWith('.md')) {
          fileNameToCreate = `${fileNameToCreate}.md`
        }

        const relativePath = currentDir ? `${currentDir}/${fileNameToCreate}` : fileNameToCreate
        const pathOptions = await getFilePathOptions(relativePath)
        const fileExists = pathOptions.baseDir
          ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          : await exists(pathOptions.path)

        if (!fileExists) {
          if (pathOptions.baseDir) {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          } else {
            await writeTextFile(pathOptions.path, '')
          }
          await refreshTree(currentDir, {
            includeRemote: shouldLoadRemoteOnTreeRefresh({ isCreateFlow: true })
          })
          await setActiveFilePath(relativePath)
          setDrawerOpen(false)
        }
      } else {
        const relativePath = currentDir ? `${currentDir}/${rawName}` : rawName
        const pathOptions = await getFilePathOptions(relativePath)
        const folderExists = pathOptions.baseDir
          ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          : await exists(pathOptions.path)

        if (!folderExists) {
          if (pathOptions.baseDir) {
            await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
          } else {
            await mkdir(pathOptions.path, { recursive: true })
          }
          await refreshTree(currentDir, {
            includeRemote: shouldLoadRemoteOnTreeRefresh({ isCreateFlow: true })
          })
        }
      }

      setCreateType(null)
      setCreateName('')
    } finally {
      setCreating(false)
    }
  }

  const startRename = (entry: BrowserEntry) => {
    if (!entry.isLocale) {
      toast({ title: tFile('clipboard.notSupported') })
      return
    }
    const initialName = entry.type === 'file' && entry.name.endsWith('.md')
      ? entry.name.slice(0, -3)
      : entry.name
    setRenameTarget(entry)
    setRenameName(initialName)
  }

  const handleRenameConfirm = async () => {
    if (!renameTarget || renaming) return
    const rawName = renameName.trim()
    if (!rawName) return

    setRenaming(true)
    try {
      const parent = parentPath(renameTarget.relativePath)
      const nextName = renameTarget.type === 'file' && !rawName.endsWith('.md')
        ? `${rawName}.md`
        : rawName
      const newRelativePath = parent ? `${parent}/${nextName}` : nextName
      if (newRelativePath === renameTarget.relativePath) {
        setRenameTarget(null)
        setRenameName('')
        return
      }

      const oldPathOptions = await getFilePathOptions(renameTarget.relativePath)
      const newPathOptions = await getFilePathOptions(newRelativePath)
      const newExists = newPathOptions.baseDir
        ? await exists(newPathOptions.path, { baseDir: newPathOptions.baseDir })
        : await exists(newPathOptions.path)
      if (newExists) {
        toast({ title: tFile('error.fileExists') })
        return
      }

      if (oldPathOptions.baseDir || newPathOptions.baseDir) {
        await fsRename(oldPathOptions.path, newPathOptions.path, {
          oldPathBaseDir: oldPathOptions.baseDir || BaseDirectory.AppData,
          newPathBaseDir: newPathOptions.baseDir || BaseDirectory.AppData,
        })
      } else {
        await fsRename(oldPathOptions.path, newPathOptions.path)
      }

      if (normalizedActivePath === renameTarget.relativePath) {
        await setActiveFilePath(newRelativePath)
      }
      await refreshTree(currentDir)
      setRenameTarget(null)
      setRenameName('')
    } finally {
      setRenaming(false)
    }
  }

  const handleDelete = async (entry: BrowserEntry) => {
    if (!entry.isLocale) {
      toast({ title: tFile('clipboard.notSupported') })
      return
    }

    const ok = await confirm(
      entry.type === 'folder'
        ? tContext('confirmDelete', { name: entry.name })
        : `${tContext('deleteLocalFile')}?`,
      {
      title: entry.name,
      kind: 'warning',
      }
    )
    if (!ok) return

    const pathOptions = await getFilePathOptions(entry.relativePath)
    if (entry.type === 'folder') {
      if (pathOptions.baseDir) {
        await remove(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
      } else {
        await remove(pathOptions.path, { recursive: true })
      }
      if (normalizedActivePath.startsWith(`${entry.relativePath}/`)) {
        await setActiveFilePath('')
      }
    } else {
      if (pathOptions.baseDir) {
        await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
      } else {
        await remove(pathOptions.path)
      }
      if (normalizedActivePath === entry.relativePath) {
        await setActiveFilePath('')
      }
    }
    await refreshTree(currentDir)
  }

  const handleDeleteSyncFile = async (entry: BrowserEntry) => {
    if (entry.type !== 'file' || !entry.sha) return

    const ok = await confirm(`${tContext('deleteSyncFile')}?`, {
      title: entry.name,
      kind: 'warning',
    })
    if (!ok) return

    const store = await Store.load('store.json')
    const backupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'>('primaryBackupMethod') || 'github'
    const repoName = backupMethod === 's3' || backupMethod === 'webdav'
      ? RepoNames.sync
      : await getSyncRepoName(backupMethod)

    let success = false
    switch (backupMethod) {
      case 'github': {
        const result = await deleteFile({ path: entry.relativePath, sha: entry.sha, repo: repoName })
        success = !!result
        break
      }
      case 'gitee': {
        const result = await deleteGiteeFile({ path: entry.relativePath, sha: entry.sha, repo: repoName })
        success = result !== false
        break
      }
      case 'gitlab': {
        const result = await deleteGitlabFile({ path: entry.relativePath, sha: entry.sha, repo: repoName })
        success = !!result
        break
      }
      case 'gitea': {
        const result = await deleteGiteaFile({ path: entry.relativePath, sha: entry.sha, repo: repoName })
        success = !!result
        break
      }
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          success = await s3Delete(s3Config, entry.relativePath)
        }
        break
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          success = await webdavDelete(webdavConfig, entry.relativePath)
        }
        break
      }
    }

    if (!success) {
      toast({
        title: tContext('delete'),
        description: tContext('deleteSyncFileError'),
        variant: 'destructive',
      })
      return
    }

    await refreshTree(currentDir)
    toast({
      title: tContext('delete'),
      description: tContext('deleteSyncFileSuccess'),
    })
  }

  const handleUndo = useCallback(() => {
    emitter.emit('editor-undo')
  }, [])

  const handleRedo = useCallback(() => {
    emitter.emit('editor-redo')
  }, [])

  const handleToggleOutline = useCallback(() => {
    emitter.emit('mobile-editor-toggle-outline' as any)
  }, [])

  const handleSearchReplace = useCallback(() => {
    emitter.emit('editor-search-trigger' as any)
  }, [])

  return (
    <div className="mobile-page-header w-full flex items-center justify-between gap-3 border-b bg-background px-3 text-sm">
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={handleUndo}
          disabled={!canUndo}
          aria-label="撤销"
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={handleRedo}
          disabled={!canRedo}
          aria-label="重做"
        >
          <Redo2 className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={handleSearchReplace}
          aria-label="搜索替换"
        >
          <SearchCode className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={handleToggleOutline}
          aria-label="大纲"
        >
          <List className="size-4" />
        </Button>

        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 rounded-full">
              <Folder className="size-4" />
              <span className="sr-only">{tMobile('openFiles')}</span>
            </Button>
          </DrawerTrigger>
          <DrawerContent className="h-[85%]">
            <DrawerHeader>
              <div className="flex items-center gap-2 min-w-0">
                {currentDir !== '' ? (
                  <Button variant="ghost" size="icon" onClick={() => setCurrentDir(parentPath(currentDir))}>
                    <ChevronLeft className="size-4" />
                  </Button>
                ) : (
                  <div className="size-9" />
                )}
              <DrawerTitle className="truncate">{currentDirLabel}</DrawerTitle>
              </div>
            </DrawerHeader>
            <div className="px-4 pb-4 h-full flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="size-4 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="h-9 pl-8"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => refreshTree(currentDir)}
                  title={tToolbar('refresh')}
                  aria-label={tToolbar('refresh')}
                  disabled={isBrowserLoading}
                >
                  <RefreshCw className={`size-4 ${isBrowserLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    setCreateType('file')
                    setCreateName('')
                  }}
                  title={tToolbar('newArticle')}
                  aria-label={tToolbar('newArticle')}
                >
                  <FilePlus className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    setCreateType('folder')
                    setCreateName('')
                  }}
                  title={tToolbar('newFolder')}
                  aria-label={tToolbar('newFolder')}
                >
                  <FolderPlus className="size-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {isBrowserLoading ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">{t('loading')}</div>
                ) : visibleEntries.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    {searchQuery.trim() ? t('noFiles') : tFile('mobile.emptyDir')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleEntries.map((entry) => (
                      <EntryListItem
                        key={entry.relativePath}
                        entry={entry}
                        isActive={entry.type === 'file' && normalizedActivePath === entry.relativePath}
                        onOpen={openEntry}
                        remoteLabel={tMobile('remote')}
                        subtitle={getEntrySubtitle(entry)}
                        actions={[
                          {
                            key: 'rename',
                            label: tContext('rename'),
                            icon: <Pencil className="size-4" />,
                            onClick: () => startRename(entry),
                            disabled: !entry.isLocale,
                            variant: 'outline',
                          },
                          ...(entry.type === 'file' && entry.sha ? [{
                            key: 'delete-sync',
                            label: tContext('deleteSyncFile'),
                            icon: <Unplug className="size-4" />,
                            onClick: () => handleDeleteSyncFile(entry),
                            disabled: !entry.sha,
                            variant: 'outline' as const,
                          }] : []),
                          {
                            key: 'delete',
                            label: entry.type === 'file' ? tContext('deleteLocalFile') : tContext('delete'),
                            icon: <Trash2 className="size-4" />,
                            onClick: () => handleDelete(entry),
                            disabled: !entry.isLocale,
                            variant: 'destructive',
                          },
                        ]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <NameInputDialog
        open={createType !== null}
        title={createType === 'file' ? tToolbar('newArticle') : tToolbar('newFolder')}
        placeholder={createType === 'file' ? tMobile('filePlaceholder') : tMobile('folderPlaceholder')}
        confirmText={tFile('mobile.create')}
        cancelText={tFile('mobile.cancel')}
        value={createName}
        loading={creating}
        onChange={setCreateName}
        onConfirm={handleCreateConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setCreateType(null)
            setCreateName('')
          }
        }}
      />

      <NameInputDialog
        open={renameTarget !== null}
        title={tContext('rename')}
        confirmText={tFile('mobile.save')}
        cancelText={tFile('mobile.cancel')}
        value={renameName}
        loading={renaming}
        onChange={setRenameName}
        onConfirm={handleRenameConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameName('')
          }
        }}
      />
    </div>
  )
}
