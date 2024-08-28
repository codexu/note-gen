<template>
  <v-overlay
    :model-value="loading"
    persistent
    class="flex align-center justify-center translate-y-16"
  >
    <div class="flex flex-col items-center">
      <v-progress-circular
        color="primary"
        size="64"
        indeterminate
      ></v-progress-circular>
      <v-chip variant="elevated" class="mt-4">整理笔记中...</v-chip>
    </div>
  </v-overlay>
  <MdPreview v-show="!loading" :modelValue="content" />
</template>

<script lang=ts setup>
import { onMounted, ref } from 'vue';
import { db, Mark, Note } from '../../../db.ts'
import store from 'store'
import { getCompletions, type Data } from '../../../api/completions.ts'
import { MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const loading = ref<boolean>(false)
const content = ref<string>('');
const currentTab = store.get('currentTab');
const marks = ref<Mark[]>([])
const note = ref<Note | undefined>(undefined)

async function getMarks() {
  return await db.marks.where({ tab: currentTab }).toArray()
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
      tab: currentTab,
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
  note.value = await db.notes.where({ tab: currentTab }).first()
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
  height: calc(100vh - 64px);
  margin-top: 64px;
}
</style>