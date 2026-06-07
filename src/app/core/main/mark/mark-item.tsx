'use client'
import React from "react"
import { delMark, deleteMarks, delMarkForever, Mark, restoreMark, updateMark } from "@/db/marks";
import { useTranslations } from 'next-intl';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent
} from "@/components/ui/enhanced-context-menu"
import dayjs from "dayjs";
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback, useMemo, useState } from "react";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { fetchAiDesc } from "@/lib/ai/description";
import { appDataDir } from "@tauri-apps/api/path";
import { CheckSquare, ImageUp, RefreshCw, Settings2, Square } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import { AudioPlayer } from "@/components/audio-player";
import { ImageViewer } from "@/components/image-viewer";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkMobileActions } from "./mark-mobile-actions";
import { markToMarkdown } from "@/lib/mark-to-markdown";
import useSettingStore from "@/stores/setting";
import { TodoItemContent } from "./todo-item-content";
import { useIsMobile } from "@/hooks/use-mobile";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { useRouter } from "next/navigation";
import { NO_TRANSCRIPTION_MESSAGE, transcribeRecording } from "@/lib/audio";
import { cn } from "@/lib/utils";
import { getMarkTypeListBadgeClasses } from "./mark-type-meta";
import { getMarkListItemContent } from "./mark-list-item-content";
import { TodoEditTrigger } from "./todo-edit-button";
import { canOpenMarkSource, getMarkOpenAction } from "./mark-open-path";
import { useSidebarStore } from "@/stores/sidebar";
import useArticleStore from "@/stores/article";
import { createRecordTab } from "./mark-record-tab";

dayjs.extend(relativeTime)

// Memoize line height mapping function
const getLineHeight = (textSize: string): string => {
  const heightMap: Record<string, string> = {
    'xs': 'leading-3',
    'sm': 'leading-4',
    'md': 'leading-5',
    'lg': 'leading-6',
    'xl': 'leading-7'
  }
  return heightMap[textSize] || 'leading-4'
}

const getLineHeightRem = (textSize: string): number => {
  const heightMap: Record<string, number> = {
    'xs': 0.75,
    'sm': 1,
    'md': 1.25,
    'lg': 1.5,
    'xl': 1.75
  }
  return heightMap[textSize] || 1
}

const compactRecordText = (value?: string): string => {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

const MarkDetailTrigger = React.memo(({
  mark,
  content,
  className,
  clampLines,
  interactive = true,
}: {
  mark: Mark
  content: string
  className?: string
  clampLines?: number
  interactive?: boolean
}) => {
  const t = useTranslations('record.mark.type')
  const {
    activeMarkId,
    isMultiSelectMode,
    setActiveMarkId,
  } = useMarkStore()
  const openTabs = useArticleStore((state) => state.openTabs)
  const addTab = useArticleStore((state) => state.addTab)
  const setActiveTabId = useArticleStore((state) => state.setActiveTabId)
  const setActiveFilePath = useArticleStore((state) => state.setActiveFilePath)
  const { centerPanelVisible, showCenterPanel } = useSidebarStore()
  const { recordTextSize } = useSettingStore()
  const lineHeight = useMemo(() => getLineHeight(recordTextSize), [recordTextSize])
  const lineHeightRem = useMemo(() => getLineHeightRem(recordTextSize), [recordTextSize])

  const fallbackClassName = `mt-2 max-w-full line-clamp-2 ${lineHeight} text-${recordTextSize} break-words [overflow-wrap:anywhere]`

  const openDetail = useCallback(async () => {
    if (isMultiSelectMode) {
      return
    }

    setActiveMarkId(mark.id)
    const recordTab = createRecordTab(mark, t(mark.type))
    const existingTab = openTabs.find(tab => tab.path === recordTab.path)
    if (existingTab) {
      await setActiveTabId(existingTab.id)
    } else {
      await addTab(recordTab)
    }
    await setActiveFilePath('')
    if (!centerPanelVisible) {
      await showCenterPanel()
    }
  }, [addTab, centerPanelVisible, isMultiSelectMode, mark, openTabs, setActiveFilePath, setActiveMarkId, setActiveTabId, showCenterPanel, t])

  const contentClassName = className || fallbackClassName
  const triggerClassName = "w-full min-w-0 max-w-full overflow-hidden text-left transition-colors hover:underline"
  const label = content || t(mark.type)
  const clampStyle: React.CSSProperties | undefined = clampLines
    ? {
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: clampLines,
      maxHeight: `${lineHeightRem * clampLines}rem`,
      overflow: 'hidden',
    }
    : undefined
  const clampContainerStyle: React.CSSProperties | undefined = clampLines
    ? {
      maxHeight: `${lineHeightRem * clampLines}rem`,
      overflow: 'hidden',
    }
    : undefined

  if (clampLines) {
    return (
      <div
        className={cn(
          "group relative w-full min-w-0 max-w-full overflow-hidden text-left",
          activeMarkId === mark.id && "text-primary"
        )}
        style={clampContainerStyle}
      >
        <span
          className={cn(
            "w-full min-w-0 max-w-full overflow-hidden transition-colors",
            interactive && "group-hover:underline",
            contentClassName
          )}
          style={clampStyle}
        >
          {label}
        </span>
        {interactive ? (
          <button
            type="button"
            aria-label={label}
            aria-pressed={activeMarkId === mark.id}
            onClick={openDetail}
            className="absolute inset-0 cursor-pointer"
          />
        ) : null}
      </div>
    )
  }

  if (!interactive) {
    return (
      <span
        className={cn("w-full min-w-0 max-w-full overflow-hidden", contentClassName)}
      >
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={activeMarkId === mark.id}
      onClick={openDetail}
      style={clampContainerStyle}
      className={cn(
        triggerClassName,
        activeMarkId === mark.id && "text-primary"
      )}
    >
      <span
        className={cn("w-full min-w-0 max-w-full overflow-hidden", contentClassName)}
      >
        {label}
      </span>
    </button>
  )
})
MarkDetailTrigger.displayName = 'MarkDetailTrigger'

export type MarkItemVariant = 'list' | 'compact' | 'cards'

export const MarkWrapper = React.memo(({mark, variant = 'list', interactive = true}: {mark: Mark, variant?: MarkItemVariant, interactive?: boolean}) => {
  const t = useTranslations('record.mark.type');
  const todoT = useTranslations('record.mark.todo');
  const recordingT = useTranslations('recording');
  const { isMultiSelectMode, selectedMarkIds, toggleMarkSelection } = useMarkStore();
  const { recordTextSize, sttModel } = useSettingStore();
  const { fetchMarks } = useMarkStore();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isRetryingTranscription, setIsRetryingTranscription] = useState(false);

  const lineHeight = useMemo(() => getLineHeight(recordTextSize), [recordTextSize])
  const lineHeightRem = useMemo(() => getLineHeightRem(recordTextSize), [recordTextSize])
  const shouldShowRecordingAction = mark.type === 'recording' && mark.content === NO_TRANSCRIPTION_MESSAGE
  const itemContent = useMemo(() => getMarkListItemContent(mark), [mark])
  const listTitleClassName = `block max-w-full truncate text-${recordTextSize} font-semibold ${interactive ? 'hover:underline' : ''}`
  const listPreviewClassName = `max-w-full ${lineHeight} text-${recordTextSize} text-muted-foreground break-words [overflow-wrap:anywhere]`
  const cardPreviewClampLines = 6
  const cardPreviewClampStyle: React.CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: cardPreviewClampLines,
    maxHeight: `${lineHeightRem * cardPreviewClampLines}rem`,
    overflow: 'hidden',
  }
  const cardPreviewClampContainerStyle: React.CSSProperties = {
    maxHeight: `${lineHeightRem * cardPreviewClampLines}rem`,
    overflow: 'hidden',
  }

  const todoPriorityDotClass = itemContent.todo
    ? itemContent.todo.priority === 'high'
      ? 'bg-red-500'
      : itemContent.todo.priority === 'low'
        ? 'bg-green-500'
        : 'bg-orange-500'
    : ''

  const handleCheckboxChange = useCallback(() => {
    toggleMarkSelection(mark.id);
  }, [mark.id, toggleMarkSelection]);

  const handleRecordingAction = useCallback(async () => {
    if (!sttModel) {
      router.push(isMobile ? '/mobile/setting/pages/audio' : '/core/setting/audio')
      return
    }

    if (!mark.url || isRetryingTranscription) {
      return
    }

    try {
      setIsRetryingTranscription(true)
      const fileData = await readFile(mark.url, { baseDir: BaseDirectory.AppData })
      const extension = mark.url.split('.').pop()?.toLowerCase()
      const mimeType = extension === 'wav' ? 'audio/wav' :
        extension === 'mp3' ? 'audio/mpeg' :
        extension === 'm4a' || extension === 'mp4' ? 'audio/mp4' :
        extension === 'ogg' ? 'audio/ogg' :
        extension === 'webm' ? 'audio/webm' :
        'audio/webm'
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: mimeType })
      const transcription = await transcribeRecording(audioBlob)

      if (!transcription.trim()) {
        toast({
          title: recordingT('error'),
          description: recordingT('transcriptionEmpty'),
          variant: 'destructive',
        })
        return
      }

      await updateMark({
        ...mark,
        desc: transcription.substring(0, 100),
        content: transcription,
      })
      await fetchMarks()

      toast({
        title: recordingT('success'),
        description: recordingT('retrySuccess'),
      })
    } catch (error) {
      console.error('重新识别录音失败:', error)
      toast({
        title: recordingT('error'),
        description: error instanceof Error ? error.message : recordingT('retryError'),
        variant: 'destructive',
      })
    } finally {
      setIsRetryingTranscription(false)
    }
  }, [fetchMarks, isMobile, isRetryingTranscription, mark, recordingT, router, sttModel])

  const renderListTextBlock = (title: string, preview?: string) => {
    const displayTitle = compactRecordText(title) || t(mark.type)
    const displayPreview = compactRecordText(preview)
    const shouldShowPreview = Boolean(displayPreview && displayPreview !== displayTitle)

    return (
      <div className="mt-2 w-full min-w-0 max-w-full space-y-1.5 overflow-hidden">
        <MarkDetailTrigger
          mark={mark}
          content={displayTitle}
          className={listTitleClassName}
          interactive={interactive}
        />
        {shouldShowPreview ? (
          <MarkDetailTrigger
            mark={mark}
            content={displayPreview}
            className={listPreviewClassName}
            clampLines={4}
            interactive={interactive}
          />
        ) : null}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden">
        {interactive && isMultiSelectMode && (
          <div className="shrink-0 pr-1">
            <Checkbox
              checked={selectedMarkIds.has(mark.id)}
              onCheckedChange={handleCheckboxChange}
            />
          </div>
        )}
        <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
          {t(mark.type)}
        </span>
        {mark.type === 'todo' && itemContent.todo ? (
          <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
        ) : null}
        <div className="w-full min-w-0 max-w-full flex-1 overflow-hidden">
          {mark.type === 'todo' ? interactive ? (
            <TodoEditTrigger mark={mark} className={`block max-w-full truncate text-${recordTextSize} font-medium hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <span className={`block max-w-full truncate text-${recordTextSize} font-medium`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </span>
          ) : (
            <MarkDetailTrigger
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              className={`block max-w-full truncate text-${recordTextSize} font-medium ${interactive ? 'hover:underline' : ''}`}
              interactive={interactive}
            />
          )}
        </div>
        {mark.type === 'recording' && mark.url ? (
          <AudioPlayer audioPath={mark.url} compact />
        ) : null}
        <span className="shrink-0 text-xs text-zinc-500">{dayjs(mark.createdAt).format('HH:mm')}</span>
      </div>
    )
  }

  if (variant === 'cards') {
    const isImageCard = mark.type === 'image' || mark.type === 'scan'

    return (
      <div className="w-full min-w-0 max-w-full space-y-2.5 overflow-hidden">
        <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500">
          {interactive && isMultiSelectMode && (
            <div className="shrink-0 pr-1">
              <Checkbox
                checked={selectedMarkIds.has(mark.id)}
                onCheckedChange={handleCheckboxChange}
              />
            </div>
          )}
          <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
            {t(mark.type)}
          </span>
          {mark.type === 'todo' && itemContent.todo ? (
            <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
          ) : null}
          <span className="ml-auto shrink-0 text-xs">{dayjs(mark.createdAt).format('MM-DD HH:mm')}</span>
        </div>
        {isImageCard && mark.url ? (
          <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md bg-zinc-100">
            <ImageViewer
              url={mark.url}
              path={mark.type === 'scan' ? 'screenshot' : 'image'}
              imageClassName="h-auto max-h-56 w-full object-cover"
              interactive={interactive}
            />
          </div>
        ) : null}
        <div className="w-full min-w-0 max-w-full space-y-1.5 overflow-hidden">
          {mark.type === 'todo' ? interactive ? (
            <TodoEditTrigger mark={mark} className={`block max-w-full truncate text-${recordTextSize} font-semibold hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <span className={`block max-w-full truncate text-${recordTextSize} font-semibold`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </span>
          ) : (
            <MarkDetailTrigger
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              className={`block max-w-full truncate text-${recordTextSize} font-semibold ${interactive ? 'hover:underline' : ''}`}
              interactive={interactive}
            />
          )}
          {!isImageCard && itemContent.preview ? mark.type === 'todo' ? (
            interactive ? (
              <div
                className="w-full min-w-0 max-w-full overflow-hidden"
                style={cardPreviewClampContainerStyle}
              >
                <TodoEditTrigger mark={mark} className={`block w-full max-w-full text-left text-${recordTextSize} ${lineHeight} text-muted-foreground hover:underline`}>
                  <span
                    className="block w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                    style={cardPreviewClampStyle}
                  >
                    {itemContent.preview}
                  </span>
                </TodoEditTrigger>
              </div>
            ) : (
              <p
                className={`max-w-full break-words text-${recordTextSize} ${lineHeight} text-muted-foreground [overflow-wrap:anywhere]`}
                style={cardPreviewClampStyle}
              >
                {itemContent.preview}
              </p>
            )
          ) : (
            <MarkDetailTrigger
              mark={mark}
              content={itemContent.preview}
              className={`max-w-full break-words text-${recordTextSize} ${lineHeight} text-muted-foreground [overflow-wrap:anywhere]`}
              clampLines={cardPreviewClampLines}
              interactive={interactive}
            />
          ) : null}
          {!isImageCard && mark.type === 'link' && mark.url ? interactive ? (
            <a
              href={mark.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block max-w-full truncate text-xs text-blue-600 hover:underline"
            >
              {mark.url}
            </a>
          ) : (
            <span className="block max-w-full truncate text-xs text-blue-600">
              {mark.url}
            </span>
          ) : null}
          {!isImageCard && mark.type === 'todo' && itemContent.todo ? (
            <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-zinc-500">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                {itemContent.todo.completed ? <CheckSquare className="size-3.5 text-green-600" /> : <Square className="size-3.5 text-zinc-400" />}
                <span className="min-w-0 truncate">{itemContent.todo.completed ? todoT('completed') : todoT('uncompleted')}</span>
              </div>
            </div>
          ) : null}
          {!isImageCard && mark.type === 'recording' && mark.url ? (
            <div className="w-full min-w-0 max-w-full overflow-hidden pt-1">
              <AudioPlayer audioPath={mark.url} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (mark.type) {
    case 'scan':
    return (
        <div className={`min-w-0 max-w-full flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500">
            <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
              {t(mark.type)}
            </span>
            <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          {renderListTextBlock(itemContent.title || mark.desc || t(mark.type), itemContent.preview)}
        </div>
    )
    case 'image':
    return (
        <div className={`min-w-0 max-w-full flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500">
            <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
              {t(mark.type)}
            </span>
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          {renderListTextBlock(itemContent.title || mark.desc || t(mark.type), itemContent.preview)}
        </div>
    )
    case 'link':
    return (
        <div className="min-w-0 max-w-full flex-1 overflow-hidden pr-10 md:pr-0">
          <div className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
            <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
              {t(mark.type)}
            </span>
            <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          {renderListTextBlock(itemContent.title || mark.desc || t(mark.type), mark.content || itemContent.preview)}
          <div className="mt-1 min-w-0 max-w-full overflow-hidden">
            {interactive ? (
              <a
                href={mark.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block max-w-full truncate text-${recordTextSize} text-blue-500 hover:underline`}
              >
                {mark.url}
              </a>
            ) : (
              <span className={`block max-w-full truncate text-${recordTextSize} text-blue-500`}>
                {mark.url}
              </span>
            )}
          </div>
        </div>
    )
    case 'text':
      return (
          <div className="min-w-0 max-w-full flex-1 overflow-hidden pr-10 md:pr-0">
            <div className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
                {t(mark.type)}
              </span>
              <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            {renderListTextBlock(itemContent.title || t(mark.type), itemContent.preview)}
          </div>
      )
    case 'recording':
      return (
          <div className="min-w-0 max-w-full flex-1 overflow-hidden pr-10 md:pr-0">
            <div className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
                {t(mark.type)}
              </span>
              {interactive && shouldShowRecordingAction && (
                <button
                  type="button"
                  className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleRecordingAction}
                  disabled={isRetryingTranscription}
                  title={sttModel
                    ? (isRetryingTranscription ? recordingT('retrying') : recordingT('retryTranscription'))
                    : recordingT('configureModel')}
                >
                  {sttModel ? (
                    <RefreshCw className={`size-3.5 ${isRetryingTranscription ? 'animate-spin' : ''}`} />
                  ) : (
                    <Settings2 className="size-3.5" />
                  )}
                </button>
              )}
              <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            {renderListTextBlock(itemContent.title || t(mark.type), itemContent.preview)}
            {mark.url && (
              <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden">
                <AudioPlayer audioPath={mark.url} />
              </div>
            )}
          </div>
      )
    case 'file':
      return (
          <div className="min-w-0 max-w-full flex-1 overflow-hidden pr-10 md:pr-0">
            <div className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
                {t(mark.type)}
              </span>
              <span className={`ml-auto shrink-0 text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            {renderListTextBlock(itemContent.title || t(mark.type), itemContent.preview || mark.desc)}
            {mark.url && (
              <div className="mt-1 min-w-0 max-w-full overflow-hidden">
                <span className={`block max-w-full break-words text-${recordTextSize} [overflow-wrap:anywhere]`}>
                  {mark.desc}
                </span>
              </div>
            )}
          </div>
      )
    case 'todo':
      return <TodoItemContent mark={mark} interactive={interactive} />
    default:
      return null
    }
  }

  return (
    <div className="flex w-full min-w-0 max-w-full items-start overflow-hidden p-2">
      {interactive && isMultiSelectMode && (
        <div className="flex shrink-0 items-start pr-2 pt-1">
          <Checkbox
            checked={selectedMarkIds.has(mark.id)}
            onCheckedChange={handleCheckboxChange}
          />
        </div>
      )}
      <div className="w-full min-w-0 max-w-full flex-1 overflow-hidden">
        {renderContent()}
      </div>
      {(mark.type === 'scan' || mark.type === 'image') && (
        <div className="ml-2 flex shrink-0 items-center justify-center overflow-hidden bg-zinc-900">
          <ImageViewer url={mark.url} path={mark.type === 'scan' ? 'screenshot' : 'image'} interactive={interactive} />
        </div>
      )}
    </div>
  )
})
MarkWrapper.displayName = 'MarkWrapper'

export const MarkItem = React.memo(({mark, variant = 'list', interactive = true}: {mark: Mark, variant?: MarkItemVariant, interactive?: boolean}) => {
  const t = useTranslations();
  const isMobile = useIsMobile()
  const {
    marks,
    fetchMarks,
    trashState,
    fetchAllTrashMarks,
    isMultiSelectMode,
    selectedMarkIds,
    clearSelection,
    highlightedMarkId,
    activeMarkId,
    clearActiveMark,
  } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()

  const shouldClearActiveMark = useCallback(() => {
    if (!activeMarkId) {
      return false
    }

    return activeMarkId === mark.id || (isMultiSelectMode && selectedMarkIds.has(activeMarkId))
  }, [activeMarkId, isMultiSelectMode, mark.id, selectedMarkIds])

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!interactive || isMultiSelectMode) {
      e.preventDefault()
      return
    }

    const markdownContent = markToMarkdown(mark);
    e.dataTransfer.setData('text/plain', markdownContent);
    e.dataTransfer.setData('application/json', JSON.stringify(mark));
    e.dataTransfer.effectAllowed = 'copy';

    // 添加拖拽时的视觉反馈
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [interactive, isMultiSelectMode, mark]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
  }, []);

  const handleDelMark = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      // 多选删除
      const selectedMarks = Array.from(selectedMarkIds)
      await deleteMarks(selectedMarks)
      clearSelection()
    } else {
      // 单个删除
      await delMark(mark.id)
    }
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
    if (shouldClearActiveMark()) {
      clearActiveMark()
    }
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, fetchMarks, fetchTags, getCurrentTag, mark.id, shouldClearActiveMark, clearActiveMark])

  const handleDelForever = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const accepted = await confirm(`${t('record.mark.toolbar.deleteForever')}?\n${t('record.trash.syncWarning')}`, {
      title: t('record.trash.title'),
      kind: 'warning',
    })
    if (!accepted) return

    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      // 多选永久删除
      const selectedMarks = Array.from(selectedMarkIds)
      for (const markId of selectedMarks) {
        await delMarkForever(markId)
      }
      clearSelection()
    } else {
      // 单个永久删除
      await delMarkForever(mark.id)
    }
    await fetchAllTrashMarks()
    if (shouldClearActiveMark()) {
      clearActiveMark()
    }
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, fetchAllTrashMarks, mark.id, shouldClearActiveMark, clearActiveMark, t])

  const handleRestore = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    await restoreMark(mark.id)
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
    if (activeMarkId === mark.id) {
      clearActiveMark()
    }
  }, [mark.id, trashState, fetchAllTrashMarks, fetchMarks, activeMarkId, clearActiveMark])

  const handleTransfer = useCallback(async (tagId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isMultiSelectMode && selectedMarkIds.size > 0) {
      // 多选转移 - 只处理选中的记录
      const selectedMarks = Array.from(selectedMarkIds)
      for (const markId of selectedMarks) {
        // 获取完整的mark对象并更新tagId
        const existingMark = marks.find((m: Mark) => m.id === markId)
        if (existingMark) {
          await updateMark({ ...existingMark, tagId })
        }
      }
      clearSelection()
    } else {
      // 单个转移
      await updateMark({ ...mark, tagId })
    }
    await fetchTags()
    getCurrentTag()
    fetchMarks()
    if (shouldClearActiveMark()) {
      clearActiveMark()
    }
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, marks, mark, fetchTags, getCurrentTag, fetchMarks, shouldClearActiveMark, clearActiveMark])

  const regenerateDesc = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    const desc = await fetchAiDesc(mark.content || '') || ''
    await updateMark({ ...mark, desc })
    fetchMarks()
  }, [mark, fetchMarks])

  const handelShowInFolder = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const appDir = await appDataDir()
      const action = getMarkOpenAction(mark, appDir, 'folder')

      if (!action?.path) {
        return
      }

      if (action.mode === 'reveal') {
        await revealItemInDir(action.path)
        return
      }

      await openPath(action.path)
    } catch (error) {
      console.error('Failed to open source folder:', error)
    }
  }, [mark])

  const handelShowInFile = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const appDir = await appDataDir()
      const action = getMarkOpenAction(mark, appDir, 'file')

      if (!action?.path) {
        return
      }

      await openPath(action.path)
    } catch (error) {
      console.error('Failed to open source file:', error)
    }
  }, [mark])

  const handleCopyLink = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    await navigator.clipboard.writeText(mark.url)
    toast({
      title: t('record.mark.toolbar.copied')
    })
  }, [mark.url, t])

  // Memoize filtered tags to prevent unnecessary re-renders
  const filteredTags = useMemo(() =>
    tags.filter(tag => tag.id !== currentTagId),
    [tags, currentTagId]
  )

  const markCard = (
    <div
      data-mark-item="true"
      data-mark-id={mark.id}
      className={cn(
        "relative transition-colors",
        variant === 'cards'
          ? 'w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/70 bg-background p-2.5'
          : variant === 'compact'
            ? 'w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/60 bg-background px-3 py-2'
            : 'w-full min-w-0 max-w-full overflow-hidden border-b border-l-2 border-b-border/60 border-l-transparent bg-background last:border-b-0',
        highlightedMarkId === mark.id && (
          variant === 'list'
            ? 'record-search-highlight bg-amber-50/80 dark:bg-amber-500/10'
            : 'record-search-highlight border-amber-400/80 bg-amber-50/80 dark:border-amber-400/70 dark:bg-amber-500/10'
        ),
        activeMarkId === mark.id && (
          variant === 'list'
            ? 'border-l-2 border-l-primary bg-accent/45'
            : 'border-primary/60 bg-accent/50 shadow-sm'
        ),
        interactive ? (
          variant === 'list'
            ? (isMobile ? 'cursor-default active:bg-accent/35' : 'cursor-move hover:bg-muted/45')
            : (isMobile ? 'cursor-default active:bg-accent/40' : 'cursor-move hover:bg-accent/50')
        ) : 'cursor-default'
      )}
      draggable={interactive && !isMultiSelectMode && !isMobile}
      onDragStart={interactive ? handleDragStart : undefined}
      onDragEnd={interactive ? handleDragEnd : undefined}
    >
      <MarkWrapper mark={mark} variant={variant} interactive={interactive} />
      {interactive ? (
        <div className="absolute top-2 right-2">
          <MarkMobileActions
            mark={mark}
            tags={tags}
            currentTagId={currentTagId}
            trashState={trashState}
            isMultiSelectMode={isMultiSelectMode}
            selectedMarkIds={selectedMarkIds}
            onTransfer={handleTransfer}
            onCopyLink={handleCopyLink}
            onRegenerateDesc={regenerateDesc}
            onShowInFolder={handelShowInFolder}
            onShowInFile={handelShowInFile}
            onRestore={handleRestore}
            onDelete={handleDelMark}
            onDeleteForever={handleDelForever}
          />
        </div>
      ) : null}
    </div>
  )

  if (isMobile || !interactive) {
    return markCard
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {markCard}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {
          trashState ? null :
          <ContextMenuSub>
            <ContextMenuSubTrigger inset menuType="record">
              {isMultiSelectMode && selectedMarkIds.size > 0
                ? t('record.mark.toolbar.moveSelectedTags', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.moveTag')
              }
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {
                filteredTags.map((tag) => (
                  <ContextMenuItem
                    disabled={tag.id === currentTagId}
                    key={tag.id}
                    onClick={() => handleTransfer(tag.id)}
                    menuType="record"
                  >
                    {tag.name}
                  </ContextMenuItem>
                ))
              }
            </ContextMenuSubContent>
          </ContextMenuSub>
        }
        <ContextMenuItem inset disabled={isMultiSelectMode || true} menuType="record">
          {t('record.mark.toolbar.convertTo', { type: mark.type === 'scan' ? t('record.mark.type.image') : t('record.mark.type.screenshot') })}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || !mark.url} onClick={handleCopyLink} menuType="record">
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || mark.type === 'text'} onClick={regenerateDesc} menuType="record">
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={isMultiSelectMode || !canOpenMarkSource(mark)} onClick={handelShowInFolder} menuType="record">
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || !canOpenMarkSource(mark)} onClick={handelShowInFile} menuType="record">
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        {
          trashState ? 
          <>
            <ContextMenuItem inset disabled={isMultiSelectMode} onClick={handleRestore} menuType="record">
              {t('record.mark.toolbar.restore')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleDelForever} menuType="record">
              <span className="text-red-900">
                {isMultiSelectMode && selectedMarkIds.size > 0 
                  ? t('record.mark.toolbar.deleteSelectedForever', { count: selectedMarkIds.size })
                  : t('record.mark.toolbar.deleteForever')
                }
              </span>
            </ContextMenuItem>
          </> :
          <ContextMenuItem inset onClick={handleDelMark} menuType="record">
            <span className="text-red-900">
              {isMultiSelectMode && selectedMarkIds.size > 0 
                ? t('record.mark.toolbar.deleteSelected', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.delete')
              }
            </span>
          </ContextMenuItem>
        }
      </ContextMenuContent>
    </ContextMenu>
  )
})
MarkItem.displayName = 'MarkItem'
