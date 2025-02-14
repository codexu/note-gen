'use client'
import { clear, hasImage, hasText, readImageBase64, readText } from "tauri-plugin-clipboard-api";
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { BaseDirectory, copyFile, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import useTagStore from "@/stores/tag";
import useSettingStore from "@/stores/setting";
import useMarkStore from "@/stores/mark";
import { v4 as uuid } from 'uuid'
import ocr from "@/lib/ocr";
import { fetchAiDesc } from "@/lib/ai";
import { insertMark, Mark } from "@/db/marks";
import { uint8ArrayToBase64, uploadFile } from "@/lib/github";
import { RepoNames } from "@/lib/github.types";
import { CheckCircle, CircleX } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { convertBytesToSize } from "@/lib/utils";
import { _t } from '@/locales';

export function Clipboard() {
  const [type, setType] = useState<'image' | 'text'>('image')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [fileSize, setFileSize] = useState('')
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { apiKey, githubUsername } = useSettingStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  async function readHandler() {
    const hasImageRes = await hasImage()
    const hasTextRes = await hasText()

    if (hasImageRes) {
      setType('image')
      await handleImage()
    } else if (hasTextRes) {
      setType('text')
      await handleText()
    }
  }

  async function handleImage() {
    const image = await readImageBase64()
    const uint8Array = Uint8Array.from(atob(image), c => c.charCodeAt(0))
    await writeFile('clipboard.png', uint8Array, { baseDir: BaseDirectory.AppData })
    setFileSize(convertBytesToSize(uint8Array.length))
    setImage(`Data:image/png;base64, ${image}`)
  }

  async function handleText() {
    const text = await readText()
    setText(text)
  }

  async function handleInset() {
    await clear()
    setImage('')
    const queueId = uuid()
    // 获取文件后缀
    addQueue({ queueId, progress: _t('saving_image_progress'), type: 'image', startTime: Date.now() })
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData})
    }
    await copyFile('clipboard.png', `image/${queueId}.png`, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData})
    setQueue(queueId, { progress: _t('ocr_recognition_progress') });
    const content = await ocr(`image/${queueId}.png`)
    let desc = ''
    if (apiKey) {
      setQueue(queueId, { progress: _t('ai_content_recognition_progress') });
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
    const file = await readFile(`image/${queueId}.png`, { baseDir: BaseDirectory.AppData  })
    if (githubUsername) {
      setQueue(queueId, { progress: _t('uploading_image_server') });
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
    await insertMark(mark)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  async function handleTextInset() {
    await clear()
    setText('')
    const mark: Partial<Mark> = {
      tagId: currentTagId,
      type: 'text',
      content: text,
      desc: text,
    }
    insertMark(mark)
    fetchMarks()
    fetchTags()
    getCurrentTag()
  }

  async function handleCancle() {
    setImage('')
    setText('')
    setFileSize('')
    await clear()
  }

  useEffect(() => {
    listen('tauri://focus', readHandler)
  }, [])

  return (
    type === 'image' ? (
      image && (
        <div className="relative flex justify-center items-center">
          <div className="absolute top-0 left-0 flex gap-2 justify-between items-center mb-2 w-full z-20 p-4">
            <p className="text-sm font-bold text-white">{_t('detected_clipboard_image_text')}</p>
            <div className="flex gap-2">
              <CircleX className="text-white size-4 cursor-pointer" onClick={handleCancle} />
              <CheckCircle className="text-white size-4 cursor-pointer" onClick={handleInset} />
            </div>
          </div>
          <p className="absolute bottom-4 right-4 z-20 text-xs text-white">{fileSize}</p>
          <div className="bg-primary opacity-70 w-full h-full absolute top-0 left-0 z-10"></div>
          <Image src={image} width={0} height={0} alt="clipboard image" className="w-full object-cover" />
        </div>
      )
    ) : (
      text && (
        <div className="flex-col justify-center items-center p-4 bg-primary">
          <div className="flex gap-2 justify-between items-center mb-2">
            <p className="text-sm font-bold text-secondary">{_t('detected_clipboard_text_text')}</p>
            <div className="flex gap-2">
              <CircleX className="text-secondary size-4 cursor-pointer" onClick={handleCancle} />
              <CheckCircle className="text-secondary size-4 cursor-pointer" onClick={handleTextInset} />
            </div>
          </div>
          <p className="line-clamp-5 text-xs text-secondary mb-2">{text}</p>
          <p className="line-clamp-5 text-xs text-secondary text-right">{_t('characters', text.length)}</p>
        </div>
      )
    )
  )
}
