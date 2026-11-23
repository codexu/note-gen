'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import dayjs from 'dayjs'
import {
  Clock3,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  FolderOpen,
  Link as LinkIcon,
  LoaderCircle,
  Pencil,
  RotateCcw,
  ScanText,
  Sparkles,
  Tag,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { PhotoView } from 'react-photo-view'
import { useTranslations } from 'next-intl'
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { PluginEmbeddedViews } from '@/components/plugins/plugin-embedded-views'
import { LocalImage } from '@/components/local-image'
import { PhotoPreviewProvider } from '@/components/photo-preview-provider'
import { AudioPlayer } from '@/components/audio-player'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { delMark, delMarkForever, getMarkLocalAssetPath, restoreMark, type Mark } from '@/db/marks'
import type { Tag as RecordTag } from '@/db/tags'
import { cn, isHttpUrl } from '@/lib/utils'
import { getEditorContentContainerClass } from '@/lib/editor-layout-styles'
import emitter from '@/lib/emitter'
import { fetchAiDesc } from '@/lib/ai/description'
import { type ImageRecognitionStage, recognizeImageWithFallback } from '@/lib/image-recognition'
import { getImageRecognitionProgressText } from '@/lib/image-recognition-progress'
import { recordTagIds } from '@/lib/record-tags'
import { toast } from '@/hooks/use-toast'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import {
  TipTapEditor,
  type MarkdownChangeHandler,
  type MarkdownFlushRef,
} from '@/app/core/main/editor/markdown/tiptap-editor'
import { Outline } from '@/app/core/main/editor/markdown/outline'
import { useDesktopEditorOutline } from '@/app/core/main/editor/markdown/use-desktop-editor-outline'
import {
  canEditRecordDescription,
  getRecordBodyMarkdown,
  replaceRecordBodyMarkdown,
} from './mark-list-item-content'
import { canOpenMarkSource, getMarkOpenAction } from './mark-open-path'
import { createRecordTab, getRecordTabName, getRecordTabPath } from './mark-record-tab'
import { getImageRecordStatus, getRecordImageCaption, isImageRecord } from './image-record-status'
import { RecordDescriptionDialog } from './record-description-dialog'
import { RecordFileButton } from './record-file-button'
import { getRecordImageSrc } from './record-image-asset'
import { RecordImageViewSwitch, type RecordImageView } from './record-image-view-switch'
import { canEditRecordImage, RecordImageWorkspace } from './record-image-workspace'
import { RecordTagEditor } from './record-tag-editor'
import { TodoRecordDetails } from './todo-record-details'
import { useRecordDetailSave } from './use-record-detail-save'
import { registerRecordTabCloseGuard } from './record-detail-tab-guard'

function getRecordWebSource(address: string | null | undefined) {
  const url = address?.trim()
  if (!url || !isHttpUrl(url)) return null

  try {
    return new URL(url)
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function getImageMimeType(url: string) {
  const extension = url.split('.').pop()?.toLowerCase()

  switch (extension) {
  case 'jpg':
  case 'jpeg':
    return 'image/jpeg'
  case 'webp':
    return 'image/webp'
  case 'gif':
    return 'image/gif'
  default:
    return 'image/png'
  }
}

function MarkMissingState({ onClose }: { onClose: () => void }) {
  const t = useTranslations()

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>{t('record.mark.detail.notFound')}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

type SaveRecord = ReturnType<typeof useRecordDetailSave>['save']
type EditTask = 'description' | 'recognition' | null

function useRecordActions(mark: Mark, onClose: () => void, save: SaveRecord) {
  const t = useTranslations()
  const [isChangingTrash, setIsChangingTrash] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { tags, fetchTags, getCurrentTag } = useTagStore()
  const {
    marks, fetchMarks, fetchAllMarks, fetchAllTrashMarks, clearActiveMark, setActiveMarkId,
  } = useMarkStore()
  const { addTab, removeTab, setActiveTabId, setActiveFilePath } = useArticleStore()
  const currentIndex = marks.findIndex((item) => item.id === mark.id)
  const nextMark = currentIndex === -1 ? marks[0] : marks[currentIndex + 1] ?? marks[currentIndex - 1]
  const sourceUrl = mark.type === 'file' ? mark.url?.trim() ?? '' : mark.url

  useEffect(() => {
    if (!tags.length) void fetchTags()
  }, [fetchTags, tags.length])

  function reportError(error: unknown) {
    const description = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    toast({ title: t('common.error'), description, variant: 'destructive' })
  }

  async function moveTag(tagId: number) {
    if (!await save((latest) => ({ ...latest, tagId }))) return

    try {
      await fetchTags()
      getCurrentTag()
      await fetchMarks()
      await fetchAllMarks()
    } catch (error) {
      reportError(error)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(sourceUrl)
      toast({ title: t('record.mark.toolbar.copied') })
    } catch (error) {
      reportError(error)
    }
  }

  async function openSource(target: 'folder' | 'file') {
    try {
      if (mark.type === 'file' && target === 'file' && isHttpUrl(sourceUrl)) {
        await openUrl(sourceUrl)
        return
      }
      const action = getMarkOpenAction({ type: mark.type, url: sourceUrl }, await appDataDir(), target)
      if (!action?.path) return
      if (action.mode === 'reveal') await revealItemInDir(action.path)
      else await openPath(action.path)
    } catch (error) {
      reportError(error)
    }
  }

  async function changeTrash(action: 'delete' | 'restore') {
    if (isChangingTrash) return
    setIsChangingTrash(true)
    try {
      if (action === 'restore') await restoreMark(mark.id)
      else if (mark.deleted) await delMarkForever(mark.id)
      else await delMark(mark.id)

      try {
        if (mark.deleted) {
          await fetchAllTrashMarks()
        } else {
          await fetchMarks()
          await fetchAllMarks()
          await fetchTags()
          getCurrentTag()
        }
      } catch (error) {
        reportError(error)
      }

      setConfirmDelete(false)
      await removeTab(getRecordTabPath(mark.id))
      if (nextMark) {
        setActiveMarkId(nextMark.id)
        const tab = createRecordTab(nextMark, t(`record.mark.type.${nextMark.type}`))
        await addTab(tab)
        await setActiveTabId(tab.id)
        await setActiveFilePath('')
      } else {
        clearActiveMark()
        onClose()
      }
    } catch (error) {
      reportError(error)
    } finally {
      setIsChangingTrash(false)
    }
  }

  return { tags, moveTag, sourceUrl, copyLink, openSource, changeTrash, confirmDelete, setConfirmDelete, isChangingTrash }
}

function RecordActions({
  mark,
  actions,
  busy,
  onRegenerateDescription,
  onRecognizeImage,
  recognitionLabel,
}: {
  mark: Mark
  actions: ReturnType<typeof useRecordActions>
  busy: boolean
  onRegenerateDescription?: () => void
  onRecognizeImage?: () => void
  recognitionLabel: string
}) {
  const t = useTranslations()
  const trigger = useRef<HTMLButtonElement>(null)
  const editorOnMenuClose = useRef<'description' | 'tags' | null>(null)
  const [openEditor, setOpenEditor] = useState<'description' | 'tags' | null>(null)
  const isTrash = mark.deleted === 1
  const others = actions.tags.filter((tag) => tag.id !== mark.tagId)
  const canMove = !isTrash && others.length > 0
  const canCopy = Boolean(actions.sourceUrl)
  const canOpen = canOpenMarkSource({ type: mark.type, url: actions.sourceUrl })
  const canEditDescription = canEditRecordDescription(mark)
  const deleteLabel = t(isTrash ? 'record.mark.toolbar.deleteForever' : 'record.mark.toolbar.delete')

  function focusMoreTrigger(event: Event) {
    event.preventDefault()
    trigger.current?.focus()
  }

  return (
    <>
      {isTrash ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="@max-xs/record-detail:size-7 @max-xs/record-detail:p-0"
          aria-label={t('record.mark.toolbar.restore')}
          title={t('record.mark.toolbar.restore')}
          disabled={actions.isChangingTrash}
          onClick={() => void actions.changeTrash('restore')}
        >
          <RotateCcw data-icon="inline-start" />
          <span className="@max-xs/record-detail:hidden">{t('record.mark.toolbar.restore')}</span>
        </Button>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('record.mark.detail.moreActions')}
            title={t('record.mark.detail.moreActions')}
            disabled={busy || actions.isChangingTrash}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-max min-w-40 max-w-[min(20rem,90vw)] motion-reduce:animate-none"
          onCloseAutoFocus={(event) => {
            if (editorOnMenuClose.current) {
              event.preventDefault()
              setOpenEditor(editorOnMenuClose.current)
              editorOnMenuClose.current = null
            } else if (actions.confirmDelete) event.preventDefault()
          }}
        >
          {canEditDescription || onRegenerateDescription || onRecognizeImage ? (
            <>
              <DropdownMenuGroup>
                {canEditDescription ? (
                  <DropdownMenuItem onSelect={() => { editorOnMenuClose.current = 'description' }}>
                    <Pencil aria-hidden="true" />
                    {t('record.mark.detail.editDescription')}
                  </DropdownMenuItem>
                ) : null}
                {onRegenerateDescription ? (
                  <DropdownMenuItem onSelect={onRegenerateDescription}>
                    <Sparkles />
                    {t('record.mark.toolbar.regenerateDesc')}
                  </DropdownMenuItem>
                ) : null}
                {onRecognizeImage ? (
                  <DropdownMenuItem onSelect={onRecognizeImage}>
                    <ScanText aria-hidden="true" />
                    {recognitionLabel}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {!isTrash || canCopy || canOpen ? (
            <>
              <DropdownMenuGroup>
                {!isTrash ? (
                  <DropdownMenuItem onSelect={() => { editorOnMenuClose.current = 'tags' }}>
                    <Tags aria-hidden="true" />
                    {t('record.tagging.manage')}
                  </DropdownMenuItem>
                ) : null}
                {canMove ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Tag />
                      {t('record.mark.toolbar.moveTag')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] max-w-60 overflow-y-auto">
                      <DropdownMenuGroup>
                        {others.map((tag) => (
                          <DropdownMenuItem key={tag.id} onSelect={() => void actions.moveTag(tag.id)}>
                            <span className="break-words">{tag.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {canCopy ? (
                  <DropdownMenuItem onSelect={() => void actions.copyLink()}>
                    <Copy />
                    {t(mark.type === 'link' || isHttpUrl(actions.sourceUrl) ? 'record.mark.toolbar.copyLink' : 'record.mark.detail.copySource')}
                  </DropdownMenuItem>
                ) : null}
                {canOpen ? (
                  <>
                    {mark.type !== 'file' ? (
                      <DropdownMenuItem onSelect={() => void actions.openSource('file')}>
                        <FileText />
                        {t('record.mark.toolbar.viewFile')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void actions.openSource('folder')}>
                      <FolderOpen />
                      {t('record.mark.toolbar.viewFolder')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => actions.setConfirmDelete(true)}>
              <Trash2 />
              {deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {canEditDescription ? (
        <RecordDescriptionDialog
          mark={mark}
          open={openEditor === 'description'}
          onOpenChange={(open) => setOpenEditor(open ? 'description' : null)}
          onCloseAutoFocus={focusMoreTrigger}
        />
      ) : null}
      {!isTrash ? (
        <RecordTagEditor
          mark={mark}
          open={openEditor === 'tags'}
          onOpenChange={(open) => setOpenEditor(open ? 'tags' : null)}
          onCloseAutoFocus={focusMoreTrigger}
        />
      ) : null}
      <AlertDialog
        open={actions.confirmDelete}
        onOpenChange={(open) => { if (!actions.isChangingTrash) actions.setConfirmDelete(open) }}
      >
        <AlertDialogContent onCloseAutoFocus={focusMoreTrigger}>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(isTrash ? 'record.trash.syncWarning' : 'record.mark.toolbar.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.isChangingTrash}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actions.isChangingTrash}
              onClick={(event) => {
                event.preventDefault()
                void actions.changeTrash('delete')
              }}
            >
              {deleteLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RecordImage({ src, alt, label }: { src: string; alt: string; label: string }) {
  const [resolvedSrc, setResolvedSrc] = useState('')
  return (
    <PhotoView src={resolvedSrc || src}>
      <button
        type="button"
        aria-label={label}
        className="flex min-h-12 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LocalImage
          src={src}
          alt={alt}
          loading="eager"
          onResolvedSrc={setResolvedSrc}
          className="h-auto max-h-[56vh] w-full object-contain"
        />
      </button>
    </PhotoView>
  )
}

function RecordMarkdown({
  markId,
  exportName,
  content,
  contentHeader,
  recordToolsTarget,
  editable,
  isActive,
  hidden,
  label,
  placeholder = label,
  onChange,
  onDirty,
  markdownFlushRef,
}: {
  markId: number
  exportName: string
  content: string
  contentHeader: ReactNode
  recordToolsTarget: HTMLElement | null
  editable: boolean
  isActive: boolean
  hidden: boolean
  label: string
  placeholder?: string
  onChange: MarkdownChangeHandler
  onDirty: () => void
  markdownFlushRef: MarkdownFlushRef
}) {
  const path = getRecordTabPath(markId)
  const [visualEditor, setVisualEditor] = useState<Editor | null>(null)
  const {
    outlineOpen, showPanel, outlinePosition, outlineWidth, toggleOutline, changeOutlineWidth, commitOutlineWidth,
  } = useDesktopEditorOutline(path, isActive, 'notes')
  const outline = showPanel && visualEditor ? (
    <Outline
      editor={visualEditor}
      isOpen={outlineOpen}
      position={outlinePosition}
      documentKey={path}
      width={outlineWidth}
      onWidthChange={changeOutlineWidth}
      onWidthCommit={commitOutlineWidth}
    />
  ) : null

  return (
    <article
      data-record-mode={editable ? 'edit' : 'read'}
      data-record-has-header={contentHeader ? '' : undefined}
      role="group"
      aria-label={label}
      hidden={hidden}
      className={cn('record-detail-markdown-editor h-full min-h-0 min-w-0 flex-1', hidden ? 'hidden' : 'flex')}
      data-allow-text-selection
    >
      {outlinePosition === 'left' ? outline : null}
      <div className="relative h-full min-w-0 flex-1">
        <TipTapEditor
          initialContent={content}
          onChange={onChange}
          onContentDirty={onDirty}
          markdownFlushRef={markdownFlushRef}
          activeFilePath={path}
          placeholder={editable ? placeholder : undefined}
          readOnly={!editable}
          editable={editable}
          contentHeader={contentHeader}
          onVisualEditorChange={setVisualEditor}
          outlineOpen={Boolean(visualEditor) && outlineOpen}
          outlinePosition={outlinePosition}
          outlineWidth={outlineWidth}
          outlineInLayout
          onToggleOutline={toggleOutline}
          applyLayoutPreferences
          isActive={isActive}
          exposeToPluginHost={false}
          recordExportName={exportName}
          recordToolsTarget={recordToolsTarget}
        />
      </div>
      {outlinePosition === 'right' ? outline : null}
    </article>
  )
}

const inlineInputClass = 'border-0 bg-transparent px-0 focus-visible:bg-muted/40 focus-visible:ring-0 dark:bg-transparent dark:focus-visible:bg-muted/40'

function RecordDetailBody({
  mark,
  isActive,
  save,
  actions,
  contentClassName,
  primaryActionTarget,
  recordToolsTarget,
  moreActionsTarget,
  imageSaveTarget,
  isSaving,
  markdownFlushRef,
  onMarkdownDirty,
  onMarkdownFlushed,
}: {
  mark: Mark
  isActive: boolean
  save: SaveRecord
  actions: ReturnType<typeof useRecordActions>
  contentClassName: string
  primaryActionTarget: HTMLElement | null
  recordToolsTarget: HTMLElement | null
  moreActionsTarget: HTMLElement | null
  imageSaveTarget: HTMLElement | null
  isSaving: boolean
  markdownFlushRef: MarkdownFlushRef
  onMarkdownDirty: () => void
  onMarkdownFlushed: () => void
}) {
  const t = useTranslations()
  const primaryModel = useSettingStore((state) => state.primaryModel)
  const [task, setTask] = useState<EditTask>(null)
  const [recognitionStage, setRecognitionStage] = useState<ImageRecognitionStage | null>(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const [imageBody, setImageBody] = useState<'unopened' | 'visible' | 'hidden'>('unopened')
  const isTrash = mark.deleted === 1
  const isTodo = mark.type === 'todo'
  const imageSrc = getRecordImageSrc(mark)
  const body = getRecordBodyMarkdown(mark)
  const hasBody = Boolean(body.trim())
  const latestBody = useRef(body)
  useLayoutEffect(() => { latestBody.current = body }, [body])

  const imageStatusLabels = {
    pending: t('record.capture.screenshotRecognitionPending'),
    failed: t('record.capture.screenshotRecognitionFailed'),
    noText: t('record.capture.screenshotNoText'),
    savedOnly: t('record.capture.screenshotSavedOnly'),
  }
  const imageStatus = getImageRecordStatus(mark, imageStatusLabels)
  const imageCaption = getRecordImageCaption(mark, imageStatusLabels)
  const contentLabel = t(isTodo ? 'record.mark.detail.todoNotes' : isImageRecord(mark) ? 'record.capture.screenshotOcrContent' : 'record.mark.content')
  const hasLink = mark.type === 'link'
  const webSource = hasLink ? getRecordWebSource(mark.url) : null
  const showLinkSource = hasLink && (!isTrash || Boolean(mark.url))
  const canEditImage = canEditRecordImage(mark)
  const showImageBody = canEditImage && imageBody === 'visible'
  const showImageWorkspace = canEditImage && !showImageBody
  const previewImage = canEditImage ? null : imageSrc

  function changeImageView(view: RecordImageView) {
    if (view === 'image' && markdownFlushRef.current?.() === false) return
    setImageBody(view === 'body' ? 'visible' : 'hidden')
  }

  const changeMarkdown: MarkdownChangeHandler = (content) => {
    onMarkdownFlushed()
    if (isTrash) return

    latestBody.current = content
    void save((latest) => replaceRecordBodyMarkdown(latest, content), { debounce: true })
  }

  async function regenerateDescription() {
    if (task || markdownFlushRef.current?.() === false) return
    setTask('description')
    try {
      const desc = await fetchAiDesc(latestBody.current)
      if (desc) await save((latest) => ({ ...latest, desc }))
      else toast({ title: t('common.error'), description: t('record.mark.toolbar.regenerateDesc'), variant: 'destructive' })
    } catch (error) {
      toast({ title: t('common.error'), description: error instanceof Error ? error.message : undefined, variant: 'destructive' })
    } finally {
      setTask(null)
    }
  }

  async function recognizeImage() {
    if (task || markdownFlushRef.current?.() === false) return
    const hadBody = Boolean(latestBody.current.trim())
    setTask('recognition')
    setRecognitionStage(null)
    try {
      const file = getMarkLocalAssetPath(mark)
      const bytes = file ? await readFile(file, { baseDir: BaseDirectory.AppData }) : null
      const result = await recognizeImageWithFallback({
        imagePath: file,
        base64: bytes ? `data:${getImageMimeType(mark.url)};base64,${bytesToBase64(bytes)}` : mark.url,
        shouldGenerateDescription: Boolean(primaryModel),
        onProgress: setRecognitionStage,
      })
      if (result.method === 'none' || (hadBody && !result.content.trim())) {
        toast({
          title: t(result.method === 'none' ? 'record.capture.screenshotRecognitionFailed' : 'record.capture.screenshotNoText'),
          variant: result.method === 'none' ? 'destructive' : 'default',
        })
        return
      }
      const saveResult = save((latest) => latest.url === mark.url && latest.type === mark.type
        ? {
          ...latest,
          content: result.content,
          desc: result.desc || result.content || t('record.capture.screenshotNoText'),
        }
        : latest)
      setEditorRevision((revision) => revision + 1)
      await saveResult
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('record.capture.screenshotRecognitionFailed'),
        variant: 'destructive',
      })
    } finally {
      setTask(null)
    }
  }

  const recognizing = task === 'recognition'
  const imageStatusText = !recognizing && !hasBody && imageStatus ? imageStatusLabels[imageStatus] : null
  const recognitionLabel = t(hasBody ? 'record.capture.screenshotRecognizeAgain' : 'record.mark.detail.recognizeText')
  const recognitionProgress = recognitionStage ? getImageRecognitionProgressText(t, recognitionStage) : t('record.capture.screenshotRecognizing')
  const processingLabel = task === 'description' ? t('record.mark.detail.regeneratingDescription')
    : recognizing ? recognitionProgress
    : null
  const sourceHeader = previewImage || showLinkSource || imageStatusText ? (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {previewImage ? (
        <figure className="flex w-full max-w-4xl flex-col gap-2">
          <RecordImage
            key={previewImage}
            src={previewImage}
            alt={t(`record.mark.type.${mark.type}`)}
            label={t('record.mark.detail.previewImage')}
          />
          {imageCaption ? <figcaption className="wrap-break-word whitespace-pre-wrap text-sm text-muted-foreground">{imageCaption}</figcaption> : null}
        </figure>
      ) : null}
      {showLinkSource ? (
        <Item size="xs" variant="muted" className="min-w-0 max-w-2xl flex-nowrap">
          <ItemMedia variant="icon" className="text-muted-foreground">
            <LinkIcon aria-hidden="true" />
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0">
            {webSource ? (
              <ItemTitle className="w-full" title={webSource.host}>
                <span className="truncate">{webSource.host}</span>
              </ItemTitle>
            ) : null}
            {!isTrash ? (
              <Input
                aria-label={t('record.mark.detail.linkUrl')}
                placeholder={t('record.mark.detail.linkUrl')}
                title={mark.url || undefined}
                value={mark.url || ''}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn(inlineInputClass, webSource && 'h-7 text-xs text-muted-foreground md:text-xs')}
                onChange={(event) => {
                  const url = event.target.value
                  void save((latest) => ({ ...latest, url }), { debounce: true })
                }}
              />
            ) : (
              <ItemTitle className={cn('w-full', webSource && 'text-xs font-normal text-muted-foreground')} title={mark.url}>
                <span className="truncate">{mark.url}</span>
              </ItemTitle>
            )}
          </ItemContent>
        </Item>
      ) : null}
      {imageStatusText ? (
        <span className="text-xs text-muted-foreground">{imageStatusText}</span>
      ) : null}
    </div>
  ) : null
  const contentHeader = isTodo ? <TodoRecordDetails mark={mark} save={save} disabled={Boolean(task)} /> : sourceHeader

  return (
    <>
      {primaryActionTarget ? createPortal(
        <>
          <span role="status" className="sr-only">{processingLabel}</span>
          {processingLabel ? (
            <span className="flex h-7 items-center gap-1.5 px-1 text-xs text-muted-foreground" title={processingLabel} aria-hidden="true">
              <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" />
              <span className="@max-lg/record-detail:hidden">{processingLabel}</span>
            </span>
          ) : null}
          {webSource ? (
            <Button asChild variant="ghost" size="icon-sm">
              <a
                href={webSource.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('record.mark.detail.openOriginalPage')}
                title={t('record.mark.detail.openOriginalPage')}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          ) : null}
          <RecordFileButton mark={mark} onOpen={() => void actions.openSource('file')} />
          {canEditImage ? (
            <RecordImageViewSwitch value={showImageBody ? 'body' : 'image'} onValueChange={changeImageView} />
          ) : null}
        </>,
        primaryActionTarget,
      ) : null}
      {moreActionsTarget ? createPortal(
        <RecordActions
          mark={mark}
          actions={actions}
          busy={isSaving || Boolean(task)}
          onRegenerateDescription={canEditRecordDescription(mark) && hasBody ? () => void regenerateDescription() : undefined}
          onRecognizeImage={!isTrash && imageSrc ? () => void recognizeImage() : undefined}
          recognitionLabel={recognitionLabel}
        />,
        moreActionsTarget,
      ) : null}
      {canEditImage ? (
        <div
          hidden={showImageBody}
          className={cn('w-full min-h-0 min-w-0 flex-1', showImageBody ? 'hidden' : 'flex flex-col')}
        >
          <RecordImageWorkspace
            mark={mark}
            isActive={isActive && showImageWorkspace}
            caption={imageCaption}
            toolbarTarget={recordToolsTarget}
            saveTarget={imageSaveTarget}
          />
        </div>
      ) : null}
      {isTrash && !hasBody ? (
        <article className="app-panel-scrollbar min-w-0 flex-1 overflow-y-auto overscroll-contain" data-allow-text-selection>
          <div className={contentClassName}>
            <div className="px-4 py-4">
              {contentHeader ?? <p className="text-sm text-muted-foreground">{t('record.mark.detail.emptyContent')}</p>}
            </div>
          </div>
        </article>
      ) : !canEditImage || imageBody !== 'unopened' ? (
        <RecordMarkdown
          key={isTrash ? body : editorRevision}
          markId={mark.id}
          exportName={getRecordTabName(mark, t(`record.mark.type.${mark.type}`))}
          content={body}
          contentHeader={contentHeader}
          recordToolsTarget={showImageWorkspace ? null : recordToolsTarget}
          label={contentLabel}
          placeholder={isTodo ? t('record.mark.detail.todoNotesPlaceholder') : undefined}
          editable={!isTrash && task !== 'recognition'}
          isActive={isActive && !showImageWorkspace}
          hidden={showImageWorkspace}
          onChange={changeMarkdown}
          onDirty={onMarkdownDirty}
          markdownFlushRef={markdownFlushRef}
        />
      ) : null}
    </>
  )
}

function RecordDetailTags({ mark, tags }: { mark: Mark; tags: RecordTag[] }) {
  const t = useTranslations('record.mark.detail')
  const selectedTagIds = recordTagIds(mark)
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id))

  if (!selectedTags.length) return null

  return (
    <ul
      aria-label={t('classification')}
      tabIndex={0}
      data-allow-text-selection
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain rounded-sm py-0.5 [scrollbar-width:none] focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-ring"
    >
      {selectedTags.map((tag) => (
        <li key={tag.id} className="max-w-full min-w-0 shrink-0 first:ms-auto">
          <Badge variant="secondary" className="max-w-full font-normal" title={tag.name}>
            <span className="truncate">{tag.name}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}

interface RecordDetailIdentity {
  groupId: string
  tabId: string
  onClose: () => void
  isActive: boolean
}

function MarkDetailView({ mark, groupId, tabId, onClose, isActive }: RecordDetailIdentity & { mark: Mark }) {
  const t = useTranslations()
  const { draft, save, status, retry, getStatus } = useRecordDetailSave(mark)
  const actions = useRecordActions(draft, onClose, save)
  const markdownFlushRef = useRef<(() => boolean) | null>(null)
  const hasUnflushedContent = useRef(false)
  const [markdownDirty, setMarkdownDirty] = useState(false)
  const [primaryActionTarget, setPrimaryActionTarget] = useState<HTMLDivElement | null>(null)
  const [recordToolsTarget, setRecordToolsTarget] = useState<HTMLDivElement | null>(null)
  const [moreActionsTarget, setMoreActionsTarget] = useState<HTMLDivElement | null>(null)
  const [imageSaveTarget, setImageSaveTarget] = useState<HTMLDivElement | null>(null)
  const createdAt = dayjs(mark.createdAt)
  const hasCreatedAt = createdAt.isValid()
  const fullDate = createdAt.format('YYYY-MM-DD HH:mm')
  const shortTime = createdAt.format('HH:mm')
  const isTrash = mark.deleted === 1
  const audioPath = draft.type === 'recording' ? (draft.url?.trim() ?? '') : ''
  const isSaving = markdownDirty || status === 'pending' || status === 'saving'
  const retryLabel = `${t('record.mark.detail.saveFailed')} · ${t('record.mark.detail.retrySave')}`
  const contentWidth = useSettingStore((state) => state.editorContentWidth)
  const contentClassName = cn('w-full min-w-0 @max-sm/record-detail:px-4', getEditorContentContainerClass({ contentWidth, isMobile: false }))
  const pluginTarget = useMemo(() => ({ kind: 'record' as const, id: mark.id, recordType: mark.type }), [mark.id, mark.type])

  useLayoutEffect(() => registerRecordTabCloseGuard(groupId, tabId, () => {
    if (hasUnflushedContent.current && !markdownFlushRef.current?.()) return 'saving'

    const current = getStatus()
    if (current === 'pending') void retry()
    if (current === 'pending' || current === 'saving') return 'saving'
    if (current === 'failed') return 'dirty'
    return null
  }), [getStatus, groupId, retry, tabId])

  useEffect(() => {
    if (!isActive || isTrash) return

    const flushRecord = ({ markId }: { markId: number }) => {
      if (markId !== mark.id || markdownFlushRef.current?.() === false) return
      void retry()
    }
    emitter.on('record-editor-save-requested', flushRecord)
    return () => emitter.off('record-editor-save-requested', flushRecord)
  }, [isActive, isTrash, mark.id, retry])

  return (
    <PhotoPreviewProvider>
      <div className="@container/record-detail flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex min-h-12 min-w-0 shrink-0 items-center gap-2 border-b bg-muted/25 px-3 py-1.5 @max-sm/record-detail:gap-1 @max-sm/record-detail:px-2">
          <div className="flex min-w-0 items-center gap-1">
            <div ref={setRecordToolsTarget} className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:none] empty:hidden [&>*]:shrink-0" />
            <div ref={setPrimaryActionTarget} className="contents" />
            <div ref={setMoreActionsTarget} className="flex shrink-0 items-center gap-1 empty:hidden" />
            {!isTrash && (status === 'failed' || isSaving) ? (
              <div className="grid size-7 shrink-0 place-items-center text-muted-foreground">
                {status === 'failed' ? (
                  <>
                    <span role="status" className="sr-only">{t('record.mark.detail.saveFailed')}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      title={retryLabel}
                      aria-label={retryLabel}
                      onClick={() => void retry()}
                    >
                      <TriangleAlert aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <span role="status" title={t('common.saving')} className="inline-flex shrink-0">
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                    <span className="sr-only">{t('common.saving')}</span>
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {isTrash ? <span className="shrink-0 text-xs text-muted-foreground @max-sm/record-detail:sr-only">{t('record.mark.detail.readOnly')}</span> : null}
          <RecordDetailTags mark={mark} tags={actions.tags} />
          {hasCreatedAt ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <time
                    dateTime={createdAt.toISOString()}
                    tabIndex={0}
                    aria-label={`${t('record.mark.createdAt')} ${fullDate}`}
                    className="ms-auto flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground tabular-nums focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-ring"
                  >
                    <Clock3 className="size-3.5" aria-hidden="true" />
                    <span aria-hidden="true" className="hidden @md/record-detail:block @xl/record-detail:hidden">{shortTime}</span>
                    <span aria-hidden="true" className="hidden @xl/record-detail:block">{fullDate}</span>
                  </time>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end">{t('record.mark.createdAt')} {fullDate}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          <div
            ref={setImageSaveTarget}
            className={cn('flex shrink-0 items-center empty:hidden', !hasCreatedAt && 'ms-auto')}
          />
        </header>
        <PluginEmbeddedViews location="record-detail" active={isActive && !isTrash} contextKey={String(mark.id)} target={pluginTarget} compact />
        <div className="flex min-h-0 min-w-0 flex-1">
          <RecordDetailBody
            mark={draft}
            isActive={isActive}
            save={save}
            actions={actions}
            contentClassName={contentClassName}
            primaryActionTarget={primaryActionTarget}
            recordToolsTarget={recordToolsTarget}
            moreActionsTarget={moreActionsTarget}
            imageSaveTarget={imageSaveTarget}
            isSaving={isSaving || status === 'failed'}
            markdownFlushRef={markdownFlushRef}
            onMarkdownDirty={() => {
              hasUnflushedContent.current = true
              setMarkdownDirty(true)
            }}
            onMarkdownFlushed={() => {
              hasUnflushedContent.current = false
              setMarkdownDirty(false)
            }}
          />
        </div>
        {audioPath ? (
          <footer className="shrink-0 border-t bg-background px-3">
            <AudioPlayer audioPath={audioPath} variant="detail" />
          </footer>
        ) : null}
      </div>
    </PhotoPreviewProvider>
  )
}

export function MarkDetailPanel({ markId, ...identity }: RecordDetailIdentity & { markId: number }) {
  const mark = useMarkStore((state) => state.marks.find((item) => item.id === markId)
    ?? state.allMarks.find((item) => item.id === markId)
    ?? null)
  const fetchAllMarks = useMarkStore((state) => state.fetchAllMarks)

  useEffect(() => {
    if (!mark) void fetchAllMarks()
  }, [fetchAllMarks, mark])

  if (!mark) return <MarkMissingState onClose={identity.onClose} />

  return <MarkDetailView key={mark.id} mark={mark} {...identity} />
}
