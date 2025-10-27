"use client"
import {TooltipButton} from "@/components/tooltip-button"
import {TooltipProvider} from "@/components/ui/tooltip"
import {RefreshCcw} from "lucide-react"
import * as React from "react"
import useImageStore from "@/stores/imageHosting"
import {Separator} from "@/components/ui/separator"
import {convertBytesToSize} from "@/lib/utils"
import {open} from '@tauri-apps/plugin-shell';
import { RepoNames } from '@/lib/sync/github.types'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from "react"
import { Store } from '@tauri-apps/plugin-store'

export function ImageHeader() {
  const t = useTranslations('image')
  const {getImages, images, path, setPath} = useImageStore()
  const [githubImageUsername, setGithubImageUsername] = useState('')
  const checkSetting = useMemo(() => githubImageUsername && githubImageUsername.length > 0, [githubImageUsername])

  async function init() {
    const store = await Store.load('store.json');
    const githubImageUsername = await store.get<string>('githubImageUsername')
    if (githubImageUsername) {
      setGithubImageUsername(githubImageUsername)
    }
  }

  function handleOpenBroswer(path: string) {
    let url = ''
    if (path === '') {
      url = `https://github.com/${githubImageUsername}/${RepoNames.image}`
    } else {
      url = `https://github.com/${githubImageUsername}/${RepoNames.image}/tree/main/${path}`
    }
    open(url)
  }

  function backHandler() {
    setPath('')
    getImages()
  }

  useEffect(() => {
    init()
  }, [])

  return (
    checkSetting ? (
      <header className="h-12 flex items-center justify-between gap-2 border-b px-4 bg-primary-foreground">
        <div className="flex items-center h-6 gap-1">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="cursor-pointer">
                <BreadcrumbLink onClick={backHandler}>Github {t('root')}</BreadcrumbLink>
              </BreadcrumbItem>
              {
                path && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="cursor-pointer" onClick={() => handleOpenBroswer(path)}>
                      <BreadcrumbLink>{path}</BreadcrumbLink>
                    </BreadcrumbItem>
                  </>
                )
              }
            </BreadcrumbList>
          </Breadcrumb>
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
