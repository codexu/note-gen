<template>
  <section>
    <div v-for="(item, index) in notes" :key="index">
      <img class="image" :src="item.imgPath" />
      <p>{{ item.content }}</p>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { db, type Note } from '../db.ts'
import store from 'store'
import emitter from '../emitter.ts'
import { readBinaryFile } from '@tauri-apps/api/fs'

const notes = ref<Note[]>()

async function getNotes() {
  const currentTag = store.get('currentTag') as string;
  const result = await db.notes.where({ tag: currentTag }).toArray()
  notes.value = await Promise.all(result.map(async (note) => {
    // 生成图片 URL
    // 获取图片
    console.log(note.imgPath);
    const imgFile = await readBinaryFile(note.imgPath);
    console.log(imgFile);
    const imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));

    return {
      ...note,
      imgPath: imgPath
    }
  }))
}

emitter.on('refresh', getNotes)

onMounted(async () => {
  await getNotes()
})
</script>
