<template>
  <a-button type="primary" @click="screenshot" :icon="h(EditOutlined)">记录</a-button>
</template>

<script setup lang="ts">
import { EditOutlined } from '@ant-design/icons-vue';
import { invoke } from "@tauri-apps/api/tauri";
import { register } from '@tauri-apps/api/globalShortcut';
import { onMounted, h } from "vue";
import storage from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';
import { createWorker } from 'tesseract.js';
import { readBinaryFile, copyFile, BaseDirectory, exists, createDir } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'
import { appDataDir } from '@tauri-apps/api/path';
import dayjs from 'dayjs';
import useStore from '../store.ts'

const store = useStore()

async function screenshot() {
  store.screenshotStatus = true
  store.screenshotProgress = '正在截图'
  try {
    const screenshotPath = await invoke("screenshot") as string;
    store.screenshotProgress = '正在保存截图'
    const appDataDirPath = await appDataDir();
    if (!await exists(appDataDirPath, { dir: BaseDirectory.AppConfig })) {
      await createDir(appDataDirPath, { dir: BaseDirectory.AppConfig });
    }
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const fileName = `${now}.png`;
    const path = `${appDataDirPath}/${now}.png`;
    await copyFile(screenshotPath, fileName, { dir: BaseDirectory.AppConfig });

    store.screenshotProgress = '正在 OCR 识别文字'
    const imgFile = await readBinaryFile(path);
    // 识别图片
    const worker = await createWorker(['chi_sim', 'eng']);
    const { data } = await worker.recognize(imgFile);

    data.text = data.text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');

    store.screenshotProgress = '正在分析关键词'
    const keywords = await invoke("cut_words", {
      str: data.text
    }) as string[]

    const currentTag = storage.get('currentTag')

    store.screenshotProgress = '正在保存记录'
    await db.marks.add({
      imgPath: screenshotPath as string,
      content: data.text,
      tag: currentTag,
      keywords,
      createdAt: new Date().getTime()
    })

    emitter.emit('refresh')

    store.screenshotStatus = false
    store.screenshotProgress = ''
  } catch (error) {
    store.screenshotStatus = false
    store.screenshotProgress = ''
  }
}

onMounted(async () => {
  await listen('left_click', () => {
    screenshot()
  });
  await register('CommandOrControl+Shift+C', () => {
    screenshot();
  });
})
</script>

<style scoped>
.image {
  width: 300px;
}
</style>
