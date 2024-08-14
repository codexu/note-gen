<template>
  <section class="h-screen flex justify-center items-center">
    <a-spin v-if="loading" size="large" :spinning="loading" tip="笔记整理中..." />
    <div v-else>
      <header class="h-12 w-full px-4 flex justify-between items-center">
        <a-button size="small" @click="router.back()">返回</a-button>
      </header>
      <MdEditor :height="1000" v-model="content" />
    </div>
  </section>
</template>

<script lang=ts setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { db, Mark, Note } from '../../db.ts'
import store from 'store'
import { getCompletions, type Data } from '../../api/completions.ts'
import { MdEditor } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const router = useRouter()
const loading = ref<boolean>(false)
const content = ref<string>('');
const currentTag = store.get('currentTag') as string;
const marks = ref<Mark[]>([])
const note = ref<Note | undefined>(undefined)

async function getMarks() {
  return await db.marks.where({ tag: currentTag }).toArray()
}

function saveNote() {
  const markIds = marks.value.map(item => item.id)
  const title = (content.value.match(/^# (.*)$/m) as string[])[1]
  if (note.value) {
    db.notes.update(note.value.id, {
      title,
      content: content.value,
      markIds,
      createdAt: new Date().getTime()
    })
  } else {
    db.notes.add({
      title,
      content: content.value,
      markIds,
      tag: currentTag,
      createdAt: new Date().getTime()
    })
  }
}

function createNote() {
  const request_content = `
    以下是我记录的一些笔记片段：
    ${marks.value.map(item => item.content).join(';\n\n')}。
    我还提取了这些笔记的关键词：
    ${marks.value.map(item => item.keywords.join(',')).join(';\n\n')}。
    请将这些片段整理成一篇详细完整的笔记，要满足以下要求：
    - 使用 Markdown 语法。
    - 请使用中文。
    - 如果是代码，必须完整保留，不要随意生成。
    - 笔记片段可能缺失，内容要补全。
    - 根据笔记内容，延伸出扩展知识。
    - 笔记顺序可能是错误的，要按照正确顺序排列。
    - 参考资料（带链接，最好是中文网站）
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
  getCompletions(data).then(res => {
    content.value = res.data.choices[0].message.content
    saveNote()
  }).finally(() => {
    loading.value = false
  })
}

async function getNote() {
  const markLastCreatedAt = Math.max(...marks.value.map(item => item.createdAt))
  note.value = await db.notes.where({ tag: currentTag }).first()
  if (note.value && note.value.createdAt > markLastCreatedAt) {
    content.value = note.value.content
    loading.value = false
  } else {
    createNote()
  }
}

onMounted(async() => {
  loading.value = true
  marks.value = await getMarks()
  getNote()
})
</script>

<style scoped>
.md-editor{
  height: calc(100vh - 48px)
}
</style>