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
import { ImageViewer } from "@/components/image-viewer";
import ChatPreview from "../chat/chat-preview";

dayjs.extend(relativeTime)

function DetailViewer({mark, content, path}: {mark: Mark, content: string, path?: string}) {
  const [value, setValue] = useState('')
  const { updateMark } = useMarkStore()
  const t = useTranslations('record.mark.type');
  const markT = useTranslations('record.mark');

  async function textMarkChangeHandler(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    await updateMark({ ...mark, desc: e.target.value, content: e.target.value })
  }

  useEffect(() => {
    setValue(mark.content || '')
  }, [mark])
  return (
    <Sheet>
      <SheetTrigger asChild>
        <span className="line-clamp-2 leading-4 mt-2 text-xs break-words cursor-pointer hover:underline">{content}</span>
      </SheetTrigger>
      <SheetContent className="lg:min-w-[800px] w-full mt-[env(safe-area-inset-top)] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{t(mark.type)}</SheetTitle>
          <span className="mt-4 text-xs text-zinc-500">{markT('createdAt')}：{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
        </SheetHeader>
        <div className="h-[calc(100vh-88px)] overflow-y-auto lg:p-8 p-2">
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
              <ChatPreview text={mark.desc || ''} />
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
  switch (mark.type) {
    case 'scan':
    return (
      <div className="flex p-2">
        <div className="pr-2 flex-1 overflow-hidden text-xs">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-cyan-900 text-white px-1 rounded">
              {t(mark.type)}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="screenshot" />
        </div>
        <div className="bg-zinc-900 flex items-center justify-center">
          <ImageViewer url={mark.url} path="screenshot" />
        </div>
      </div>
    )
    case 'image':
    return (
      <div className="flex p-2">
        <div className="pr-2 flex-1 overflow-hidden text-xs">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-fuchsia-900 text-white px-1 rounded">
              {t(mark.type)}
            </span>
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="image" />
        </div>
        <div className="bg-zinc-900 flex items-center justify-center">
          <ImageViewer url={mark.url} path="image" />
        </div>
      </div>
    )
    case 'link':
    return (
      <div className="p-2 flex-1">
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
        <div className="p-2 flex-1">
          <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
            <span className="flex items-center gap-1 bg-lime-900 text-white px-1 rounded">
              {t(mark.type)}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.content || ''} />
        </div>
      )
    case 'file':
      return (
        <div className="p-2 flex-1">
          <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
            <span className="flex items-center gap-1 bg-orange-800 text-white px-1 rounded">
              {t(mark.type)}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.content || ''} />
        </div>
      )
    default:
      return null
  }
}

export function MarkItem({mark}: {mark: Mark}) {
  const t = useTranslations();
  const { fetchMarks, trashState, fetchAllTrashMarks } = useMarkStore()
  const { tags, currentTagId, fetchTags, getCurrentTag } = useTagStore()

  async function handleDelMark() {
    await delMark(mark.id)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function handleDelForever() {
    await delMarkForever(mark.id)
    await fetchAllTrashMarks()
  }

  async function handleRestore() {
    await restoreMark(mark.id)
    if (trashState) {
      await fetchAllTrashMarks()
    } else {
      await fetchMarks()
    }
  }

  async function handleTransfer(tagId: number) {
    await updateMark({ ...mark, tagId })
    await fetchTags()
    getCurrentTag()
    fetchMarks()
  }

  async function regenerateDesc() {
    const desc = await fetchAiDesc(mark.content || '') || ''
    await updateMark({ ...mark, desc })
    fetchMarks()
  }

  async function handelShowInFolder() {
    const appDir = await appDataDir()
    const path = mark.type === 'scan' ? 'screenshot' : 'image'
    open(`${appDir}/${path}`)
  }

  async function handelShowInFile() {
    const appDir = await appDataDir()
    const path = mark.type === 'scan' ? 'screenshot' : 'image'
    let filename = mark.url
    if (mark.url.includes('http')) {
      filename = mark.url.split('/').pop() || '';
    }
    open(`${appDir}/${path}/${filename}`)
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(mark.url)
    toast({
      title: t('record.mark.toolbar.copied')
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="border-b">
          <MarkWrapper mark={mark} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {
          trashState ? null :
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>{t('record.mark.toolbar.moveTag')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {
                tags.map((tag) => (
                  <ContextMenuItem disabled={tag.id === currentTagId} key={tag.id} onClick={() => handleTransfer(tag.id)}>
                    {tag.name}
                  </ContextMenuItem>
                ))
              }
            </ContextMenuSubContent>
          </ContextMenuSub>
        }
        <ContextMenuItem inset disabled>
          {t('record.mark.toolbar.convertTo', { type: mark.type === 'scan' ? t('record.mark.type.image') : t('record.mark.type.screenshot') })}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={!mark.url} onClick={handleCopyLink}>
          {t('record.mark.toolbar.copyLink')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={regenerateDesc}>
          {t('record.mark.toolbar.regenerateDesc')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={handelShowInFolder}>
          {t('record.mark.toolbar.viewFolder')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={handelShowInFile}>
          {t('record.mark.toolbar.viewFile')}
        </ContextMenuItem>
        {
          trashState ? 
          <>
            <ContextMenuItem inset onClick={handleRestore}>
              {t('record.mark.toolbar.restore')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleDelForever}>
              <span className="text-red-900">{t('record.mark.toolbar.deleteForever')}</span>
            </ContextMenuItem>
          </> :
          <ContextMenuItem inset onClick={handleDelMark}>
            <span className="text-red-900">{t('record.mark.toolbar.delete')}</span>
          </ContextMenuItem>
        }
      </ContextMenuContent>
    </ContextMenu>
  )
}
