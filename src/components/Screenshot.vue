<template>
  <a-button type="primary" @click="screenshot" :icon="h(EditOutlined)">记录</a-button>
</template>

<script setup lang="ts">
import { EditOutlined } from '@ant-design/icons-vue';
import { invoke } from "@tauri-apps/api/tauri";
import { onMounted, h } from "vue";
import storage from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';
import { createWorker } from 'tesseract.js';
import { readBinaryFile, BaseDirectory, writeBinaryFile } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'
import { appDataDir } from '@tauri-apps/api/path';
import dayjs from 'dayjs';
import imageCompression from 'browser-image-compression';
import useStore from '../store.ts'
import { Data, getCompletions } from '../api/completions.ts';
import { v4 as uuidv4 } from 'uuid';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';

const store = useStore()

async function screenshot() {

  const id = uuidv4()

  store.screenshotList.push({
    id,
    screenshotStatus: true,
    screenshotProgress: '截图'
  })

  try {
    const base64img = await invoke("screenshot") as string;
    await notificationScreenshot()
    const buffer = base64ToArrayBuffer(base64img)
    const blob = new Blob([buffer], { type: 'image/png' });
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const fileName = `${now}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });
    
    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '压缩截图' })
    const options = {
      maxSizeMB: 0.7,
      maxWidthOrHeight: 1280,
    };
    const compressedFile = await imageCompression(file, options);
    const bufferCompressed = await compressedFile.arrayBuffer();

    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '保存截图' })
    await writeBinaryFile(fileName, bufferCompressed, {
      dir: BaseDirectory.AppConfig
    });
    const appDataDirPath = await appDataDir();
   
    const path = `${appDataDirPath}/${fileName}`;

    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '识别文字' })
    const imgFile = await readBinaryFile(path);
    // 识别图片
    const worker = await createWorker(['chi_sim', 'eng']);
    const { data } = await worker.recognize(imgFile);

    data.text = data.text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');

    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '提取内容' })
    const content = await takeContent(data.text)

    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '分析关键词' })
    const keywords = await invoke("cut_words", {
      str: content
    }) as string[]

    const currentTag = storage.get('currentTag')

    store.updateStatus({id, screenshotStatus: true, screenshotProgress: '保存记录' })
    await db.marks.add({
      imgPath: path,
      content: content,
      tag: currentTag,
      keywords,
      createdAt: new Date().getTime()
    })
    store.complete(id)
    emitter.emit('refresh')
  } catch (error) {
    store.updateStatus({id, screenshotStatus: false, screenshotProgress: '截图失败' })
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
async function takeContent(content: string) {
  const request_content = `
    以下是截图后使用 OCR 识别出的文字，该截图是整个屏幕的截图，识别后的内容为：${content}。
    - 提取截图中的核心内容，剔除无关内容，（无关内容可能包括系统软件界面上的文字、网页导航栏中的文字等）。
    - 以“content”作为开头。
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
  return result.slice(8, result.length)
}

// 截图完成通知
async function notificationScreenshot() {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }
  if (permissionGranted) {
    sendNotification({ title: '记点儿', body: '截图成功' });
  }
}

onMounted(async () => {
  await listen('left_click', () => {
    screenshot()
  });
})
</script>

<style scoped>
.image {
  width: 300px;
}
</style>
