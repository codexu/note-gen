'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { LocalImage } from '@/components/local-image'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, MoveRight, CheckSquare, XSquare, Filter, Plus, ListChecks, RotateCcw, Search } from 'lucide-react'
import { filterMarks } from '@/app/core/main/mark/mark-filters.mjs'
import { getMarkTypeChipClasses, MARK_TYPE_OPTIONS } from '@/app/core/main/mark/mark-type-meta'
import useMarkStore, { RecordTimePreset } from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { delMark, delMarkForever, Mark, restoreMark, updateMark as updateMarkDb } from '@/db/marks'
import { insertTag } from '@/db/tags'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
    marks,
    allMarks,
    queues,
    fetchAllMarks,
    fetchAllTrashMarks,
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    setRecordTagId,
    resetRecordFilters,
    hasActiveRecordFilters,
    setVisibleMarkIds,
    initRecordFilters,
  } = useMarkStore()
  const { tags, fetchTags } = useTagStore()

  const [multiMode, setMultiMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
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
    initRecordFilters()
  }, [initRecordFilters])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchAllMarks()
    }
  }, [trashState, fetchAllMarks, fetchAllTrashMarks])

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

  // 新增记录流程会先刷新 marks（当前标签），这里同步拉取 allMarks 保持时间流实时更新
  useEffect(() => {
    if (!trashState) {
      fetchAllMarks()
    }
  }, [marks, trashState, fetchAllMarks])

  const records = trashState ? marks : allMarks
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])

  const filteredRecords = useMemo(() => {
    return filterMarks(records, recordFilters)
  }, [records, recordFilters])

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
      await fetchAllMarks()
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

  const tagLabel = recordFilters.tagId === 'all' ? t('common.all') : (tags.find((item) => item.id === recordFilters.tagId)?.name || t('common.all'))

  const selectedTypeCount = recordFilters.selectedTypes.length
  const canMoveBetweenTags = tags.length >= 2
  const isFilterActive = hasActiveRecordFilters()

  function toggleTypeFilter(type: Mark['type']) {
    toggleRecordType(type)
  }

  function selectAllTypes() {
    if (recordFilters.selectedTypes.length === MARK_TYPE_OPTIONS.length) {
      MARK_TYPE_OPTIONS.forEach((type) => {
        if (recordFilters.selectedTypes.includes(type)) {
          toggleRecordType(type)
        }
      })
      return
    }

    MARK_TYPE_OPTIONS.forEach((type) => {
      if (!recordFilters.selectedTypes.includes(type)) {
        toggleRecordType(type)
      }
    })
  }

  async function handleCreateTag() {
    const value = newTagName.trim()
    if (!value) return
    const res = await insertTag({ name: value })
    const newTagId = Number(res.lastInsertId)
    await fetchTags()
    setRecordTagId(newTagId)
    setNewTagName('')
    setCreateTagOpen(false)
  }

  function handleResetFilters() {
    resetRecordFilters()
    setTypeFilterOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      {!trashState && (
        <div className="sticky top-0 z-10 border-b bg-background px-3 pb-2 pt-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            {!multiMode ? (
              <>
                <Select value={String(recordFilters.tagId)} onValueChange={(value) => setRecordTagId(value === 'all' ? 'all' : Number(value))}>
                  <SelectTrigger className="h-9 min-w-0 flex-1">
                    <SelectValue placeholder={tagLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={String(tag.id)}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setCreateTagOpen(true)} title={t('record.mark.tag.newTag')}>
                  <Plus className="size-4" />
                </Button>

                <Button
                  variant={isFilterActive ? 'secondary' : 'outline'}
                  size="sm"
                  className="relative h-9 w-9 shrink-0"
                  title={t('record.mark.toolbar.filter.title')}
                  onClick={() => setTypeFilterOpen(true)}
                >
                  <Filter className="size-4" />
                  {isFilterActive ? (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                  ) : null}
                </Button>

                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setMultiMode(true)} title={t('record.mark.toolbar.multiSelect')}>
                  <CheckSquare className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setSelectedIds(isAllSelected ? new Set() : new Set(filteredRecords.map((item: Mark) => item.id)))}
                    title={t('record.mark.toolbar.selectAll')}
                  >
                    <ListChecks className="size-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        disabled={selectedCount === 0 || !canMoveBetweenTags}
                        title={t('record.mark.toolbar.moveTag')}
                      >
                        <MoveRight className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {tags.map((tag) => (
                        <DropdownMenuItem key={tag.id} onClick={() => handleMoveSelected(tag.id)}>
                          {tag.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="destructive" size="icon" className="h-9 w-9 shrink-0" disabled={selectedCount === 0} onClick={handleDeleteSelected} title={t('record.mark.toolbar.delete')}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Button variant="default" size="icon" className="ml-auto h-9 w-9 shrink-0" onClick={() => setMultiMode(false)} title={t('record.mark.toolbar.exitMultiSelect')}>
                  <XSquare className="size-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
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

      <Sheet open={typeFilterOpen} onOpenChange={setTypeFilterOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('record.mark.toolbar.filter.title')}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('record.mark.toolbar.filter.title')}</CardTitle>
                <CardDescription>{t('record.mark.toolbar.filter.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  <Button variant="ghost" size="sm" className="h-8 px-0 text-xs text-muted-foreground" onClick={selectAllTypes}>
                    {selectedTypeCount === MARK_TYPE_OPTIONS.length && selectedTypeCount > 0 ? t('record.mark.toolbar.filter.clearTypes') : t('record.mark.toolbar.filter.selectAllTypes')}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('record.mark.toolbar.filter.tag')}</div>
                  <Select value={String(recordFilters.tagId)} onValueChange={(value) => setRecordTagId(value === 'all' ? 'all' : Number(value))}>
                    <SelectTrigger className="h-10 rounded-lg">
                      <SelectValue placeholder={t('record.mark.toolbar.filter.allTags')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('record.mark.toolbar.filter.allTags')}</SelectItem>
                      {tags.map((tag) => (
                        <SelectItem key={tag.id} value={String(tag.id)}>
                          {tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button variant="outline" className="h-9 gap-2" onClick={handleResetFilters} disabled={!isFilterActive}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('record.mark.toolbar.filter.clear')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
