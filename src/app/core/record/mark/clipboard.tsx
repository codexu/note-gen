'use client'
import { clear, hasImage, hasText, readImageBase64, readText } from "tauri-plugin-clipboard-api";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { BaseDirectory, copyFile, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import useTagStore from "@/stores/tag";
import useSettingStore from "@/stores/setting";
import useMarkStore from "@/stores/mark";
import { v4 as uuid } from 'uuid'
import ocr from "@/lib/ocr";
import { fetchAiDesc, fetchAiDescByImage } from "@/lib/ai";
import { insertMark, Mark } from "@/db/marks";
import { uint8ArrayToBase64, uploadFile } from "@/lib/sync/github";
import { RepoNames } from "@/lib/sync/github.types";
import { CheckCircle, CircleX } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { convertBytesToSize } from "@/lib/utils";

export function Clipboard() {
  const t = useTranslations();
  const [type, setType] = useState<'image' | 'text'>('image')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [fileSize, setFileSize] = useState('')
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { primaryModel, githubUsername, primaryImageMethod, enableImageRecognition } = useSettingStore()
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
    setImage(`data:image/png;base64, ${image}`)
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
    addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.saveImage'), type: 'image', startTime: Date.now() })
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData})
    }
    await copyFile('clipboard.png', `image/${queueId}.png`, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData})
    let content = ''
    let desc = ''
    
    // Skip image recognition if disabled
    if (!enableImageRecognition) {
      setQueue(queueId, { progress: t('record.mark.progress.save') });
      content = ''
      desc = ''
    } else if (primaryImageMethod === 'vlm') {
      // 使用 VLM 识别图片
      setQueue(queueId, { progress: t('record.mark.progress.aiAnalysis') });
      const file = await readFile(`image/${queueId}.png`, { baseDir: BaseDirectory.AppData })
      const base64 = `data:image/png;base64,${Buffer.from(file).toString('base64')}`
      content = await fetchAiDescByImage(base64) || 'VLM Error'
      desc = content
    } else {
      // 使用 OCR 识别图片
      setQueue(queueId, { progress: t('record.mark.progress.ocr') });
      content = await ocr(`image/${queueId}.png`)
      setQueue(queueId, { progress: t('record.mark.progress.aiAnalysis') });
      if (primaryModel) {
        desc = await fetchAiDesc(content).then(res => res ? res : content) || content
      } else {
        desc = content
      }
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
      setQueue(queueId, { progress: t('record.mark.progress.uploadImage') });
      const res = await uploadFile({
        ext: 'png',
        file: uint8ArrayToBase64(file),
        filename: `${queueId}.png`,
        repo: RepoNames.image
      })
      if (res) {
        setQueue(queueId, { progress: t('record.mark.progress.jsdelivrCache') });
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
            <p className="text-sm font-bold text-white">{t('record.mark.clipboard.detectedImage')}</p>
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
            <p className="text-sm font-bold text-secondary">{t('record.mark.clipboard.detectedText')}</p>
            <div className="flex gap-2">
              <CircleX className="text-secondary size-4 cursor-pointer" onClick={handleCancle} />
              <CheckCircle className="text-secondary size-4 cursor-pointer" onClick={handleTextInset} />
            </div>
          </div>
          <p className="line-clamp-5 text-xs text-secondary mb-2">{text}</p>
          <p className="line-clamp-5 text-xs text-secondary text-right">{t('record.mark.text.characterCount', { count: text.length })}</p>
        </div>
      )
    )
  )
}