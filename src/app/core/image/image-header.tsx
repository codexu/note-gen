"use client"
import {TooltipButton} from "@/components/tooltip-button"
import {TooltipProvider} from "@/components/ui/tooltip"
import {Link, RefreshCcw} from "lucide-react"
import * as React from "react"
import useImageStore from "@/stores/image"
import {Separator} from "@/components/ui/separator"
import {convertBytesToSize} from "@/lib/utils"
import {open} from '@tauri-apps/plugin-shell';
import useSettingStore from "@/stores/setting"


export function ImageHeader() {
  const {getImages, images} = useImageStore()
  const {githubUsername} = useSettingStore()
  const checkSetting = githubUsername && githubUsername.length > 0
  const handleOpenBroswer = () => {
    const url = `https://github.com/${githubUsername}/note-gen-image-sync`
    open(url)
  }

  return (
    checkSetting ? (
      <header className="h-12 flex items-center justify-between gap-2 border-b px-4 bg-primary-foreground">
        <div className="flex items-center h-6 gap-1">
          <TooltipButton icon={<Link/>} tooltipText="打开仓库" onClick={handleOpenBroswer}/>
        </div>
        <div className="flex items-center h-6 gap-1">
          <TooltipProvider>
            <div className="flex items-center h-6 gap-1">
              <span className="text-sm px-2">{images.length} 个文件</span>
              <Separator orientation="vertical"/>
              <span
                className="text-sm px-2">总大小：{convertBytesToSize(images.reduce((total, image) => total + image.size, 0))}</span>
              <Separator orientation="vertical"/>
            </div>
            <TooltipButton icon={<RefreshCcw/>} tooltipText="刷新" onClick={getImages}/>
          </TooltipProvider>
        </div>
      </header>
    ) : <></>
  )
}
