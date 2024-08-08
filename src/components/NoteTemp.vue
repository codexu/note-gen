<template>
  <section class="w-full">
    <template v-for="(item, index) in remarks" :key="index">
      <a-divider>{{ dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss') }}</a-divider>
      <div class="flex w-full py-4 border-b border-gray-300">
        <div class="mr-4 min-h-24">
          <a-image :width="200" :src="item.imgPath" />
        </div>
        <div>
          <p>{{ item.content }}</p>
          <a-button danger @click="deleteNote(item)" :icon="h(DeleteOutlined)"></a-button>
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { onMounted, ref, h } from 'vue';
import { DeleteOutlined } from '@ant-design/icons-vue';
import { db, type Note } from '../db.ts'
import store from 'store'
import emitter from '../emitter.ts'
import { readBinaryFile } from '@tauri-apps/api/fs'
import dayjs from 'dayjs';

const remarks = ref<Note[]>()

async function getRemarks() {
  const currentTag = store.get('currentTag') as string;
  const result = await db.remarks.where({ tag: currentTag }).toArray()
  remarks.value = await Promise.all(result.map(async (note) => {
    const imgFile = await readBinaryFile(note.imgPath);
    const imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));
    return {
      ...note,
      imgPath: imgPath
    }
  }))
}

emitter.on('refresh', getRemarks)

onMounted(async () => {
  await getRemarks()
})

// 删除记录
async function deleteNote(note: Note) {
  await db.remarks.delete(note.id)
  emitter.emit('refresh')
}
</script>
