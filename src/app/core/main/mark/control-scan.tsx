'use client'
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'
import { invoke } from "@tauri-apps/api/core"
import { Check, ScanText } from "lucide-react"
import { convertFileSrc } from "@tauri-apps/api/core"
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useEffect, useState, useCallback } from "react"
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
import { BaseDirectory, exists, remove, writeFile } from "@tauri-apps/plugin-fs"
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import './crop.css'
import Image from 'next/image'
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { v4 as uuid } from "uuid"
import useSettingStore from "@/stores/setting"
import ocr from "@/lib/ocr"
import { fetchAiDesc, fetchAiDescByImage } from "@/lib/ai/description"
import { insertMark } from "@/db/marks"
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { Button } from "@/components/ui/button"

export function ControlScan() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false)
  const [selectedImageSrc, setSelectedImageSrc] = useState('')
  const [files, setFiles] = useState<ScreenshotImage[]>([])
  const cropperRef = useRef<Cropper | null>(null);
  const cropBoxRef = useRef<Element | null>(null)
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, removeQueue, setQueue } = useMarkStore()
  const { primaryModel, primaryImageMethod, enableImageRecognition } = useSettingStore()

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
      autoCropArea: 1,
      toggleDragModeOnDblclick: false
    });
    window.setTimeout(() => {
      const cropBox = document.querySelector('.cropper-crop-box')
      if (!cropBox) return
      cropBox.addEventListener('dblclick', cropEnd)
      cropBoxRef.current = cropBox
    }, 100)
  }

  async function createScreenShot() {
    const fileNames = await invoke<ScreenshotImage[]>('screenshot')
    const convertedFiles = fileNames.map((fileName: ScreenshotImage) => {
      return {
        ...fileName,
        path: convertFileSrc(fileName.path),
      }
    })
    setFiles(convertedFiles)
    if (convertedFiles.length > 0) {
      setSelectedImageSrc(convertedFiles[0].path)
    } else {
      setSelectedImageSrc('')
    }
  }

  function selectImage(file: ScreenshotImage) {
    setSelectedImageSrc(file.path)
  }

  const cropEnd = useCallback(async () => {
    setOpen(false)
    const queueId = uuid()
    if (!cropperRef.current) return
    const canvas = cropperRef.current.getCroppedCanvas();
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const arrayBuffer = await blob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      await writeFile(`screenshot/${queueId}.png`, uint8Array, {
        baseDir: BaseDirectory.AppData
      })
      
      // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
      handleRecordComplete(router)
      
      let content = ''
      let desc = ''
      
      // Skip image recognition if disabled
      if (!enableImageRecognition) {
        addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.save'), type: 'scan', startTime: Date.now() })
        content = ''
        desc = ''
      } else if (primaryImageMethod === 'vlm') {
        addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.aiAnalysis'), type: 'scan', startTime: Date.now() })
        const base64 = `data:image/png;base64,${Buffer.from(uint8Array).toString('base64')}`
        content = await fetchAiDescByImage(base64) || 'VLM Error'
        desc = content
      } else {
        addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.ocr'), type: 'scan', startTime: Date.now() })
        content = await ocr(`screenshot/${queueId}.png`) || 'OCR Error'
        if (primaryModel) {
          setQueue(queueId, { progress: t('record.mark.progress.aiAnalysis') });
          desc = await fetchAiDesc(content).then(res => res ? res : content) || content
        } else {
          desc = content
        }
      }
      setQueue(queueId, { progress: t('record.mark.progress.save') });
      await insertMark({ tagId: currentTagId, type: 'scan', content, url: `${queueId}.png`, desc })
      removeQueue(queueId)
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
    })
  }, [
    addQueue,
    currentTagId,
    enableImageRecognition,
    fetchMarks,
    fetchTags,
    getCurrentTag,
    primaryImageMethod,
    primaryModel,
    removeQueue,
    router,
    setQueue,
    t,
  ])

  useEffect(() => {
    if (!open) {
      cropperRef.current?.destroy()
      cropperRef.current = null
      cropBoxRef.current?.removeEventListener('dblclick', cropEnd)
      cropBoxRef.current = null
      setFiles((currentFiles) => (currentFiles.length > 0 ? [] : currentFiles))
      setSelectedImageSrc((currentSrc) => (currentSrc ? '' : currentSrc))
      void cleanupTempScreenshots()
    }
  }, [cleanupTempScreenshots, cropEnd, open])

  const handleScan = useCallback(() => {
    createScreenShot()
    setOpen(true)
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-scan', handleScan)
    return () => {
      emitter.off('toolbar-shortcut-scan', handleScan)
    }
  }, [handleScan])

  const handleCropperImageLoad = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (open) {
        initCropper()
      }
    })
  }, [open])

  return (
    <div className="hidden md:block">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <TooltipButton icon={<ScanText />} tooltipText={t('record.mark.type.screenshot')} onClick={createScreenShot} />
        </DialogTrigger>
        <DialogContent className="left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 border-none bg-black p-4 pt-14 text-white sm:rounded-none">
          <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/80 p-2">
              {selectedImageSrc ? (
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
              ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-end">
              <Button
                type="button"
                variant="secondary"
                className="bg-white/10 text-white hover:bg-white/20"
                onClick={cropEnd}
                disabled={!selectedImageSrc}
              >
                <Check className="h-4 w-4" />
                {t('common.confirm')}
              </Button>
            </div>
            <Carousel
              opts={{
                align: "start",
              }}
              orientation="horizontal"
              className="h-24 w-full shrink-0"
            >
              <CarouselContent>
                {files.map((file, index) => (
                  <CarouselItem key={index} className="pt-1 md:basis-1/5">
                    <Card
                      className={`size-24 cursor-pointer overflow-hidden border-2 border-black ${selectedImageSrc === file.path ? 'border-white' : ''}`}
                      onClick={() => selectImage(file)}
                    >
                      <CardContent className="relative flex size-full flex-col items-center justify-center overflow-hidden p-0">
                        <Image className="size-full object-cover" src={file.path} alt="" width={200} height={200} />
                        <p className="absolute bottom-0 left-0 right-0 line-clamp-1 bg-black bg-opacity-50 text-center text-xs text-white">{file.name}</p>
                      </CardContent>
                    </Card>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="border-white bg-black text-white" />
              <CarouselNext className="border-white bg-black text-white" />
            </Carousel>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
