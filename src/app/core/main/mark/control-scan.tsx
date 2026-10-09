'use client'

import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'
import { invoke } from "@tauri-apps/api/core"
import { AlertCircle, Check, LoaderCircle, RefreshCw, ScanText, X } from "lucide-react"
import { convertFileSrc } from "@tauri-apps/api/core"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEffect, useState, useCallback, useMemo } from "react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { Card, CardContent } from "@/components/ui/card"
import { useRef } from "react";
import { ScreenshotImage } from "note-gen/screenshot"
import { BaseDirectory, exists, mkdir, remove, writeFile } from "@tauri-apps/plugin-fs"
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import './crop.css'
import Image from 'next/image'
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { v4 as uuid } from "uuid"
import useSettingStore from "@/stores/setting"
import { recognizeImageWithFallback } from "@/lib/image-recognition"
import { getImageRecognitionProgressText } from "@/lib/image-recognition-progress"
import { insertMark, Mark, updateMark as updateMarkDb } from "@/db/marks"
import emitter from '@/lib/emitter'
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { useRecordCompletion } from './use-record-completion'
import { uploadImage } from "@/lib/imageHosting"
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'

const SCREENSHOT_DIR = 'screenshot'
const SCREEN_CAPTURE_PERMISSION_REQUIRED = 'SCREEN_CAPTURE_PERMISSION_REQUIRED'
const TITLE_BAR_HEIGHT_PX = 36
const DEFAULT_CROP_BOX_RATIO = 0.5

function isWindowScreenshot(file: ScreenshotImage) {
  return (file.source || 'window') === 'window'
}

function isScreenshotDialogControlTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, input, textarea, select, [role="combobox"], [role="listbox"], [role="option"]'))
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

function getCroppedPngBytes(cropper: Cropper) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const canvas = cropper.getCroppedCanvas()

    if (!canvas) {
      reject(new Error('No screenshot area selected'))
      return
    }

    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Unable to export screenshot'))
        return
      }

      const arrayBuffer = await blob.arrayBuffer()
      resolve(new Uint8Array(arrayBuffer))
    }, 'image/png')
  })
}

function setCenteredDefaultCropBox(cropper: Cropper) {
  const canvasData = cropper.getCanvasData()
  const width = canvasData.width * DEFAULT_CROP_BOX_RATIO
  const height = canvasData.height * DEFAULT_CROP_BOX_RATIO

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return
  }

  cropper.setCropBoxData({
    left: canvasData.left + (canvasData.width - width) / 2,
    top: canvasData.top + (canvasData.height - height) / 2,
    width,
    height,
  })
}

export function ControlScan() {
  const t = useTranslations();
  const [open, setOpen] = useState(false)
  const [selectedImageSrc, setSelectedImageSrc] = useState('')
  const [files, setFiles] = useState<ScreenshotImage[]>([])
  const [selectedSaveTagId, setSelectedSaveTagId] = useState<number | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const cropperRef = useRef<Cropper | null>(null);
  const cropBoxRef = useRef<Element | null>(null)
  const openRef = useRef(open)
  const captureInFlightRef = useRef(false)
  const captureRequestIdRef = useRef(0)
  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const { addQueue, removeQueue, setQueue, fetchMarks } = useMarkStore()
  const {
    primaryModel,
    enableImageRecognition,
    recordSaveTargetMode,
    fixedRecordTagId,
    lastRecordTagId,
  } = useSettingStore()
  const completeRecord = useRecordCompletion()

  const visibleFiles = useMemo(() => (
    files.filter(isWindowScreenshot)
  ), [files])
  const defaultSaveTargetId = useMemo(() => getRecordSaveTagIdFromTags({
    mode: recordSaveTargetMode,
    currentTagId,
    lastTagId: lastRecordTagId,
    fixedTagId: fixedRecordTagId,
    tagIds: tags.map((tag) => tag.id),
  }), [
    currentTagId,
    fixedRecordTagId,
    lastRecordTagId,
    recordSaveTargetMode,
    tags,
  ])
  const selectedSaveTargetId = selectedSaveTagId && tags.some((tag) => tag.id === selectedSaveTagId)
    ? selectedSaveTagId
    : defaultSaveTargetId
  const recognitionLabel = enableImageRecognition
    ? t('record.capture.screenshotRecognitionAuto')
    : t('record.capture.screenshotRecognitionOff')
  const saveButtonLabel = enableImageRecognition
    ? t('record.capture.screenshotSaveAndRecognize')
    : t('record.capture.screenshotSaveOnly')
  const sourceCountLabel = visibleFiles.length > 0
    ? t('record.capture.screenshotSourceCount', { count: visibleFiles.length })
    : t('record.capture.screenshotNoSource')

  const cleanupTempScreenshots = useCallback(async () => {
    try {
      const tempDirExists = await exists('temp_screenshot', { baseDir: BaseDirectory.AppData })
      if (tempDirExists) {
        await remove('temp_screenshot', { baseDir: BaseDirectory.AppData, recursive: true })
      }
    } catch (error) {
      console.error('Failed to cleanup temp screenshots:', error)
    }
  }, [])

  function initCropper() {
    cropperRef.current?.destroy()
    cropperRef.current = null
    cropBoxRef.current?.removeEventListener('dblclick', cropEnd)
    cropBoxRef.current = null
    const image = document.getElementById('cropper') as HTMLImageElement;
    if (!image) return
    cropperRef.current = new Cropper(image, {
      background: false,
      viewMode: 1,
      responsive: true,
      autoCropArea: DEFAULT_CROP_BOX_RATIO,
      toggleDragModeOnDblclick: false
    });
    window.setTimeout(() => {
      if (cropperRef.current) {
        setCenteredDefaultCropBox(cropperRef.current)
      }

      const cropBox = document.querySelector('.cropper-crop-box')
      if (!cropBox) return
      cropBox.addEventListener('dblclick', cropEnd)
      cropBoxRef.current = cropBox
    }, 100)
  }

  const refreshScreenshotSources = useCallback(async () => {
    if (captureInFlightRef.current) {
      setIsCapturing(true)
      return
    }

    const requestId = captureRequestIdRef.current + 1
    captureRequestIdRef.current = requestId
    captureInFlightRef.current = true
    setIsCapturing(true)
    setCaptureError('')
    setFiles([])
    setSelectedImageSrc('')

    try {
      const fileNames = await invoke<ScreenshotImage[]>('screenshot')
      const convertedFiles = fileNames.map((fileName: ScreenshotImage) => ({
        ...fileName,
        source: fileName.source || 'window',
        path: convertFileSrc(fileName.path),
      }))

      if (!openRef.current || captureRequestIdRef.current !== requestId) {
        return
      }

      setFiles(convertedFiles)
    } catch (error) {
      console.error('Screenshot capture failed:', error)
      if (openRef.current && captureRequestIdRef.current === requestId) {
        setCaptureError(error instanceof Error ? error.message : String(error || t('common.error')))
      }
    } finally {
      if (captureRequestIdRef.current === requestId) {
        captureInFlightRef.current = false
      }

      if (openRef.current && captureRequestIdRef.current === requestId) {
        setIsCapturing(false)
      }
    }
  }, [t])

  function selectImage(file: ScreenshotImage) {
    setSelectedImageSrc(file.path)
  }

  const updateSavedMark = useCallback(async (mark: Mark) => {
    await updateMarkDb(mark)
    await fetchMarks()
  }, [fetchMarks])

  const processSavedScreenshot = useCallback(async (
    savedMark: Mark,
    queueId: string,
    bytes: Uint8Array,
    filename: string,
  ) => {
    let nextMark = savedMark

    try {
      if (enableImageRecognition) {
        const result = await recognizeImageWithFallback({
          imagePath: `${SCREENSHOT_DIR}/${filename}`,
          base64: `data:image/png;base64,${bytesToBase64(bytes)}`,
          shouldGenerateDescription: Boolean(primaryModel),
          onProgress: (stage) => {
            setQueue(queueId, {
              progress: getImageRecognitionProgressText(t, stage),
            })
          },
        })

        nextMark = {
          ...nextMark,
          content: result.content,
          desc: result.desc || result.content || t('record.capture.screenshotNoText'),
        }
        await updateSavedMark(nextMark)
        toast({
          title: t('record.capture.screenshotRecognitionComplete'),
        })
      }
    } catch (error) {
      console.error('Screenshot recognition failed:', error)
      nextMark = {
        ...nextMark,
        desc: t('record.capture.screenshotRecognitionFailed'),
      }
      await updateSavedMark(nextMark)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('record.capture.screenshotRecognitionFailed'),
        variant: 'destructive',
      })
    }

    try {
      setQueue(queueId, { progress: t('record.mark.progress.uploadImage') })
      const file = new File([bytes], filename, { type: 'image/png' })
      const hostedUrl = await uploadImage(file)

      if (hostedUrl) {
        nextMark = { ...nextMark, url: hostedUrl }
        await updateSavedMark(nextMark)
      }
    } catch (uploadError) {
      console.error('Failed to upload screenshot to image hosting:', uploadError)
      toast({
        title: t('record.capture.imageUploadFallback'),
        description: t('record.capture.imageUploadFallbackDescription'),
      })
    } finally {
      removeQueue(queueId)
    }
  }, [
    enableImageRecognition,
    primaryModel,
    removeQueue,
    setQueue,
    t,
    updateSavedMark,
  ])

  const cropEnd = useCallback(async () => {
    if (!selectedSaveTargetId) {
      toast({
        title: t('common.error'),
        description: t('record.capture.saveTargetPlaceholder'),
        variant: 'destructive',
      })
      return
    }

    if (!cropperRef.current) {
      return
    }

    try {
      const queueId = uuid()
      const filename = `${queueId}.png`
      const bytes = await getCroppedPngBytes(cropperRef.current)
      const isScreenshotFolderExists = await exists(SCREENSHOT_DIR, { baseDir: BaseDirectory.AppData})

      if (!isScreenshotFolderExists) {
        await mkdir(SCREENSHOT_DIR, { baseDir: BaseDirectory.AppData})
      }

      await writeFile(`${SCREENSHOT_DIR}/${filename}`, bytes, {
        baseDir: BaseDirectory.AppData
      })

      setOpen(false)

      const createdAt = Date.now()
      const initialDesc = enableImageRecognition ? t('record.capture.screenshotRecognitionPending') : ''
      const result = await insertMark({
        tagId: selectedSaveTargetId,
        type: 'scan',
        content: '',
        url: filename,
        desc: initialDesc,
      })
      const markId = Number(result.lastInsertId || 0)

      if (!markId) {
        throw new Error(t('record.capture.screenshotSaveFailed'))
      }

      const savedMark: Mark = {
        id: markId,
        tagId: selectedSaveTargetId,
        type: 'scan',
        content: '',
        url: filename,
        desc: initialDesc,
        deleted: 0,
        createdAt,
      }

      addQueue({
        queueId,
        tagId: selectedSaveTargetId,
        progress: t('record.mark.progress.cacheScreenshot'),
        type: 'scan',
        startTime: Date.now(),
      })

      await completeRecord({
        markId,
        tagId: selectedSaveTargetId,
        typeLabel: t('record.mark.type.screenshot'),
      })
      void processSavedScreenshot(savedMark, queueId, bytes, filename)
    } catch (error) {
      console.error('Screenshot record failed:', error)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }, [
    addQueue,
    completeRecord,
    enableImageRecognition,
    processSavedScreenshot,
    selectedSaveTargetId,
    t,
  ])

  useEffect(() => {
    openRef.current = open

    if (!open) {
      cropperRef.current?.destroy()
      cropperRef.current = null
      cropBoxRef.current?.removeEventListener('dblclick', cropEnd)
      cropBoxRef.current = null
      setFiles((currentFiles) => (currentFiles.length > 0 ? [] : currentFiles))
      setSelectedImageSrc((currentSrc) => (currentSrc ? '' : currentSrc))
      setCaptureError((currentError) => (currentError ? '' : currentError))
      setIsCapturing(false)
      void cleanupTempScreenshots()
    }
  }, [cleanupTempScreenshots, cropEnd, open])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const prepareTags = async () => {
      await initTags()
      await fetchTags()
      if (!cancelled) {
        const tagState = useTagStore.getState()
        const settingState = useSettingStore.getState()
        setSelectedSaveTagId(getRecordSaveTagIdFromTags({
          mode: settingState.recordSaveTargetMode,
          currentTagId: tagState.currentTagId,
          lastTagId: settingState.lastRecordTagId,
          fixedTagId: settingState.fixedRecordTagId,
          tagIds: tagState.tags.map((tag) => tag.id),
        }))
      }
    }

    void prepareTags()
    return () => {
      cancelled = true
    }
  }, [fetchTags, initTags, open])

  useEffect(() => {
    if (!open || isCapturing) {
      return
    }

    if (visibleFiles.length === 0) {
      setSelectedImageSrc((currentSrc) => (currentSrc ? '' : currentSrc))
      return
    }

    if (!visibleFiles.some((file) => file.path === selectedImageSrc)) {
      setSelectedImageSrc(visibleFiles[0].path)
    }
  }, [isCapturing, open, selectedImageSrc, visibleFiles])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isScreenshotDialogControlTarget(event.target)) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void cropEnd()
        return
      }

      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || visibleFiles.length <= 1) {
        return
      }

      event.preventDefault()
      const selectedIndex = visibleFiles.findIndex((file) => file.path === selectedImageSrc)
      const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
      const nextIndex = event.key === 'ArrowRight'
        ? (currentIndex + 1) % visibleFiles.length
        : (currentIndex - 1 + visibleFiles.length) % visibleFiles.length
      setSelectedImageSrc(visibleFiles[nextIndex].path)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cropEnd, open, selectedImageSrc, visibleFiles])

  const openScreenshotDialog = useCallback(() => {
    openRef.current = true
    setSelectedSaveTagId(selectedSaveTargetId)
    setOpen(true)
    void refreshScreenshotSources()
  }, [refreshScreenshotSources, selectedSaveTargetId])

  const handleScan = useCallback(() => {
    openScreenshotDialog()
  }, [openScreenshotDialog])

  useEffect(() => {
    emitter.on('toolbar-shortcut-scan', handleScan)
    return () => {
      emitter.off('toolbar-shortcut-scan', handleScan)
    }
  }, [handleScan])

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedSaveTagId((currentTag) => {
      if (currentTag && tags.some((tag) => tag.id === currentTag)) {
        return currentTag
      }

      return selectedSaveTargetId
    })
  }, [open, selectedSaveTargetId, tags])

  const handleCropperImageLoad = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (open) {
        initCropper()
      }
    })
  }, [open])

  return (
    <div className="hidden md:block">
      <TooltipButton icon={<ScanText />} tooltipText={t('record.capture.screenshotRecordTitle')} onClick={openScreenshotDialog} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-none translate-x-0 translate-y-0 border-none bg-black p-4 text-white sm:max-w-none sm:rounded-none"
          showCloseButton={false}
          style={{
            left: 0,
            top: TITLE_BAR_HEIGHT_PX,
            width: '100vw',
            height: `calc(100vh - ${TITLE_BAR_HEIGHT_PX}px)`,
            transform: 'none',
          }}
        >
          <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-white/75">
                <span className="max-w-40 truncate rounded-full bg-white/10 px-2 py-1">
                  {sourceCountLabel}
                </span>
                <span className="max-w-40 truncate rounded-full bg-white/10 px-2 py-1">
                  {t('record.capture.screenshotRecognitionMethod')}: {recognitionLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select
                  value={selectedSaveTargetId ? String(selectedSaveTargetId) : undefined}
                  onValueChange={(value) => setSelectedSaveTagId(Number(value))}
                  disabled={tags.length === 0}
                >
                  <SelectTrigger className="h-8 w-48 justify-start gap-1 border-white/10 bg-white/10 px-2 py-1 text-xs text-white shadow-none hover:bg-white/15 focus:ring-white/30 data-[placeholder]:text-white/50 [&_svg]:ml-auto [&_svg]:text-white/70">
                    <span className="shrink-0 text-white/60">{t('record.capture.saveTarget')}:</span>
                    <SelectValue placeholder={t('record.capture.saveTargetPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent className="z-[10000]">
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={String(tag.id)}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-2 text-white hover:bg-white/15 hover:text-white"
                  onClick={() => void refreshScreenshotSources()}
                  disabled={isCapturing}
                >
                  <RefreshCw className={`h-4 w-4 ${isCapturing ? 'animate-spin' : ''}`} />
                  {t('record.capture.screenshotRefresh')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-2 bg-white text-black hover:bg-white/90"
                  onClick={cropEnd}
                  disabled={!selectedImageSrc || isCapturing || !selectedSaveTargetId}
                >
                  <Check className="h-4 w-4" />
                  {saveButtonLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-2 text-white hover:bg-white/15 hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                  {t('common.close')}
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/80 p-2">
              {isCapturing ? (
                <div className="flex flex-col items-center gap-3 text-white/80">
                  <LoaderCircle className="h-7 w-7 animate-spin" />
                  <p className="text-sm">{t('record.capture.screenshotCapturing')}</p>
                </div>
              ) : captureError ? (
                <div className="flex max-w-md flex-col items-center gap-3 text-center text-white/80">
                  <AlertCircle className="h-8 w-8 text-amber-300" />
                  <p className="text-sm font-medium text-white">{t('record.capture.screenshotCaptureFailed')}</p>
                  <p className="text-xs leading-relaxed text-white/65">
                    {captureError === SCREEN_CAPTURE_PERMISSION_REQUIRED
                      ? t('record.capture.screenshotPermissionHint')
                      : captureError}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-white/10 text-white hover:bg-white/20"
                    onClick={() => void refreshScreenshotSources()}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('record.capture.retry')}
                  </Button>
                </div>
              ) : selectedImageSrc ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    id="cropper"
                    key={selectedImageSrc}
                    src={selectedImageSrc}
                    alt=""
                    className="block max-h-full max-w-full"
                    onLoad={handleCropperImageLoad}
                  />
                </>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-3 text-center text-white/80">
                  <AlertCircle className="h-8 w-8 text-amber-300" />
                  <p className="text-sm font-medium text-white">{t('record.capture.screenshotEmpty')}</p>
                  <p className="text-xs leading-relaxed text-white/65">{t('record.capture.screenshotPermissionHint')}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-white/10 text-white hover:bg-white/20"
                    onClick={() => void refreshScreenshotSources()}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('record.capture.retry')}
                  </Button>
                </div>
              )}
            </div>

            {visibleFiles.length > 0 ? (
              <Carousel
                opts={{
                  align: "center",
                }}
                orientation="horizontal"
                className="mx-auto h-28 w-full max-w-5xl shrink-0 px-12"
              >
                <CarouselContent className="-ml-3 justify-center">
                  {visibleFiles.map((file, index) => {
                    const isSelected = selectedImageSrc === file.path

                    return (
                      <CarouselItem key={`${file.source}-${file.path}-${index}`} className="basis-auto pl-3">
                        <Card
                          className={`group h-24 w-36 cursor-pointer overflow-hidden rounded-md border bg-white/5 p-0 transition hover:border-white/45 hover:bg-white/10 ${isSelected ? 'border-white shadow-[0_0_0_2px_rgba(255,255,255,0.25)]' : 'border-white/15'}`}
                          onClick={() => selectImage(file)}
                        >
                          <CardContent className="relative flex size-full items-center justify-center overflow-hidden p-0">
                            <Image className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" src={file.path} alt="" width={288} height={192} />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2 pb-1.5 pt-7">
                              <p className="line-clamp-1 text-[11px] font-medium text-white">{file.name}</p>
                              <p className="line-clamp-1 text-[10px] text-white/65">{t('record.capture.screenshotModeWindow')}</p>
                            </div>
                            {isSelected ? (
                              <span className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-white text-black">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            ) : null}
                          </CardContent>
                        </Card>
                      </CarouselItem>
                    )
                  })}
                </CarouselContent>
                <CarouselPrevious className="left-1 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-30" />
                <CarouselNext className="right-1 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-30" />
              </Carousel>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
