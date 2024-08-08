<template>
  <section class="h-screen flex justify-center items-center">
    <MdEditor v-show="!loading" :height="1000" v-model="note" />
    <a-spin v-show="loading" size="large" :spinning="loading" tip="笔记整理中..." />
  </section>
</template>

<script lang=ts setup>
import { onMounted, ref } from 'vue';
import { db } from '../../db.ts'
import store from 'store'
import { getCompletions, type Data } from '../../api/completions.ts'
import { MdEditor } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const loading = ref<boolean>(false)
const note = ref<string>('');

async function getRemarks() {
  const currentTag = store.get('currentTag') as string;
  return await db.remarks.where({ tag: currentTag }).toArray()
}

onMounted(async() => {
  loading.value = true
  const remarks = await getRemarks()
  const content = `
    以下是我记录的一些笔记片段：
    ${remarks.map(item => item.content).join(';\n\n')}
    请将这些片段整理成一篇详细完整的笔记，要求返回格式：
    - 使用 Markdown 语法
    - 每个片段之间使用空行分隔
    - 请使用中文
  `
  const data: Data = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content,
      },
    ]
  }
  getCompletions(data).then(res => {
    note.value = res.data.choices[0].message.content
  }).finally(() => {
    loading.value = false
  })
})
</script>

<style scoped>
.md-editor{
  height: 100vh;
}
</style>