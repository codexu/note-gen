'use client'

import { useEffect, useState, useRef } from 'react'
import { Cropper, CropperRef, Priority } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { Button } from '@/components/ui/button'
import { 
  RotateCw, 
  FlipHorizontal, 
  FlipVertical, 
  ZoomIn, 
  ZoomOut,
  Crop,
  Save,
  Undo
} from 'lucide-react'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { ImageFooter } from './image-footer'
import { TooltipButton } from '@/components/tooltip-button'
import NextImage from 'next/image'

interface ImageEditorProps {
  filePath: string
}

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

export function ImageEditor({ filePath }: ImageEditorProps) {
  const cropperRef = useRef<CropperRef>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const cropperContainerRef = useRef<HTMLDivElement>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalImageData, setOriginalImageData] = useState<Uint8Array | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [imageWidth, setImageWidth] = useState<number>(0)
  const [imageHeight, setImageHeight] = useState<number>(0)
  const [previewScale, setPreviewScale] = useState(1)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const { loadFileTree } = useArticleStore()

  const MIN_PREVIEW_SCALE = 0.25
  const MAX_PREVIEW_SCALE = 4
  const PREVIEW_SCALE_STEP = 0.25

  useEffect(() => {
    loadImage()
  }, [filePath])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || loading || !imageSrc) return

    const updateViewportSize = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateViewportSize()
    const observer = new ResizeObserver(updateViewportSize)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [loading, imageSrc])

  async function loadImage() {
    if (!filePath) return
    
    try {
      setLoading(true)
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)
      
      let imageData: Uint8Array
      if (workspace.isCustom) {
        imageData = await readFile(pathOptions.path)
      } else {
        imageData = await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
      
      setOriginalImageData(imageData)
      
      const blob = new Blob([imageData as unknown as BlobPart])
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(false)
      setPreviewScale(1)
      
      // 加载图片尺寸
      const img = new Image()
      img.onload = () => {
        setImageWidth(img.naturalWidth)
        setImageHeight(img.naturalHeight)
      }
      img.src = url
    } catch (error) {
      console.error('Failed to load image:', error)
      toast({
        title: '加载图片失败',
        description: String(error),
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const applyImageTransform = async (transformFn: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: HTMLImageElement) => void) => {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = imageSrc
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      transformFn(canvas, ctx, img)

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
        }, 'image/png')
      })

      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(true)
      setPreviewScale(1)
      
      // 更新图片尺寸
      setImageWidth(canvas.width)
      setImageHeight(canvas.height)
    } catch (error) {
      console.error('Failed to transform image:', error)
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
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(1.2)
      return
    }

    setPreviewScale((scale) => Math.min(MAX_PREVIEW_SCALE, Number((scale + PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleZoomOut = () => {
    if (cropMode && cropperRef.current) {
      cropperRef.current.zoomImage(0.8)
      return
    }

    setPreviewScale((scale) => Math.max(MIN_PREVIEW_SCALE, Number((scale - PREVIEW_SCALE_STEP).toFixed(2))))
  }

  const handleReset = () => {
    if (originalImageData) {
      const blob = new Blob([originalImageData as unknown as BlobPart])
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(false)
      setCropMode(false)
      setPreviewScale(1)
    }
  }

  const handleSave = async () => {
    try {
      let blob: Blob

      if (cropperRef.current) {
        // 如果在裁切模式，从 Cropper 获取图片
        const canvas = cropperRef.current.getCanvas()
        if (!canvas) return

        blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => {
            if (b) resolve(b)
          }, 'image/png')
        })
      } else {
        // 非裁切模式，直接从 imageSrc 获取图片数据
        const response = await fetch(imageSrc)
        blob = await response.blob()
      }

      const arrayBuffer = await blob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)

      if (workspace.isCustom) {
        await writeFile(pathOptions.path, uint8Array)
      } else {
        await writeFile(pathOptions.path, uint8Array, { baseDir: pathOptions.baseDir })
      }

      setOriginalImageData(uint8Array)
      setHasChanges(false)
      setCropMode(false)
      
      await loadFileTree()

      toast({
        title: '保存成功',
        description: '图片已保存'
      })
    } catch (error) {
      console.error('Failed to save image:', error)
      toast({
        title: '保存失败',
        description: String(error),
        variant: 'destructive'
      })
    }
  }

  const handleCropComplete = async () => {
    if (!cropMode || !cropperRef.current) return
    
    try {
      // 获取裁切后的图片
      const canvas = cropperRef.current.getCanvas()
      if (!canvas) return

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
        }, 'image/png')
      })

      // 更新图片显示
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      
      // 更新图片尺寸
      const img = new Image()
      img.onload = () => {
        setImageWidth(img.naturalWidth)
        setImageHeight(img.naturalHeight)
      }
      img.src = url
      
      setHasChanges(true)
      setCropMode(false)
      setPreviewScale(1)
    } catch (error) {
      console.error('Failed to crop image:', error)
    }
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!imageSrc) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <p className="text-muted-foreground">无法加载图片</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Toolbar */}
      <div className="h-12 flex items-center gap-2 px-2 border-b bg-background">
        <Toggle
          pressed={cropMode}
          onPressedChange={setCropMode}
          aria-label="裁切模式"
          size="sm"
        >
          <Crop className="h-4 w-4" />
        </Toggle>
        
        <Separator orientation="vertical" className="h-6" />
        
        <TooltipButton
          icon={<RotateCw className="h-4 w-4" />}
          tooltipText="旋转"
          onClick={handleRotate}
          size="sm"
          side="bottom"
        />
        
        <TooltipButton
          icon={<FlipHorizontal className="h-4 w-4" />}
          tooltipText="水平翻转"
          onClick={handleFlipHorizontal}
          size="sm"
          side="bottom"
        />
        
        <TooltipButton
          icon={<FlipVertical className="h-4 w-4" />}
          tooltipText="垂直翻转"
          onClick={handleFlipVertical}
          size="sm"
          side="bottom"
        />
        
        <div className="flex-1" />
        
        <TooltipButton
          icon={<ZoomIn className="h-4 w-4" />}
          tooltipText="放大"
          onClick={handleZoomIn}
          size="sm"
          side="bottom"
        />
        
        <TooltipButton
          icon={<ZoomOut className="h-4 w-4" />}
          tooltipText="缩小"
          onClick={handleZoomOut}
          size="sm"
          side="bottom"
        />
        
        {hasChanges && (
          <>
            <Separator orientation="vertical" className="h-6" />
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
            >
              <Undo className="h-4 w-4 mr-1" />
              重置
            </Button>
            
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
            >
              <Save className="h-4 w-4 mr-1" />
              保存
            </Button>
          </>
        )}
      </div>

      {/* Image Display / Cropper */}
      <div ref={viewportRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-4">
        {cropMode ? (
          <div 
            ref={cropperContainerRef}
            className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden"
            style={cropperViewportStyle}
            onDoubleClick={handleCropComplete}
          >
            <Cropper
              ref={cropperRef}
              src={imageSrc}
              className="h-full w-full min-h-0 min-w-0"
              defaultSize={getInitialCropSize}
              defaultVisibleArea={getInitialVisibleArea}
              priority={Priority.visibleArea}
              stencilProps={{
                movable: true,
                resizable: true,
                lines: true,
                handlers: true,
              }}
              onChange={() => {
                setHasChanges(true)
              }}
            />
          </div>
        ) : (
            <NextImage 
              src={imageSrc} 
              alt="Preview"
              width={imageWidth}
              height={imageHeight}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                imageRendering: 'auto',
                transform: `scale(${previewScale})`,
                transformOrigin: 'center center',
                transition: 'transform 120ms ease-out'
              }}
              unoptimized
            />
          )}
      </div>

      {/* Footer */}
      <ImageFooter 
        filePath={filePath} 
        imageWidth={imageWidth} 
        imageHeight={imageHeight} 
      />
    </div>
  )
}
