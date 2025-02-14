'use client'
import { useState } from 'react';
import { BaseDirectory, copyFile, exists, mkdir, readFile } from '@tauri-apps/plugin-fs';
import useTagStore from "@/stores/tag";
import useSettingStore from "@/stores/setting";
import useMarkStore from "@/stores/mark";
import { v4 as uuid } from 'uuid'
import ocr from "@/lib/ocr";
import { fetchAiDesc } from "@/lib/ai";
import { insertMark, Mark } from "@/db/marks";
import { uint8ArrayToBase64, uploadFile } from "@/lib/github";
import { RepoNames } from "@/lib/github.types";
import { CheckCircle, Highlighter, ImagePlus, LoaderCircle } from "lucide-react";
import { Chat } from "@/db/chats";
import { LocalImage } from '@/components/local-image';
import MessageControl from './message-control';
import useChatStore from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { _t } from '@/locales';

export function ChatClipboard({chat}: { chat: Chat }) {
  const [loading, setLoading] = useState(false)
  const [type] = useState<'image' | 'text'>(chat.image ? 'image' : 'text')
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { apiKey, githubUsername } = useSettingStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()
  const { updateInsert } = useChatStore()

  async function handleInset() {
    setLoading(true)
    const queueId = uuid()
    // 获取文件后缀
    addQueue({ queueId, progress: _t('saving_image'), type: 'image', startTime: Date.now() })
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData})
    }
    if (!chat.image) return
    const fromPath = chat.image.slice(1)
    const toPath = fromPath.replace('clipboard', 'image')
    await copyFile(fromPath, toPath, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData})
    setQueue(queueId, { progress: _t('ocr_recognition') });
    const content = await ocr(toPath)
    let desc = ''
    if (apiKey) {
      setQueue(queueId, { progress: _t('ai_content_recognition') });
      desc = await fetchAiDesc(content).then(res => res ? res : content)
    } else {
      desc = content
    }
    const mark: Partial<Mark> = {
      tagId: currentTagId,
      type: 'image',
      content,
      url: `${queueId}.png`,
      desc,
    }
    const file = await readFile(toPath, { baseDir: BaseDirectory.AppData  })
    if (githubUsername) {
      setQueue(queueId, { progress: _t('uploading_image') });
      const res = await uploadFile({
        ext: 'png',
        file: uint8ArrayToBase64(file),
        filename: `${queueId}.png`,
        repo: RepoNames.image
      })
      if (res) {
        setQueue(queueId, { progress: _t('notify_jsdelivr_cache') });
        await fetch(`https://purge.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`)
        mark.url = `https://cdn.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`
      } else {
        mark.url = `${queueId}.png}`
      }
    }
    removeQueue(queueId)
    await updateInsert(chat.id)
    setLoading(false)
    await insertMark(mark)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function handleTextInset() {
    await updateInsert(chat.id)
    const mark: Partial<Mark> = {
      tagId: currentTagId,
      type: 'text',
      content: chat.content,
      desc: '',
    }
    insertMark(mark)
    fetchMarks()
    fetchTags()
    getCurrentTag()
  }

  return (
    type === 'image' && chat.image ?
      <div className="flex-col leading-6">
        <p>{_t('detected_clipboard_image')}</p>
        <LocalImage src={chat.image} alt="" width={0} height={0} className="max-h-96 max-w-96 w-auto mt-2 mb-3 border-8 rounded" />
        <MessageControl chat={chat}>
          {
            loading ?
              <Button variant={"ghost"} size="sm" disabled>
                <LoaderCircle className="size-4 animate-spin" />
                {_t('recording')}
              </Button> : (
              chat.inserted?
                <Button variant={"ghost"} size="sm" disabled>
                  <CheckCircle className="size-4" />
                  {_t('recorded')}
                </Button> :
                <Button variant={"ghost"} size="sm" onClick={handleInset}>
                  <ImagePlus className="size-4" />
                  {_t('record_action')}
                </Button>
            )
          }

        </MessageControl>
      </div> :
      <div className="flex-col leading-6">
        <p>{_t('detected_clipboard_text')}</p>
        <p className='text-zinc-500'>{chat.content}</p>
        <MessageControl chat={chat}>
          {
            chat.inserted ?
              <Button variant={"ghost"} size="sm" disabled>
                <CheckCircle className="size-4" />
                {_t('recorded')}
              </Button> :
              <Button variant={"ghost"} size="sm" onClick={handleTextInset}>
                <Highlighter className="size-4" />
                {_t('record_action')}
              </Button>
          }
        </MessageControl>
      </div>
  )
}
