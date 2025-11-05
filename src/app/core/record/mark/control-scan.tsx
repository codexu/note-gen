'use client'
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl'
import { invoke } from "@tauri-apps/api/core"
import { ScanText } from "lucide-react"
import { convertFileSrc } from "@tauri-apps/api/core"
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useEffect, useState } from "react"
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
import { BaseDirectory, writeFile } from "@tauri-apps/plugin-fs"
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import Image from 'next/image'
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { v4 as uuid } from "uuid"
import useSettingStore from "@/stores/setting"
import ocr from "@/lib/ocr"
import { fetchAiDesc, fetchAiDescByImage } from "@/lib/ai"
import { insertMark } from "@/db/marks"

export function ControlScan() {
  const t = useTranslations();
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState<HTMLImageElement>();
  const [files, setFiles] = useState<ScreenshotImage[]>([])
  const cropperRef = useRef<Cropper | null>(null);
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, removeQueue, setQueue } = useMarkStore()
  const { primaryModel, primaryImageMethod, enableImageRecognition } = useSettingStore()

  function initCropper() {
    if (cropperRef.current) {
      cropperRef.current.destroy()
    }
    const image = document.getElementById('cropper') as HTMLImageElement;
    if (!image) return
    // 绑定双击事件
    cropperRef.current = new Cropper(image, {
      background: false,
      viewMode: 1,
      toggleDragModeOnDblclick: false
    });
    setTimeout(() => {
      document.querySelector('.cropper-crop-box')?.addEventListener('dblclick', () => {
        cropEnd()
      })
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
      const image = new window.Image();
      image.src = convertedFiles[0].path;
      setImage(image)
    }
  }

  function selectImage(file: ScreenshotImage) {
    const image = new window.Image();
    image.src = file.path;
    setImage(image)
  }

  async function cropEnd() {
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
  };

  useEffect(() => {
    if (open) {
      initCropper()
    }
  }, [image, open])

  return (
    <div className="hidden md:block">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <TooltipButton icon={<ScanText />} tooltipText={t('record.mark.type.screenshot')} onClick={createScreenShot} />
        </DialogTrigger>
        <DialogContent className="max-w-screen h-screen text-white bg-black border-none flex flex-col items-center justify-center overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {
              image && (
                <Image id="cropper" className="size-full object-contain" width={0} height={0} src={image.src} alt="" />
              )
            }
          </div>
          <Carousel
            opts={{
              align: "start",
            }}
            orientation="horizontal"
            className="w-full max-w-xl h-24"
          >
            <CarouselContent>
              {files.map((file, index) => (
                <CarouselItem key={index} className="pt-1 md:basis-1/5">
                  <Card
                    className={`size-24 overflow-hidden cursor-pointer border-2 border-black ${image?.src === file.path ? 'border-white' : ''}`}
                    onClick={() => selectImage(file)}
                  >
                    <CardContent className="flex relative items-center justify-center p-0 overflow-hidden size-full flex-col">
                      <Image className="size-full object-cover" src={file.path} alt="" width={200} height={200} />
                      <p className="text-xs text-white line-clamp-1 text-center absolute bottom-0 left-0 right-0 bg-black bg-opacity-50">{file.name}</p>
                    </CardContent>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="text-white bg-black border-white" />
            <CarouselNext className="text-white bg-black border-white" />
          </Carousel>
        </DialogContent>
      </Dialog>
    </div>
  )
}
