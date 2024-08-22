<template>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/tauri";
import { onMounted } from "vue";
import storage from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';
import { createWorker } from 'tesseract.js';
import { readBinaryFile, BaseDirectory, writeBinaryFile } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'
import { appDataDir } from '@tauri-apps/api/path';
import dayjs from 'dayjs';
import imageCompression from 'browser-image-compression';
import useStore, { ScreenshotListStatus } from '../store.ts'
import { Data, getCompletions } from '../api/completions.ts';
import { v4 as uuidv4 } from 'uuid';
import { clone, debounce } from 'lodash'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';

const store = useStore()

async function screenshot() {

  const id = uuidv4()

  const tagId = storage.get('currentTag')

  const result: ScreenshotListStatus = {
    id,
    tagId,
    path: '',
    keywords: [],
    description: '',
    screenshotStatus: true,
    screenshotProgress: '截图',
  }

  store.screenshotList.unshift(clone(result))

  try {
    const base64img = await invoke("screenshot_base64") as string;
    await notificationScreenshot()
    const buffer = base64ToArrayBuffer(base64img)
    const blob = new Blob([buffer], { type: 'image/png' });
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const fileName = `${now}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    result.screenshotProgress = '压缩图片'
    store.updateStatus(clone(result))
    const options = {
      maxSizeMB: 0.7,
      maxWidthOrHeight: 1280,
    };
    const compressedFile = await imageCompression(file, options);
    const bufferCompressed = await compressedFile.arrayBuffer();

    result.screenshotProgress = '保存截图'

    store.updateStatus(clone(result))
    await writeBinaryFile(fileName, bufferCompressed, {
      dir: BaseDirectory.AppConfig
    });
    const appDataDirPath = await appDataDir();
    const path = `${appDataDirPath}/${fileName}`;
    
    const imgFile = await readBinaryFile(path);
    const imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));
    result.path = imgPath
    result.screenshotProgress = '识别文字'

    store.updateStatus(clone(result))
    const worker = await createWorker(['chi_sim', 'eng']);
    const { data } = await worker.recognize(imgFile);

    const content = data.text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');

    result.screenshotProgress = '分析关键词'
    store.updateStatus(clone(result))
    const keywords = await invoke("cut_words", {
      str: content
    }) as string[]
    result.keywords = keywords

    result.screenshotProgress = '提取内容'
    store.updateStatus(clone(result))
    const description = await takeDescription(data.text)
    result.description = description

    const currentTag = storage.get('currentTag')

    result.screenshotProgress = '保存记录'
    store.updateStatus(clone(result))
    await db.marks.add({
      imgPath: path,
      status: true,
      content,
      description,
      tag: currentTag,
      keywords,
      createdAt: new Date().getTime()
    })
    store.complete(id)
    emitter.emit('refresh')
  } catch (error) {
    result.screenshotProgress = '截图失败'
    store.updateStatus(clone(result))
    setTimeout(() => {
      store.complete(id)
    }, 5000);
  }
}

function base64ToArrayBuffer(base64: string) {
  var binary_string = atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
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