'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaseDirectory, copyFile, exists, mkdir, readDir, rename as fsRename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { platform as getRuntimePlatform } from '@tauri-apps/plugin-os'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { cloneDeep } from 'lodash-es'
import { ChevronLeft, ClipboardPaste, Copy, FilePlus, FileUp, FolderDown, FolderInput, FolderPlus, FolderUp, Pencil, Scissors, Search, Trash2 } from 'lucide-react'
import { MobileMeSheet } from '@/app/mobile/components/mobile-me-sheet'
import { WorkspaceSwitcher } from '@/app/core/setting/file/setting-workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { getFilePathOptions } from '@/lib/workspace'
import { getWritingAssetsFolderName } from '@/lib/writing-assets-path'
import { filterFileTreeByVisibility } from '@/app/core/main/file/file-tree-model'
import { EntryListItem } from './entry-list-item'
import { NameInputDialog } from './name-input-dialog'
import { BrowserEntry } from './types'
import { getChildrenByPath, getNodeByPath, isMarkdownFile, normalizePath, parentPath } from './browser-utils'
import { Store } from '@tauri-apps/plugin-store'
import { CloudFolderConfig } from '@/types/sync'
import { buildMoveTargetPath, isInvalidFolderMoveTarget, moveFileManagerEntry, moveFileManagerPaths } from '@/app/core/main/file/file-dnd'
import { getFileSelectionEntries } from '@/app/core/main/file/file-selection'
import { useFileDeletion } from '@/app/core/main/file/use-file-deletion'
import useFileDeletionStore, { isFileDeletionPending } from '@/stores/file-deletion'
import { withWorkspacePathMove } from '@/lib/sync/workspace-path-moves'
import { moveSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { cn } from '@/lib/utils'
import { CloudLibraryMenu } from '@/app/core/main/file/cloud-library-menu'
import { pullRemoteLibraryFolder, uploadLocalLibraryFile, uploadLocalLibraryFolder } from '@/lib/sync/remote-library'
import useClipboardStore from '@/stores/clipboard'
import { generateCopyFilename, generateCopyFoldername } from '@/lib/default-filename'
import { getFileTreeSyncStatus, getSyncConfiguration } from '@/app/core/main/file/file-tree-action-policy'
import {
  prepareActiveEditorDeactivationDurably,
  prepareActiveEditorPathMutationDurably,
} from '@/lib/editor-deactivation'

function shouldLoadRemoteOnTreeRefresh(options?: { isCreateFlow?: boolean }) {
  return options?.isCreateFlow !== true
}

function getVisibleDirectoryPath(path: string, assetsFolderName: string) {
  const normalizedPath = normalizePath(path)
  const segments = normalizedPath.split('/').filter(Boolean)
  const assetsIndex = segments.indexOf(assetsFolderName)

  return assetsIndex === -1
    ? normalizedPath
    : segments.slice(0, assetsIndex).join('/')
}

async function isMobileOneDriveSyncEnabled() {
  if (getRuntimePlatform() !== 'android' && getRuntimePlatform() !== 'ios') return false
  const store = await Store.load('store.json')
  if (await store.get<string>('primaryBackupMethod') !== 'cloudFolder') return false
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config?.provider === 'oneDrive' && Boolean(config.path)
}

type DragPoint = {
  x: number
  y: number
}

interface MobileFileBrowserProps {
  active: boolean
  onOpenFile: () => void
}

export function MobileFileBrowser({ active, onOpenFile }: MobileFileBrowserProps) {
  const router = useRouter()
  const t = useTranslations('record.chat.input.fileLink')
  const tFile = useTranslations('article.file')
  const tContext = useTranslations('article.file.context')
  const tMobile = useTranslations('article.file.mobile')
  const tSyncStatus = useTranslations('article.file.syncStatus')
  const tToolbar = useTranslations('article.file.toolbar')
  const tSync = useTranslations('settings.sync')
  const {
    activeFilePath,
    setActiveFilePath,
    fileTree,
    fileTreeLoading,
    loadFileTree,
    loadRemoteSyncFiles,
    loadCollapsibleFiles,
    loadFolderRemoteFiles,
    setFileTree,
    setCollapsibleList,
    moveLocalEntry,
    syncOpenTabsForPathChange,
    syncStaticAssets,
    markFileRemote,
    setEntryLoading,
    showCloudFiles,
    showAssetsFolders,
    sortDirection,
    sortType,
    setSortDirection,
    setSortType,
  } = useArticleStore()
  const assetsPath = useSettingStore(state => state.assetsPath)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const pendingDeletionPaths = useFileDeletionStore(state => state.pendingPaths)
  const deleteEntries = useFileDeletion()
  const assetsFolderName = getWritingAssetsFolderName(assetsPath)

  const ensureSyncConfigured = useCallback(async () => {
    const sync = await getSyncConfiguration()
    if (sync.configured) return true

    toast({
      description: sync.reason === 'missing-repository'
        ? tSync('repositoryRequired')
        : tSync('status.unconfigured'),
      variant: 'destructive',
    })
    router.push('/mobile/setting/pages/sync')
    return false
  }, [router, tSync])
  const { clipboardItem, clipboardItems, clipboardOperation, setClipboardItem } = useClipboardStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [currentDir, setCurrentDir] = useState('')
  const [folderLoading, setFolderLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [entryMetaMap, setEntryMetaMap] = useState<Record<string, { modifiedAt?: string; size?: number }>>({})
  const hasInitializedBrowserRef = useRef(false)
  const remoteRefreshInFlightRef = useRef(false)

  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null)
  const [createName, setCreateName] = useState('')
  const [createTargetDir, setCreateTargetDir] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [renameTarget, setRenameTarget] = useState<BrowserEntry | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [dragEntry, setDragEntry] = useState<BrowserEntry | null>(null)
  const [dragStartPoint, setDragStartPoint] = useState<DragPoint | null>(null)
  const [dragPoint, setDragPoint] = useState<DragPoint | null>(null)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const folderDropTargetRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const parentDropTargetRef = useRef<HTMLElement | null>(null)

  const normalizedActivePath = normalizePath(activeFilePath)

  const currentDirLabel = useMemo(() => {
    if (!currentDir) return tMobile('root')
    return currentDir.split('/').pop() || currentDir
  }, [currentDir, tMobile])

  const displayTree = useMemo(() => filterFileTreeByVisibility(fileTree, {
    showCloudFiles,
    showAssetsFolders,
    assetsFolderName,
    isPathHidden: pendingDeletionPaths.length > 0
      ? path => isFileDeletionPending(path, workspacePath) : undefined,
  }), [fileTree, showCloudFiles, showAssetsFolders, assetsFolderName, pendingDeletionPaths, workspacePath])
  const currentFolderNode = useMemo(() => getNodeByPath(displayTree, currentDir), [displayTree, currentDir])

  useEffect(() => {
    if (!currentDir || !isFileDeletionPending(currentDir, workspacePath)) return
    let nextDir = parentPath(currentDir)
    while (nextDir && !getNodeByPath(displayTree, nextDir)) nextDir = parentPath(nextDir)
    setCurrentDir(nextDir)
  }, [currentDir, displayTree, pendingDeletionPaths, workspacePath])

  const rawEntries = useMemo(() => {
    const children = getChildrenByPath(displayTree, currentDir)
    return children
      .filter((node) => node.isDirectory || syncStaticAssets || isMarkdownFile(node))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1

        if (sortType === 'none' || sortType === 'name') {
          const result = a.name.localeCompare(b.name, undefined, { numeric: true })
          return sortType === 'name' && sortDirection === 'desc' ? -result : result
        }

        const aTimestamp = Date.parse(sortType === 'created' ? a.createdAt || '' : a.modifiedAt || '')
        const bTimestamp = Date.parse(sortType === 'created' ? b.createdAt || '' : b.modifiedAt || '')
        const result = Number.isNaN(aTimestamp) || Number.isNaN(bTimestamp)
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : aTimestamp - bTimestamp
        return sortDirection === 'asc' ? result : -result
      })
  }, [displayTree, currentDir, sortDirection, sortType, syncStaticAssets])

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
        syncStatus: getFileTreeSyncStatus(node),
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
    if (!active) return

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
  }, [active, rawEntries, currentDir])

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
      if (entry.syncStatus === 'local-only') {
        return [tSyncStatus('local-only'), ...parts].join(' · ')
      }
      return parts.length > 0 ? parts.join(' · ') : tMobile('file')
    }

    const folderSummary = (
      typeof entry.fileCount === 'number' &&
      typeof entry.folderCount === 'number'
    )
      ? tMobile('folderChildren', { files: entry.fileCount, folders: entry.folderCount })
      : tMobile('folder')

    const parts = [folderSummary, formatDateTime(modifiedAt)].filter(Boolean)
    if (entry.syncStatus === 'local-only') {
      parts.unshift(tSyncStatus('local-only'))
    }
    return parts.join(' · ')
  }, [entryMetaMap, formatDateTime, formatSize, tMobile, tSyncStatus])

  const isBrowserRefreshing = fileTreeLoading || folderLoading || isRefreshing || !!currentFolderNode?.loading
  const showBrowserLoading = isBrowserRefreshing && visibleEntries.length === 0

  const getValidDropTargetPath = useCallback((entry: BrowserEntry, point: DragPoint) => {
    if (!entry.isLocale) return null

    if (currentDir && parentDropTargetRef.current) {
      const rect = parentDropTargetRef.current.getBoundingClientRect()
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        const targetPath = parentPath(currentDir)
        return isInvalidFolderMoveTarget(entry.relativePath, targetPath) ? null : targetPath
      }
    }

    for (const [targetPath, node] of folderDropTargetRefs.current.entries()) {
      if (targetPath === entry.relativePath) continue
      if (isInvalidFolderMoveTarget(entry.relativePath, targetPath)) continue

      const rect = node.getBoundingClientRect()
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        return targetPath
      }
    }

    return null
  }, [currentDir])

  const updateDragTarget = useCallback((entry: BrowserEntry, point: DragPoint) => {
    setDragTargetPath(getValidDropTargetPath(entry, point))
  }, [getValidDropTargetPath])

  const registerFolderDropTarget = useCallback((entry: BrowserEntry, node: HTMLDivElement | null) => {
    if (entry.type !== 'folder' || !entry.isLocale) return

    if (node) {
      folderDropTargetRefs.current.set(entry.relativePath, node)
      return
    }

    folderDropTargetRefs.current.delete(entry.relativePath)
  }, [])

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
        await loadCollapsibleFiles(path, { skipRemoteSync: !includeRemote })
        if (includeRemote) {
          await loadFolderRemoteFiles(path)
        }
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [loadFileTree, loadRemoteSyncFiles, loadCollapsibleFiles, loadFolderRemoteFiles, setCollapsibleList])

  const refreshRemoteInBackground = useCallback(async () => {
    if (document.visibilityState !== 'visible' || remoteRefreshInFlightRef.current) return
    remoteRefreshInFlightRef.current = true
    try {
      await loadRemoteSyncFiles()
    } catch (error) {
      console.error('Background remote file tree refresh failed:', error)
    } finally {
      remoteRefreshInFlightRef.current = false
    }
  }, [loadRemoteSyncFiles])

  const handleDragStart = useCallback((entry: BrowserEntry, point: DragPoint) => {
    if (entry.isLoading || isFileDeletionPending(entry.relativePath)) return
    if (!entry.isLocale) {
      toast({ title: tFile('clipboard.notSupported') })
      return
    }

    setDragEntry(entry)
    setDragStartPoint(point)
    setDragPoint(point)
    updateDragTarget(entry, point)
  }, [tFile, updateDragTarget])

  const handleDragMove = useCallback((point: DragPoint) => {
    setDragPoint(point)
    setDragEntry((entry) => {
      if (entry) {
        updateDragTarget(entry, point)
      }
      return entry
    })
  }, [updateDragTarget])

  const resetDragState = useCallback(() => {
    setDragEntry(null)
    setDragStartPoint(null)
    setDragPoint(null)
    setDragTargetPath(null)
  }, [])

  const handleDragEnd = useCallback(async (point: DragPoint) => {
    const entry = dragEntry
    const targetDirectoryPath = entry ? getValidDropTargetPath(entry, point) : null

    resetDragState()

    if (!entry || targetDirectoryPath === null || isFileDeletionPending(entry.relativePath)
      || isFileDeletionPending(targetDirectoryPath)) return

    const { targetPath } = buildMoveTargetPath(entry.relativePath, targetDirectoryPath)
    const targetPathOptions = await getFilePathOptions(targetPath)
    const targetExists = targetPathOptions.baseDir
      ? await exists(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
      : await exists(targetPathOptions.path)

    if (targetExists) {
      toast({ title: tFile('error.fileExists') })
      return
    }

    if (!await prepareActiveEditorPathMutationDurably(normalizedActivePath, [entry.relativePath])) return

    try {
      const result = await moveFileManagerEntry(entry.relativePath, targetDirectoryPath)
      if (!result.moved) {
        if (result.reason === 'invalid-target') {
          toast({ title: tMobile('moveInvalidTarget') })
        }
        return
      }

      moveLocalEntry(result.sourcePath, result.targetPath)
      await refreshTree(currentDir, { includeRemote: false })
    } catch (error) {
      console.error('Mobile file move failed:', error)
      toast({
        title: tMobile('moveFailed'),
        variant: 'destructive',
      })
    }
  }, [
    currentDir,
    dragEntry,
    getValidDropTargetPath,
    moveLocalEntry,
    normalizedActivePath,
    refreshTree,
    resetDragState,
    setActiveFilePath,
    tFile,
    tMobile,
  ])

  useEffect(() => {
    if (!active) {
      hasInitializedBrowserRef.current = false
      resetDragState()
      return
    }

    if (hasInitializedBrowserRef.current) return
    hasInitializedBrowserRef.current = true

    const activeParentDir = parentPath(normalizedActivePath)
    const initialDir = showAssetsFolders
      ? activeParentDir
      : getVisibleDirectoryPath(activeParentDir, assetsFolderName)
    setCurrentDir(initialDir)
    setSearchQuery('')

    const init = async () => {
      await refreshTree(initialDir, { includeRemote: false })
      void refreshRemoteInBackground()
    }

    init()
  }, [active, assetsFolderName, normalizedActivePath, refreshRemoteInBackground, refreshTree, resetDragState, showAssetsFolders])

  useEffect(() => {
    if (!active || showAssetsFolders) return

    const nextDir = getVisibleDirectoryPath(currentDir, assetsFolderName)
    if (nextDir === currentDir) return

    setCurrentDir(nextDir)
    setSearchQuery('')
    resetDragState()
  }, [active, assetsFolderName, currentDir, resetDragState, showAssetsFolders])

  useEffect(() => {
    if (!active) return

    let subscribed = true
    let timer: number | undefined

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshRemoteInBackground()
    }

    const startOneDriveRefresh = async () => {
      if (!await isMobileOneDriveSyncEnabled() || !subscribed) return
      timer = window.setInterval(() => void refreshRemoteInBackground(), 15_000)
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    void startOneDriveRefresh()
    return () => {
      subscribed = false
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [active, refreshRemoteInBackground])

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
    if (entry.isLoading || isFileDeletionPending(entry.relativePath, workspacePath)) return
    if (entry.type === 'folder') {
      await enterFolder(entry.relativePath)
      return
    }

    if (!entry.name.toLowerCase().endsWith('.md')) {
      toast({ title: tFile('clipboard.notSupported') })
      return
    }

    await setActiveFilePath(entry.relativePath)
    onOpenFile()
  }

  const handleUploadEntry = async (entry: BrowserEntry) => {
    if (!entry.isLocale || entry.isLoading) return
    if (!await ensureSyncConfigured()) return

    setEntryLoading(entry.relativePath, true)
    const isFolder = entry.type === 'folder'
    const progressToast = toast({
      title: tContext(isFolder ? 'uploadFolderProgress' : 'uploadFileProgress'),
      description: entry.name,
      duration: Infinity,
    })

    try {
      if (isFolder) {
        const result = await uploadLocalLibraryFolder(entry.relativePath, progress => {
          if (progress.phase === 'uploaded' && progress.path && progress.sha) {
            markFileRemote(progress.path, progress.sha)
          }
          if (progress.path) {
            progressToast.update({
              title: tContext('uploadFolderProgress'),
              description: `${progress.current}/${progress.total} · ${progress.path}`,
              duration: Infinity,
            })
          }
        })
        progressToast.update({
          title: tContext('uploadFolderSuccess'),
          description: tContext('uploadFolderResult', {
            uploaded: result.uploaded,
            failed: result.failed.length,
          }),
          variant: result.failed.length > 0 ? 'destructive' : 'default',
          duration: 5000,
        })
      } else {
        const sha = await uploadLocalLibraryFile(entry.relativePath)
        markFileRemote(entry.relativePath, sha)
        progressToast.update({
          title: tContext('uploadFileSuccess'),
          description: entry.name,
          duration: 3000,
        })
      }
      await refreshTree(currentDir)
    } catch (error) {
      progressToast.update({
        title: tContext(isFolder ? 'uploadFolderError' : 'uploadFileError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    } finally {
      setEntryLoading(entry.relativePath, false)
    }
  }

  const handleSyncFolder = async (entry: BrowserEntry) => {
    if (entry.type !== 'folder' || entry.isLoading) return
    if (!await ensureSyncConfigured()) return

    setEntryLoading(entry.relativePath, true)
    const progressToast = toast({
      title: tContext('syncFolderProgress'),
      description: entry.name,
      duration: Infinity,
    })
    try {
      const result = await pullRemoteLibraryFolder(entry.relativePath, progress => {
        if (!progress.path) return
        progressToast.update({
          title: tContext('syncFolderProgress'),
          description: `${progress.current}/${progress.total} · ${progress.path}`,
          duration: Infinity,
        })
      })
      progressToast.update({
        title: tContext('syncFolderSuccess'),
        description: tFile('cloudLibrary.pullResult', {
          downloaded: result.downloaded,
          skipped: result.skipped,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        duration: 5000,
      })
      await refreshTree(currentDir)
    } catch (error) {
      progressToast.update({
        title: tContext('syncFolderError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    } finally {
      setEntryLoading(entry.relativePath, false)
    }
  }

  const copyLocalEntry = useCallback(async (
    sourceRelativePath: string,
    targetRelativePath: string,
    isDirectory: boolean
  ): Promise<void> => {
    const source = await getFilePathOptions(sourceRelativePath)
    const target = await getFilePathOptions(targetRelativePath)

    if (!isDirectory) {
      if (source.baseDir || target.baseDir) {
        await copyFile(source.path, target.path, {
          fromPathBaseDir: source.baseDir || BaseDirectory.AppData,
          toPathBaseDir: target.baseDir || BaseDirectory.AppData,
        })
      } else {
        await copyFile(source.path, target.path)
      }
      return
    }

    if (target.baseDir) {
      await mkdir(target.path, { baseDir: target.baseDir, recursive: true })
    } else {
      await mkdir(target.path, { recursive: true })
    }

    const entries = source.baseDir
      ? await readDir(source.path, { baseDir: source.baseDir })
      : await readDir(source.path)
    for (const child of entries) {
      if (child.isSymlink) continue
      const sourceChild = `${sourceRelativePath}/${child.name}`
      const targetChild = `${targetRelativePath}/${child.name}`
      if (child.isDirectory) {
        await copyLocalEntry(sourceChild, targetChild, true)
      } else if (child.isFile && !child.isSymlink) {
        await copyLocalEntry(sourceChild, targetChild, false)
      }
    }
  }, [])

  const handleClipboardEntry = (entry: BrowserEntry, operation: 'copy' | 'cut') => {
    if (!entry.isLocale) return
    setClipboardItem({
      path: entry.relativePath,
      name: entry.name,
      isDirectory: entry.type === 'folder',
      sha: entry.sha,
      isLocale: entry.isLocale,
    }, operation)
    toast({ title: tFile(`clipboard.${operation === 'copy' ? 'copied' : 'cut'}`) })
  }

  const handlePasteEntry = async (entry: BrowserEntry) => {
    const sourceItems = clipboardItems.length > 0
      ? clipboardItems
      : clipboardItem ? [clipboardItem] : []
    if (sourceItems.length === 0) {
      toast({ title: tFile('clipboard.empty'), variant: 'destructive' })
      return
    }

    if (
      clipboardOperation === 'cut'
      && !await prepareActiveEditorPathMutationDurably(
        normalizedActivePath,
        sourceItems.map(sourceItem => sourceItem.path),
      )
    ) return

    const targetDir = entry.type === 'folder' ? entry.relativePath : parentPath(entry.relativePath)
    const pathMoves: Array<{ sourcePath: string; targetPath: string }> = []
    try {
      if (clipboardOperation === 'cut') {
        for (const sourceItem of sourceItems) {
          if (sourceItem.isDirectory && (targetDir === sourceItem.path || targetDir.startsWith(`${sourceItem.path}/`))) {
            throw new Error(tFile('clipboard.notSupported'))
          }
          const name = sourceItem.isDirectory ? await generateCopyFoldername(targetDir, sourceItem.name)
            : await generateCopyFilename(targetDir, sourceItem.name)
          pathMoves.push({ sourcePath: sourceItem.path, targetPath: targetDir ? `${targetDir}/${name}` : name })
        }
        await moveFileManagerPaths(pathMoves)
        setClipboardItem(null, 'none')
        await refreshTree(currentDir, { includeRemote: false })
        toast({ title: tFile('clipboard.pasted') })
        return
      }

      for (const sourceItem of sourceItems) {
        if (
          sourceItem.isDirectory &&
          (targetDir === sourceItem.path || targetDir.startsWith(`${sourceItem.path}/`))
        ) {
          throw new Error(tFile('clipboard.notSupported'))
        }
        const targetName = sourceItem.isDirectory
          ? await generateCopyFoldername(targetDir, sourceItem.name)
          : await generateCopyFilename(targetDir, sourceItem.name)
        const targetPath = targetDir ? `${targetDir}/${targetName}` : targetName
        pathMoves.push({ sourcePath: sourceItem.path, targetPath })
        await copyLocalEntry(sourceItem.path, targetPath, sourceItem.isDirectory)
      }

      await refreshTree(currentDir, { includeRemote: false })
      toast({ title: tFile('clipboard.pasted') })
    } catch (error) {
      toast({
        title: tFile('clipboard.pasteFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handleDuplicateFolder = async (entry: BrowserEntry) => {
    if (entry.type !== 'folder' || !entry.isLocale) return
    const targetDir = parentPath(entry.relativePath)
    const targetName = await generateCopyFoldername(targetDir, entry.name)
    const targetPath = targetDir ? `${targetDir}/${targetName}` : targetName
    try {
      await copyLocalEntry(entry.relativePath, targetPath, true)
      await refreshTree(currentDir, { includeRemote: false })
      toast({ title: tFile('clipboard.copied') })
    } catch (error) {
      toast({
        title: tFile('clipboard.pasteFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  const handleCreateConfirm = async () => {
    if (!createType || creating) return

    const rawName = createName.trim()
    if (!rawName) return

    setCreating(true)
    try {
      const targetDir = createTargetDir ?? currentDir
      await ensureLocalFolder(targetDir)

      if (createType === 'file') {
        let fileNameToCreate = rawName
        if (!fileNameToCreate.endsWith('.md')) {
          fileNameToCreate = `${fileNameToCreate}.md`
        }

        const relativePath = targetDir ? `${targetDir}/${fileNameToCreate}` : fileNameToCreate
        const pathOptions = await getFilePathOptions(relativePath)
        const fileExists = pathOptions.baseDir
          ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          : await exists(pathOptions.path)

        if (!fileExists) {
          if (!await prepareActiveEditorDeactivationDurably(normalizedActivePath)) return
          if (pathOptions.baseDir) {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          } else {
            await writeTextFile(pathOptions.path, '')
          }
          emitter.emit('article-saved', { path: relativePath, content: '' })
          await refreshTree(targetDir, {
            includeRemote: shouldLoadRemoteOnTreeRefresh({ isCreateFlow: true })
          })
          await setActiveFilePath(
            relativePath,
            true,
            { deactivationAlreadyPrepared: true },
          )
          onOpenFile()
        }
      } else {
        const relativePath = targetDir ? `${targetDir}/${rawName}` : rawName
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
          await refreshTree(targetDir, {
            includeRemote: shouldLoadRemoteOnTreeRefresh({ isCreateFlow: true })
          })
        }
      }

      setCreateType(null)
      setCreateName('')
      setCreateTargetDir(null)
    } finally {
      setCreating(false)
    }
  }

  const startRename = (entry: BrowserEntry) => {
    if (entry.isLoading || isFileDeletionPending(entry.relativePath, workspacePath)) return
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

      if (!await prepareActiveEditorPathMutationDurably(
        normalizedActivePath,
        [renameTarget.relativePath],
      )) return

      await withWorkspacePathMove(renameTarget.relativePath, newRelativePath, async () => {
        if (await moveSelfHostedWorkspacePath(renameTarget.relativePath, newRelativePath)) {
          // The native journal completed the local move.
        } else if (oldPathOptions.baseDir || newPathOptions.baseDir) {
          await fsRename(oldPathOptions.path, newPathOptions.path, {
            oldPathBaseDir: oldPathOptions.baseDir || BaseDirectory.AppData,
            newPathBaseDir: newPathOptions.baseDir || BaseDirectory.AppData,
          })
        } else {
          await fsRename(oldPathOptions.path, newPathOptions.path)
        }
        await syncOpenTabsForPathChange(renameTarget.relativePath, newRelativePath, false)
        const { renameVectorDocumentsByPrefix } = await import('@/db/vector')
        await renameVectorDocumentsByPrefix(renameTarget.relativePath, newRelativePath)
      })

      await refreshTree(currentDir)
      setRenameTarget(null)
      setRenameName('')
    } finally {
      setRenaming(false)
    }
  }

  const handleDelete = async (entry: BrowserEntry) => {
    if (!entry.name || entry.isLoading || renaming || isFileDeletionPending(entry.relativePath, workspacePath)) return
    const [selection] = getFileSelectionEntries(useArticleStore.getState().fileTree, [entry.relativePath])
    if (!selection || selection.item.isEditing) return
    await deleteEntries([selection])
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="mobile-page-header flex w-full items-center gap-2 border-b bg-background px-2 text-sm">
        <div className="flex shrink-0 items-center">
          <MobileMeSheet />
        </div>
        <div className="min-w-0 flex-1 truncate text-left font-medium" title={currentDirLabel}>
          {currentDirLabel}
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => {
              setCreateType('file')
              setCreateName('')
              setCreateTargetDir(currentDir)
            }}
            title={tToolbar('newArticle')}
            aria-label={tToolbar('newArticle')}
          >
            <FilePlus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => {
              setCreateType('folder')
              setCreateName('')
              setCreateTargetDir(currentDir)
            }}
            title={tToolbar('newFolder')}
            aria-label={tToolbar('newFolder')}
          >
            <FolderPlus className="size-4" />
          </Button>
          <WorkspaceSwitcher compact />
          <CloudLibraryMenu
            className="size-9 shrink-0"
            onRefresh={() => void refreshTree(currentDir).catch(error => {
              console.error('Remote file tree refresh failed:', error)
              toast({ description: tMobile('refreshFailed'), variant: 'destructive' })
            })}
            refreshing={isBrowserRefreshing}
            sortOptions={{
              type: sortType,
              direction: sortDirection,
              setType: setSortType,
              setDirection: setSortDirection,
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3">
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 pl-8"
          />
        </div>
        {currentDir !== '' && (
                <button
                  ref={(node) => {
                    parentDropTargetRef.current = node
                  }}
                  type="button"
                  data-vaul-no-drag
                  onClick={() => {
                    if (dragEntry) return
                    setCurrentDir(parentPath(currentDir))
                  }}
                  className={cn(
                    "mb-3 flex min-h-12 w-full items-center gap-2 rounded-md border border-dashed bg-background px-3 py-3 text-left text-sm shadow-sm",
                    dragTargetPath === parentPath(currentDir) && "border-primary bg-primary/5 text-primary"
                  )}
                >
                  {dragEntry ? (
                    <FolderInput className="size-4 shrink-0" />
                  ) : (
                    <ChevronLeft className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {dragEntry ? tMobile('dragToParent') : currentDirLabel}
                  </span>
                </button>
        )}

        <div
                className={cn(
                  "mobile-under-dock-scroll relative flex-1",
                  dragEntry ? "overflow-visible" : "overflow-y-auto overflow-x-hidden"
                )}
                data-vaul-no-drag
              >
                {showBrowserLoading ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">{t('loading')}</div>
                ) : visibleEntries.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    {searchQuery.trim() ? t('noFiles') : tFile('mobile.emptyDir')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {visibleEntries.map((entry) => (
                      <EntryListItem
                        key={entry.relativePath}
                        entry={entry}
                        isActive={entry.type === 'file' && normalizedActivePath === entry.relativePath}
                        onOpen={openEntry}
                        syncStatusLabel={tSyncStatus(entry.syncStatus)}
                        subtitle={getEntrySubtitle(entry)}
                        dragDisabled={!entry.isLocale || entry.isLoading}
                        isDragging={dragEntry?.relativePath === entry.relativePath}
                        dragOffset={
                          dragEntry?.relativePath === entry.relativePath && dragStartPoint && dragPoint
                            ? {
                                x: dragPoint.x - dragStartPoint.x,
                                y: dragPoint.y - dragStartPoint.y,
                              }
                            : undefined
                        }
                        isDropTarget={dragTargetPath === entry.relativePath}
                        dropTargetRef={(node) => registerFolderDropTarget(entry, node)}
                        onDragStart={handleDragStart}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onDragCancel={resetDragState}
                        actions={[
                          ...(entry.type === 'folder' ? [{
                            key: 'new-file',
                            label: tContext('newFile'),
                            icon: <FilePlus className="size-4" />,
                            onClick: () => {
                              setCreateType('file')
                              setCreateName('')
                              setCreateTargetDir(entry.relativePath)
                            },
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                          }, {
                            key: 'new-folder',
                            label: tContext('newFolder'),
                            icon: <FolderPlus className="size-4" />,
                            onClick: () => {
                              setCreateType('folder')
                              setCreateName('')
                              setCreateTargetDir(entry.relativePath)
                            },
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                          }] : []),
                          ...(entry.type === 'file' ? [{
                            key: 'upload',
                            label: tContext('uploadFile'),
                            icon: <FileUp className="size-4" />,
                            onClick: () => handleUploadEntry(entry),
                            disabled: !entry.isLocale || entry.isLoading,
                            variant: 'outline' as const,
                          }] : [{
                            key: 'upload-folder',
                            label: tContext('uploadFolder'),
                            icon: <FolderUp className="size-4" />,
                            onClick: () => handleUploadEntry(entry),
                            disabled: !entry.isLocale || entry.isLoading,
                            variant: 'outline' as const,
                            separatorBefore: true,
                          }, {
                            key: 'sync-folder',
                            label: tContext('syncFolder'),
                            icon: <FolderDown className="size-4" />,
                            onClick: () => handleSyncFolder(entry),
                            disabled: entry.isLoading,
                            variant: 'outline' as const,
                          }]),
                          {
                            key: 'cut',
                            label: tContext('cut'),
                            icon: <Scissors className="size-4" />,
                            onClick: () => handleClipboardEntry(entry, 'cut'),
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                            separatorBefore: true,
                          },
                          {
                            key: 'copy',
                            label: tContext('copy'),
                            icon: <Copy className="size-4" />,
                            onClick: () => handleClipboardEntry(entry, 'copy'),
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                          },
                          ...(entry.type === 'folder' ? [{
                            key: 'duplicate',
                            label: tContext('duplicate'),
                            icon: <Copy className="size-4" />,
                            onClick: () => handleDuplicateFolder(entry),
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                          }] : []),
                          {
                            key: 'paste',
                            label: tContext('paste'),
                            icon: <ClipboardPaste className="size-4" />,
                            onClick: () => handlePasteEntry(entry),
                            disabled: !clipboardItem && clipboardItems.length === 0,
                            variant: 'outline' as const,
                          },
                          {
                            key: 'rename',
                            label: tContext('rename'),
                            icon: <Pencil className="size-4" />,
                            onClick: () => startRename(entry),
                            disabled: !entry.isLocale,
                            variant: 'outline' as const,
                            separatorBefore: true,
                          },
                          {
                            key: 'delete',
                            label: tContext('delete'),
                            icon: <Trash2 className="size-4" />,
                            onClick: () => handleDelete(entry),
                            disabled: !entry.name || entry.isLoading || renaming,
                            variant: 'destructive' as const,
                            separatorBefore: true,
                          },
                        ].map(action => ({
                          ...action,
                          disabled: action.disabled || entry.isLoading || isFileDeletionPending(entry.relativePath, workspacePath),
                        }))}
                      />
                    ))}
                  </div>
                )}
        </div>
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
            setCreateTargetDir(null)
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
