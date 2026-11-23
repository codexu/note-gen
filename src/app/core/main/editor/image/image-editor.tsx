'use client'

import { useEffect, useState, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Cropper, CropperRef, Priority } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { Button } from '@/components/ui/button'
import {
  ArrowUpRight,
  Check,
  Pencil,
  Redo2,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Crop,
  Save,
  ScanLine,
  SlidersHorizontal,
  Undo,
  Undo2,
} from 'lucide-react'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ImageFooter } from './image-footer'
import { TooltipButton } from '@/components/tooltip-button'
import NextImage from 'next/image'
import { MainStatusBarPortal } from '../../main-status-bar'
import emitter from '@/lib/emitter'
import { sameFileBytes } from '@/lib/sync/file-content'
import { markEditorPathMutation, runEditorPathWriteTransaction } from '@/lib/editor-deactivation'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { drawScreenshot, type Annotation } from '@/lib/screenshot-editor'
import { ImageAnnotationCanvas, type RecordAnnotationTool } from './image-annotation-canvas'

type ImageEditorProps = { isActive?: boolean } & (
  | { filePath: string; recordSource?: never; stageOverlay?: never; toolbarTarget?: never; saveTarget?: never }
  | { filePath?: never; stageOverlay?: ReactNode; toolbarTarget: HTMLElement | null; saveTarget: HTMLElement | null; recordSource: {
    key: string
    revision?: string
    load: () => Promise<{ bytes: Uint8Array; mimeType?: string; revision?: string }>
    save: (bytes: Uint8Array) => Promise<string | void>
  } }
)

const annotationTools = [
  { value: 'pen', icon: Pencil },
  { value: 'arrow', icon: ArrowUpRight },
  { value: 'mosaic', icon: ScanLine },
] as const

interface ImageFrame {
  blob: Blob
  width: number
  height: number
}

interface ImageEdit {
  frame: ImageFrame
  annotations: readonly Annotation[]
}

const IMAGE_HISTORY_LIMIT = 20
const EMPTY_IMAGE_HISTORY: Record<'undo' | 'redo', readonly ImageEdit[]> = { undo: [], redo: [] }

interface CropperLayoutState {
  boundary: {
    width: number
    height: number
  }
  imageSize: {
    width: number
    height: number
  }
}

function decodeImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode the image'))
    image.src = src
  })
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the image'))
    }, 'image/png')
  })
}

async function captureCanvas(canvas: HTMLCanvasElement): Promise<ImageFrame> {
  const { width, height } = canvas
  return { blob: await canvasToPng(canvas), width, height }
}

async function renderAnnotatedImage(src: string, annotations: readonly Annotation[]) {
  const image = await decodeImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  drawScreenshot(context, image, canvas, annotations)
  return canvas
}

export function ImageEditor(props: ImageEditorProps) {
  const { filePath = '', recordSource, isActive = true, toolbarTarget, saveTarget } = props
  const t = useTranslations('editorImage')
  const common = useTranslations('common')
  const zoom = useTranslations('screenshotPin')
  const screenshot = useTranslations('screenshotEditor')
  const sourceKey = recordSource ? `record:${recordSource.key}` : `file:${filePath}`
  const recordRevision = recordSource?.revision
  const cropperRef = useRef<CropperRef>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const previewUrl = useRef('')
  const cropPreviewUrl = useRef('')
  const [preview, setPreview] = useState<(ImageFrame & { url: string }) | null>(null)
  const imageSrc = preview?.url ?? ''
  const imageWidth = preview?.width ?? 0
  const imageHeight = preview?.height ?? 0
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<RecordAnnotationTool | null>(null)
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([])
  const [imageHistory, setImageHistory] = useState(EMPTY_IMAGE_HISTORY)
  const hasDraftChanges = hasChanges || annotations.length > 0
  const drawingRef = useRef(false)
  const [originalImage, setOriginalImage] = useState<(ImageFrame & { bytes: Uint8Array }) | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [cropReady, setCropReady] = useState(false)
  const [operation, setOperation] = useState<'transform' | 'save' | null>(null)
  const operationRef = useRef(false)
  const [previewScale, setPreviewScale] = useState(1)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const sourceRef = useRef<{
    filePath: string
    workspace: Awaited<ReturnType<typeof getWorkspacePath>>
    options: Awaited<ReturnType<typeof getFilePathOptions>>
  } | null>(null)
  const loadVersionRef = useRef(0)
  const editingRef = useRef(false)
  const externalUpdateRef = useRef(false)
  const loadedRecordRevision = useRef<string | undefined>(undefined)
  const observedRecordRevision = useRef(recordRevision)
  const currentSource = useRef({ key: sourceKey, recordSource })
  currentSource.current = { key: sourceKey, recordSource }

  const MIN_PREVIEW_SCALE = 0.25
  const MAX_PREVIEW_SCALE = 4
  const PREVIEW_SCALE_STEP = 0.25

  const keepCurrentPreviewTab = () => {
    if (recordSource) return
    const articleState = useArticleStore.getState()
    const previewTab = articleState.openTabs.find(tab => (
      tab.path === filePath && tab.preview
    ))
    if (previewTab) void articleState.setTabDisposition(previewTab.id, 'regular')
  }

  useEffect(() => {
    editingRef.current = false
    drawingRef.current = false
    externalUpdateRef.current = false
    loadedRecordRevision.current = undefined
    sourceRef.current = null
    operationRef.current = false
    setOperation(null)
    setOriginalImage(null)
    setHasChanges(false)
    setAnnotationTool(null)
    setAnnotations([])
    setImageHistory(EMPTY_IMAGE_HISTORY)
    changeCropMode(false)
    setPreview(null)
    void loadImage()
    return () => {
      loadVersionRef.current += 1
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = ''
      clearCropPreview()
    }
  }, [sourceKey])

  useEffect(() => {
    const previous = observedRecordRevision.current
    observedRecordRevision.current = recordRevision
    if (!recordRevision || recordRevision === previous || recordRevision === loadedRecordRevision.current) return
    if (editingRef.current || drawingRef.current || operationRef.current || hasDraftChanges || cropMode) {
      externalUpdateRef.current = true
    } else {
      void loadImage()
    }
  }, [recordRevision])

  useEffect(() => {
    if (recordSource) return
    const onPulled = ({ path }: { path: string }) => {
      // Keep unsaved edits intact. Saving them checks the original disk bytes.
      if (path !== filePath) return
      if (editingRef.current || hasChanges || cropMode) {
        externalUpdateRef.current = true
      } else {
        void loadImage()
      }
    }
    emitter.on('sync-pulled', onPulled)
    return () => { emitter.off('sync-pulled', onPulled) }
  }, [sourceKey, hasChanges, cropMode])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || loading || !imageSrc) return

    const updateViewportSize = () => {
      const { clientWidth: width, clientHeight: height } = element
      if (width && height) setViewportSize({ width, height })
    }

    updateViewportSize()
    const observer = new ResizeObserver(updateViewportSize)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [loading, imageSrc])

  function isCurrentLoad(version: number) {
    return version === loadVersionRef.current && sourceKey === currentSource.current.key
  }

  function showPreview(frame: ImageFrame, url = URL.createObjectURL(frame.blob)) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = url
    setPreview({ blob: frame.blob, width: frame.width, height: frame.height, url })
  }

  async function loadImage() {
    const record = currentSource.current.recordSource
    if (!record && !filePath) return
    const version = ++loadVersionRef.current
    let url = ''

    try {
      setLoading(true)
      setLoadError(null)
      let data: { bytes: Uint8Array; mimeType?: string; revision?: string }
      if (record) {
        data = await record.load()
      } else {
        const workspace = await getWorkspacePath()
        const options = await getFilePathOptions(filePath)
        const currentWorkspace = await getWorkspacePath()
        if (currentWorkspace.path !== workspace.path || currentWorkspace.isCustom !== workspace.isCustom) return
        data = { bytes: workspace.isCustom
          ? await readFile(options.path)
          : await readFile(options.path, { baseDir: options.baseDir }) }
        if (!isCurrentLoad(version)) return
        sourceRef.current = { filePath, workspace, options }
      }

      if (!isCurrentLoad(version) || editingRef.current) return
      const blob = new Blob([data.bytes as unknown as BlobPart], { type: data.mimeType })
      url = URL.createObjectURL(blob)
      const image = await decodeImage(url)
      if (!isCurrentLoad(version) || editingRef.current) return
      const frame = { blob, width: image.naturalWidth, height: image.naturalHeight }
      showPreview(frame, url)
      loadedRecordRevision.current = data.revision ?? record?.revision
      setOriginalImage({ ...frame, bytes: data.bytes })
      setHasChanges(false)
      setImageHistory(EMPTY_IMAGE_HISTORY)
      setPreviewScale(1)
    } catch (error) {
      if (!isCurrentLoad(version)) return
      console.error('Failed to load image:', error)
      if (record) {
        setLoadError(error instanceof Error ? error.message : t('loadError'))
      } else {
        toast({ title: t('loadError'), description: String(error), variant: 'destructive' })
      }
    } finally {
      if (url && previewUrl.current !== url) URL.revokeObjectURL(url)
      if (isCurrentLoad(version)) setLoading(false)
    }
  }

  function setCurrentOperation(next: typeof operation) {
    operationRef.current = next !== null
    setOperation(next)
  }

  function rememberImageEdit() {
    if (!recordSource || !preview) return
    const before = { frame: preview, annotations }
    setImageHistory(history => ({
      undo: [...history.undo.slice(1 - IMAGE_HISTORY_LIMIT), before],
      redo: [],
    }))
  }

  async function changePreview(getFrame: () => Promise<ImageFrame | undefined>, finishCrop = false) {
    if (operationRef.current || drawingRef.current) return
    const wasEditing = editingRef.current
    const version = loadVersionRef.current
    editingRef.current = true
    setCurrentOperation('transform')
    try {
      const frame = await getFrame()
      if (!frame || !isCurrentLoad(version)) {
        if (isCurrentLoad(version)) editingRef.current = wasEditing
        return
      }
      rememberImageEdit()
      showPreview(frame)
      keepCurrentPreviewTab()
      setHasChanges(true)
      setAnnotations([])
      setPreviewScale(1)
      if (finishCrop) changeCropMode(false)
    } catch (error) {
      console.error('Failed to transform image:', error)
      if (isCurrentLoad(version)) {
        editingRef.current = wasEditing
        if (recordSource) toast({ title: common('error'), variant: 'destructive' })
      }
    } finally {
      if (isCurrentLoad(version)) setCurrentOperation(null)
    }
  }

  function applyImageTransform(transformFn: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement) => void) {
    void changePreview(async () => {
      const annotated = annotations.length ? await renderAnnotatedImage(imageSrc, annotations) : null
      const canvas = document.createElement('canvas')
      try {
        const img = annotated ?? await decodeImage(imageSrc)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        transformFn(canvas, ctx, img)
        return await captureCanvas(canvas)
      } finally {
        canvas.width = 0
        if (annotated) annotated.width = 0
      }
    })
  }

  function clearCropPreview() {
    if (cropPreviewUrl.current) URL.revokeObjectURL(cropPreviewUrl.current)
    cropPreviewUrl.current = ''
  }

  function changeCropMode(enabled: boolean) {
    if (!enabled) clearCropPreview()
    setCropReady(false)
    setCropMode(enabled)
  }

  function loadPendingRecordRevision() {
    if (!recordSource || !externalUpdateRef.current || editingRef.current || drawingRef.current || operationRef.current) return
    externalUpdateRef.current = false
    void loadImage()
  }

  function handleDrawingChange(drawing: boolean) {
    drawingRef.current = drawing
    if (!drawing && !hasDraftChanges && !cropMode) loadPendingRecordRevision()
  }

  function handleAnnotation(annotation: Annotation) {
    rememberImageEdit()
    editingRef.current = true
    setAnnotations(current => [...current, annotation])
  }

  function moveImageHistory(direction: 'undo' | 'redo') {
    if (!preview || operationRef.current || drawingRef.current || cropMode) return
    const step = imageHistory[direction].at(-1)
    if (!step) return

    const otherDirection = direction === 'undo' ? 'redo' : 'undo'
    setImageHistory({
      ...imageHistory,
      [direction]: imageHistory[direction].slice(0, -1),
      [otherDirection]: [...imageHistory[otherDirection], { frame: preview, annotations }],
    })
    if (step.frame.blob !== preview.blob) {
      showPreview(step.frame)
      setPreviewScale(1)
    }
    const frameChanged = step.frame.blob !== originalImage?.blob
    setHasChanges(frameChanged)
    setAnnotations(step.annotations)
    editingRef.current = frameChanged || step.annotations.length > 0
    if (!editingRef.current) loadPendingRecordRevision()
  }

  async function handleCropModeChange(enabled: boolean) {
    if (operationRef.current || drawingRef.current) return
    if (!enabled || annotations.length === 0) {
      if (enabled) setAnnotationTool(null)
      changeCropMode(enabled)
      if (!enabled && !hasDraftChanges) loadPendingRecordRevision()
      return
    }

    const version = loadVersionRef.current
    let canvas: HTMLCanvasElement | undefined
    setCurrentOperation('transform')
    try {
      canvas = await renderAnnotatedImage(imageSrc, annotations)
      const blob = await canvasToPng(canvas)
      if (!isCurrentLoad(version)) return
      cropPreviewUrl.current = URL.createObjectURL(blob)
      setAnnotationTool(null)
      changeCropMode(true)
    } catch (error) {
      console.error('Failed to prepare image crop:', error)
      if (isCurrentLoad(version)) toast({ title: common('error'), variant: 'destructive' })
    } finally {
      if (canvas) canvas.width = 0
      if (isCurrentLoad(version)) setCurrentOperation(null)
    }
  }

  const handleRotate = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.height
      canvas.height = img.width
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(90 * Math.PI / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
    })
  }

  const handleFlipHorizontal = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0)
    })
  }

  const handleFlipVertical = () => {
    applyImageTransform((canvas, ctx, img) => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.translate(0, canvas.height)
      ctx.scale(1, -1)
      ctx.drawImage(img, 0, 0)
    })
  }

  const handleZoomIn = () => {
    if (operationRef.current || drawingRef.current) return
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(1.2)
      return
    }

    setPreviewScale((scale) => Math.min(MAX_PREVIEW_SCALE, Number((scale + PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleZoomOut = () => {
    if (operationRef.current || drawingRef.current) return
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(0.8)
      return
    }

    setPreviewScale((scale) => Math.max(MIN_PREVIEW_SCALE, Number((scale - PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleReset = () => {
    if (operationRef.current || drawingRef.current) return
    if (hasDraftChanges && !externalUpdateRef.current) rememberImageEdit()
    editingRef.current = false
    setHasChanges(false)
    setAnnotations([])
    changeCropMode(false)
    setPreviewScale(1)
    if (externalUpdateRef.current) {
      externalUpdateRef.current = false
      void loadImage()
      return
    }
    if (originalImage) showPreview(originalImage)
  }

  const handleSave = async () => {
    if (!preview || operationRef.current || drawingRef.current) return
    const version = loadVersionRef.current
    const wasEditing = editingRef.current
    let annotated: HTMLCanvasElement | undefined
    editingRef.current = true
    setCurrentOperation('save')
    try {
      keepCurrentPreviewTab()
      if (!cropMode && annotations.length > 0) annotated = await renderAnnotatedImage(imageSrc, annotations)
      const canvas = cropMode ? cropperRef.current?.getCanvas() : annotated
      if (cropMode && !canvas) return
      const frame = canvas ? await captureCanvas(canvas) : preview
      const bytes = new Uint8Array(await frame.blob.arrayBuffer())
      if (!isCurrentLoad(version)) return

      if (recordSource) {
        const revision = await recordSource.save(bytes)
        if (revision) loadedRecordRevision.current = revision
      } else {
        const source = sourceRef.current
        if (!source || source.filePath !== filePath || !originalImage) throw new Error(t('changedOnDisk'))
        const saved = await runEditorPathWriteTransaction(filePath, async () => {
          const workspace = await getWorkspacePath()
          if (workspace.path !== source.workspace.path || workspace.isCustom !== source.workspace.isCustom) {
            throw new Error(t('changedOnDisk'))
          }
          const diskBytes = await readFile(source.options.path, { baseDir: source.options.baseDir })
          if (!sameFileBytes(diskBytes, originalImage.bytes)) throw new Error(t('changedOnDisk'))
          await writeFile(source.options.path, bytes, { baseDir: source.options.baseDir })
          markEditorPathMutation(filePath)
          return true
        })
        if (!saved) throw new Error(t('changedOnDisk'))
      }

      if (isCurrentLoad(version)) {
        if (cropMode) rememberImageEdit()
        setOriginalImage({ ...frame, bytes })
        if (canvas) showPreview(frame)
        editingRef.current = false
        externalUpdateRef.current = false
        setHasChanges(false)
        setAnnotations([])
        changeCropMode(false)
      }

      if (!recordSource) {
        await useArticleStore.getState().loadFileTree()
        toast({ title: '保存成功', description: '图片已保存' })
      }
    } catch (error) {
      console.error('Failed to save image:', error)
      if (isCurrentLoad(version)) {
        toast({
          title: t('saveError'),
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive'
        })
      }
    } finally {
      if (annotated) annotated.width = 0
      if (isCurrentLoad(version)) {
        if (editingRef.current) editingRef.current = wasEditing
        setCurrentOperation(null)
      }
    }
  }

  const handleCropComplete = () => {
    if (!cropMode || !cropperRef.current) return
    void changePreview(async () => {
      const canvas = cropperRef.current?.getCanvas()
      if (!canvas) return
      return captureCanvas(canvas)
    }, true)
  }

  const cropperViewportStyle = (() => {
    if (!imageWidth || !imageHeight || !viewportSize.width || !viewportSize.height) {
      return { width: '100%', height: '100%' }
    }

    const horizontalPadding = 32
    const verticalPadding = 32
    const maxWidth = Math.max(0, viewportSize.width - horizontalPadding)
    const maxHeight = Math.max(0, viewportSize.height - verticalPadding)

    if (!maxWidth || !maxHeight) {
      return { width: '100%', height: '100%' }
    }

    const imageAspectRatio = imageWidth / imageHeight
    const viewportAspectRatio = maxWidth / maxHeight

    if (imageAspectRatio > viewportAspectRatio) {
      return {
        width: `${maxWidth}px`,
        height: `${maxWidth / imageAspectRatio}px`,
      }
    }

    return {
      width: `${maxHeight * imageAspectRatio}px`,
      height: `${maxHeight}px`,
    }
  })()

  const getInitialCropSize = ({ boundary }: CropperLayoutState) => ({
    width: boundary.width * 0.8,
    height: boundary.height * 0.8,
  })

  const getInitialVisibleArea = ({ imageSize }: CropperLayoutState) => ({
    left: 0,
    top: 0,
    width: imageSize.width,
    height: imageSize.height,
  })

  const imageReady = Boolean(imageSrc) && loadError === null
  const busy = operation !== null || loading
  const controlsDisabled = busy || !imageReady
  const fittedScale = Math.min(
    1,
    Math.max(1, viewportSize.width - 32) / Math.max(1, imageWidth),
    Math.max(1, viewportSize.height - 32) / Math.max(1, imageHeight),
  ) * previewScale
  const croppingRecord = Boolean(recordSource && cropMode)
  const transformDisabled = controlsDisabled || croppingRecord
  const compactRecordToolbar = viewportSize.width < 384
  const recordButtonSize = cn('size-7 p-0 pointer-coarse:h-11', compactRecordToolbar && 'w-6 min-w-0')
  const transformTools = [
    { icon: RotateCw, label: t('rotate'), run: handleRotate, disabled: transformDisabled },
    { icon: FlipHorizontal, label: t('flipHorizontal'), run: handleFlipHorizontal, disabled: transformDisabled },
    { icon: FlipVertical, label: t('flipVertical'), run: handleFlipVertical, disabled: transformDisabled },
  ]
  const zoomTools = [
    { icon: ZoomIn, label: zoom('zoomIn'), run: handleZoomIn, disabled: controlsDisabled },
    { icon: ZoomOut, label: zoom('zoomOut'), run: handleZoomOut, disabled: controlsDisabled },
  ]
  const imageTools = [...transformTools, ...zoomTools]
  const saveLabel = operation === 'save' ? common('saving') : common('save')

  const cropButton = (
    <Toggle
      pressed={cropMode}
      onPressedChange={handleCropModeChange}
      aria-label={t('crop')}
      title={t('crop')}
      size="sm"
      className={recordSource ? cn('shrink-0', recordButtonSize) : undefined}
      disabled={controlsDisabled}
    >
      <Crop className={recordSource ? undefined : 'size-4'} />
    </Toggle>
  )

  const recordToolbar = (
    <div data-swipe-back-ignore className="flex shrink-0 items-center gap-0.5">
      <TooltipButton
        icon={<Undo2 />}
        tooltipText={screenshot('undo')}
        onClick={() => moveImageHistory('undo')}
        disabled={controlsDisabled || cropMode || imageHistory.undo.length === 0}
        buttonClassName={recordButtonSize}
        size="sm"
        side="bottom"
      />
      <TooltipButton
        icon={<Redo2 />}
        tooltipText={screenshot('redo')}
        onClick={() => moveImageHistory('redo')}
        disabled={controlsDisabled || cropMode || imageHistory.redo.length === 0}
        buttonClassName={recordButtonSize}
        size="sm"
        side="bottom"
      />
      {(!compactRecordToolbar || cropMode) && cropButton}
      {cropMode ? (
        <TooltipButton icon={<Check />} tooltipText={t('applyCrop')} onClick={handleCropComplete} disabled={controlsDisabled || !cropReady} buttonClassName={recordButtonSize} size="sm" side="bottom" />
      ) : (
        <ToggleGroup
          type="single"
          value={annotationTool ?? ''}
          onValueChange={value => {
            if (!drawingRef.current) setAnnotationTool(annotationTools.find(tool => tool.value === value)?.value ?? null)
          }}
          disabled={controlsDisabled}
          size="sm"
          spacing={0.5}
        >
          {annotationTools.map(({ value, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={screenshot(value)} title={screenshot(value)} className={recordButtonSize}>
              <Icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className={recordButtonSize} aria-label={t('moreTools')} title={t('moreTools')} disabled={controlsDisabled}>
            <SlidersHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max" data-swipe-back-ignore>
          <DropdownMenuGroup>
            {compactRecordToolbar && !cropMode && (
              <DropdownMenuItem onSelect={() => void handleCropModeChange(true)}>
                <Crop />
                {t('crop')}
              </DropdownMenuItem>
            )}
            {imageTools.map(({ icon: Icon, label, run, disabled }) => (
              <DropdownMenuItem key={label} onSelect={run} disabled={disabled}>
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={handleReset} disabled={!hasDraftChanges && !cropMode && previewScale === 1}>
              {t('reset')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const fileToolbar = (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2">
      {cropButton}
      <Separator orientation="vertical" className="h-6" />
      {transformTools.map(({ icon: Icon, label, run, disabled }) => (
        <TooltipButton key={label} icon={<Icon className="size-4" />} tooltipText={label} onClick={run} disabled={disabled} size="sm" side="bottom" />
      ))}
      <div className="flex-1" />
      {zoomTools.map(({ icon: Icon, label, run, disabled }) => (
        <TooltipButton key={label} icon={<Icon className="size-4" />} tooltipText={label} onClick={run} disabled={disabled} size="sm" side="bottom" />
      ))}
      {hasChanges && (
        <div className="flex shrink-0 items-center gap-2">
          <Separator orientation="vertical" className="h-6" />
          <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={busy}>
            <Undo data-icon="inline-start" />
            {t('reset')}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
            {operation === 'save'
              ? <Spinner data-icon="inline-start" className="motion-reduce:animate-none" />
              : <Save data-icon="inline-start" />}
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-busy={busy}>
      {recordSource
        ? isActive && toolbarTarget && createPortal(recordToolbar, toolbarTarget)
        : imageReady && !loading && fileToolbar}
      {recordSource && isActive && saveTarget && hasDraftChanges && createPortal(
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={controlsDisabled || (croppingRecord && !cropReady)}
          aria-label={saveLabel}
          title={saveLabel}
          className={cn(recordButtonSize, '@3xl/record-detail:w-auto @3xl/record-detail:px-2.5')}
        >
          {operation === 'save' ? <Spinner data-icon="inline-start" className="motion-reduce:animate-none" /> : <Save data-icon="inline-start" />}
          <span className="hidden @3xl/record-detail:inline">{saveLabel}</span>
        </Button>,
        saveTarget,
      )}
      <div ref={viewportRef} className={cn('relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4', recordSource ? 'record-image-stage' : 'bg-background')}>
        {loading ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
            {common('loading')}
          </div>
        ) : !imageReady ? (
          <div role="alert" className="flex flex-col gap-1 text-center text-sm">
            <p>{t('loadError')}</p>
            {loadError && loadError !== t('loadError') && <p className="text-muted-foreground">{loadError}</p>}
          </div>
        ) : cropMode ? (
          <div
            className={cn('flex min-h-0 min-w-0 items-center justify-center overflow-hidden', recordSource && 'touch-none', busy && 'pointer-events-none')}
            data-swipe-back-ignore={recordSource ? '' : undefined}
            style={cropperViewportStyle}
            onDoubleClick={handleCropComplete}
          >
            <Cropper
              ref={cropperRef}
              src={cropPreviewUrl.current || imageSrc}
              className={cn('h-full w-full min-h-0 min-w-0', recordSource && 'record-image-surface')}
              defaultSize={getInitialCropSize}
              defaultVisibleArea={getInitialVisibleArea}
              priority={Priority.visibleArea}
              stencilProps={{
                movable: true,
                resizable: true,
                lines: true,
                handlers: true,
              }}
              onReady={() => setCropReady(true)}
              onChange={() => {
                if (recordSource || operationRef.current) return
                keepCurrentPreviewTab()
                setHasChanges(true)
              }}
            />
          </div>
        ) : recordSource && (annotationTool !== null || annotations.length > 0) ? (
          <ImageAnnotationCanvas
            src={imageSrc}
            width={imageWidth}
            height={imageHeight}
            displayWidth={imageWidth * fittedScale}
            displayHeight={imageHeight * fittedScale}
            tool={annotationTool}
            annotations={annotations}
            onAnnotation={handleAnnotation}
            onDrawingChange={handleDrawingChange}
            disabled={!isActive || busy}
            label={t('preview')}
          />
        ) : (
          <NextImage
            src={imageSrc}
            alt={t('preview')}
            width={imageWidth}
            height={imageHeight}
            className={cn('transition-transform duration-120 ease-out motion-reduce:transition-none', recordSource && 'record-image-surface h-auto w-auto')}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `scale(${previewScale})`,
            }}
            unoptimized
          />
        )}
        {props.stageOverlay}
      </div>

      {!recordSource && imageReady && !loading && (
        <MainStatusBarPortal active={isActive}>
          <ImageFooter
            filePath={filePath}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            embedded
          />
        </MainStatusBarPortal>
      )}
    </div>
  )
}
