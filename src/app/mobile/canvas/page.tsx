'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  BrainCircuit,
  CalendarDays,
  Columns3,
  CopyPlus,
  EllipsisVertical,
  FilePlus2,
  Grid2X2,
  Palette,
  Pencil,
  Pin,
  PinOff,
  ShieldQuestion,
  Timer,
  Trash2,
  Workflow,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { MobileMeSheet } from '@/app/mobile/components/mobile-me-sheet'
import { MobileActionDrawer } from '@/app/mobile/components/mobile-action-drawer'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { canvasDocumentToSvg } from '@/lib/canvas/static-export'
import { isAutoDataSyncProviderConfigured } from '@/lib/sync/auto-data-sync-queue'
import useCanvasStore from '@/stores/canvas'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import type { CanvasProject, CanvasProjectType } from '@/types/canvas'

const TEMPLATE_ICONS = {
  blank: FilePlus2,
  flowchart: Workflow,
  mindmap: BrainCircuit,
  timeline: Timer,
  quadrant: Grid2X2,
  kanban: Columns3,
  swot: ShieldQuestion,
} satisfies Record<CanvasProjectType, typeof FilePlus2>

let mobileCanvasScrollTop = 0

function MobileCanvasThumbnail({ project }: { project: CanvasProject }) {
  const fallback = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(canvasDocumentToSvg(project.document))}`
  const repairThumbnail = useCanvasStore(state => state.repairThumbnail)
  const [failedSourceKey, setFailedSourceKey] = useState<string | null>(null)
  const thumbnailSourceKey = `${project.thumbnailPath || 'missing'}:${project.thumbnailRevision || project.updatedAt}`
  const fallbackActive = failedSourceKey === thumbnailSourceKey
  const source = project.thumbnailPath && !fallbackActive
    ? `${convertFileSrc(project.thumbnailPath)}?v=${project.thumbnailRevision || project.updatedAt}`
    : fallback

  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden border-b bg-muted/20">
      <Image
        src={source}
        alt=""
        fill
        unoptimized
        sizes="(min-width: 700px) 30vw, 50vw"
        className="object-contain p-2"
        onError={() => {
          if (fallbackActive || !project.thumbnailPath) return
          setFailedSourceKey(thumbnailSourceKey)
          void repairThumbnail(project.id)
        }}
      />
    </span>
  )
}

interface MobileCanvasPageProps {
  preview?: boolean
}

export function MobileCanvasPage({ preview = false }: MobileCanvasPageProps = {}) {
  const router = useRouter()
  const t = useTranslations('canvas')
  const projects = useCanvasStore(state => state.projects)
  const loading = useCanvasStore(state => state.loading)
  const loadProjects = useCanvasStore(state => state.loadProjects)
  const createProject = useCanvasStore(state => state.createProject)
  const openProject = useCanvasStore(state => state.openProject)
  const setActiveCanvasId = useCanvasStore(state => state.setActiveCanvasId)
  const duplicateProject = useCanvasStore(state => state.duplicateProject)
  const deleteProject = useCanvasStore(state => state.deleteProject)
  const renameProject = useCanvasStore(state => state.renameProject)
  const togglePin = useCanvasStore(state => state.togglePin)
  const sortMode = useSettingStore(state => state.canvasManagerSortMode)
  const setSortMode = useSettingStore(state => state.setCanvasManagerSortMode)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<CanvasProject | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (preview) return
    setActiveCanvasId(null)
    useChatStore.getState().setMobileActiveContexts({ canvasId: null })
    void loadProjects()
  }, [loadProjects, preview, setActiveCanvasId])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = mobileCanvasScrollTop
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  const visibleProjects = useMemo(() => {
    return [...projects].sort((left, right) => {
      if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) return left.pinnedAt ? -1 : 1
      if (left.pinnedAt && right.pinnedAt) return right.pinnedAt - left.pinnedAt
      if (sortMode === 'created') return right.createdAt - left.createdAt
      if (sortMode === 'name') return left.title.localeCompare(right.title)
      return right.updatedAt - left.updatedAt
    })
  }, [projects, sortMode])

  async function handleCreate(canvasType: CanvasProjectType) {
    const project = await createProject(canvasType, t(`templates.${canvasType}`))
    if (!project) return
    setTemplateOpen(false)
    router.push(`/mobile/canvas/editor?id=${encodeURIComponent(project.id)}`)
  }

  async function handleOpen(projectId: string) {
    const project = await openProject(projectId)
    if (project) router.push(`/mobile/canvas/editor?id=${encodeURIComponent(project.id)}`)
  }

  async function handleDelete(projectId: string) {
    await deleteProject(projectId, await isAutoDataSyncProviderConfigured())
  }

  async function finishRename() {
    if (!editingProject) return
    await renameProject(editingProject.id, editingTitle.trim())
    setEditingProject(null)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="mobile-page-header flex w-full shrink-0 items-center gap-2 border-b bg-background px-2">
        <MobileMeSheet />
        <div className="ml-auto flex shrink-0 items-center">
          <Drawer open={templateOpen} onOpenChange={setTemplateOpen}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('new')}>
                <FilePlus2 className="!size-5" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{t('chooseTemplate')}</DrawerTitle>
                <DrawerDescription>{t('empty.description')}</DrawerDescription>
              </DrawerHeader>
              <div className="grid grid-cols-2 gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {(Object.keys(TEMPLATE_ICONS) as CanvasProjectType[]).map(canvasType => {
                  const Icon = TEMPLATE_ICONS[canvasType]
                  return (
                    <Button
                      key={canvasType}
                      type="button"
                      variant="outline"
                      className="h-14 justify-start"
                      onClick={() => void handleCreate(canvasType)}
                    >
                      <Icon data-icon="inline-start" />
                      {t(`templates.${canvasType}`)}
                    </Button>
                  )
                })}
              </div>
            </DrawerContent>
          </Drawer>
          <MobileActionDrawer
            title={t('more')}
            trigger={
              <Button variant="ghost" size="icon" aria-label={t('more')}>
                <EllipsisVertical className="!size-5" />
              </Button>
            }
            items={[
              {
                key: 'updated',
                label: t('manager.sort.updated'),
                icon: <EllipsisVertical />,
                selected: sortMode === 'updated',
                onSelect: () => setSortMode('updated'),
              },
              {
                key: 'created',
                label: t('manager.sort.created'),
                icon: <CalendarDays />,
                selected: sortMode === 'created',
                onSelect: () => setSortMode('created'),
              },
              {
                key: 'name',
                label: t('manager.sort.name'),
                icon: <Pencil />,
                selected: sortMode === 'name',
                onSelect: () => setSortMode('name'),
              },
            ]}
          />
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        className="mobile-under-dock-scroll min-h-0 flex-1 overflow-y-auto p-3"
        onScroll={(event) => {
          mobileCanvasScrollTop = event.currentTarget.scrollTop
        }}
      >
        {loading && visibleProjects.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[980px]:grid-cols-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="p-2.5">
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <Empty className="min-h-[60vh] border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Palette /></EmptyMedia>
              <EmptyTitle>{t('empty.title')}</EmptyTitle>
              <EmptyDescription>{t('empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setTemplateOpen(true)}>
                <FilePlus2 data-icon="inline-start" />
                {t('new')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[980px]:grid-cols-4">
            {visibleProjects.map(project => (
              <div key={project.id} className="relative">
                  <button
                    type="button"
                    className="w-full min-w-0 overflow-hidden rounded-xl border bg-card text-left transition-colors active:bg-accent"
                    onClick={() => void handleOpen(project.id)}
                  >
                    <MobileCanvasThumbnail project={project} />
                    <span className="block truncate px-2.5 py-2 text-xs font-medium">{project.title}</span>
                    {project.pinnedAt ? (
                      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-background/85 p-1 text-primary">
                        <Pin className="size-3" />
                      </span>
                    ) : null}
                  </button>
                  <div className="absolute right-1.5 top-1.5">
                    <MobileActionDrawer
                      title={project.title}
                      trigger={
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          aria-label={t('more')}
                          onClick={event => event.stopPropagation()}
                        >
                          <EllipsisVertical />
                        </Button>
                      }
                      items={[
                        {
                          key: 'pin',
                          label: project.pinnedAt ? t('manager.unpin') : t('manager.pin'),
                          icon: project.pinnedAt ? <PinOff /> : <Pin />,
                          onSelect: () => togglePin(project.id),
                        },
                        {
                          key: 'rename',
                          label: t('rename'),
                          icon: <Pencil />,
                          onSelect: () => {
                            setEditingProject(project)
                            setEditingTitle(project.title)
                          },
                        },
                        {
                          key: 'duplicate',
                          label: t('duplicate'),
                          icon: <CopyPlus />,
                          onSelect: () => duplicateProject(project.id, t('duplicateTitle', { title: project.title })),
                        },
                        {
                          key: 'delete',
                          label: t('delete'),
                          icon: <Trash2 />,
                          onSelect: () => handleDelete(project.id),
                          destructive: true,
                          separatorBefore: true,
                        },
                      ]}
                    />
                  </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ResponsiveDialog open={Boolean(editingProject)} onOpenChange={open => !open && setEditingProject(null)}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('rename')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('manager.title')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <Input
            autoFocus
            value={editingTitle}
            onChange={event => setEditingTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void finishRename()
            }}
          />
          <Button disabled={!editingTitle.trim()} onClick={() => void finishRename()}>
            {t('rename')}
          </Button>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

export default MobileCanvasPage
