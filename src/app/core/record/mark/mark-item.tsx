'use client'
import { delMark, delMarkForever, Mark, restoreMark, updateMark } from "@/db/marks";
import { useTranslations } from 'next-intl';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSeparator,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import dayjs from "dayjs";
import relativeTime from 'dayjs/plugin/relativeTime'
import React, { useEffect, useState } from "react";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { LocalImage } from "@/components/local-image";
import { fetchAiDesc } from "@/lib/ai";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { appDataDir } from "@tauri-apps/api/path";
import { ImageUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { open } from "@tauri-apps/plugin-shell";
import { Textarea } from "@/components/ui/textarea";
import { AudioPlayer } from "@/components/audio-player";
import { ImageViewer } from "@/components/image-viewer";
import ChatPreview from "../chat/chat-preview";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkMobileActions } from "./mark-mobile-actions";

dayjs.extend(relativeTime)

function DetailViewer({mark, content, path}: {mark: Mark, content: string, path?: string}) {
  const [value, setValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const { updateMark } = useMarkStore()
  const t = useTranslations('record.mark.type');
  const markT = useTranslations('record.mark');
  const messageControlT = useTranslations('record.mark.mark.chat.messageControl');

  const getWordCount = (text: string) => {
    if (!text) return 0;
    return text.replace(/\s/g, '').length;
  };

  async function textDescChangeHandler(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDescValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value })
  }

  async function textMarkChangeHandler(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value, content: e.target.value })
  }

  useEffect(() => {
    setValue(mark.content || '')
    setDescValue(mark.desc?.trim() || '')
  }, [mark])
  return (
    <Sheet>
      <SheetTrigger asChild>
        <span className="line-clamp-2 leading-4 mt-2 text-xs break-words cursor-pointer hover:underline">{content}</span>
      </SheetTrigger>
      <SheetContent className="lg:min-w-[800px] w-full mt-[env(safe-area-inset-top)] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{t(mark.type)}</SheetTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">{markT('createdAt')}：{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
            <span className="text-xs text-zinc-500">
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
              className="w-full max-h-80 object-contain"
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
}

export function MarkWrapper({mark}: {mark: Mark}) {
  const t = useTranslations('record.mark.type');
  const { isMultiSelectMode, selectedMarkIds, toggleMarkSelection } = useMarkStore();
  
  const handleCheckboxChange = () => {
    toggleMarkSelection(mark.id);
  };

  const renderContent = () => {
    switch (mark.type) {
    case 'scan':
    return (
        <div className="flex-1 overflow-hidden text-xs pr-10 md:pr-2">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-cyan-900 text-white px-1 rounded text-xs">
              {t(mark.type)}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="screenshot" />
        </div>
    )
    case 'image':
    return (
        <div className="flex-1 overflow-hidden text-xs pr-10 md:pr-2">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-fuchsia-900 text-white px-1 rounded text-xs">
              {t(mark.type)}
            </span>
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="image" />
        </div>
    )
    case 'link':
    return (
        <div className="flex-1 pr-10 md:pr-0">
          <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
            <span className="flex items-center gap-1 bg-blue-900 text-white px-1 rounded">
              {t(mark.type)}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} />
          <div className="mt-1">
            <a 
              href={mark.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline truncate block"
            >
              {mark.url}
            </a>
          </div>
        </div>
    )
    case 'text':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
              <span className="flex items-center gap-1 bg-lime-900 text-white px-1 rounded">
                {t(mark.type)}
              </span>
              <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
          </div>
      )
    case 'recording':
      return (
          <div className="flex-1 pr-10 md:pr-0">
            <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
              <span className="flex items-center gap-1 bg-red-900 text-white px-1 rounded">
                {t(mark.type)}
              </span>
              <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
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
            <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
              <span className="flex items-center gap-1 bg-orange-800 text-white px-1 rounded">
                {t(mark.type)}
              </span>
              <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
            </div>
            <DetailViewer mark={mark} content={mark.content || ''} />
            {mark.url && (
              <div className="mt-1">
                <span className="text-xs">
                  {mark.desc}
                </span>
              </div>
            )}
          </div>
      )
    default:
      return null
    }
  }

  return (
    <div className="flex p-2 items-start">
      {isMultiSelectMode && (
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
          <ImageViewer url={mark.url} path={mark.type === 'scan' ? 'screenshot' : 'image'} />
        </div>
      )}
    </div>
  )
}

export function MarkItem({mark}: {mark: Mark}) {
  const t = useTranslations();
  const { 
    marks,
    fetchMarks, 
    trashState, 
    fetchAllTrashMarks, 
    isMultiSelectMode, 
    selectedMarkIds, 
    clearSelection 
  } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()

  async function handleDelMark(e?: React.MouseEvent) {
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
  }

  async function handleDelForever(e?: React.MouseEvent) {
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
  }

  async function handleRestore(e?: React.MouseEvent) {
    e?.stopPropagation()
    await restoreMark(mark.id)
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
  }

  async function handleTransfer(tagId: number, e?: React.MouseEvent) {
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
        <div className="border-t relative">
          <MarkWrapper mark={mark} />
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
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {
          trashState ? null :
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>
              {isMultiSelectMode && selectedMarkIds.size > 0 
                ? t('record.mark.toolbar.moveSelectedTags', { count: selectedMarkIds.size })
                : t('record.mark.toolbar.moveTag')
              }
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {
                tags.map((tag) => (
                  <ContextMenuItem 
                    disabled={tag.id === currentTagId} 
                    key={tag.id} 
                    onClick={() => handleTransfer(tag.id)}
                  >
                    {tag.name}
                  </ContextMenuItem>
                ))
              }
            </ContextMenuSubContent>
          </ContextMenuSub>
        }
        <ContextMenuItem inset disabled={isMultiSelectMode || true}>
          {t('record.mark.toolbar.convertTo', { type: mark.type === 'scan' ? t('record.mark.type.image') : t('record.mark.type.screenshot') })}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || !mark.url} onClick={handleCopyLink}>
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || mark.type === 'text'} onClick={regenerateDesc}>
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={isMultiSelectMode || mark.type === 'text'} onClick={handelShowInFolder}>
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isMultiSelectMode || mark.type === 'text'} onClick={handelShowInFile}>
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        {
          trashState ? 
          <>
            <ContextMenuItem inset disabled={isMultiSelectMode} onClick={handleRestore}>
              {t('record.mark.toolbar.restore')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleDelForever}>
              <span className="text-red-900">
                {isMultiSelectMode && selectedMarkIds.size > 0 
                  ? t('record.mark.toolbar.deleteSelectedForever', { count: selectedMarkIds.size })
                  : t('record.mark.toolbar.deleteForever')
                }
              </span>
            </ContextMenuItem>
          </> :
          <ContextMenuItem inset onClick={handleDelMark}>
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
}
