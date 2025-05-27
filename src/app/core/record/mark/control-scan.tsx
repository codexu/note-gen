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
 
export function ControlScan() {
  const t = useTranslations();
  const [path, setPath] = useState<string | null>(null)
  const [paths, setPaths] = useState<string[]>([])
  async function createScreenShot() {
    const fileNames = await invoke<string[]>('screenshot')
    console.log(fileNames)
    const paths = fileNames.map((fileName: string) => convertFileSrc(fileName))
    console.log(paths)
    setPaths(paths)
    setPath(paths[0])
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <TooltipButton icon={<ScanText />} tooltipText={t('record.mark.type.screenshot')} onClick={createScreenShot} />
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-40px)] h-[calc(100vh-40px)] flex flex-col items-center justify-center overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {path && (
            <Image className="h-full w-full object-contain" src={path} alt="" width={200} height={200} />
          )}
        </div>
        <Carousel
          opts={{
            align: "start",
          }}
          orientation="horizontal"
          className="w-full max-w-xl h-24"
        >
          <CarouselContent>
            {paths.map((path, index) => (
              <CarouselItem key={index} className="pt-1 md:basis-1/5">
                <Card className="size-24 overflow-hidden cursor-pointer" onClick={() => setPath(path)}>
                  <CardContent className="flex items-center justify-center p-0 overflow-hidden">
                    <Image className="size-24 object-cover" src={path} alt="" width={200} height={200} />
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