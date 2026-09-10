'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dayjs from 'dayjs'
import { usePathname, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import {
  Copy,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Store } from '@tauri-apps/plugin-store'
import { AudioPlayer } from '@/components/audio-player'
import { LocalImage } from '@/components/local-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { SwipeBack, type SwipeBackHandle } from '@/components/ui/swipe-back'
import { MobileBackButton } from '@/components/mobile-back-button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MobileActionDrawer } from '@/app/mobile/components/mobile-action-drawer'
import { MobileSelectDrawer } from '@/app/mobile/components/mobile-select-drawer'
import { MobileRecordStream } from '@/app/mobile/record/mobile-record-stream'
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
import { parseTodoMarkContent } from '@/app/core/main/mark/mark-list-item-content'
import { getRecordTabPath } from '@/app/core/main/mark/mark-record-tab'
import { getMarkTypeListBadgeClasses } from '@/app/core/main/mark/mark-type-meta'
import type { Priority } from '@/app/core/main/mark/todo-form'
import { isLargeMarkdownDocument } from '@/app/core/main/editor/markdown/large-markdown'
import { delMark, delMarkForever, getMarkById, restoreMark, type Mark } from '@/db/marks'
import { toast } from '@/hooks/use-toast'
import { cn, isHttpUrl } from '@/lib/utils'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import useChatStore from '@/stores/chat'

interface MobileRecordDetailProps {
  markId: number
  isActive: boolean
}

const LargeRecordMarkdownEditor = dynamic(
  () => import('@/app/core/main/editor/markdown/tiptap-editor').then(module => module.TipTapEditor),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted/20" />,
  }
)

interface MarkDraft {
  tagId: number
  desc: string
  content: string
  url: string
  todoTitle: string
  todoDescription: string
  todoCompleted: boolean
  todoPriority: Priority
}

function createDraft(mark: Mark): MarkDraft {
  const todo = parseTodoMarkContent(mark)

  return {
    tagId: mark.tagId,
    desc: mark.desc || '',
    content: mark.content || '',
    url: mark.url || '',
    todoTitle: todo.title,
    todoDescription: todo.description,
    todoCompleted: todo.completed,
    todoPriority: todo.priority,
  }
}

function getImageSrc(mark: Mark) {
  if (!mark.url || (mark.type !== 'image' && mark.type !== 'scan')) return ''
  if (isHttpUrl(mark.url)) return mark.url
  return `/${mark.type === 'scan' ? 'screenshot' : 'image'}/${mark.url}`
}

function DetailField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function MobileRecordDetail({ markId, isActive }: MobileRecordDetailProps) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const {
    updateMark,
    fetchMarkPreviews,
    fetchTrashMarkPreviews,
    setActiveMarkId,
    clearActiveMark,
  } = useMarkStore()
  const { tags, fetchTags, getCurrentTag } = useTagStore()
  const [mark, setMark] = useState<Mark | null>(null)
  const [draft, setDraft] = useState<MarkDraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const autoSaveTimerRef = useRef<number | null>(null)
  const swipeBackRef = useRef<SwipeBackHandle>(null)

  useEffect(() => {
    if (pathname !== '/mobile/record/detail') return
    setActiveMarkId(markId)
    const chatState = useChatStore.getState()
    chatState.setMobileActiveContexts({ markId })
  }, [markId, pathname, setActiveMarkId])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [record] = await Promise.all([getMarkById(markId), fetchTags()])
        if (!cancelled) {
          setMark(record || null)
          if (!record) {
            clearActiveMark()
            const mobileContexts = useChatStore.getState().mobileActiveContexts
            if (mobileContexts.markId === markId) {
              useChatStore.getState().setMobileActiveContexts({ markId: null })
            }
          }
        }
      } catch (error) {
        toast({
          title: t('common.error'),
          description: error instanceof Error ? error.message : t('common.error'),
          variant: 'destructive',
        })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [clearActiveMark, fetchTags, markId])

  useEffect(() => {
    if (mark) setDraft(createDraft(mark))
  }, [mark?.id])

  const savedDraft = useMemo(() => (mark ? createDraft(mark) : null), [mark])
  const hasChanges = Boolean(draft && savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft))
  const isReadOnly = mark?.deleted === 1
  const currentTag = tags.find((tag) => tag.id === draft?.tagId)

  function navigateBack() {
    clearActiveMark()
    useChatStore.getState().setMobileActiveContexts({ markId: null })
    router.push('/mobile/record')
    void Store.load('store.json').then(store => store.set('currentPage', '/mobile/record'))
  }

  const refreshRecords = useCallback(async (deleted: boolean) => {
    if (deleted) {
      await fetchTrashMarkPreviews()
      return
    }

    await Promise.all([fetchMarkPreviews(), fetchTags()])
    getCurrentTag()
  }, [fetchMarkPreviews, fetchTags, fetchTrashMarkPreviews, getCurrentTag])

  const saveDraft = useCallback(async (sourceMark: Mark, nextDraft: MarkDraft) => {
    if (sourceMark.deleted === 1) return false
    setIsSaving(true)
    try {
      const nextMark: Mark = sourceMark.type === 'todo'
        ? {
            ...sourceMark,
            tagId: nextDraft.tagId,
            desc: nextDraft.todoTitle.trim(),
            content: JSON.stringify({
              title: nextDraft.todoTitle,
              description: nextDraft.todoDescription,
              completed: nextDraft.todoCompleted,
              priority: nextDraft.todoPriority,
            }),
          }
        : {
            ...sourceMark,
            tagId: nextDraft.tagId,
            desc: sourceMark.type === 'text' ? nextDraft.content : nextDraft.desc,
            content: nextDraft.content,
            url: nextDraft.url,
          }

      await updateMark(nextMark)
      setMark(nextMark)
      const mobileContexts = useChatStore.getState().mobileActiveContexts
      if (mobileContexts.markId === nextMark.id) {
        useChatStore.getState().setMobileActiveContexts({ markId: nextMark.id })
      }
      if (sourceMark.tagId !== nextDraft.tagId) {
        await refreshRecords(false)
      }
      return true
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
      return false
    } finally {
      setIsSaving(false)
    }
  }, [refreshRecords, t, updateMark])

  useEffect(() => {
    if (!mark || !draft || isReadOnly || !hasChanges) return

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveDraft(mark, draft)
    }, 500)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [draft, hasChanges, isReadOnly, mark, saveDraft])

  async function closeDetail() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    if (mark && draft && hasChanges && !isReadOnly) {
      const saved = await saveDraft(mark, draft)
      if (!saved) return
    }

    navigateBack()
  }

  async function handleCopyLink() {
    if (!draft?.url) return
    await navigator.clipboard.writeText(draft.url)
    toast({ title: t('record.mark.toolbar.copied') })
  }

  async function handleOpenLink(url: string) {
    if (!isHttpUrl(url)) return
    await openUrl(url)
  }

  async function handleDelete() {
    if (!mark) return

    if (mark.deleted === 1) {
      await delMarkForever(mark.id)
    } else {
      await delMark(mark.id)
    }
    await refreshRecords(mark.deleted === 1)
    navigateBack()
  }

  async function handleRestore() {
    if (!mark) return
    await restoreMark(mark.id)
    await fetchTrashMarkPreviews()
    navigateBack()
  }

  if (isLoading || (mark && !draft)) {
    return (
      <SwipeBack
        ref={swipeBackRef}
        onBack={() => void closeDetail()}
        backdrop={<MobileRecordStream preview />}
      >
        <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
          {t('record.mark.loading')}
        </div>
      </SwipeBack>
    )
  }

  if (!mark || !draft) {
    return (
      <SwipeBack
        ref={swipeBackRef}
        onBack={() => void closeDetail()}
        backdrop={<MobileRecordStream preview />}
      >
        <div className="flex h-full flex-col bg-background">
          <header className="mobile-page-header flex shrink-0 items-center border-b px-2">
            <MobileBackButton
              label={t('common.back')}
              onClick={() => swipeBackRef.current?.back()}
            />
          </header>
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {t('record.mark.detail.notFound')}
          </div>
        </div>
      </SwipeBack>
    )
  }

  const imageSrc = getImageSrc(mark)
  const typeLabel = t(`record.mark.type.${mark.type}`)
  const recordEditorPath = getRecordTabPath(mark.id)
  const isLargeContent = isLargeMarkdownDocument(draft.content)
  const isLargeTodoDescription = isLargeMarkdownDocument(draft.todoDescription)

  return (
    <SwipeBack
      ref={swipeBackRef}
      onBack={() => void closeDetail()}
      enabled={!deleteDialogOpen}
      backdrop={<MobileRecordStream preview />}
    >
      <div id="mobile-record-detail" className="relative flex h-full min-h-0 w-full flex-col bg-background">
      <header className="mobile-page-header flex shrink-0 items-center gap-2 border-b bg-background px-2">
        <MobileBackButton
          label={t('common.back')}
          onClick={() => swipeBackRef.current?.back()}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge variant="outline" className={cn('shrink-0', getMarkTypeListBadgeClasses(mark.type))}>
            {typeLabel}
          </Badge>
          {isSaving || hasChanges ? <span className="truncate text-xs text-muted-foreground">{t('common.saving')}</span> : null}
        </div>
        <MobileActionDrawer
          title={t('record.mark.detail.moreActions')}
          trigger={
            <Button variant="ghost" size="icon" aria-label={t('record.mark.detail.moreActions')}>
              <EllipsisVertical />
            </Button>
          }
          items={[
            ...(mark.url ? [{
              key: 'copy-link',
              label: t('record.mark.toolbar.copyLink'),
              icon: <Copy />,
              onSelect: handleCopyLink,
            }] : []),
            ...(isHttpUrl(draft.url) ? [{
              key: 'open-link',
              label: t('common.open'),
              icon: <ExternalLink />,
              onSelect: () => handleOpenLink(draft.url),
            }] : []),
            ...(isReadOnly ? [{
              key: 'restore',
              label: t('record.mark.toolbar.restore'),
              icon: <RotateCcw />,
              onSelect: handleRestore,
            }] : []),
            {
              key: 'delete',
              label: isReadOnly ? t('record.mark.toolbar.deleteForever') : t('record.mark.toolbar.delete'),
              icon: <Trash2 />,
              onSelect: () => setDeleteDialogOpen(true),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-allow-text-selection>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm')}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{currentTag?.name || t('record.mark.detail.tag')}</span>
          </div>

          {imageSrc ? (
            <div className="overflow-hidden rounded-md border bg-muted/20">
              <LocalImage src={imageSrc} alt={draft.desc || typeLabel} className="h-auto max-h-[42vh] min-h-48 w-full object-contain" />
            </div>
          ) : null}

          {mark.type === 'recording' && mark.url ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <AudioPlayer audioPath={mark.url} />
            </div>
          ) : null}

          {mark.type === 'file' && mark.url ? (
            <div className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 p-3">
              <FileText className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{mark.url}</span>
            </div>
          ) : null}

          {mark.type === 'link' && draft.url ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 p-3 text-left"
              onClick={() => void handleOpenLink(draft.url)}
              disabled={!isHttpUrl(draft.url)}
            >
              <LinkIcon className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{draft.url}</span>
              {isHttpUrl(draft.url) ? <ExternalLink className="shrink-0 text-muted-foreground" /> : null}
            </button>
          ) : null}

          <Separator />

          <div className="flex flex-col gap-5">
            <DetailField label={t('record.mark.detail.tag')} htmlFor="record-tag">
              <MobileSelectDrawer
                id="record-tag"
                title={t('record.mark.detail.tag')}
                value={String(draft.tagId)}
                onValueChange={(value) => setDraft((current) => current ? { ...current, tagId: Number(value) } : current)}
                disabled={isReadOnly}
                className="h-11"
                options={tags.map(tag => ({ value: String(tag.id), label: tag.name }))}
              />
            </DetailField>

            {mark.type === 'todo' ? (
              <>
                <DetailField label={t('record.mark.todo.title')} htmlFor="todo-title">
                  <Input
                    id="todo-title"
                    value={draft.todoTitle}
                    onChange={(event) => setDraft({ ...draft, todoTitle: event.target.value })}
                    placeholder={t('record.mark.todo.titlePlaceholder')}
                    disabled={isReadOnly}
                    className="h-11"
                  />
                </DetailField>
                <label className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm">
                  <Checkbox
                    checked={draft.todoCompleted}
                    onCheckedChange={(checked) => setDraft({ ...draft, todoCompleted: checked === true })}
                    disabled={isReadOnly}
                  />
                  {draft.todoCompleted ? t('record.mark.todo.completed') : t('record.mark.todo.uncompleted')}
                </label>
                <DetailField label={t('record.mark.todo.priority')} htmlFor="todo-priority">
                  <Tabs
                    value={draft.todoPriority}
                    onValueChange={(value) => setDraft({ ...draft, todoPriority: value as Priority })}
                  >
                    <TabsList id="todo-priority" className="grid h-11 w-full grid-cols-3">
                      <TabsTrigger value="low" disabled={isReadOnly}>{t('record.mark.todo.priorityLow')}</TabsTrigger>
                      <TabsTrigger value="medium" disabled={isReadOnly}>{t('record.mark.todo.priorityMedium')}</TabsTrigger>
                      <TabsTrigger value="high" disabled={isReadOnly}>{t('record.mark.todo.priorityHigh')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </DetailField>
                <DetailField label={t('record.mark.todo.description')} htmlFor="todo-description">
                  {isLargeTodoDescription ? (
                    <div id="todo-description" className="h-[60vh] min-h-80 overflow-hidden rounded-md border bg-background">
                      <LargeRecordMarkdownEditor
                        initialContent={draft.todoDescription}
                        onChange={(value) => setDraft(current => current ? { ...current, todoDescription: value } : current)}
                        activeFilePath={recordEditorPath}
                        placeholder={t('record.mark.todo.descriptionPlaceholder')}
                        editable={!isReadOnly}
                        showFooterBar={false}
                        mobileMode
                        enableLargeDocumentMode
                        isActive={isActive}
                        exposeToPluginHost={false}
                      />
                    </div>
                  ) : (
                    <Textarea
                      id="todo-description"
                      value={draft.todoDescription}
                      onChange={(event) => setDraft({ ...draft, todoDescription: event.target.value })}
                      placeholder={t('record.mark.todo.descriptionPlaceholder')}
                      disabled={isReadOnly}
                      rows={5}
                      maxRows={10}
                      className="min-h-36 resize-none"
                    />
                  )}
                </DetailField>
              </>
            ) : (
              <>
                {mark.type !== 'text' ? (
                  <DetailField label={t('record.mark.desc')} htmlFor="record-description">
                    <Input
                      id="record-description"
                      value={draft.desc}
                      onChange={(event) => setDraft({ ...draft, desc: event.target.value })}
                      disabled={isReadOnly}
                      className="h-11"
                    />
                  </DetailField>
                ) : null}
                <DetailField label={t('record.mark.content')} htmlFor="record-content">
                  {isLargeContent ? (
                    <div id="record-content" className="h-[65vh] min-h-96 overflow-hidden rounded-md border bg-background">
                      <LargeRecordMarkdownEditor
                        initialContent={draft.content}
                        onChange={(value) => setDraft(current => current ? { ...current, content: value } : current)}
                        activeFilePath={recordEditorPath}
                        editable={!isReadOnly}
                        showFooterBar={false}
                        mobileMode
                        enableLargeDocumentMode
                        isActive={isActive}
                        exposeToPluginHost={false}
                      />
                    </div>
                  ) : (
                    <Textarea
                      id="record-content"
                      value={draft.content}
                      onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                      disabled={isReadOnly}
                      maxRows={30}
                      className={cn('resize-none leading-7', mark.type === 'text' ? 'min-h-[48vh]' : 'min-h-56')}
                    />
                  )}
                </DetailField>
                {mark.type === 'link' ? (
                  <DetailField label="URL" htmlFor="record-url">
                    <Input
                      id="record-url"
                      inputMode="url"
                      value={draft.url}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      disabled={isReadOnly}
                      className="h-11"
                    />
                  </DetailField>
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isReadOnly ? t('record.mark.toolbar.deleteForever') : t('record.mark.toolbar.delete')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isReadOnly ? t('record.trash.syncWarning') : t('record.mark.toolbar.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      </div>
    </SwipeBack>
  )
}
