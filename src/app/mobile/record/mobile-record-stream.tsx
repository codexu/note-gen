'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LocalImage } from '@/components/local-image'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { MobileActionDrawer } from '@/app/mobile/components/mobile-action-drawer'
import { MobileMeSheet } from '@/app/mobile/components/mobile-me-sheet'
import { ArrowDown, Trash2, MoveRight, CheckSquare, Filter, Plus, ListChecks, RotateCcw, Search, ChevronDown, XCircle, ImageIcon, MoreVertical } from 'lucide-react'
import { filterMarks, getTrashRecordFilters } from '@/app/core/main/mark/mark-filters'
import { getMarkTypeChipClasses, getMarkTypeListBadgeClasses, MARK_TYPE_OPTIONS } from '@/app/core/main/mark/mark-type-meta'
import useMarkStore, { RecordTimePreset } from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { clearTrash, delMark, deleteMarks, delMarkForever, Mark, restoreMark, restoreMarks, updateMarkTag } from '@/db/marks'
import { insertTag } from '@/db/tags'
import { cn, isHttpUrl } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { refreshRemoteRecordsNow } from '@/lib/sync/auto-data-sync-queue'
import { toast } from '@/hooks/use-toast'

const TIME_OPTIONS: RecordTimePreset[] = ['all', 'today', 'last7Days', 'last30Days']
const PULL_REFRESH_THRESHOLD = 72
const PULL_REFRESH_MAX_DISTANCE = 112
const INITIAL_RENDER_COUNT = 40
const RENDER_BATCH_SIZE = 40
let mobileRecordScrollTop = 0

function getMarkPreview(mark: Mark): string {
  if (mark.type === 'text') return mark.content?.trim() || mark.desc?.trim() || ''
  if (mark.type === 'image' || mark.type === 'scan') return mark.desc?.trim() || mark.content?.trim() || ''
  if (mark.type === 'link') return mark.url || mark.desc || ''
  return mark.desc?.trim() || mark.content?.trim() || mark.url || ''
}

function getMarkImageSrc(mark: Mark) {
  if (!mark.url || (mark.type !== 'image' && mark.type !== 'scan')) {
    return ''
  }

  if (isHttpUrl(mark.url)) {
    return mark.url
  }

  return `/${mark.type === 'scan' ? 'screenshot' : 'image'}/${mark.url}`
}

interface MobileRecordStreamProps {
  preview?: boolean
}

export function MobileRecordStream({ preview = false }: MobileRecordStreamProps = {}) {
  const t = useTranslations()
  const router = useRouter()
  const {
    trashState,
    setTrashState,
    marks,
    queues,
    fetchMarkPreviews,
    fetchTrashMarkPreviews,
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    resetRecordFilters,
    setVisibleMarkIds,
    initRecordFilters,
    pendingScrollMarkId,
    setPendingScrollMarkId,
    highlightedMarkId,
  } = useMarkStore()
  const { tags, fetchTags, currentTagId, setCurrentTagId, initTags } = useTagStore()

  const [multiMode, setMultiMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [tagDrawerOpen, setTagDrawerOpen] = useState(false)
  const [createTagOpen, setCreateTagOpen] = useState(false)
  const [typeFilterOpen, setTypeFilterOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [moveTargetMark, setMoveTargetMark] = useState<Mark | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const pullStartXRef = useRef(0)
  const pullStartYRef = useRef(0)
  const pullDistanceRef = useRef(0)
  const isPullGestureRef = useRef(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [visibleRecordCount, setVisibleRecordCount] = useState(INITIAL_RENDER_COUNT)
  const [isRecordDataReady, setIsRecordDataReady] = useState(preview)

  useEffect(() => {
    if (preview) return

    let cancelled = false

    const prepareRecordData = async () => {
      await Promise.all([initRecordFilters(), initTags()])
      await fetchTags()
      if (!cancelled) {
        setIsRecordDataReady(true)
      }
    }

    void prepareRecordData()
    return () => {
      cancelled = true
    }
  }, [fetchTags, initRecordFilters, initTags, preview])

  useEffect(() => {
    if (!isRecordDataReady || preview) return

    if (trashState) {
      void fetchTrashMarkPreviews()
    } else {
      void fetchMarkPreviews()
    }
  }, [currentTagId, fetchMarkPreviews, fetchTrashMarkPreviews, isRecordDataReady, preview, trashState])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = mobileRecordScrollTop
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!multiMode) {
      setSelectedIds(new Set())
    }
  }, [multiMode])

  const records = marks
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const mobileRecordFilters = useMemo(() => {
    if (trashState) {
      return getTrashRecordFilters()
    }

    return {
      ...recordFilters,
      tagId: 'all' as const,
      tagRules: { include: [], exclude: [], match: 'all' as const },
    }
  }, [trashState, recordFilters])

  const filteredRecords = useMemo(() => {
    return filterMarks(records, mobileRecordFilters, tags)
  }, [records, mobileRecordFilters, tags])

  const renderedRecords = useMemo(
    () => filteredRecords.slice(0, visibleRecordCount),
    [filteredRecords, visibleRecordCount]
  )

  const groupedRecords = useMemo(() => {
    const groups: Array<{ day: string; list: Mark[] }> = []
    const groupMap = new Map<string, Mark[]>()
    for (const mark of renderedRecords) {
      const day = dayjs(mark.createdAt).format('YYYY-MM-DD')
      if (!groupMap.has(day)) groupMap.set(day, [])
      groupMap.get(day)!.push(mark)
    }
    Array.from(groupMap.keys()).forEach((day) => {
      groups.push({ day, list: groupMap.get(day)! })
    })
    return groups
  }, [renderedRecords])

  useEffect(() => {
    setVisibleRecordCount(INITIAL_RENDER_COUNT)
  }, [mobileRecordFilters, trashState])

  useEffect(() => {
    if (visibleRecordCount >= filteredRecords.length) return

    const target = loadMoreRef.current
    const scrollContainer = scrollContainerRef.current
    if (!target || !scrollContainer || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return

      setVisibleRecordCount((count) => Math.min(count + RENDER_BATCH_SIZE, filteredRecords.length))
    }, {
      root: scrollContainer,
      rootMargin: '240px 0px',
    })

    observer.observe(target)
    return () => observer.disconnect()
  }, [filteredRecords.length, visibleRecordCount])

  useEffect(() => {
    if (preview) return

    setVisibleMarkIds(filteredRecords.map((mark: Mark) => mark.id))
    return () => setVisibleMarkIds([])
  }, [filteredRecords, preview, setVisibleMarkIds])

  useEffect(() => {
    if (!pendingScrollMarkId || preview) return
    const targetIndex = filteredRecords.findIndex((mark: Mark) => mark.id === pendingScrollMarkId)
    if (targetIndex < 0) return

    setVisibleRecordCount((count) => Math.max(count, targetIndex + 1))

    let cancelled = false
    let attempts = 0
    const maxAttempts = 20

    const scrollToTarget = () => {
      if (cancelled) return
      const target = document.querySelector<HTMLElement>(`[data-mobile-mark-id="${pendingScrollMarkId}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setPendingScrollMarkId(null)
        return
      }

      if (attempts >= maxAttempts) {
        setPendingScrollMarkId(null)
        return
      }

      attempts += 1
      window.setTimeout(scrollToTarget, 50)
    }

    scrollToTarget()

    return () => {
      cancelled = true
    }
  }, [filteredRecords, pendingScrollMarkId, preview, setPendingScrollMarkId])

  function getDayLabel(day: string) {
    if (dayjs(day).isSame(dayjs(), 'day')) return t('common.today')
    if (dayjs(day).isSame(dayjs().subtract(1, 'day'), 'day')) return t('common.yesterday')
    return day
  }

  async function refreshRecords() {
    if (trashState) {
      await fetchTrashMarkPreviews()
    } else {
      await fetchMarkPreviews()
    }
  }

  function updatePullDistance(distance: number) {
    pullDistanceRef.current = distance
    setPullDistance(distance)
  }

  function handlePullTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const container = scrollContainerRef.current
    if (
      trashState ||
      multiMode ||
      isPullRefreshing ||
      !container ||
      container.scrollTop > 0 ||
      event.touches.length !== 1
    ) {
      isPullGestureRef.current = false
      return
    }

    const touch = event.touches[0]
    pullStartXRef.current = touch.clientX
    pullStartYRef.current = touch.clientY
    isPullGestureRef.current = true
  }

  function handlePullTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (!isPullGestureRef.current || isPullRefreshing) {
      return
    }

    const container = scrollContainerRef.current
    const touch = event.touches[0]
    const deltaX = touch.clientX - pullStartXRef.current
    const deltaY = touch.clientY - pullStartYRef.current

    if (!container || container.scrollTop > 0 || deltaY <= 0 || Math.abs(deltaX) > deltaY) {
      isPullGestureRef.current = false
      updatePullDistance(0)
      return
    }

    event.preventDefault()
    updatePullDistance(Math.min(PULL_REFRESH_MAX_DISTANCE, deltaY * 0.45))
  }

  async function pullRemoteRecords() {
    setIsPullRefreshing(true)
    updatePullDistance(56)

    try {
      const refreshed = await refreshRemoteRecordsNow()
      if (refreshed) {
        await Promise.all([
          fetchTags(),
          refreshRecords(),
        ])
      }
    } finally {
      setIsPullRefreshing(false)
      updatePullDistance(0)
    }
  }

  function handlePullTouchEnd() {
    if (!isPullGestureRef.current) {
      return
    }

    isPullGestureRef.current = false
    if (pullDistanceRef.current >= PULL_REFRESH_THRESHOLD) {
      void pullRemoteRecords()
      return
    }

    updatePullDistance(0)
  }

  function handlePullTouchCancel() {
    isPullGestureRef.current = false
    updatePullDistance(0)
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDelete(mark: Mark) {
    if (trashState) {
      const accepted = await confirm(`${t('record.mark.toolbar.deleteForever')}?\n${t('record.trash.syncWarning')}`, {
        title: t('record.trash.title'),
        kind: 'warning',
      })
      if (!accepted) return
      await delMarkForever(mark.id)
    } else {
      await delMark(mark.id)
    }
    await refreshRecords()
  }

  async function handleRestore(mark: Mark) {
    await restoreMark(mark.id)
    await refreshRecords()
  }

  async function handleClearTrash() {
    const accepted = await confirm(`${t('record.trash.confirm')}\n${t('record.trash.syncWarning')}`, {
      title: t('record.trash.title'),
      kind: 'warning',
    })
    if (!accepted) return
    await clearTrash()
    await fetchTrashMarkPreviews()
  }

  async function handleRestoreAll() {
    if (marks.length === 0) return
    await restoreMarks(marks.map((item) => item.id))
    await fetchTrashMarkPreviews()
  }

  async function handleMove(mark: Mark, targetTagId: number) {
    await updateMarkTag(mark.id, targetTagId)
    await refreshRecords()
  }

  async function handleMoveTargetTag(targetTagId: number) {
    if (!moveTargetMark) return
    await handleMove(moveTargetMark, targetTagId)
    setMoveTargetMark(null)
  }

  async function handleDeleteSelected() {
    const targets = filteredRecords.filter((item: Mark) => selectedIds.has(item.id))
    if (trashState && targets.length > 0) {
      const accepted = await confirm(`${t('record.mark.toolbar.deleteSelectedForever', { count: targets.length })}\n${t('record.trash.syncWarning')}`, {
        title: t('record.trash.title'),
        kind: 'warning',
      })
      if (!accepted) return
    }
    if (trashState) {
      for (const item of targets) {
        await delMarkForever(item.id)
      }
    } else {
      await deleteMarks(targets.map((item) => item.id))
    }
    setSelectedIds(new Set())
    await refreshRecords()
  }

  async function handleMoveSelected(targetTagId: number) {
    const targets = filteredRecords.filter((item: Mark) => selectedIds.has(item.id))
    for (const item of targets) {
      await updateMarkTag(item.id, targetTagId)
    }
    setSelectedIds(new Set())
    await refreshRecords()
  }

  const selectedCount = selectedIds.size
  const isAllSelected = filteredRecords.length > 0 && selectedIds.size === filteredRecords.length

  const canMoveBetweenTags = tags.length >= 2
  const isFilterActive = Boolean(
    recordFilters.search.trim() ||
    recordFilters.selectedTypes.length > 0 ||
    recordFilters.timePreset !== 'all'
  )
  const currentTagLabel = tags.find((item) => item.id === currentTagId)?.name || t('record.mark.list.title')

  function toggleTypeFilter(type: Mark['type']) {
    toggleRecordType(type)
  }

  async function handleCreateTag() {
    const value = newTagName.trim()
    if (!value) return
    try {
      const res = await insertTag({ name: value })
      const newTagId = Number(res.lastInsertId)
      await fetchTags()
      await setCurrentTagId(newTagId)
      setNewTagName('')
      setCreateTagOpen(false)
      setTagDrawerOpen(false)
    } catch (error) {
      toast({ title: t('common.error'), description: String(error), variant: 'destructive' })
    }
  }

  function handleResetFilters() {
    resetRecordFilters()
    setTypeFilterOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mobile-page-header sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-2">
        <div className="flex min-w-0 items-center">
          <MobileMeSheet />
          {trashState ? (
            <div className="truncate px-2 text-sm font-medium">{t('record.trash.title')}</div>
          ) : multiMode ? (
            <div className="truncate px-2 text-sm font-medium">{t('record.mark.toolbar.multiSelectMode')}</div>
          ) : (
            <Drawer open={tagDrawerOpen} onOpenChange={setTagDrawerOpen}>
              <Button variant="ghost" className="h-11 min-w-0 px-2 text-sm font-medium" onClick={() => setTagDrawerOpen(true)}>
                <span className="truncate">{currentTagLabel}</span>
                <ChevronDown className="ml-1 size-4 shrink-0 text-muted-foreground" />
              </Button>
              <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
                <DrawerHeader>
                  <DrawerTitle>{t('record.mark.toolbar.filter.tag')}</DrawerTitle>
                </DrawerHeader>
                <div className="flex flex-col gap-2 px-4 pb-4">
                  {tags.map((tag) => (
                    <Button
                      key={tag.id}
                      variant={currentTagId === tag.id ? 'default' : 'outline'}
                      className="h-10 w-full justify-start"
                      onClick={async () => {
                        useMarkStore.getState().setRecordTagRules({ include: [], exclude: [], match: 'all' })
                        useMarkStore.getState().setRecordTagId('all')
                        await setCurrentTagId(tag.id)
                        setTagDrawerOpen(false)
                      }}
                    >
                      {tag.name}
                    </Button>
                  ))}
                  <Button variant="outline" className="mt-3 h-10 w-full justify-start gap-2" onClick={() => setCreateTagOpen(true)}>
                    <Plus className="size-4" />
                    {t('record.mark.tag.newTag')}
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          )}
        </div>

        <div className="flex items-center">
          {trashState ? (
            <>
              <Button variant="ghost" size="icon" onClick={handleRestoreAll} disabled={marks.length === 0} title={t('record.trash.restoreAll')}>
                <RotateCcw />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleClearTrash} disabled={marks.length === 0} title={t('record.trash.empty')}>
                <Trash2 />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void setTrashState(false, { deferFetch: true })} title={t('common.close')}>
                <XCircle />
              </Button>
            </>
          ) : multiMode ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedIds(isAllSelected ? new Set() : new Set(filteredRecords.map((item: Mark) => item.id)))}
                title={t('record.mark.toolbar.selectAll')}
              >
                <ListChecks />
              </Button>
              <MobileActionDrawer
                title={t('record.mark.toolbar.moveTag')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={selectedCount === 0 || !canMoveBetweenTags}
                    title={t('record.mark.toolbar.moveTag')}
                  >
                    <MoveRight />
                  </Button>
                }
                items={tags.map(tag => ({
                  key: String(tag.id),
                  label: tag.name,
                  onSelect: () => handleMoveSelected(tag.id),
                }))}
              />
              <Button variant="ghost" size="icon" className="text-destructive" disabled={selectedCount === 0} onClick={handleDeleteSelected} title={t('record.mark.toolbar.delete')}>
                <Trash2 />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setMultiMode(false)} title={t('record.mark.toolbar.exitMultiSelect')}>
                <XCircle />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="relative" title={t('record.mark.toolbar.filter.title')} onClick={() => setTypeFilterOpen(true)}>
                <Filter />
                {isFilterActive ? (
                  <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                ) : null}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setMultiMode(true)} title={t('record.mark.toolbar.multiSelect')}>
                <CheckSquare />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void setTrashState(true, { deferFetch: true })} title={t('record.mark.toolbar.trash')}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        className="mobile-under-dock-scroll min-h-0 flex-1 overscroll-y-contain overflow-y-auto px-3 py-2"
        onScroll={(event) => {
          mobileRecordScrollTop = event.currentTarget.scrollTop
        }}
        onTouchStart={handlePullTouchStart}
        onTouchMove={handlePullTouchMove}
        onTouchEnd={handlePullTouchEnd}
        onTouchCancel={handlePullTouchCancel}
      >
        {(pullDistance > 0 || isPullRefreshing) ? (
          <div
            className="flex items-center justify-center gap-2 overflow-hidden text-xs text-muted-foreground transition-[height] duration-150"
            style={{ height: pullDistance }}
            role="status"
          >
            {isPullRefreshing ? (
              <Spinner />
            ) : (
              <ArrowDown
                className={cn(
                  'size-4 transition-transform',
                  pullDistance >= PULL_REFRESH_THRESHOLD && 'rotate-180'
                )}
              />
            )}
            <span>
              {isPullRefreshing
                ? t('record.mark.list.refreshing')
                : pullDistance >= PULL_REFRESH_THRESHOLD
                  ? t('record.mark.list.releaseToRefresh')
                  : t('record.mark.list.pullToRefresh')}
            </span>
          </div>
        ) : null}
        {!trashState && queues.length > 0 && (
          <div className="mb-3 space-y-2">
            {queues.map((queue) => (
              <div key={queue.queueId} className="rounded-xl border border-dashed bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={cn(getMarkTypeListBadgeClasses(queue.type), 'shrink-0 text-[10px]')}>
                    {t(`record.mark.type.${queue.type}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{queue.progress}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tagMap.get(queue.tagId) ? `${t('record.capture.saveTarget')}: ${tagMap.get(queue.tagId)} · ` : ''}{t('record.capture.processingInBackground')}
                </p>
              </div>
            ))}
          </div>
        )}

        {groupedRecords.length === 0 ? (
          <div className="py-14 text-center">
            <div className="text-sm text-muted-foreground">{isFilterActive ? t('record.mark.list.emptyFiltered') : t('record.mark.empty')}</div>
            {isFilterActive ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={handleResetFilters}>
                {t('record.mark.toolbar.filter.clear')}
              </Button>
            ) : null}
          </div>
        ) : (
          groupedRecords.map((group) => (
            <div key={group.day} className="mb-4">
              <div className="mb-2 text-xs font-medium text-muted-foreground">{getDayLabel(group.day)}</div>
              <div className="space-y-2">
                {group.list.map((mark) => (
                    <div
                      key={mark.id}
                      data-mobile-mark-id={mark.id}
                      className={cn(
                        "rounded-xl bg-background transition-colors",
                        highlightedMarkId === mark.id && "record-search-highlight"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-xl border bg-background px-3 py-3",
                          highlightedMarkId === mark.id && "border-primary/30 shadow-sm"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {multiMode ? (
                            <div className="pt-1">
                              <Checkbox checked={selectedIds.has(mark.id)} onCheckedChange={() => toggleSelect(mark.id)} />
                            </div>
                          ) : null}

                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => router.push(`/mobile/record/detail?id=${mark.id}`)}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn(getMarkTypeListBadgeClasses(mark.type), 'shrink-0 text-[10px]')}>
                                {t(`record.mark.type.${mark.type}`)}
                              </span>
                              <span className="ml-auto text-xs text-muted-foreground">{dayjs(mark.createdAt).format('HH:mm')}</span>
                            </div>
                            {(mark.type === 'image' || mark.type === 'scan') && mark.url ? (
                              <div className="mt-2 flex items-center gap-2">
                                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground/60">
                                  <ImageIcon className="size-4" />
                                  <LocalImage
                                    src={getMarkImageSrc(mark)}
                                    alt=""
                                    useThumbnail
                                    thumbnailMaxSize={96}
                                    generateThumbnail={false}
                                    className="absolute inset-0 h-full w-full object-cover"
                                  />
                                </div>
                                <p className="line-clamp-2 text-sm text-muted-foreground">{getMarkPreview(mark) || '-'}</p>
                              </div>
                            ) : (
                              <p className="mt-2 line-clamp-2 text-sm">{getMarkPreview(mark) || '-'}</p>
                            )}
                          </button>
                          {!multiMode ? (
                            <MobileActionDrawer
                              title={getMarkPreview(mark) || t(`record.mark.type.${mark.type}`)}
                              trigger={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-9 shrink-0"
                                  aria-label={t('record.mark.toolbar.more')}
                                  title={t('record.mark.toolbar.more')}
                                  data-vaul-no-drag
                                >
                                  <MoreVertical />
                                </Button>
                              }
                              items={trashState ? [
                                {
                                  key: 'restore',
                                  label: t('record.mark.toolbar.restore'),
                                  icon: <RotateCcw data-icon="inline-start" />,
                                  onSelect: () => handleRestore(mark),
                                },
                                {
                                  key: 'delete-forever',
                                  label: t('record.mark.toolbar.deleteForever'),
                                  icon: <Trash2 data-icon="inline-start" />,
                                  onSelect: () => handleDelete(mark),
                                  destructive: true,
                                  separatorBefore: true,
                                },
                              ] : [
                                {
                                  key: 'move-tag',
                                  label: t('record.mark.toolbar.moveTag'),
                                  icon: <MoveRight data-icon="inline-start" />,
                                  onSelect: () => setMoveTargetMark(mark),
                                  disabled: !canMoveBetweenTags,
                                },
                                {
                                  key: 'delete',
                                  label: t('record.mark.toolbar.delete'),
                                  icon: <Trash2 data-icon="inline-start" />,
                                  onSelect: () => handleDelete(mark),
                                  destructive: true,
                                  separatorBefore: true,
                                },
                              ]}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))
        )}
        {visibleRecordCount < filteredRecords.length ? (
          <div ref={loadMoreRef} className="h-1" aria-hidden="true" />
        ) : null}
      </div>

      <Sheet open={createTagOpen} onOpenChange={setCreateTagOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('record.mark.tag.newTag')}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={t('record.mark.tag.newTagPlaceholder')}
              className="h-10"
            />
            <Button onClick={handleCreateTag} className="h-10 w-full">
              {t('record.mark.tag.add')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Drawer open={typeFilterOpen} onOpenChange={setTypeFilterOpen}>
        <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
          <DrawerHeader>
            <DrawerTitle>{t('record.mark.toolbar.filter.title')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('record.mark.toolbar.filter.search')}</div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={recordFilters.search}
                    onChange={(event) => setRecordSearch(event.target.value)}
                    placeholder={t('record.mark.toolbar.filter.searchPlaceholder')}
                    className="h-10 pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('record.mark.toolbar.filter.time')}</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/35 p-1">
                  {TIME_OPTIONS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRecordTimePreset(preset)}
                      className={cn(
                        'h-9 justify-center rounded-lg px-2 text-xs font-medium',
                        recordFilters.timePreset === preset
                          ? 'bg-background shadow-sm text-foreground hover:bg-background'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      )}
                    >
                      {t(`record.mark.toolbar.filter.timeOptions.${preset}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('record.mark.toolbar.filter.type')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {MARK_TYPE_OPTIONS.map((type) => (
                    <Button
                      key={type}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleTypeFilter(type)}
                      className={cn(
                        'h-9 justify-start rounded-lg px-3 text-sm',
                        getMarkTypeChipClasses(type, recordFilters.selectedTypes.includes(type))
                      )}
                    >
                      {t(`record.mark.type.${type}`)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" className="h-9 gap-2" onClick={handleResetFilters} disabled={!isFilterActive}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('record.mark.toolbar.filter.clear')}
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Sheet open={Boolean(moveTargetMark)} onOpenChange={(open) => !open && setMoveTargetMark(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('record.mark.toolbar.moveTag')}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {tags.filter((tag) => tag.id !== moveTargetMark?.tagId).map((tag) => (
              <Button key={tag.id} variant="outline" className="h-10 w-full justify-start" onClick={() => handleMoveTargetTag(tag.id)}>
                {tag.name}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
