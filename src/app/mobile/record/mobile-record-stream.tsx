'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { LocalImage } from '@/components/local-image'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Trash2, MoveRight, CheckSquare, Filter, Plus, ListChecks, RotateCcw, Search, ChevronDown, XCircle } from 'lucide-react'
import { filterMarks, getTrashRecordFilters } from '@/app/core/main/mark/mark-filters'
import { getMarkTypeChipClasses, MARK_TYPE_OPTIONS } from '@/app/core/main/mark/mark-type-meta'
import useMarkStore, { RecordTimePreset } from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { clearTrash, delMark, delMarkForever, initMarksDb, Mark, restoreMark, restoreMarks, updateMark as updateMarkDb } from '@/db/marks'
import { insertTag } from '@/db/tags'
import { cn } from '@/lib/utils'

const TIME_OPTIONS: RecordTimePreset[] = ['all', 'today', 'last7Days', 'last30Days']

function getMarkPreview(mark: Mark): string {
  if (mark.type === 'text') return mark.content?.trim() || mark.desc?.trim() || ''
  if (mark.type === 'image' || mark.type === 'scan') return mark.desc?.trim() || mark.content?.trim() || ''
  if (mark.type === 'link') return mark.url || mark.desc || ''
  return mark.desc?.trim() || mark.content?.trim() || mark.url || ''
}

export function MobileRecordStream() {
  const t = useTranslations()
  const {
    trashState,
    setTrashState,
    marks,
    queues,
    fetchMarks,
    fetchAllTrashMarks,
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    resetRecordFilters,
    setVisibleMarkIds,
    initRecordFilters,
  } = useMarkStore()
  const { tags, fetchTags, currentTagId, setCurrentTagId, initTags } = useTagStore()

  const [multiMode, setMultiMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [tagDrawerOpen, setTagDrawerOpen] = useState(false)
  const [createTagOpen, setCreateTagOpen] = useState(false)
  const [typeFilterOpen, setTypeFilterOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [activeMark, setActiveMark] = useState<Mark | null>(null)
  const [moveTargetMark, setMoveTargetMark] = useState<Mark | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const isSwipingRef = useRef(false)
  const swipingMarkIdRef = useRef<number | null>(null)
  const [swipedMarkId, setSwipedMarkId] = useState<number | null>(null)
  const [swipeDeltaX, setSwipeDeltaX] = useState(0)

  useEffect(() => {
    initMarksDb()
  }, [])

  useEffect(() => {
    initRecordFilters()
  }, [initRecordFilters])

  useEffect(() => {
    initTags()
  }, [initTags])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchMarks()
    }
  }, [trashState, currentTagId, fetchMarks, fetchAllTrashMarks])

  useEffect(() => {
    if (!multiMode) {
      setSelectedIds(new Set())
    }
  }, [multiMode])

  useEffect(() => {
    if (!activeMark) return
    setEditDesc(activeMark.type === 'text' ? (activeMark.content || '') : (activeMark.desc || ''))
    setEditContent(activeMark.content || '')
    setEditUrl(activeMark.url || '')
  }, [activeMark])

  useEffect(() => {
    if (!activeMark) return
    const hasChanges =
      (activeMark.desc || '') !== editDesc ||
      (activeMark.content || '') !== editContent ||
      (activeMark.url || '') !== editUrl

    if (!hasChanges) return

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      const updatedMark: Mark = {
        ...activeMark,
        desc: activeMark.type === 'text' ? editContent : editDesc,
        content: editContent,
        url: editUrl,
      }
      await updateMarkDb(updatedMark)
      setActiveMark(updatedMark)
      await refreshRecords()
    }, 300)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [activeMark, editDesc, editContent, editUrl])

  const records = marks
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const mobileRecordFilters = useMemo(() => {
    if (trashState) {
      return getTrashRecordFilters()
    }

    return {
      ...recordFilters,
      tagId: 'all' as const,
    }
  }, [trashState, recordFilters])

  const filteredRecords = useMemo(() => {
    return filterMarks(records, mobileRecordFilters)
  }, [records, mobileRecordFilters])

  const groupedRecords = useMemo(() => {
    const groups: Array<{ day: string; list: Mark[] }> = []
    const groupMap = new Map<string, Mark[]>()
    for (const mark of filteredRecords) {
      const day = dayjs(mark.createdAt).format('YYYY-MM-DD')
      if (!groupMap.has(day)) groupMap.set(day, [])
      groupMap.get(day)!.push(mark)
    }
    Array.from(groupMap.keys()).forEach((day) => {
      groups.push({ day, list: groupMap.get(day)! })
    })
    return groups
  }, [filteredRecords])

  useEffect(() => {
    setVisibleMarkIds(filteredRecords.map((mark: Mark) => mark.id))
    return () => setVisibleMarkIds([])
  }, [filteredRecords, setVisibleMarkIds])

  function getDayLabel(day: string) {
    if (dayjs(day).isSame(dayjs(), 'day')) return t('common.today')
    if (dayjs(day).isSame(dayjs().subtract(1, 'day'), 'day')) return t('common.yesterday')
    return day
  }

  async function refreshRecords() {
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
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
    const accepted = await confirm(t('record.trash.confirm'), {
      title: t('record.trash.title'),
      kind: 'warning',
    })
    if (!accepted) return
    await clearTrash()
    await fetchAllTrashMarks()
  }

  async function handleRestoreAll() {
    if (marks.length === 0) return
    await restoreMarks(marks.map((item) => item.id))
    await fetchAllTrashMarks()
  }

  async function handleMove(mark: Mark, targetTagId: number) {
    await updateMarkDb({ ...mark, tagId: targetTagId })
    await refreshRecords()
  }

  function getActionWidth() {
    return 120
  }

  function handleItemTouchStart(e: React.TouchEvent, markId: number) {
    if (multiMode) return
    const touch = e.touches[0]
    touchStartXRef.current = touch.clientX
    touchStartYRef.current = touch.clientY
    isSwipingRef.current = false
    swipingMarkIdRef.current = markId
    if (swipedMarkId !== markId) {
      setSwipedMarkId(null)
    }
  }

  function handleItemTouchMove(e: React.TouchEvent) {
    if (multiMode || swipingMarkIdRef.current === null) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStartXRef.current
    const deltaY = touch.clientY - touchStartYRef.current

    if (!isSwipingRef.current) {
      if (Math.abs(deltaX) < 8) return
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return
      isSwipingRef.current = true
    }

    e.preventDefault()
    const maxLeft = -getActionWidth()
    const next = Math.max(maxLeft, Math.min(0, deltaX))
    setSwipeDeltaX(next)
  }

  function handleItemTouchEnd() {
    if (multiMode || swipingMarkIdRef.current === null) return
    const id = swipingMarkIdRef.current
    const maxLeft = -getActionWidth()
    const shouldOpen = swipeDeltaX < maxLeft / 2
    setSwipedMarkId(shouldOpen ? id : null)
    setSwipeDeltaX(0)
    isSwipingRef.current = false
    swipingMarkIdRef.current = null
  }

  async function handleMoveTargetTag(targetTagId: number) {
    if (!moveTargetMark) return
    await handleMove(moveTargetMark, targetTagId)
    setMoveTargetMark(null)
    setSwipedMarkId(null)
  }

  async function handleDeleteSelected() {
    const targets = filteredRecords.filter((item: Mark) => selectedIds.has(item.id))
    for (const item of targets) {
      if (trashState) {
        await delMarkForever(item.id)
      } else {
        await delMark(item.id)
      }
    }
    setSelectedIds(new Set())
    await refreshRecords()
  }

  async function handleMoveSelected(targetTagId: number) {
    const targets = filteredRecords.filter((item: Mark) => selectedIds.has(item.id))
    for (const item of targets) {
      await updateMarkDb({ ...item, tagId: targetTagId })
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
    const res = await insertTag({ name: value })
    const newTagId = Number(res.lastInsertId)
    await fetchTags()
    await setCurrentTagId(newTagId)
    setNewTagName('')
    setCreateTagOpen(false)
    setTagDrawerOpen(false)
  }

  function handleResetFilters() {
    resetRecordFilters()
    setTypeFilterOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mobile-page-header sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-3">
        {trashState ? (
          <div className="px-2 text-sm font-medium">{t('record.trash.title')}</div>
        ) : multiMode ? (
          <div className="px-2 text-sm font-medium">{t('record.mark.toolbar.multiSelectMode')}</div>
        ) : (
          <Drawer open={tagDrawerOpen} onOpenChange={setTagDrawerOpen}>
            <Button variant="ghost" className="h-11 px-2 text-sm font-medium" onClick={() => setTagDrawerOpen(true)}>
              <span className="truncate">{currentTagLabel}</span>
              <ChevronDown className="ml-1 size-4 text-muted-foreground" />
            </Button>
            <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
              <DrawerHeader>
                <DrawerTitle>{t('record.mark.toolbar.filter.tag')}</DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-4 space-y-2 overflow-auto">
                {tags.map((tag) => (
                  <Button
                    key={tag.id}
                    variant={currentTagId === tag.id ? 'default' : 'outline'}
                    className="h-10 w-full justify-start"
                    onClick={async () => {
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

        <div className="flex items-center gap-1">
          {trashState ? (
            <>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={handleRestoreAll} disabled={marks.length === 0} title={t('record.trash.restoreAll')}>
                <RotateCcw className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={handleClearTrash} disabled={marks.length === 0} title={t('record.trash.empty')}>
                <Trash2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setTrashState(false)} title={t('common.close')}>
                <XCircle className="size-4" />
              </Button>
            </>
          ) : multiMode ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                onClick={() => setSelectedIds(isAllSelected ? new Set() : new Set(filteredRecords.map((item: Mark) => item.id)))}
                title={t('record.mark.toolbar.selectAll')}
              >
                <ListChecks className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    disabled={selectedCount === 0 || !canMoveBetweenTags}
                    title={t('record.mark.toolbar.moveTag')}
                  >
                    <MoveRight className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {tags.map((tag) => (
                    <DropdownMenuItem key={tag.id} onClick={() => handleMoveSelected(tag.id)}>
                      {tag.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive" disabled={selectedCount === 0} onClick={handleDeleteSelected} title={t('record.mark.toolbar.delete')}>
                <Trash2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setMultiMode(false)} title={t('record.mark.toolbar.exitMultiSelect')}>
                <XCircle className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="relative h-11 w-11" title={t('record.mark.toolbar.filter.title')} onClick={() => setTypeFilterOpen(true)}>
                <Filter className="size-4" />
                {isFilterActive ? (
                  <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                ) : null}
              </Button>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setMultiMode(true)} title={t('record.mark.toolbar.multiSelect')}>
                <CheckSquare className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setTrashState(true)} title={t('record.mark.toolbar.trash')}>
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {!trashState && queues.length > 0 && (
          <div className="mb-3 space-y-2">
            {queues.map((queue) => (
              <div key={queue.queueId} className="rounded-xl border border-dashed bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {t(`record.mark.type.${queue.type}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{queue.progress}</span>
                </div>
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
                {group.list.map((mark) => {
                  const actionWidth = getActionWidth()
                  const isCurrentSwiping = swipingMarkIdRef.current === mark.id
                  const translateX = isCurrentSwiping
                    ? swipeDeltaX
                    : swipedMarkId === mark.id
                      ? -actionWidth
                      : 0

                  return (
                  <div key={mark.id} className="relative overflow-hidden rounded-xl bg-background">
                    {!multiMode && (
                      <div className="absolute inset-y-0 right-0 flex items-center gap-2 px-2">
                        {trashState ? (
                          <>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-11 rounded-xl shadow-sm"
                              onClick={() => {
                                handleRestore(mark)
                                setSwipedMarkId(null)
                              }}
                              title={t('record.mark.toolbar.restore')}
                              aria-label={t('record.mark.toolbar.restore')}
                            >
                              <RotateCcw className="size-4" />
                              <span className="sr-only">{t('record.mark.toolbar.restore')}</span>
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="size-11 rounded-xl shadow-sm"
                              onClick={() => {
                                handleDelete(mark)
                                setSwipedMarkId(null)
                              }}
                              title={t('record.mark.toolbar.deleteForever')}
                              aria-label={t('record.mark.toolbar.deleteForever')}
                            >
                              <Trash2 className="size-4" />
                              <span className="sr-only">{t('record.mark.toolbar.deleteForever')}</span>
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-11 rounded-xl shadow-sm"
                              disabled={!canMoveBetweenTags}
                              onClick={() => {
                                setMoveTargetMark(mark)
                                setSwipedMarkId(null)
                              }}
                              title={t('record.mark.toolbar.moveTag')}
                              aria-label={t('record.mark.toolbar.moveTag')}
                            >
                              <MoveRight className="size-4" />
                              <span className="sr-only">{t('record.mark.toolbar.moveTag')}</span>
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="size-11 rounded-xl shadow-sm"
                              onClick={() => {
                                handleDelete(mark)
                                setSwipedMarkId(null)
                              }}
                              title={t('record.mark.toolbar.delete')}
                              aria-label={t('record.mark.toolbar.delete')}
                            >
                              <Trash2 className="size-4" />
                              <span className="sr-only">{t('record.mark.toolbar.delete')}</span>
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    <div
                      className="rounded-xl border bg-background px-3 py-3 transition-transform duration-200 ease-out"
                      style={{ transform: `translateX(${translateX}px)` }}
                      onTouchStart={(e) => handleItemTouchStart(e, mark.id)}
                      onTouchMove={handleItemTouchMove}
                      onTouchEnd={handleItemTouchEnd}
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
                        onClick={() => {
                          if (swipedMarkId === mark.id) {
                            setSwipedMarkId(null)
                            return
                          }
                          setActiveMark(mark)
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`record.mark.type.${mark.type}`)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{dayjs(mark.createdAt).format('HH:mm')}</span>
                          {!trashState && (
                            <span className="ml-auto text-xs text-muted-foreground">{tagMap.get(mark.tagId) || '-'}</span>
                          )}
                        </div>
                        {(mark.type === 'image' || mark.type === 'scan') && mark.url ? (
                          <div className="mt-2 flex items-center gap-2">
                            <LocalImage
                              src={mark.url.includes('http') ? mark.url : `/${mark.type === 'scan' ? 'screenshot' : 'image'}/${mark.url}`}
                              alt=""
                              className="h-12 w-12 rounded-md object-cover"
                            />
                            <p className="line-clamp-2 text-sm text-muted-foreground">{getMarkPreview(mark) || '-'}</p>
                          </div>
                        ) : (
                          <p className="mt-2 line-clamp-2 text-sm">{getMarkPreview(mark) || '-'}</p>
                        )}
                      </button>
                    </div>
                    </div>
                  </div>
                )})}
              </div>
            </div>
          ))
        )}
      </div>

      <Sheet open={Boolean(activeMark)} onOpenChange={(open) => !open && setActiveMark(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
          {activeMark && (
            <>
              <SheetHeader>
                <SheetTitle>{t(`record.mark.type.${activeMark.type}`)}</SheetTitle>
              </SheetHeader>
              <div className="mt-3 space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">{dayjs(activeMark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</div>
                {(activeMark.type === 'image' || activeMark.type === 'scan') && activeMark.url && (
                  <div className="overflow-hidden rounded-lg border bg-muted/20 p-2">
                    <LocalImage
                      src={activeMark.url.includes('http') ? activeMark.url : `/${activeMark.type === 'scan' ? 'screenshot' : 'image'}/${activeMark.url}`}
                      alt=""
                      className="h-48 w-full rounded-md object-contain"
                    />
                  </div>
                )}
                {activeMark.type !== 'text' && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t('record.mark.desc')}</div>
                    <Textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={3}
                      className="min-h-20"
                    />
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">{t('record.mark.content')}</div>
                  <Textarea
                    value={editContent}
                    onChange={(e) => {
                      const next = e.target.value
                      setEditContent(next)
                      if (activeMark.type === 'text') {
                        setEditDesc(next)
                      }
                    }}
                    rows={8}
                    className="min-h-28"
                  />
                </div>
                {activeMark.type === 'link' && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">URL</div>
                    <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
          <div className="px-4 pb-4 space-y-3 overflow-auto">
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
