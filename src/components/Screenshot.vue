<template>
  <div>
    <img class="image" :src="url" alt="" />
    <p>{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/tauri";
import { register } from '@tauri-apps/api/globalShortcut';
import { readBinaryFile } from "@tauri-apps/api/fs";
import { onMounted, ref } from "vue";
import { createWorker } from 'tesseract.js';

const url = ref("");
const text = ref('')

async function screenshot() {
  const screenshotPath = await invoke("screenshot");
  // 读取文件
  const buffer = await readBinaryFile(screenshotPath as string);
  const blob = new Blob([buffer], {
    type: "image/png",
  });
  url.value = URL.createObjectURL(blob);

  const worker = await createWorker(['chi_sim', 'eng']);
  const ret = await worker.recognize(blob);

  text.value = ret.data.text;
}

// onMounted(async () => {
//   await register('Shift+B', () => {
//     screenshot();
//   });
// })
</script>

<style scoped>
.image {
  width: 300px;
}
</style>
