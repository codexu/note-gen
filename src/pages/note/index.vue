<template>
  <section class="h-screen flex justify-center items-center">
    <a-spin v-if="loading" size="large" :spinning="loading" tip="笔记整理中..." />
    <div v-else>
      <header class="h-12 w-full px-4 flex justify-between items-center">
        <a-button size="small" @click="router.back()">返回</a-button>
      </header>
      <MdEditor :height="1000" v-model="note" />
    </div>
  </section>
</template>

<script lang=ts setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { db } from '../../db.ts'
import store from 'store'
import { getCompletions, type Data } from '../../api/completions.ts'
import { MdEditor } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const router = useRouter()
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
    ${remarks.map(item => item.content).join(';\n\n')}。
    我还提取了这些笔记的关键词：
    ${remarks.map(item => item.keywords.join(',')).join(';\n\n')}。
    请将这些片段整理成一篇详细完整的笔记，要求返回格式：
    - 使用 Markdown 语法。
    - 请使用中文。
    - 笔记的内容有限，请尽量补充内容。
    - 参考资料（带链接，最好是中文网站）
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
  height: calc(100vh - 48px)
}
</style>