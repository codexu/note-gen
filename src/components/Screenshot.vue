<template>
  <a-button type="primary" @click="screenshot" :icon="h(EditOutlined)">记录</a-button>
</template>

<script setup lang="ts">
import { EditOutlined } from '@ant-design/icons-vue';
import { invoke } from "@tauri-apps/api/tauri";
import { register } from '@tauri-apps/api/globalShortcut';
import { onMounted, h } from "vue";
import store from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';
import { createWorker } from 'tesseract.js';
import { readBinaryFile } from '@tauri-apps/api/fs'

async function screenshot() {
  const screenshotPath = await invoke("screenshot") as string;
  const imgFile = await readBinaryFile(screenshotPath);
  // 识别图片
  const worker = await createWorker(['chi_sim', 'eng']);
  const { data } = await worker.recognize(imgFile);

  data.text = data.text.replace(/\s+/g, '');

  const keywords = await invoke("cut_words", {
    str: data.text
  }) as string[]

  const currentTag = store.get('currentTag')

  await db.marks.add({
    imgPath: screenshotPath as string,
    content: data.text,
    tag: currentTag,
    keywords,
    createdAt: new Date().getTime()
  })

  emitter.emit('refresh')
}

onMounted(async () => {
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
