'use client'

import { useCallback, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Copy, EllipsisVertical, ExternalLink, Pencil, RotateCcw, ScanText, Tags, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { canEditRecordDescription } from '@/app/core/main/mark/mark-list-item-content'
import { canOpenMarkSource } from '@/app/core/main/mark/mark-open-path'
import { getMarkTypeListBadgeClasses } from '@/app/core/main/mark/mark-type-meta'
import { RecordDescriptionDialog } from '@/app/core/main/mark/record-description-dialog'
import { RecordFileButton } from '@/app/core/main/mark/record-file-button'
import { RecordImageViewSwitch, type RecordImageView } from '@/app/core/main/mark/record-image-view-switch'
import { RecordTagEditor } from '@/app/core/main/mark/record-tag-editor'
import { MobileActionDrawer, type MobileActionDrawerItem } from '@/app/mobile/components/mobile-action-drawer'
import { MobileBackButton } from '@/components/mobile-back-button'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Mark } from '@/db/marks'
import type { Tag } from '@/db/tags'
import { recordTagIds } from '@/lib/record-tags'
import { cn, isHttpUrl } from '@/lib/utils'
import { getLinkDomain } from './mobile-record-content'

interface MobileRecordDetailHeaderProps {
  mark: Mark | null
  tags: Tag[]
  saving: boolean
  saveFailed: boolean
  busy: boolean
  recognizing: boolean
  onBack: () => void
  onRetrySave: () => void
  onDelete: () => void
  onRestore: () => void
  onCopySource: () => void
  onOpenSource: () => void
  onRecognize?: () => void
  recognizeAgain: boolean
  showImageToolbar: boolean
  imageView: RecordImageView
  onImageViewChange?: (value: RecordImageView) => void
  onDescriptionSaved: (mark: Mark) => void
  onTagsSaved: (mark: Mark) => void
  toolsRef: (node: HTMLDivElement | null) => void
  formatRef: (node: HTMLDivElement | null) => void
  imageToolsRef: (node: HTMLDivElement | null) => void
  imageSaveRef: (node: HTMLDivElement | null) => void
}

type DetailDialog = 'tags' | 'description'

export function MobileRecordDetailHeader({
  mark,
  tags,
  saving,
  saveFailed,
  busy,
  recognizing,
  onBack,
  onRetrySave,
  onDelete,
  onRestore,
  onCopySource,
  onOpenSource,
  onRecognize,
  recognizeAgain,
  showImageToolbar,
  imageView,
  onImageViewChange,
  onDescriptionSaved,
  onTagsSaved,
  toolsRef,
  formatRef,
  imageToolsRef,
  imageSaveRef,
}: MobileRecordDetailHeaderProps) {
  const t = useTranslations()
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const dialogAfterDrawer = useRef<DetailDialog | null>(null)
  const [activeDialog, setActiveDialog] = useState<DetailDialog | null>(null)
  const setTagsOpen = useCallback((open: boolean) => setActiveDialog(open ? 'tags' : null), [])
  const setDescriptionOpen = useCallback((open: boolean) => setActiveDialog(open ? 'description' : null), [])
  const readOnly = mark?.deleted === 1
  const canEditDescription = Boolean(mark && canEditRecordDescription(mark))
  const actionsLocked = busy || saving || saveFailed
  const createdAt = mark ? dayjs(mark.createdAt) : null
  const typeLabel = mark ? t(`record.mark.type.${mark.type}`) : ''
  const fullDate = createdAt?.isValid() ? createdAt.format('YYYY-MM-DD HH:mm') : null
  const tagIds = mark ? recordTagIds(mark) : []
  const recordTags = tags.filter(tag => tagIds.includes(tag.id))
  const tagNames = recordTags.map(tag => tag.name).join(' · ')
  const source = mark?.url?.trim()
  const documentSource = mark?.type === 'link' || mark?.type === 'file'
  const isWebSource = Boolean(source && isHttpUrl(source))
  const sourceActionLabel = mark?.type === 'link' && source && getLinkDomain(source)
    ? t('record.mark.detail.openOriginalPage') : undefined
  const actions: MobileActionDrawerItem[] = []

  if (mark) {
    if (onRecognize) {
      actions.push({
        key: 'recognize-text',
        label: t(recognizeAgain ? 'record.capture.screenshotRecognizeAgain' : 'record.mark.detail.recognizeText'),
        icon: <ScanText aria-hidden="true" />,
        onSelect: onRecognize,
        disabled: actionsLocked,
      })
    }
    if (!readOnly) {
      actions.push({
        key: 'edit-tags',
        label: t('record.tagging.manage'),
        icon: <Tags aria-hidden="true" />,
        onSelect: () => { dialogAfterDrawer.current = 'tags' },
        disabled: actionsLocked,
      })
    }
    if (canEditDescription) {
      actions.push({
        key: 'edit-description',
        label: t('record.mark.detail.editDescription'),
        icon: <Pencil aria-hidden="true" />,
        onSelect: () => { dialogAfterDrawer.current = 'description' },
        disabled: actionsLocked,
      })
    }
    if (source) {
      actions.push({
        key: 'copy-source',
        label: t(isWebSource || mark.type === 'link' ? 'record.mark.toolbar.copyLink' : 'record.mark.detail.copySource'),
        icon: <Copy />,
        onSelect: onCopySource,
      })
      if (!documentSource && (isWebSource || canOpenMarkSource(mark))) {
        actions.push({
          key: 'open-source',
          label: t('common.open'),
          icon: <ExternalLink />,
          onSelect: onOpenSource,
        })
      }
    }
    if (readOnly) {
      actions.push({
        key: 'restore',
        label: t('record.mark.toolbar.restore'),
        icon: <RotateCcw />,
        onSelect: onRestore,
        disabled: actionsLocked,
      })
    }
    actions.push({
      key: 'delete',
      label: t(readOnly ? 'record.mark.toolbar.deleteForever' : 'record.mark.toolbar.delete'),
      icon: <Trash2 />,
      onSelect: onDelete,
      disabled: actionsLocked,
      destructive: true,
      separatorBefore: actions.length > 0,
    })
  }

  const statusLabel = saveFailed ? t('record.mark.detail.saveFailed')
    : recognizing ? t('record.capture.screenshotRecognizing')
      : saving ? t('common.saving') : t('record.capture.saved')
  const moreLabel = t('record.mark.detail.moreActions')
  const showStatus = saving || recognizing

  function focusMoreButton(event: Event) {
    event.preventDefault()
    moreButtonRef.current?.focus()
  }

  const moreActions = mark ? (
    <MobileActionDrawer
      title={moreLabel}
      trigger={(
        <Button
          ref={moreButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={moreLabel}
          disabled={busy}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      )}
      items={actions}
      renderExtraItems={() => (
        <div className="mx-2 mb-2 space-y-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={getMarkTypeListBadgeClasses(mark.type)}>{typeLabel}</span>
            {fullDate && createdAt ? (
              <time dateTime={createdAt.toISOString()} className="tabular-nums">{t('record.mark.createdAt')} {fullDate}</time>
            ) : null}
            {readOnly ? <span>{t('record.mark.detail.readOnly')}</span> : null}
          </div>
          {recordTags.length ? (
            <ul
              aria-label={t('record.mark.detail.classification')}
              tabIndex={0}
              className="flex max-h-16 flex-wrap gap-1 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              {recordTags.map(tag => (
                <li key={tag.id} className="min-w-0 max-w-full rounded-md bg-background px-2 py-0.5 wrap-anywhere">{tag.name}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      onCloseAutoFocus={(event) => {
        const nextDialog = dialogAfterDrawer.current
        if (!nextDialog) return
        dialogAfterDrawer.current = null
        event.preventDefault()
        setActiveDialog(nextDialog)
      }}
    />
  ) : null

  return (
    <header className="@container/record-detail w-full shrink-0 border-b bg-background px-[max(env(safe-area-inset-left),env(safe-area-inset-right))]">
      <div className="mobile-page-header flex min-w-0 items-center gap-1.5 px-2 text-sm">
        <MobileBackButton label={t('common.back')} className="size-11" onClick={onBack} />
        {mark ? (
          <span className={cn(getMarkTypeListBadgeClasses(mark.type), 'min-w-0')} title={typeLabel}>
            <span className="truncate">{typeLabel}</span>
          </span>
        ) : (
          <span className="min-w-0 truncate font-medium">{t('record.mark.list.title')}</span>
        )}
        {onImageViewChange ? (
          <RecordImageViewSwitch
            value={imageView}
            onValueChange={onImageViewChange}
            disabled={busy}
            compact
          />
        ) : null}
        {mark ? (
          <div className="ms-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {readOnly ? (
              <span className="shrink-0 whitespace-nowrap">{t('record.mark.detail.readOnly')}</span>
            ) : null}
            {tagNames ? (
              <span
                title={tagNames}
                className="min-w-0 max-w-16 truncate rounded-md bg-muted px-1.5 py-0.5 @sm/record-detail:max-w-24"
              >
                {tagNames}
              </span>
            ) : null}
            {fullDate && createdAt ? (
              <time dateTime={createdAt.toISOString()} title={`${t('record.mark.createdAt')} · ${fullDate}`} className="shrink-0 whitespace-nowrap tabular-nums">
                <span className="sr-only">{t('record.mark.createdAt')} {fullDate}</span>
                <span aria-hidden="true" className="@sm/record-detail:hidden">{createdAt.format('HH:mm')}</span>
                <span aria-hidden="true" className="hidden @sm/record-detail:inline">{createdAt.format('MM-DD HH:mm')}</span>
              </time>
            ) : null}
          </div>
        ) : null}
        {moreActions}
      </div>
      {mark ? (
        <div className="flex min-h-11 min-w-0 items-center gap-1 border-t border-border/60 bg-muted/25 px-2 md:px-[max(1rem,calc((100vw_-_48rem)/2))]">
          <div
            key={showImageToolbar ? 'image-tools' : 'body-tools'}
            data-swipe-back-ignore
            className="scrollbar-hide min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain"
          >
            <div className="flex min-h-11 w-max items-center gap-1">
              {showImageToolbar ? (
                <div ref={imageToolsRef} className="empty:hidden" />
              ) : (
                <>
                  {sourceActionLabel ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={sourceActionLabel}
                      title={sourceActionLabel}
                      disabled={busy}
                      onClick={onOpenSource}
                    >
                      <ExternalLink aria-hidden="true" />
                    </Button>
                  ) : null}
                  {mark.type === 'file' ? (
                    <RecordFileButton
                      mark={mark}
                      onOpen={onOpenSource}
                      mobile
                      disabled={busy}
                      className="shrink-0 @sm/record-detail:max-w-40 @lg/record-detail:max-w-56"
                    />
                  ) : null}
                  <div ref={toolsRef} className="flex shrink-0 items-center empty:hidden [&>div]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11" />
                  <div
                    ref={formatRef}
                    className="shrink-0 empty:hidden [&>div]:overflow-visible [&>div]:border-t-0 [&>div]:bg-transparent [&>div]:px-0"
                  />
                </>
              )}
            </div>
          </div>
          {!readOnly ? (
            <>
              <span role="status" className="sr-only">{statusLabel}</span>
              {saveFailed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 text-destructive hover:text-destructive"
                  aria-label={`${statusLabel} · ${t('record.mark.detail.retrySave')}`}
                  title={t('record.mark.detail.retrySave')}
                  disabled={busy}
                  onClick={onRetrySave}
                >
                  <TriangleAlert aria-hidden="true" />
                </Button>
              ) : showStatus ? (
                <Spinner aria-hidden="true" className="size-4 shrink-0 text-muted-foreground motion-reduce:animate-none" />
              ) : null}
            </>
          ) : null}
          {showImageToolbar ? (
            <div ref={imageSaveRef} className="flex shrink-0 items-center empty:hidden [&>button]:h-11 [&>button]:min-w-11" />
          ) : null}
        </div>
      ) : null}
      {mark && !readOnly ? (
        <RecordTagEditor
          mark={mark}
          open={activeDialog === 'tags'}
          onOpenChange={setTagsOpen}
          onSaved={onTagsSaved}
          onCloseAutoFocus={focusMoreButton}
        />
      ) : null}
      {mark && canEditDescription ? (
        <RecordDescriptionDialog
          mark={mark}
          open={activeDialog === 'description'}
          onOpenChange={setDescriptionOpen}
          onSaved={onDescriptionSaved}
          onCloseAutoFocus={focusMoreButton}
        />
      ) : null}
    </header>
  )
}
