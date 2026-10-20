'use client'

import { Mark, delMark, deleteMarks, updateMark } from "@/db/marks"
import { useEffect, useMemo, useState } from "react"
import { cn, convertImage, isHttpUrl } from "@/lib/utils"
import { PhotoView } from "react-photo-view"
import { LocalImage } from "@/components/local-image"
import { useTranslations } from "next-intl"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { appDataDir } from "@tauri-apps/api/path"
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener"
import { toast } from "@/hooks/use-toast"
import { fetchAiDesc } from "@/lib/ai/description"
import { Checkbox } from "@/components/ui/checkbox"
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
import { getMarkOpenAction } from "./mark-open-path"

interface ImageGalleryProps {
  marks: Mark[]
}

const COLLAPSED_IMAGE_LIMIT = 8

// 单个图片项组件
function ImageItem({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const {
    marks,
    fetchMarks,
    isMultiSelectMode,
    selectedMarkIds,
    toggleMarkSelection,
    clearSelection,
  } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const isRemoteImage = isHttpUrl(mark.url)
  const [photoSrc, setPhotoSrc] = useState(isRemoteImage ? mark.url : '')
  const isSelected = selectedMarkIds.has(mark.id)
  const isBatchOperation = isMultiSelectMode && selectedMarkIds.size > 0
  const filteredTags = tags.filter(tag => tag.id !== currentTagId)
  const imagePath = mark.type === 'scan' 
    ? `/screenshot/${mark.url}`
    : `/image/${mark.url}`

  useEffect(() => {
    let cancelled = false

    async function resolvePreviewSrc() {
      const nextPhotoSrc = isRemoteImage
        ? mark.url
        : await convertImage(imagePath)

      if (!cancelled) {
        setPhotoSrc(nextPhotoSrc)
      }
    }

    void resolvePreviewSrc()

    return () => {
      cancelled = true
    }
  }, [imagePath, isRemoteImage, mark.url])

  async function handleDelMark(e?: React.MouseEvent) {
    e?.stopPropagation()
    if (isBatchOperation) {
      const selectedMarks = Array.from(selectedMarkIds)
      await deleteMarks(selectedMarks)
      clearSelection()
    } else {
      await delMark(mark.id)
    }
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function handleTransfer(tagId: number, e?: React.MouseEvent) {
    e?.stopPropagation()
    if (isBatchOperation) {
      const selectedMarks = Array.from(selectedMarkIds)
      for (const markId of selectedMarks) {
        const existingMark = marks.find((item: Mark) => item.id === markId)
        if (existingMark) {
          await updateMark({ ...existingMark, tagId })
        }
      }
      clearSelection()
    } else {
      await updateMark({ ...mark, tagId })
    }
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
    const action = getMarkOpenAction(mark, appDir, 'folder')
    if (!action?.path) return

    if (action.mode === 'reveal') {
      await revealItemInDir(action.path)
      return
    }

    await openPath(action.path)
  }

  async function handelShowInFile(e?: React.MouseEvent) {
    e?.stopPropagation()
    const appDir = await appDataDir()
    const action = getMarkOpenAction(mark, appDir, 'file')
    if (!action?.path) return

    await openPath(action.path)
  }

  async function handleCopyLink(e?: React.MouseEvent) {
    e?.stopPropagation()
    await navigator.clipboard.writeText(mark.url)
    toast({
      title: t('record.mark.toolbar.copied')
    })
  }

  function handleToggleSelection(e?: { preventDefault: () => void; stopPropagation: () => void }) {
    e?.preventDefault()
    e?.stopPropagation()
    toggleMarkSelection(mark.id)
  }

  const imageContent = (
    <div
      className={cn(
        "relative aspect-square cursor-pointer overflow-hidden rounded bg-zinc-900",
        isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
    >
      {isMultiSelectMode ? (
        <div className="absolute left-1 top-1 z-10">
          <Checkbox
            checked={isSelected}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={() => toggleMarkSelection(mark.id)}
            className="bg-background/90 shadow-sm"
          />
        </div>
      ) : null}
      {isRemoteImage ? (
        <Image
          src={mark.url}
          alt=""
          width={0}
          height={0}
          loading="lazy"
          decoding="async"
          unoptimized
          onLoad={() => setPhotoSrc(mark.url)}
          className="h-full w-full object-cover"
        />
      ) : (
        <LocalImage
          src={imagePath}
          alt=""
          useThumbnail
          onResolvedSrc={setPhotoSrc}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        {isMultiSelectMode ? (
          <div
            role="button"
            tabIndex={0}
            className="block w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={handleToggleSelection}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleToggleSelection(e)
              }
            }}
          >
            {imageContent}
          </div>
        ) : (
          <PhotoView src={photoSrc}>
            {imageContent}
          </PhotoView>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger inset>
            {isBatchOperation
              ? t('record.mark.toolbar.moveSelectedTags', { count: selectedMarkIds.size })
              : t('record.mark.toolbar.moveTag')
            }
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {filteredTags.map((tag) => (
              <ContextMenuItem 
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
        <ContextMenuItem inset disabled={isMultiSelectMode || !mark.url} onClick={handleCopyLink}>
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode} onClick={regenerateDesc}>
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={isMultiSelectMode || !getMarkOpenAction(mark, '', 'folder')?.path} onClick={handelShowInFolder}>
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || !getMarkOpenAction(mark, '', 'file')?.path} onClick={handelShowInFile}>
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        <ContextMenuItem inset onClick={handleDelMark}>
          <span className="text-red-900">
            {isBatchOperation
              ? t('record.mark.toolbar.deleteSelected', { count: selectedMarkIds.size })
              : t('record.mark.toolbar.delete')
            }
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ImageGallery({ marks }: ImageGalleryProps) {
  const t = useTranslations()
  const [isExpanded, setIsExpanded] = useState(false)
  const { isMultiSelectMode, selectedMarkIds, setSelectedMarkIds } = useMarkStore()

  // 筛选出没有内容的图片记录（包括 scan 和 image 类型）
  const emptyImageMarks = useMemo(() => marks.filter(mark =>
    (mark.type === 'image' || mark.type === 'scan') && 
    Boolean(mark.url) &&
    (!mark.content || mark.content.trim() === '')
  ), [marks])
  const visibleImageMarks = isExpanded
    ? emptyImageMarks
    : emptyImageMarks.slice(0, COLLAPSED_IMAGE_LIMIT)
  const hiddenImageCount = emptyImageMarks.length - visibleImageMarks.length
  const selectedImageCount = emptyImageMarks.filter(mark => selectedMarkIds.has(mark.id)).length
  const isAllImagesSelected = emptyImageMarks.length > 0 && selectedImageCount === emptyImageMarks.length
  const imageGroupSelectionState = isAllImagesSelected
    ? true
    : selectedImageCount > 0
      ? 'indeterminate'
      : false

  function handleToggleImageGroupSelection() {
    const nextSelectedIds = new Set(selectedMarkIds)

    if (isAllImagesSelected) {
      emptyImageMarks.forEach(mark => nextSelectedIds.delete(mark.id))
    } else {
      emptyImageMarks.forEach(mark => nextSelectedIds.add(mark.id))
    }

    setSelectedMarkIds(nextSelectedIds)
  }

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
          {isMultiSelectMode ? (
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={imageGroupSelectionState}
                onCheckedChange={handleToggleImageGroupSelection}
              />
            </div>
          ) : null}
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <span className="text-xs font-medium">
              图片组
            </span>
            <span className="text-xs opacity-70">
              {isMultiSelectMode ? `${selectedImageCount}/${emptyImageMarks.length}` : emptyImageMarks.length}
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
          {visibleImageMarks.map((mark) => (
            <ImageItem key={mark.id} mark={mark} />
          ))}
          {hiddenImageCount > 0 ? (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="flex aspect-square items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              +{hiddenImageCount}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
