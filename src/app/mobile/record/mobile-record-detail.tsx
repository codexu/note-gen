'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { invoke } from '@tauri-apps/api/core'
import { appDataDir } from '@tauri-apps/api/path'
import { platform } from '@tauri-apps/plugin-os'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import type { MarkdownChangeHandler, MarkdownFlushRef } from '@/app/core/main/editor/markdown/tiptap-editor'
import { getRecordBodyMarkdown, replaceRecordBodyMarkdown } from '@/app/core/main/mark/mark-list-item-content'
import { getMarkOpenAction } from '@/app/core/main/mark/mark-open-path'
import { getRecordTabName, getRecordTabPath } from '@/app/core/main/mark/mark-record-tab'
import { getRecordImageCaption, isImageRecord } from '@/app/core/main/mark/image-record-status'
import type { RecordImageView } from '@/app/core/main/mark/record-image-view-switch'
import { canEditRecordImage, RecordImageWorkspace } from '@/app/core/main/mark/record-image-workspace'
import { TodoRecordDetails } from '@/app/core/main/mark/todo-record-details'
import { readRecordAfterPendingWrites, useRecordDetailSave } from '@/app/core/main/mark/use-record-detail-save'
import { AudioPlayer } from '@/components/audio-player'
import { MobileBackButton } from '@/components/mobile-back-button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { SwipeBack, type SwipeBackHandle } from '@/components/ui/swipe-back'
import { delMark, delMarkForever, getMarkLocalAssetPath, restoreMark, type Mark } from '@/db/marks'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { recognizeImageWithFallback } from '@/lib/image-recognition'
import { cn, isHttpUrl } from '@/lib/utils'
import useChatStore from '@/stores/chat'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { MobileRecordContent } from './mobile-record-content'
import { MobileRecordDetailHeader } from './mobile-record-detail-header'
import { MobileRecordStream } from './mobile-record-stream'

interface MobileRecordDetailProps {
  markId: number
  isActive: boolean
}

type BackGuard = () => boolean | Promise<boolean>
type RecordAction = 'leaving' | 'recognition' | 'delete' | 'restore'

const RecordMarkdownEditor = dynamic(
  () => import('@/app/core/main/editor/markdown/tiptap-editor').then(module => module.TipTapEditor),
  { ssr: false, loading: () => <Skeleton className="mx-2 mt-4 h-24 motion-reduce:animate-none" /> },
)

async function getRecognitionImage(mark: Mark, imagePath: string | null) {
  if (!imagePath) return isHttpUrl(mark.url) ? mark.url : null

  const bytes = await readFile(imagePath, { baseDir: BaseDirectory.AppData })
  const extension = imagePath.split('.').pop()?.toLowerCase() || 'png'
  const mime = extension === 'jpg' ? 'jpeg' : extension
  const blob = new Blob([new Uint8Array(bytes)], { type: `image/${mime}` })

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error('Could not read the record image'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function MobileRecordDetail(props: MobileRecordDetailProps) {
  return <MobileRecordDetailScreen key={props.markId} {...props} />
}

function MobileRecordDetailScreen({ markId, isActive }: MobileRecordDetailProps) {
  const t = useTranslations()
  const router = useRouter()
  const fetchTags = useTagStore(state => state.fetchTags)
  const [mark, setMark] = useState<Mark | null | undefined>(undefined)
  const activeRef = useRef(isActive)
  const swipeBackRef = useRef<SwipeBackHandle>(null)
  const beforeBackRef = useRef<BackGuard | null>(null)

  useLayoutEffect(() => {
    activeRef.current = isActive
    if (!isActive) swipeBackRef.current?.reset()
    return () => { activeRef.current = false }
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    useMarkStore.getState().setActiveMarkId(markId)
    useChatStore.getState().setMobileActiveContexts({ markId })
  }, [isActive, markId])

  useEffect(() => {
    if (!isActive || mark !== undefined) return
    let cancelled = false
    void fetchTags().catch(error => console.error('Failed to load record tags:', error))
    void readRecordAfterPendingWrites(markId).then(saved => {
      if (!cancelled) setMark(saved ?? null)
    }).catch(error => {
      if (cancelled) return
      setMark(null)
      toast({ title: t('common.error'), description: String(error), variant: 'destructive' })
    })
    return () => { cancelled = true }
  }, [fetchTags, isActive, mark, markId, t])

  const navigateBack = useCallback(() => {
    if (!activeRef.current) return
    const records = useMarkStore.getState()
    if (records.activeMarkId === markId) records.clearActiveMark()
    const chat = useChatStore.getState()
    if (chat.mobileActiveContexts.markId === markId) chat.setMobileActiveContexts({ markId: null })
    router.replace('/mobile/record')
    void Store.load('store.json').then(store => store.set('currentPage', '/mobile/record')).catch(error => {
      console.error('Failed to remember the record page:', error)
    })
  }, [markId, router])

  const onBack = () => swipeBackRef.current?.back()

  return (
    <SwipeBack
      ref={swipeBackRef}
      beforeBack={() => beforeBackRef.current?.() ?? true}
      onBack={navigateBack}
      enabled={isActive}
      backdrop={<MobileRecordStream preview />}
    >
      <div id="mobile-record-detail" className="flex h-full min-h-0 w-full flex-col bg-background">
        {mark ? (
          <MobileRecordDetailEditor
            mark={mark}
            isActive={isActive}
            onMarkChange={setMark}
            onBack={onBack}
            navigateBack={navigateBack}
            beforeBackRef={beforeBackRef}
          />
        ) : (
          <>
            <header className="mobile-page-header flex w-full shrink-0 items-center gap-2 border-b bg-background px-2 text-sm">
              <MobileBackButton label={t('common.back')} className="size-11" onClick={onBack} />
              <span className="min-w-0 truncate font-medium">{t('record.mark.list.title')}</span>
            </header>
            <div className="flex flex-1 items-center justify-center gap-2 px-6 text-sm text-muted-foreground" role="status">
              {mark === undefined ? <Spinner aria-hidden="true" className="motion-reduce:animate-none" /> : null}
              {t(mark === undefined ? 'record.mark.loading' : 'record.mark.detail.notFound')}
            </div>
          </>
        )}
      </div>
    </SwipeBack>
  )
}

function MobileRecordDetailEditor({
  mark,
  isActive,
  onMarkChange,
  onBack,
  navigateBack,
  beforeBackRef,
}: {
  mark: Mark
  isActive: boolean
  onMarkChange: (mark: Mark | null) => void
  onBack: () => void
  navigateBack: () => void
  beforeBackRef: RefObject<BackGuard | null>
}) {
  const t = useTranslations()
  const tags = useTagStore(state => state.tags)
  const { draft, save, status, retry, getStatus, replaceBodyIfUnchanged } = useRecordDetailSave(mark, onMarkChange)
  const [toolsTarget, setToolsTarget] = useState<HTMLDivElement | null>(null)
  const [formatTarget, setFormatTarget] = useState<HTMLDivElement | null>(null)
  const [imageToolbarTarget, setImageToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [imageSaveTarget, setImageSaveTarget] = useState<HTMLDivElement | null>(null)
  const [pendingAction, setPendingAction] = useState<RecordAction | null>(null)
  const pendingActionRef = useRef<RecordAction | null>(null)
  const [confirmation, setConfirmation] = useState<'delete' | 'discard' | null>(null)
  const [markdownDirty, setMarkdownDirty] = useState(false)
  const [imageView, setImageView] = useState<RecordImageView | null>(null)
  const markdownDirtyRef = useRef(false)
  const markdownFlushRef: MarkdownFlushRef = useRef(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const activeRef = useRef(isActive)
  const wasInactive = useRef(false)
  const discarding = useRef(false)
  const committedMark = useRef(mark)
  committedMark.current = mark
  const isReadOnly = draft.deleted === 1
  const body = getRecordBodyMarkdown(draft)
  const hasBody = Boolean(body.trim())
  const imageRecord = isImageRecord(draft)
  const editableImage = canEditRecordImage(draft)
  const showImageWorkspace = editableImage && imageView !== 'body'
  const canRecognize = !isReadOnly && imageRecord && Boolean(draft.url)

  const beginAction = useCallback((action: RecordAction) => {
    if (pendingActionRef.current || !activeRef.current) return false
    pendingActionRef.current = action
    setPendingAction(action)
    return true
  }, [])

  const endAction = useCallback(() => {
    pendingActionRef.current = null
    setPendingAction(null)
  }, [])

  function showError(error: unknown) {
    toast({ title: t('common.error'), description: String(error), variant: 'destructive' })
  }

  const flushPending = useCallback(async () => {
    if (markdownFlushRef.current?.() === false || markdownDirtyRef.current) return false
    return await retry()
  }, [retry])

  function changeImageView(value: RecordImageView) {
    if (value === 'image' && imageView === 'body' && markdownFlushRef.current?.() === false) return
    setImageView(value)
  }

  useLayoutEffect(() => {
    const beforeBack = async () => {
      if (confirmation || !beginAction('leaving')) return false
      let leaving = false
      try {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && focused.closest('#mobile-record-detail')) focused.blur()
        leaving = await flushPending() && activeRef.current
        if (leaving) return true
        if (getStatus() === 'failed' && activeRef.current) setConfirmation('discard')
        return false
      } finally {
        if (!leaving) endAction()
      }
    }
    beforeBackRef.current = beforeBack
    return () => {
      if (beforeBackRef.current === beforeBack) beforeBackRef.current = null
    }
  }, [beforeBackRef, beginAction, confirmation, endAction, flushPending, getStatus])

  useLayoutEffect(() => {
    activeRef.current = isActive
    if (!isActive) {
      wasInactive.current = true
      setConfirmation(null)
      if (pendingActionRef.current === 'leaving') endAction()
      if (!discarding.current) void flushPending()
    }
    return () => { activeRef.current = false }
  }, [endAction, flushPending, isActive])

  const refreshRecord = useCallback(async () => {
    if (!activeRef.current || pendingActionRef.current || markdownDirtyRef.current || getStatus() !== 'idle') return
    const before = committedMark.current
    try {
      const saved = await readRecordAfterPendingWrites(before.id)
      if (!activeRef.current || pendingActionRef.current || markdownDirtyRef.current
        || getStatus() !== 'idle' || committedMark.current !== before) return
      if (saved && (saved.deleted !== before.deleted || getRecordBodyMarkdown(saved) !== getRecordBodyMarkdown(before))) {
        setEditorRevision(revision => revision + 1)
      }
      onMarkChange(saved ?? null)
    } catch (error) {
      console.error('Failed to refresh the record:', error)
    }
  }, [getStatus, onMarkChange])

  useEffect(() => {
    if (!isActive) return
    if (wasInactive.current) {
      wasInactive.current = false
      void refreshRecord()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushPending()
      else void refreshRecord()
    }
    const onRecordsChanged = () => { void refreshRecord() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    emitter.on('plugin-records-changed', onRecordsChanged)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      emitter.off('plugin-records-changed', onRecordsChanged)
    }
  }, [flushPending, isActive, refreshRecord])

  const onMarkdownChange: MarkdownChangeHandler = (value) => {
    markdownDirtyRef.current = false
    setMarkdownDirty(false)
    if (!isReadOnly) void save(latest => replaceRecordBodyMarkdown(latest, value), { debounce: true })
  }

  function updateDescription(saved: Mark) {
    onMarkChange({ ...committedMark.current, desc: saved.desc })
  }

  function updateImage(saved: Mark) {
    onMarkChange({ ...committedMark.current, url: saved.url })
  }

  function updateTags(saved: Mark) {
    onMarkChange({
      ...committedMark.current,
      tagId: saved.tagId,
      tagIds: saved.tagIds,
      tagUpdatedAt: saved.tagUpdatedAt,
    })
  }

  async function changeTrash(action: 'delete' | 'restore') {
    if (!beginAction(action)) return
    try {
      if (!await flushPending()) return
      if (action === 'restore') await restoreMark(mark.id)
      else if (isReadOnly) await delMarkForever(mark.id)
      else await delMark(mark.id)

      const records = useMarkStore.getState()
      const tagStore = useTagStore.getState()
      void Promise.all([
        records.trashState ? records.fetchTrashMarkPreviews() : records.fetchMarkPreviews(),
        records.fetchAllMarks(),
        tagStore.fetchTags(),
      ]).then(tagStore.getCurrentTag).catch(showError)
      navigateBack()
    } catch (error) {
      showError(error)
    } finally {
      endAction()
    }
  }

  async function copySource() {
    if (!draft.url) return
    try {
      await navigator.clipboard.writeText(draft.url)
      toast({ title: t('record.mark.toolbar.copied') })
    } catch (error) {
      showError(error)
    }
  }

  async function openSource() {
    const url = draft.url?.trim()
    if (!url) return
    try {
      if (isHttpUrl(url)) {
        await openUrl(url)
        return
      }
      const filePlatform = draft.type === 'file' ? platform() : undefined
      if (filePlatform === 'android' || filePlatform === 'ios') {
        await invoke('open_record_file', { path: url })
      } else {
        const action = getMarkOpenAction(draft, await appDataDir(), 'file')
        if (action?.path) await openPath(action.path)
      }
    } catch (error) {
      showError(error)
    }
  }

  async function recognizeText() {
    if (!canRecognize || !beginAction('recognition')) return
    try {
      if (!await flushPending()) return
      const imagePath = getMarkLocalAssetPath(draft)
      const result = await recognizeImageWithFallback({
        imagePath,
        base64: await getRecognitionImage(draft, imagePath),
      })
      if (!activeRef.current) return
      if (result.method === 'none') {
        toast({ title: t('record.capture.screenshotRecognitionFailed'), variant: 'destructive' })
        return
      }
      if (!result.content.trim()) {
        toast({ title: t('record.capture.screenshotNoText') })
        return
      }
      if (await replaceBodyIfUnchanged(body, result.content, () => activeRef.current, draft.url)) {
        setEditorRevision(revision => revision + 1)
      } else if (getStatus() !== 'failed') {
        toast({ title: t('record.mark.detail.recognitionChanged') })
      }
    } catch (error) {
      showError(error)
    } finally {
      endAction()
    }
  }

  const busy = pendingAction !== null
  const recognitionRunning = pendingAction === 'recognition'
  const audioPath = draft.type === 'recording' ? (draft.url?.trim() ?? '') : ''
  const bodyPlaceholder = isReadOnly ? t('record.mark.detail.emptyContent')
    : draft.type === 'todo' ? t('record.mark.detail.todoNotesPlaceholder')
    : imageRecord ? t('record.capture.screenshotOcrContent')
    : t('record.mark.content')
  const hasUrl = Boolean(draft.url?.trim())
  const imageCaption = imageRecord && hasUrl ? getRecordImageCaption(draft, {
    pending: t('record.capture.screenshotRecognitionPending'),
    failed: t('record.capture.screenshotRecognitionFailed'),
    noText: t('record.capture.screenshotNoText'),
    savedOnly: t('record.capture.screenshotSavedOnly'),
  }) : ''
  const hasContentHeader = (draft.type === 'link' && (!isReadOnly || hasUrl))
    || (hasUrl && imageRecord && !editableImage)
  const contentHeader = draft.type === 'todo' ? (
    <TodoRecordDetails mark={draft} save={save} disabled={busy} />
  ) : hasContentHeader ? (
    <MobileRecordContent
      mark={draft}
      imageCaption={imageCaption}
      isActive={isActive}
      busy={busy}
      save={save}
    />
  ) : undefined

  return (
    <>
      {isActive ? (
        <MobileRecordDetailHeader
          mark={draft}
          tags={tags}
          saving={markdownDirty || status === 'pending' || status === 'saving' || pendingAction === 'leaving'}
          saveFailed={status === 'failed'}
          busy={busy}
          recognizing={recognitionRunning}
          onBack={onBack}
          onRetrySave={() => void flushPending()}
          onDelete={() => setConfirmation('delete')}
          onRestore={() => void changeTrash('restore')}
          onCopySource={() => void copySource()}
          onOpenSource={() => void openSource()}
          onRecognize={canRecognize ? () => void recognizeText() : undefined}
          recognizeAgain={hasBody}
          showImageToolbar={showImageWorkspace}
          imageView={imageView ?? 'image'}
          onImageViewChange={editableImage ? changeImageView : undefined}
          onDescriptionSaved={updateDescription}
          onTagsSaved={updateTags}
          toolsRef={setToolsTarget}
          formatRef={setFormatTarget}
          imageToolsRef={setImageToolbarTarget}
          imageSaveRef={setImageSaveTarget}
        />
      ) : null}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col" data-record-audio-player={audioPath ? '' : undefined}>
        {editableImage ? (
          <div className={cn('min-h-0 min-w-0 flex-1', !showImageWorkspace && 'hidden')}>
            <RecordImageWorkspace
              mark={draft}
              caption={imageCaption}
              isActive={isActive && showImageWorkspace}
              toolbarTarget={showImageWorkspace ? imageToolbarTarget : null}
              saveTarget={showImageWorkspace ? imageSaveTarget : null}
              onSaved={updateImage}
            />
          </div>
        ) : null}
        {!editableImage || imageView !== null ? (
          <div
            className={cn('min-h-0 min-w-0 flex-1 px-2.5 [&_.tiptap-editor-content-header:empty]:hidden', showImageWorkspace && 'hidden')}
            data-allow-text-selection
          >
            <RecordMarkdownEditor
              key={editorRevision}
              initialContent={body}
              activeFilePath={getRecordTabPath(draft.id)}
              contentHeader={contentHeader}
              placeholder={bodyPlaceholder}
              onChange={onMarkdownChange}
              onContentDirty={() => {
                markdownDirtyRef.current = true
                setMarkdownDirty(true)
              }}
              markdownFlushRef={markdownFlushRef}
              editable={!isReadOnly && !busy}
              readOnly={isReadOnly || busy}
              showFooterBar={false}
              mobileMode
              enableLargeDocumentMode
              applyLayoutPreferences
              isActive={isActive && !showImageWorkspace}
              exposeToPluginHost={false}
              recordExportName={getRecordTabName(draft, t(`record.mark.type.${draft.type}`))}
              recordToolsTarget={showImageWorkspace ? null : toolsTarget}
              recordMobileFormatTarget={showImageWorkspace ? null : formatTarget}
            />
          </div>
        ) : null}
      </main>
      {audioPath ? (
        <footer
          data-swipe-back-ignore
          className="shrink-0 border-t bg-background px-[max(0.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] [.mobile-keyboard-open_&]:pb-0"
        >
          <AudioPlayer
            audioPath={audioPath}
            variant="detail"
            className="[.mobile-keyboard-open_&]:min-h-11 [.mobile-keyboard-open_&]:py-0"
          />
        </footer>
      ) : null}
      <AlertDialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null) }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirmation === 'discard' ? 'record.mark.detail.discardTitle'
                : isReadOnly ? 'record.mark.toolbar.deleteForever' : 'record.mark.toolbar.delete')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(confirmation === 'discard' ? 'record.mark.detail.discardDescription'
                : isReadOnly ? 'record.trash.syncWarning' : 'record.mark.toolbar.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmation === 'discard') {
                  discarding.current = true
                  navigateBack()
                } else void changeTrash('delete')
              }}
            >
              {t(confirmation === 'discard' ? 'record.mark.detail.discard' : 'common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
