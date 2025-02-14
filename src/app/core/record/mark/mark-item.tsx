'use client'
import { delMark, delMarkForever, Mark, MarkType, restoreMark, updateMark } from "@/db/marks";
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
import zh from 'dayjs/locale/zh'
import React, { useEffect, useState } from "react";
import useMarkStore from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { LocalImage } from "@/components/local-image";
import { fetchAiDesc } from "@/lib/ai";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { appDataDir } from "@tauri-apps/api/path";
// import { invoke } from "@tauri-apps/api/core";
import { ImageUp } from "lucide-react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import { convertImage } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { open } from "@tauri-apps/plugin-shell";
import { Textarea } from "@/components/ui/textarea";
import { _t } from '@/locales';

dayjs.extend(relativeTime)
dayjs.locale(zh)

function ImageViewer({mark, path}: {mark: Mark, path?: string}) {
  const [src, setSrc] = useState('')

  async function init() {
    const res = mark.url.includes('http') ? mark.url : await convertImage(`/${path}/${mark.url}`)
    setSrc(res)
  }

  useEffect(() => {
    init()
  }, [])

  return (
    <PhotoProvider>
      <PhotoView src={src}>
        <div>
          <LocalImage
            src={mark.url.includes('http') ? mark.url : `/${path}/${mark.url}`}
            alt=""
            className="w-14 h-14 object-cover cursor-pointer"
          />
        </div>
      </PhotoView>
    </PhotoProvider>
  )
}

function DetailViewer({mark, content, path}: {mark: Mark, content: string, path?: string}) {
  const [value, setValue] = useState('')
  const { updateMark } = useMarkStore()
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
      <SheetContent className="min-w-[400px] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{MarkType[mark.type]}</SheetTitle>
          <span className="mt-4 text-xs text-zinc-500">{_t('created_at')}：{dayjs(mark.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
        </SheetHeader>
        <div className="h-[calc(100vh-88px)] overflow-y-auto p-4">
          {
            mark.url && mark.type !== 'text' ?
            <LocalImage
              src={mark.url.includes('http') ? mark.url : `/${path}/${mark.url}`}
              alt=""
              className="w-full"
            /> :
            null
          }
          <SheetDescription>
            {
              mark.type === 'text' || mark.desc === mark.content ? null :
              <>
                <span className="block my-4 text-md text-zinc-900 font-bold">{_t('description')}</span>
                <span className="leading-6">{mark.desc}</span>
              </>
            }
            <span className="block my-4 text-md text-zinc-900 font-bold">{_t('content')}</span>
            {
              mark.type === "text" ?
              <Textarea placeholder={_t('enter_text_record_content_here')} rows={14} value={value} onChange={textMarkChangeHandler} /> :
              <span className="leading-6">{mark.content}</span>
            }
          </SheetDescription>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function MarkWrapper({mark}: {mark: Mark}) {
  switch (mark.type) {
    case 'scan':
    return (
      <div className="flex p-2">
        <div className="pr-2 flex-1 overflow-hidden text-xs">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-cyan-900 text-white px-1 rounded">
              {MarkType[mark.type]}
            </span>
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="screenshot" />
        </div>
        <div className="bg-zinc-900 flex items-center justify-center">
          <ImageViewer mark={mark} path="screenshot" />
        </div>
      </div>
    )
    case 'image':
    return (
      <div className="flex p-2">
        <div className="pr-2 flex-1 overflow-hidden text-xs">
          <div className="flex w-full items-center gap-2 text-zinc-500">
            <span className="flex items-center gap-1 bg-fuchsia-900 text-white px-1 rounded">
              {MarkType[mark.type]}
            </span>
            {mark.url.includes('http') ? <ImageUp className="size-3 text-zinc-400" /> : null}
            <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
          </div>
          <DetailViewer mark={mark} content={mark.desc || ''} path="image" />
        </div>
        <div className="bg-zinc-900 flex items-center justify-center">
          <ImageViewer mark={mark} path="image" />
        </div>
      </div>
    )
    case 'text':
    default:
    return (
      <div className="p-2 flex-1">
        <div className="flex w-full items-center gap-2 text-zinc-500 text-xs">
          <span className="flex items-center gap-1 bg-lime-900 text-white px-1 rounded">
            {MarkType[mark.type]}
          </span>
          <span className="ml-auto text-xs">{dayjs(mark.createdAt).fromNow()}</span>
        </div>
        <DetailViewer mark={mark} content={mark.content || ''} />
      </div>
    )
  }
}

export function MarkItem({mark}: {mark: Mark}) {

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
    const desc = await fetchAiDesc(mark.content || '').then(res => res)
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
      title: _t('copied_to_clipboard')
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
            <ContextMenuSubTrigger inset>{_t('transfer_tag')}</ContextMenuSubTrigger>
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
          {_t('convert_to')} {mark.type === 'scan' ? _t('illustration') : _t('screenshot')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={!mark.url} onClick={handleCopyLink}>
          {_t('copy_link')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={regenerateDesc}>
          {_t('regenerate_description')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={handelShowInFolder}>
          {_t('view_directory')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={mark.type === 'text'} onClick={handelShowInFile}>
          {_t('view_original_file')}
        </ContextMenuItem>
        {
          trashState ?
          <>
            <ContextMenuItem inset onClick={handleRestore}>
              {_t('restore')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={handleDelForever}>
              <span className="text-red-900">{_t('delete_forever')}</span>
            </ContextMenuItem>
          </> :
          <ContextMenuItem inset onClick={handleDelMark}>
            <span className="text-red-900">{_t('delete_mark')}</span>
          </ContextMenuItem>
        }
      </ContextMenuContent>
    </ContextMenu>
  )
}
