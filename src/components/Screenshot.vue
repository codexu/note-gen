<template>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/tauri";
import { onMounted } from "vue";
import storage from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';
import { readBinaryFile } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'
import useScreenshotStore, { ScreenshotListStatus } from '../stores/screenshot.ts'
import { Data, getCompletions } from '../api/completions.ts';
import { v4 as uuidv4 } from 'uuid';
import { clone, debounce } from 'lodash'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';

const screenshotStore = useScreenshotStore()

async function screenshot() {
  const id = uuidv4()
  const tabId = storage.get('currentTab')

  const result: ScreenshotListStatus = {
    id,
    tabId,
    path: '',
    keywords: [],
    description: '',
    screenshotStatus: true,
    screenshotProgress: '截图',
  }

  screenshotStore.screenshotList.unshift(clone(result))

  try {
    const path = await invoke<string>("screenshot_path");
    await notificationScreenshot()
    const imgUint8Array = await readBinaryFile(path);
    const imgUrl = URL.createObjectURL(new Blob([imgUint8Array], { type: 'image/jpeg' }));
    
    // 文字识别
    result.path = imgUrl
    result.screenshotProgress = '识别文字'
    screenshotStore.updateStatus(clone(result))
    const content = await invoke<string>("lt_ocr", { path });

    // 分析关键词
    result.screenshotProgress = '分析关键词'
    screenshotStore.updateStatus(clone(result))
    const keywords = await invoke("cut_words", {
      str: content
    }) as string[]
    result.keywords = keywords

    // 分析内容，提取描述
    result.screenshotProgress = '提取内容'
    screenshotStore.updateStatus(clone(result))
    const description = await takeDescription(content)
    result.description = description

    // 保存
    const currentTab = storage.get('currentTab')
    result.screenshotProgress = '保存记录'
    screenshotStore.updateStatus(clone(result))
    await db.marks.add({
      imgPath: path,
      status: true,
      content,
      description,
      tab: currentTab,
      keywords,
      createdAt: new Date().getTime()
    })
    screenshotStore.complete(id)
    emitter.emit('refresh')
  } catch (error) {
    console.error(error);
    result.screenshotProgress = '截图失败'
    screenshotStore.updateStatus(clone(result))
    setTimeout(() => {
      screenshotStore.complete(id)
    }, 5000);
  }
}

// 提取识别文字里的重要内容
async function takeDescription(content: string) {
  const request_content = `
    以下是截图后使用 OCR 识别出的文字，该截图是整个屏幕的截图，识别后的内容为：${content}。请返回一句此截图内容的核心内容描述，长度不要超过50字。
  `
  const data: Data = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: request_content,
      },
    ]
  }
  const res = await getCompletions(data);
  const result = res.data.choices[0].message.content
  return result
}

// 截图完成通知
async function notificationScreenshot() {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }
  if (permissionGranted) {
    sendNotification({ title: 'NoteGen', body: '截图成功' });
  }
}

onMounted(async () => {
  listen('screenshot', debounce(screenshot, 1000));
})
</script>