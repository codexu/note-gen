'use client'

import { Mark, delMark, updateMark } from "@/db/marks"
import { useState, useEffect } from "react"
import { cn, convertImage } from "@/lib/utils"
import { PhotoProvider, PhotoView } from "react-photo-view"
import { LocalImage } from "@/components/local-image"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { appDataDir } from "@tauri-apps/api/path"
import { open } from "@tauri-apps/plugin-shell"
import { toast } from "@/hooks/use-toast"
import { fetchAiDesc } from "@/lib/ai"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import Image from "next/image"

interface ImageGalleryProps {
  marks: Mark[]
}

// 单个图片项组件
function ImageItem({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const { fetchMarks } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const [photoSrc, setPhotoSrc] = useState('')
  const imagePath = mark.type === 'scan' 
    ? `/screenshot/${mark.url}`
    : `/image/${mark.url}`

  useEffect(() => {
    async function loadImage() {
      if (mark.url.includes('http')) {
        setPhotoSrc(mark.url)
      } else {
        const converted = await convertImage(imagePath)
        setPhotoSrc(converted)
      }
    }
    loadImage()
  }, [mark.url, imagePath])

  async function handleDelMark(e?: React.MouseEvent) {
    e?.stopPropagation()
    await delMark(mark.id)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function handleTransfer(tagId: number, e?: React.MouseEvent) {
    e?.stopPropagation()
    await updateMark({ ...mark, tagId })
    await fetchTags()
    getCurrentTag()
    fetchMarks()
  }

  async function regenerateDesc(e?: React.MouseEvent) {
    e?.stopPropagation()
    const desc = await fetchAiDesc(mark.content || '') || ''
    await updateMark({ ...mark, desc })
    fetchMarks()
  }

  async function handelShowInFolder(e?: React.MouseEvent) {
    e?.stopPropagation()
    const appDir = await appDataDir()
    const path = mark.type === 'scan' ? 'screenshot' : 'image'
    open(`${appDir}/${path}`)
  }

  async function handelShowInFile(e?: React.MouseEvent) {
    e?.stopPropagation()
    const appDir = await appDataDir()
    const path = mark.type === 'scan' ? 'screenshot' : 'image'
    let filename = mark.url
    if (mark.url.includes('http')) {
      filename = mark.url.split('/').pop() || '';
    }
    open(`${appDir}/${path}/${filename}`)
  }

  async function handleCopyLink(e?: React.MouseEvent) {
    e?.stopPropagation()
    await navigator.clipboard.writeText(mark.url)
    toast({
      title: t('record.mark.toolbar.copied')
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <PhotoProvider>
          <PhotoView src={photoSrc}>
            <div className="aspect-square overflow-hidden rounded cursor-pointer bg-zinc-900">
              {mark.url.includes('http') ? (
                <Image
                  src={mark.url}
                  alt=""
                  width={0}
                  height={0}

                  className="w-full h-full object-cover"
                />
              ) : (
                <LocalImage
                  src={imagePath}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          </PhotoView>
        </PhotoProvider>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger inset>
            {t('record.mark.toolbar.moveTag')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {tags.map((tag) => (
              <ContextMenuItem 
                disabled={tag.id === currentTagId} 
                key={tag.id} 
                onClick={() => handleTransfer(tag.id)}
              >
                {tag.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem inset disabled={true}>
          {t('record.mark.toolbar.convertTo', { type: mark.type === 'scan' ? t('record.mark.type.image') : t('record.mark.type.screenshot') })}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={!mark.url} onClick={handleCopyLink}>
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset onClick={regenerateDesc}>
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset onClick={handelShowInFolder}>
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset onClick={handelShowInFile}>
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        <ContextMenuItem inset onClick={handleDelMark}>
          <span className="text-red-900">
            {t('record.mark.toolbar.delete')}
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ImageGallery({ marks }: ImageGalleryProps) {
  const t = useTranslations()
  const [isExpanded, setIsExpanded] = useState(false)

  // 筛选出没有内容的图片记录（包括 scan 和 image 类型）
  const emptyImageMarks = marks.filter(mark => 
    (mark.type === 'image' || mark.type === 'scan') && 
    (!mark.content || mark.content.trim() === '')
  )

  // 如果没有无内容的图片，不显示组件
  if (emptyImageMarks.length === 0) {
    return null
  }

  return (
    <div>
      <div 
        className="flex items-center justify-between px-2 py-2 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <span className="text-xs font-medium">
              图片组
            </span>
            <span className="text-xs opacity-70">
              {emptyImageMarks.length}
            </span>
          </div>
        </div>
        <div className="text-muted-foreground group-hover:text-foreground transition-colors">
          {isExpanded ? (
            <span className="text-xs">{t('record.mark.imageGallery.collapse')}</span>
          ) : (
            <span className="text-xs">{t('record.mark.imageGallery.expand')}</span>
          )}
        </div>
      </div>

      {/* 图片展示区域 */}
      <div className={cn(
        "px-2 pb-2",
        !isExpanded && "max-h-[72px] overflow-hidden"
      )}>
        <div 
          className={cn(
            "grid gap-2",
            !isExpanded && "grid-rows-1"
          )}
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(56px, 1fr))`
          }}
        >
          {emptyImageMarks.map((mark) => (
            <ImageItem key={mark.id} mark={mark} />
          ))}
        </div>
      </div>
    </div>
  )
}
