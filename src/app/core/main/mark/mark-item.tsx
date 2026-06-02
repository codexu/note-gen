'use client'
import React from "react"
import { delMark, delMarkForever, Mark, restoreMark, updateMark } from "@/db/marks";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { LocalImage } from "@/components/local-image";
import { fetchAiDesc } from "@/lib/ai/description";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { appDataDir } from "@tauri-apps/api/path";
import { CheckSquare, ImageUp, RefreshCw, Settings2, Square } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Textarea } from "@/components/ui/textarea";
import { AudioPlayer } from "@/components/audio-player";
import { ImageViewer } from "@/components/image-viewer";
import ChatPreview from "../chat/chat-preview";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkMobileActions } from "./mark-mobile-actions";
import { markToMarkdown } from "@/lib/mark-to-markdown";
import useSettingStore from "@/stores/setting";
import { TodoItemContent } from "./todo-item-content";
import { useIsMobile } from "@/hooks/use-mobile";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { useRouter } from "next/navigation";
import { NO_TRANSCRIPTION_MESSAGE, transcribeRecording } from "@/lib/audio";
import { getMarkTypeListBadgeClasses } from "./mark-type-meta";
import { getMarkListItemContent } from "./mark-list-item-content";
import { TodoEditTrigger } from "./todo-edit-button";
import { canOpenMarkSource, getMarkOpenAction } from "./mark-open-path";

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

// Memoize image size mapping function
const getImageSize = (textSize: string): string => {
  const sizeMap: Record<string, string> = {
    'xs': 'max-h-16',
    'sm': 'max-h-20',
    'md': 'max-h-24',
    'lg': 'max-h-32',
    'xl': 'max-h-40'
  }
  return sizeMap[textSize] || 'max-h-24'
}

// Memoize word count function
const getWordCount = (text: string): number => {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
};

const DetailViewer = React.memo(({mark, content, path, className, interactive = true}: {mark: Mark, content: string, path?: string, className?: string, interactive?: boolean}) => {
  const [value, setValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const { updateMark } = useMarkStore()
  const { recordTextSize } = useSettingStore()
  const t = useTranslations('record.mark.type');
  const markT = useTranslations('record.mark');
  const messageControlT = useTranslations('record.mark.mark.chat.messageControl');

  const lineHeight = useMemo(() => getLineHeight(recordTextSize), [recordTextSize])
  const imageSize = useMemo(() => getImageSize(recordTextSize), [recordTextSize])

  const textDescChangeHandler = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value })
  }, [mark, updateMark])

  const textMarkChangeHandler = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value, content: e.target.value })
  }, [mark, updateMark])

  useEffect(() => {
    setValue(mark.content || '')
    setDescValue(mark.desc?.trim() || '')
  }, [mark])

  if (!interactive) {
    return <span className={className || `line-clamp-2 ${lineHeight} mt-2 text-${recordTextSize} break-words`}>{content}</span>
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <span className={className || `line-clamp-2 ${lineHeight} mt-2 text-${recordTextSize} break-words cursor-pointer hover:underline`}>{content}</span>
      </SheetTrigger>
      <SheetContent className="lg:min-w-[800px] w-full mt-[env(safe-area-inset-top)] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{t(mark.type)}</SheetTitle>
          <div className="flex items-center gap-2">
            <span className={`text-${recordTextSize} text-zinc-500`}>{markT('createdAt')}：{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
            <span className={`text-${recordTextSize} text-zinc-500`}>
              {getWordCount(value)} {messageControlT('words')}
            </span>
          </div>
        </SheetHeader>
        <div className="h-[calc(100vh-88px)] overflow-y-auto md:p-8 p-2">
          {
            mark.url && (mark.type === 'image' || mark.type === 'scan') ?
            <LocalImage
              src={mark.url.includes('http') ? mark.url : `/${path}/${mark.url}`}
              alt=""
              className={`w-full ${imageSize} object-contain`}
            /> :
            null
          }
          {
            mark.type === 'text' || mark.desc === mark.content ? null :
            <>
              <span className="block my-4 text-md text-zinc-900 font-bold">{markT('desc')}</span>
              <Textarea placeholder="在此输入文本记录内容..." rows={3} value={descValue} onChange={textDescChangeHandler} />
            </>
          }
          <span className="block my-4 text-md text-zinc-900 font-bold">{markT('content')}</span>
          {
            mark.type === "text" ? 
            <Textarea placeholder="在此输入文本记录内容..." rows={14} value={value} onChange={textMarkChangeHandler} /> :
            <ChatPreview text={mark.content || ''} />
          }
        </div>
      </SheetContent>
    </Sheet>
  )
})
DetailViewer.displayName = 'DetailViewer'

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
  const shouldShowRecordingAction = mark.type === 'recording' && mark.content === NO_TRANSCRIPTION_MESSAGE
  const itemContent = useMemo(() => getMarkListItemContent(mark), [mark])

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

  if (variant === 'compact') {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {interactive && isMultiSelectMode && (
          <div className="pr-1">
            <Checkbox
              checked={selectedMarkIds.has(mark.id)}
              onCheckedChange={handleCheckboxChange}
            />
          </div>
        )}
        <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
          {t(mark.type)}
        </span>
        {mark.type === 'todo' && itemContent.todo ? (
          <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
        ) : null}
        <div className="min-w-0 flex-1">
          {mark.type === 'todo' ? interactive ? (
            <TodoEditTrigger mark={mark} className={`block truncate text-${recordTextSize} font-medium hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <span className={`block truncate text-${recordTextSize} font-medium`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </span>
          ) : (
            <DetailViewer
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              path={mark.type === 'scan' ? 'screenshot' : mark.type === 'image' ? 'image' : undefined}
              className={`block truncate text-${recordTextSize} font-medium ${interactive ? 'hover:underline' : ''}`}
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
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-zinc-500">
          <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
            {t(mark.type)}
          </span>
          {mark.type === 'todo' && itemContent.todo ? (
            <span className={`size-2 shrink-0 rounded-full ${todoPriorityDotClass}`} />
          ) : null}
          <span className="ml-auto text-xs">{dayjs(mark.createdAt).format('MM-DD HH:mm')}</span>
        </div>
        {isImageCard && mark.url ? (
          <div className="overflow-hidden rounded-md bg-zinc-100">
            <ImageViewer
              url={mark.url}
              path={mark.type === 'scan' ? 'screenshot' : 'image'}
              imageClassName="h-auto max-h-56 w-full object-cover"
              interactive={interactive}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          {mark.type === 'todo' ? interactive ? (
            <TodoEditTrigger mark={mark} className={`block truncate text-${recordTextSize} font-semibold hover:underline`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </TodoEditTrigger>
          ) : (
            <span className={`block truncate text-${recordTextSize} font-semibold`}>
              {itemContent.title || itemContent.preview || t(mark.type)}
            </span>
          ) : (
            <DetailViewer
              mark={mark}
              content={itemContent.title || itemContent.preview || t(mark.type)}
              path={mark.type === 'scan' ? 'screenshot' : mark.type === 'image' ? 'image' : undefined}
              className={`block truncate text-${recordTextSize} font-semibold ${interactive ? 'hover:underline' : ''}`}
              interactive={interactive}
            />
          )}
          {!isImageCard && itemContent.preview ? (
            <p className={`line-clamp-6 text-${recordTextSize} ${lineHeight} text-muted-foreground`}>
              {itemContent.preview}
            </p>
          ) : null}
          {!isImageCard && mark.type === 'link' && mark.url ? interactive ? (
            <a
              href={mark.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block truncate text-xs text-blue-600 hover:underline`}
            >
              {mark.url}
            </a>
          ) : (
            <span className={`block truncate text-xs text-blue-600`}>
              {mark.url}
            </span>
          ) : null}
          {!isImageCard && mark.type === 'todo' && itemContent.todo ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                {itemContent.todo.completed ? <CheckSquare className="size-3.5 text-green-600" /> : <Square className="size-3.5 text-zinc-400" />}
                <span>{itemContent.todo.completed ? todoT('completed') : todoT('uncompleted')}</span>
              </div>
            </div>
          ) : null}
          {!isImageCard && mark.type === 'recording' && mark.url ? (
            <div className="pt-1">
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
        <div className={`flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
              {t(mark.type)}
            </span>
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="screenshot" interactive={interactive} />
        </div>
    )
    case 'image':
    return (
        <div className={`flex-1 overflow-hidden text-${recordTextSize} ${lineHeight} pr-10 md:pr-2`}>
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
              {t(mark.type)}
            </span>
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="image" interactive={interactive} />
        </div>
    )
    case 'link':
    return (
        <div className="flex-1 pr-10 md:pr-0">
          <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
            <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
              {t(mark.type)}
            </span>
            <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} interactive={interactive} />
          <div className="mt-1">
            {interactive ? (
              <a
                href={mark.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-${recordTextSize} text-blue-500 hover:underline truncate block`}
              >
                {mark.url}
              </a>
            ) : (
              <span className={`text-${recordTextSize} text-blue-500 truncate block`}>
                {mark.url}
              </span>
            )}
          </div>
        </div>
    )
    case 'text':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
                {t(mark.type)}
              </span>
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} interactive={interactive} />
          </div>
      )
    case 'recording':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
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
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} interactive={interactive} />
            {mark.url && (
              <div className="mt-2">
                <AudioPlayer audioPath={mark.url} />
              </div>
            )}
          </div>
      )
    case 'file':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
              <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
                {t(mark.type)}
              </span>
              <span className={`ml-auto text-${recordTextSize}`}>{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} interactive={interactive} />
            {mark.url && (
              <div className="mt-1">
                <span className={`text-${recordTextSize}`}>
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
    <div className="flex p-2 items-start">
      {interactive && isMultiSelectMode && (
        <div className="pr-2 flex items-start pt-1">
          <Checkbox
            checked={selectedMarkIds.has(mark.id)}
            onCheckedChange={handleCheckboxChange}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {renderContent()}
      </div>
      {(mark.type === 'scan' || mark.type === 'image') && (
        <div className="bg-zinc-900 flex items-center justify-center ml-2">
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
  } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()

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
      for (const markId of selectedMarks) {
        await delMark(markId)
      }
      clearSelection()
    } else {
      // 单个删除
      await delMark(mark.id)
    }
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, fetchMarks, fetchTags, getCurrentTag, mark.id])

  const handleDelForever = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
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
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, fetchAllTrashMarks, mark.id])

  const handleRestore = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    await restoreMark(mark.id)
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
  }, [mark.id, trashState, fetchAllTrashMarks, fetchMarks])

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
  }, [isMultiSelectMode, selectedMarkIds, clearSelection, marks, mark, fetchTags, getCurrentTag, fetchMarks])

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
      className={`relative transition-colors ${
        variant === 'cards'
          ? 'rounded-md border border-border/70 bg-background p-2.5'
          : variant === 'compact'
            ? 'rounded-md border border-border/60 bg-background px-3 py-2'
            : 'rounded-lg border border-border/60 bg-background'
      } ${highlightedMarkId === mark.id ? 'record-search-highlight border-amber-400/80 bg-amber-50/80 dark:border-amber-400/70 dark:bg-amber-500/10' : ''} ${interactive ? (isMobile ? 'cursor-default active:bg-accent/40' : 'cursor-move hover:bg-accent/50') : 'cursor-default'}`}
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
