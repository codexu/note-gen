'use client'

import { useEffect, useState, useRef } from 'react'
import { Cropper, CropperRef } from 'react-advanced-cropper'
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

export function ImageEditor({ filePath }: ImageEditorProps) {
  const cropperRef = useRef<CropperRef>(null)
  const [imageSrc, setImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalImageData, setOriginalImageData] = useState<Uint8Array | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [imageWidth, setImageWidth] = useState<number>(0)
  const [imageHeight, setImageHeight] = useState<number>(0)
  const { loadFileTree } = useArticleStore()

  useEffect(() => {
    loadImage()
  }, [filePath])

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
    if (cropperRef.current) {
      cropperRef.current.zoomImage(1.2)
    }
  }

  const handleZoomOut = () => {
    if (cropperRef.current) {
      cropperRef.current.zoomImage(0.8)
    }
  }

  const handleReset = () => {
    if (originalImageData) {
      const blob = new Blob([originalImageData as unknown as BlobPart])
      const url = URL.createObjectURL(blob)
      setImageSrc(url)
      setHasChanges(false)
      setCropMode(false)
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
    } catch (error) {
      console.error('Failed to crop image:', error)
    }
  }

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
    <div className="flex-1 flex flex-col h-full bg-background">
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
      <div className="flex-1 overflow-auto relative bg-background flex items-center justify-center">
        {cropMode ? (
          <div 
            className="w-full h-full"
            onDoubleClick={handleCropComplete}
          >
            <Cropper
              ref={cropperRef}
              src={imageSrc}
              className="h-full w-full"
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
              imageRendering: 'auto'
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
