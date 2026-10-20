'use client'

import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { ArrowDownAZ, ArrowLeft, BrainCircuit, CalendarDays, CloudAlert, CloudCheck, CloudUpload, Columns3, CopyPlus, DownloadCloud, EllipsisVertical, FileInput, FilePlus2, Grid2X2, LayoutGrid, List, Loader2, Palette, Pencil, Pin, PinOff, RefreshCw, RotateCcw, ShieldQuestion, Timer, Trash2, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import useCanvasStore from '@/stores/canvas'
import type { CanvasProject, CanvasProjectType } from '@/types/canvas'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import type {
  CanvasManagerSortMode,
  CanvasManagerViewMode,
} from '@/lib/canvas/preferences'
import {
  getAutoDataSyncState,
  isAutoDataSyncProviderConfigured,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'
import { uploadCanvas } from '@/lib/sync/canvas-sync'
import { createCanvasTab, getCanvasTabPath } from './canvas-tab'
import { setCanvasDragData } from '@/lib/canvas/canvas-dnd'
import { parseCanvasProjectFile } from '@/lib/canvas/file-format'
import { mermaidToCanvasDocument } from '@/lib/canvas/mermaid'
import { CanvasThumbnail } from './canvas-thumbnail'

type CanvasSyncDisplayStatus = 'pending' | 'uploading' | 'synced' | 'failed'

function CanvasSyncIndicator({
  status,
  label,
  className,
  onClick,
}: {
  status: CanvasSyncDisplayStatus
  label: string
  className?: string
  onClick?: () => void
}) {
  const Icon = status === 'uploading'
    ? Loader2
    : status === 'synced'
      ? CloudCheck
      : status === 'failed'
        ? CloudAlert
        : CloudUpload

  const indicatorClassName = cn(
    'flex size-6 items-center justify-center rounded-md border shadow-sm backdrop-blur',
    status === 'uploading' && 'border-primary/40 bg-primary/10 text-primary',
    status === 'synced' && 'border-border bg-background/90 text-muted-foreground',
    status === 'failed' && 'border-destructive/60 bg-destructive/15 text-destructive',
    status === 'pending' && 'border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400',
    onClick && 'cursor-pointer hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50',
    className
  )
  const icon = (<>
    <Icon className={cn('size-3.5', status === 'uploading' && 'animate-spin')} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </>)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onClick ? (
          <button type="button" className={indicatorClassName} onClick={onClick}>
            {icon}
          </button>
        ) : (
          <span className={indicatorClassName}>{icon}</span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CanvasActions() {
  const t = useTranslations('canvas')
  const createProject = useCanvasStore(state => state.createProject)
  const createProjectFromDocument = useCanvasStore(state => state.createProjectFromDocument)
  const viewMode = useSettingStore(state => state.canvasManagerViewMode)
  const setViewMode = useSettingStore(state => state.setCanvasManagerViewMode)
  const refreshAllThumbnails = useCanvasStore(state => state.refreshAllThumbnails)
  const sortMode = useSettingStore(state => state.canvasManagerSortMode)
  const setSortMode = useSettingStore(state => state.setCanvasManagerSortMode)
  const trashMode = useCanvasStore(state => state.trashMode)
  const setTrashMode = useCanvasStore(state => state.setTrashMode)
  const addTab = useArticleStore(state => state.addTab)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!trashMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setTrashMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setTrashMode, trashMode])

  const handleCreate = async (canvasType: CanvasProjectType) => {
    const project = await createProject(canvasType, t(`templates.${canvasType}`))
    if (project) await addTab(createCanvasTab(project))
  }

  const changeViewMode = (mode: string) => {
    if (mode !== 'grid' && mode !== 'list') return
    void setViewMode(mode as CanvasManagerViewMode)
  }

  const handleRefreshThumbnails = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshAllThumbnails()
    } finally {
      setRefreshing(false)
    }
  }

  const handleImport = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: t('import.fileType'), extensions: ['json', 'canvas', 'mmd', 'mermaid'] }],
      })
      if (!path || Array.isArray(path)) return
      const source = await readTextFile(path)
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.(canvas\.)?json$|\.(mmd|mermaid)$/i, '') || t('import.defaultTitle')
      const imported = /\.(mmd|mermaid)$/i.test(path)
        ? { title: fileName, canvasType: 'flowchart' as const, document: mermaidToCanvasDocument(source) }
        : parseCanvasProjectFile(source)
      const project = await createProjectFromDocument(imported.document, imported.title, imported.canvasType)
      if (project) {
        await addTab(createCanvasTab(project))
        toast.success(t('import.success'))
      }
    } catch (error) {
      console.error('Failed to import canvas:', error)
      toast.error(t('import.error'))
    }
  }

  const changeSortMode = (mode: string) => {
    if (mode !== 'updated' && mode !== 'created' && mode !== 'name') return
    void setSortMode(mode as CanvasManagerSortMode)
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {!trashMode && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('new')}>
                  <FilePlus2 />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('new')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('chooseTemplate')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void handleCreate('blank')}><FilePlus2 />{t('templates.blank')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('flowchart')}><Workflow />{t('templates.flowchart')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('mindmap')}><BrainCircuit />{t('templates.mindmap')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('timeline')}><Timer />{t('templates.timeline')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('quadrant')}><Grid2X2 />{t('templates.quadrant')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('kanban')}><Columns3 />{t('templates.kanban')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreate('swot')}><ShieldQuestion />{t('templates.swot')}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t('more')}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('more')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('manager.view')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={viewMode} onValueChange={changeViewMode}>
              <DropdownMenuRadioItem value="grid"><LayoutGrid />{t('manager.grid')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list"><List />{t('manager.list')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('manager.sort.title')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortMode} onValueChange={changeSortMode}>
              <DropdownMenuRadioItem value="updated"><RefreshCw />{t('manager.sort.updated')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created"><CalendarDays />{t('manager.sort.created')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name"><ArrowDownAZ />{t('manager.sort.name')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void handleImport()}>
              <FileInput />
              {t('import.action')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={refreshing} onSelect={() => void handleRefreshThumbnails()}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
              {t('manager.refreshThumbnails')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {!trashMode && (<>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setTrashMode(true)}>
                <Trash2 />
                {t('trash')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function CanvasSidebar() {
  const t = useTranslations('canvas')
  const projects = useCanvasStore(state => state.projects)
  const deletedProjects = useCanvasStore(state => state.deletedProjects)
  const loadProjects = useCanvasStore(state => state.loadProjects)
  const openProject = useCanvasStore(state => state.openProject)
  const createProject = useCanvasStore(state => state.createProject)
  const createProjectFromDocument = useCanvasStore(state => state.createProjectFromDocument)
  const duplicateProject = useCanvasStore(state => state.duplicateProject)
  const deleteProject = useCanvasStore(state => state.deleteProject)
  const permanentlyDeleteProject = useCanvasStore(state => state.permanentlyDeleteProject)
  const renameProject = useCanvasStore(state => state.renameProject)
  const restoreProject = useCanvasStore(state => state.restoreProject)
  const togglePin = useCanvasStore(state => state.togglePin)
  const activeCanvasId = useCanvasStore(state => state.activeCanvasId)
  const sortMode = useSettingStore(state => state.canvasManagerSortMode)
  const trashMode = useCanvasStore(state => state.trashMode)
  const setTrashMode = useCanvasStore(state => state.setTrashMode)
  const addTab = useArticleStore(state => state.addTab)
  const removeTab = useArticleStore(state => state.removeTab)
  const openTabs = useArticleStore(state => state.openTabs)
  const setOpenTabs = useArticleStore(state => state.setOpenTabs)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CanvasProject | null>(null)
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<CanvasProject | null>(null)
  const [processingCanvas, setProcessingCanvas] = useState<{
    id: string
    action: 'delete' | 'permanent-delete'
  } | null>(null)
  const [syncState, setSyncState] = useState<AutoDataSyncState>(() => getAutoDataSyncState())
  const [syncConfigured, setSyncConfigured] = useState(false)
  const [syncedVersions, setSyncedVersions] = useState<Record<string, number>>({})
  const [uploadingCanvasId, setUploadingCanvasId] = useState<string | null>(null)
  const [failedCanvasIds, setFailedCanvasIds] = useState<Set<string>>(() => new Set())
  const viewMode = useSettingStore(state => state.canvasManagerViewMode)

  useEffect(() => {
    let active = true
    const refreshSyncedVersions = async () => {
      const store = await Store.load('store.json')
      const versions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
      if (active) setSyncedVersions(versions)
    }
    const refreshSyncConfigured = async () => {
      const configured = await isAutoDataSyncProviderConfigured()
      if (active) setSyncConfigured(configured)
    }
    const unsubscribe = subscribeAutoDataSyncState(nextState => {
      setSyncState(nextState)
      void refreshSyncConfigured()
      if (!nextState.isSyncing) void refreshSyncedVersions()
    })
    void refreshSyncedVersions()
    void refreshSyncConfigured()
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const visibleProjects = useMemo(() => {
    const source = trashMode ? deletedProjects : projects
    return [...source].sort((left, right) => {
      if (!trashMode && Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) return left.pinnedAt ? -1 : 1
      if (!trashMode && left.pinnedAt && right.pinnedAt) return right.pinnedAt - left.pinnedAt
      if (sortMode === 'created') return right.createdAt - left.createdAt
      if (sortMode === 'name') return left.title.localeCompare(right.title)
      return right.updatedAt - left.updatedAt
    })
  }, [deletedProjects, projects, sortMode, trashMode])

  const getSyncStatus = (project: CanvasProject): CanvasSyncDisplayStatus => {
    if (uploadingCanvasId === project.id) return 'uploading'
    if (syncedVersions[project.id] === project.updatedAt) return 'synced'
    if (failedCanvasIds.has(project.id)) return 'failed'
    if (syncState.isSyncing
      && syncState.currentDomain === 'records'
      && syncState.phase === 'uploading') return 'uploading'
    if (syncState.status === 'failed' && syncState.affectedDomains.includes('records')) return 'failed'
    return 'pending'
  }

  const refreshSyncedVersions = async () => {
    const store = await Store.load('store.json')
    setSyncedVersions(await store.get<Record<string, number>>('canvasSyncVersions') || {})
  }

  const handleUpload = async (project: CanvasProject) => {
    if (uploadingCanvasId) return
    setUploadingCanvasId(project.id)
    setFailedCanvasIds(current => {
      const next = new Set(current)
      next.delete(project.id)
      return next
    })
    try {
      const uploaded = await uploadCanvas(project.id)
      if (uploaded) {
        await refreshSyncedVersions()
      } else {
        setFailedCanvasIds(current => new Set(current).add(project.id))
      }
    } catch {
      setFailedCanvasIds(current => new Set(current).add(project.id))
    } finally {
      setUploadingCanvasId(null)
    }
  }

  const handleOpen = async (id: string) => {
    const project = await openProject(id)
    if (project) await addTab(createCanvasTab(project))
  }

  const handleCreate = async (canvasType: CanvasProjectType = 'blank') => {
    const project = await createProject(canvasType, t(`templates.${canvasType}`))
    if (project) await addTab(createCanvasTab(project))
  }

  const handleImport = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: t('import.fileType'), extensions: ['json', 'canvas', 'mmd', 'mermaid'] }],
      })
      if (!path || Array.isArray(path)) return
      const source = await readTextFile(path)
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.(canvas\.)?json$|\.(mmd|mermaid)$/i, '') || t('import.defaultTitle')
      const imported = /\.(mmd|mermaid)$/i.test(path)
        ? { title: fileName, canvasType: 'flowchart' as const, document: mermaidToCanvasDocument(source) }
        : parseCanvasProjectFile(source)
      const project = await createProjectFromDocument(imported.document, imported.title, imported.canvasType)
      if (project) {
        await addTab(createCanvasTab(project))
        toast.success(t('import.success'))
      }
    } catch (error) {
      console.error('Failed to import canvas:', error)
      toast.error(t('import.error'))
    }
  }

  const handleRestore = async (id: string) => {
    const project = await restoreProject(id)
    if (project) await addTab(createCanvasTab(project))
  }

  const handleDuplicate = async (project: CanvasProject) => {
    const duplicate = await duplicateProject(
      project.id,
      t('duplicateTitle', { title: project.title })
    )
    if (duplicate) await addTab(createCanvasTab(duplicate))
  }

  const handleDelete = async (id: string) => {
    if (processingCanvas) return
    const syncConfigured = await isAutoDataSyncProviderConfigured()
    if (syncConfigured) setProcessingCanvas({ id, action: 'delete' })
    const tabId = getCanvasTabPath(id)
    const wasActive = useArticleStore.getState().activeTabId === tabId
    try {
      const result = await deleteProject(id, syncConfigured)
      if (result === 'synced') {
        await refreshSyncedVersions()
      } else if (result === 'pending') {
        toast.error(t('manager.sync.failed'))
      }
      await removeTab(tabId)
      if (wasActive) {
        await useArticleStore.getState().setActiveTabId('')
        await useArticleStore.getState().setActiveFilePath('')
      }
    } finally {
      setProcessingCanvas(null)
    }
  }

  const handlePermanentDelete = async (project: CanvasProject) => {
    if (processingCanvas) return
    const syncConfigured = await isAutoDataSyncProviderConfigured()
    if (syncConfigured) setProcessingCanvas({ id: project.id, action: 'permanent-delete' })
    try {
      const deleted = await permanentlyDeleteProject(project.id, syncConfigured)
      if (!deleted) toast.error(t('permanentDeleteDialog.error'))
    } catch {
      toast.error(t('permanentDeleteDialog.error'))
    } finally {
      setProcessingCanvas(null)
    }
  }

  const finishRename = async () => {
    if (!editingId) return
    const normalizedTitle = editingTitle.trim()
    await renameProject(editingId, normalizedTitle)
    if (normalizedTitle) {
      await setOpenTabs(openTabs.map(tab => (
        tab.canvasId === editingId ? { ...tab, name: normalizedTitle } : tab
      )))
    }
    setEditingId(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {syncState.phase === 'downloading' && syncState.affectedDomains.includes('records') && (
          <div
            role="status"
            className="border-y border-border bg-muted/35 px-3 py-2 text-foreground"
          >
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <DownloadCloud className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {t('manager.sync.downloadingAll')}
              </span>
              <Loader2 className="size-3.5 shrink-0 animate-spin opacity-80" />
            </div>
          </div>
        )}
        {trashMode && (
          <div className="sticky top-0 z-20 border-b bg-background p-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              onClick={() => setTrashMode(false)}
            >
              <ArrowLeft />
              {t('manager.closeTrash')}
            </Button>
          </div>
        )}
        {visibleProjects.length === 0 ? (
          <Empty className="min-h-72 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">{trashMode ? <Trash2 /> : <Palette />}</EmptyMedia>
              <EmptyTitle>{trashMode ? t('manager.trashEmpty') : t('empty.title')}</EmptyTitle>
              <EmptyDescription>{trashMode ? t('manager.trashEmptyDescription') : t('empty.description')}</EmptyDescription>
            </EmptyHeader>
            {!trashMode && (
              <EmptyContent className="flex-row justify-center">
                <Button onClick={() => void handleCreate('blank')}>
                  <Palette data-icon="inline-start" />
                  {t('new')}
                </Button>
                <Button variant="outline" onClick={() => void handleImport()}>
                  <FileInput data-icon="inline-start" />
                  {t('import.action')}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className={cn(
            'p-2',
            viewMode === 'grid'
              ? 'grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2'
              : 'flex flex-col gap-1'
          )}>
        {visibleProjects.map(project => (
          <ContextMenu key={project.id}>
            <ContextMenuTrigger asChild>
          <div className={cn(
            'relative overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm',
            viewMode === 'list' && 'flex items-center gap-2 p-1',
            !trashMode && activeCanvasId === project.id && 'border-primary ring-1 ring-primary/30',
            trashMode && 'opacity-75 hover:opacity-100'
          )}
            draggable={!trashMode && editingId !== project.id}
            onDragStart={event => !trashMode && setCanvasDragData(event.dataTransfer, project.id)}
          >
            {processingCanvas?.id === project.id && (
              <div className={cn(
                'absolute z-30 flex flex-col items-center justify-center gap-1 bg-background/80 px-2 py-1 text-center text-xs font-medium leading-tight backdrop-blur-sm',
                viewMode === 'grid' ? 'inset-x-0 top-0 aspect-[4/3]' : 'inset-0'
              )}>
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                <span className="w-full whitespace-normal break-words text-center">
                  {processingCanvas.action === 'delete'
                    ? t('manager.sync.deleting')
                    : t('manager.sync.permanentlyDeleting')}
                </span>
              </div>
            )}
            {!trashMode && editingId === project.id ? (
              <div className={cn('flex min-w-0 flex-1 items-center gap-2', viewMode === 'grid' ? 'p-2' : 'px-1')}>
                {viewMode === 'list' && <CanvasThumbnail project={project} compact />}
                <Input
                  autoFocus
                  value={editingTitle}
                  onChange={event => setEditingTitle(event.target.value)}
                  onBlur={() => void finishRename()}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void finishRename()
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                  className="h-7"
                />
              </div>
            ) : (
              <button
                type="button"
                draggable={!trashMode}
                onDragStart={event => !trashMode && setCanvasDragData(event.dataTransfer, project.id)}
                className={cn(
                  'min-w-0 text-left',
                  viewMode === 'grid' ? 'block w-full' : 'flex flex-1 items-center gap-2',
                  trashMode && 'cursor-default'
                )}
                onClick={() => {
                  if (!trashMode) void handleOpen(project.id)
                }}
              >
                <CanvasThumbnail project={project} compact={viewMode === 'list'} />
                <span className={cn(
                  'block min-w-0 flex-1 truncate text-xs font-medium',
                  viewMode === 'grid' ? 'px-2 py-2' : syncConfigured ? 'pr-7' : 'pr-2'
                )}>{project.title}</span>
              </button>
            )}
            {!trashMode && project.pinnedAt && (
              <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-background/85 p-1 text-primary shadow-sm">
                <Pin className="size-3" />
              </span>
            )}
            {syncConfigured && (
              <CanvasSyncIndicator
                status={getSyncStatus(project)}
                label={getSyncStatus(project) === 'pending'
                  ? t('manager.sync.clickToUpload')
                  : t(`manager.sync.${getSyncStatus(project)}`)}
                onClick={getSyncStatus(project) === 'pending'
                  ? () => void handleUpload(project)
                  : undefined}
                className={cn(
                  'absolute z-10',
                  viewMode === 'grid' ? 'right-1 top-1' : 'right-1 top-1/2 -translate-y-1/2'
                )}
              />
            )}
          </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {trashMode ? (
                <ContextMenuGroup>
                  <ContextMenuItem onSelect={() => void handleRestore(project.id)}>
                    <RotateCcw />
                    {t('restore')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => setPendingPermanentDelete(project)}
                  >
                    <Trash2 />
                    {t('permanentDelete')}
                  </ContextMenuItem>
                </ContextMenuGroup>
              ) : (<>
              <ContextMenuGroup>
                {syncConfigured && (
                  <ContextMenuItem
                    disabled={getSyncStatus(project) === 'uploading' || getSyncStatus(project) === 'synced'}
                    onSelect={() => void handleUpload(project)}
                  >
                    {getSyncStatus(project) === 'uploading'
                      ? <Loader2 className="animate-spin" />
                      : <CloudUpload />}
                    {t('manager.sync.upload')}
                  </ContextMenuItem>
                )}
                <ContextMenuItem onSelect={() => void togglePin(project.id)}>
                  {project.pinnedAt ? <PinOff /> : <Pin />}
                  {project.pinnedAt ? t('manager.unpin') : t('manager.pin')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => {
                  setEditingId(project.id)
                  setEditingTitle(project.title)
                }}>
                  <Pencil />
                  {t('rename')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleDuplicate(project)}>
                  <CopyPlus />
                  {t('duplicate')}
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => setPendingDelete(project)}>
                <Trash2 />
                {t('delete')}
              </ContextMenuItem>
              </>) }
            </ContextMenuContent>
          </ContextMenu>
          ))}
          </div>
        )}

      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDialog.description', { title: pendingDelete?.title || '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              {t('deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(pendingPermanentDelete)}
        onOpenChange={open => !open && setPendingPermanentDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('permanentDeleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('permanentDeleteDialog.description', { title: pendingPermanentDelete?.title || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('permanentDeleteDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const project = pendingPermanentDelete
                setPendingPermanentDelete(null)
                if (project) void handlePermanentDelete(project)
              }}
            >
              {t('permanentDeleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
