'use client'

import { useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Info, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { getMarkLocalAssetPath, type Mark } from '@/db/marks'
import { cn } from '@/lib/utils'
import useMarkStore from '@/stores/mark'
import { isImageRecord } from './image-record-status'
import { loadRecordImage, saveEditedRecordImage } from './record-image-asset'
import { readRecordAfterPendingWrites } from './use-record-detail-save'
import '../editor/image/image-editor.css'

const ImageEditor = dynamic(() => import('@/app/core/main/editor/image/image-editor').then(module => module.ImageEditor), {
  ssr: false,
  loading: () => <div className="record-image-stage grid h-full place-items-center"><Spinner className="motion-reduce:animate-none" /></div>,
})

interface RecordImageWorkspaceProps {
  mark: Mark
  isActive?: boolean
  caption?: string
  toolbarTarget: HTMLElement | null
  saveTarget: HTMLElement | null
  onSaved?: (mark: Mark) => void
}

export function canEditRecordImage(mark: Mark): boolean {
  return isImageRecord(mark) && !mark.deleted && Boolean(mark.url?.trim())
}

function isImageCaptureProcessing(mark: Mark) {
  const filename = getMarkLocalAssetPath(mark)?.split('/').pop()
  const captureId = filename?.replace(/\.[^.]+$/, '')
  return useMarkStore.getState().queues.some(queue => queue.type === mark.type
    && (queue.queueId === mark.sourceId || queue.queueId === filename || queue.queueId === captureId))
}

export function RecordImageWorkspace({ mark, isActive, caption, toolbarTarget, saveTarget, onSaved }: RecordImageWorkspaceProps) {
  const t = useTranslations()
  const descriptionId = useId()
  const [hiddenDescriptionRecord, setHiddenDescriptionRecord] = useState<number | null>(null)
  const loaded = useRef<Mark | null>(null)
  const loadRequest = useRef(0)
  const callbacks = useRef({ t, onSaved })
  callbacks.current = { t, onSaved }
  const { id, url } = mark
  const description = caption?.trim()
  const showDescription = hiddenDescriptionRecord !== id
  const descriptionToggleLabel = t(showDescription ? 'record.mark.detail.hideImageDescription' : 'record.mark.detail.showImageDescription')
  const recordSource = useMemo(() => ({
    key: String(id),
    revision: url,
    async load() {
      const request = ++loadRequest.current
      const current = await readRecordAfterPendingWrites(id)
      if (!current || !canEditRecordImage(current)) {
        throw new Error(callbacks.current.t('record.mark.detail.editImageConflict'))
      }
      const image = await loadRecordImage(current)
      if (request === loadRequest.current) loaded.current = current
      return { ...image, revision: current.url }
    },
    async save(bytes: Uint8Array) {
      const original = loaded.current
      const current = original && await readRecordAfterPendingWrites(original.id)
      const { t, onSaved } = callbacks.current
      if (!original || !current || !canEditRecordImage(current) || current.url !== original.url) {
        throw new Error(t('record.mark.detail.editImageConflict'))
      }
      if (isImageCaptureProcessing(current) || current.desc?.trim() === t('record.capture.screenshotRecognitionPending')) {
        throw new Error(t('record.mark.detail.editImageProcessing'))
      }
      const saved = await saveEditedRecordImage(original, bytes)
      if (!saved) throw new Error(t('record.mark.detail.editImageConflict'))
      loaded.current = saved
      onSaved?.(saved)
      return saved.url
    },
  }), [id, url])

  return (
    <div className={cn(
      'record-image-workspace flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground',
      !description && 'pb-[env(safe-area-inset-bottom)]',
    )}>
      <ImageEditor
        recordSource={recordSource}
        isActive={isActive}
        toolbarTarget={toolbarTarget}
        saveTarget={saveTarget}
        stageOverlay={description ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
            <div
              data-swipe-back-ignore
              className={cn(
                'pointer-events-auto flex min-w-0 items-start gap-2 px-[max(0.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] text-foreground',
                showDescription
                  ? 'w-full border-t border-border/60 bg-background/80 pb-[env(safe-area-inset-bottom)] supports-backdrop-filter:backdrop-blur-sm'
                  : 'ms-auto w-fit pb-[max(0.5rem,env(safe-area-inset-bottom))]',
              )}
            >
              <p
                id={descriptionId}
                hidden={!showDescription}
                tabIndex={0}
                className="my-2.5 max-h-[6.25rem] min-w-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain whitespace-pre-wrap ps-1 text-sm leading-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                {description}
              </p>
              <Button
                type="button"
                variant="ghost"
                size={showDescription ? 'icon-xs' : 'icon'}
                className={cn(
                  'shrink-0',
                  showDescription
                    ? 'mt-2 rounded-none border-0 text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-muted-foreground dark:hover:bg-transparent [.mobile-app-active_&]:mt-0'
                    : 'size-11 rounded-full border border-border/60 bg-background/80 supports-backdrop-filter:backdrop-blur-sm',
                )}
                aria-label={descriptionToggleLabel}
                aria-controls={descriptionId}
                aria-expanded={showDescription}
                title={descriptionToggleLabel}
                onClick={() => setHiddenDescriptionRecord(showDescription ? id : null)}
              >
                {showDescription ? <X aria-hidden="true" /> : <Info aria-hidden="true" />}
              </Button>
            </div>
          </div>
        ) : undefined}
      />
    </div>
  )
}
