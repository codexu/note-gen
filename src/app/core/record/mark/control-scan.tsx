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
import { useState } from "react"
import Image from "next/image"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { Card, CardContent } from "@/components/ui/card"
import Cropper, { ReactCropperElement } from "react-cropper";
import { useRef } from "react";
import "cropperjs/dist/cropper.css";
import "./crop.scss"
import { ScreenshotImage } from "note-gen/screenshot"

export function ControlScan() {
  const t = useTranslations();
  const [image, setImage] = useState<string>();
  const [files, setFiles] = useState<ScreenshotImage[]>([])
  const cropperRef = useRef<ReactCropperElement>(null);
  async function createScreenShot() {
    const fileNames = await invoke<ScreenshotImage[]>('screenshot')
    console.log(fileNames);
    const convertedFiles = fileNames.map((fileName: ScreenshotImage) => {
      return {
        ...fileName,
        path: convertFileSrc(fileName.path),
      }
    })
    setFiles(convertedFiles)
    setImage(convertedFiles[0].path)
  }

  const onCrop = () => {
    const cropper = cropperRef.current?.cropper;
    console.log(cropper);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <TooltipButton icon={<ScanText />} tooltipText={t('record.mark.type.screenshot')} onClick={createScreenShot} />
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-40px)] h-[calc(100vh-40px)] bg-black border-none flex flex-col items-center justify-center overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {
            image && (
              <Cropper
                ref={cropperRef}
                src={image}
                className="w-full h-full"
                guides={true}
                crop={onCrop}
              />
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
                <Card className={`size-24 overflow-hidden cursor-pointer border-0 ${image === file.path ? 'border-2 border-white' : ''}`} onClick={() => setImage(file.path)}>
                  <CardContent className="flex items-center justify-center p-0 overflow-hidden">
                    <Image className="size-24 object-cover" src={file.path} alt="" width={1200} height={1200} />
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </DialogContent>
    </Dialog>
  )
}