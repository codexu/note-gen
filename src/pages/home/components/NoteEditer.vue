<template>
  <div class="h-12 flex justify-between items-center px-2 bg-gray-50 border-b-thin">
    <v-btn variant="text" prepend-icon="mdi-file-arrow-left-right-outline">生成文章</v-btn>
    <v-switch class="h-14 mr-2" color="primary" />
  </div>
  <section class="relative w-full note-container story-scroll">
    <v-overlay
      :model-value="loading"
      contained
      class="flex align-center justify-center"
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
  </section>
</template>

<script lang=ts setup>
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { MdPreview } from 'md-editor-v3';
import useTabStore from '../../../stores/tab.ts'
import useMarkStore from '../../../stores/marks.ts'
import { db, Note } from '../../../db.ts'
import { getCompletions, type Data } from '../../../api/completions.ts'
import 'md-editor-v3/lib/style.css';

const tabStore = useTabStore()
const markStore = useMarkStore()

const { checked } = storeToRefs(tabStore)
const { marks } = storeToRefs(markStore)

const loading = ref<boolean>(false)
const content = ref<string>('');
const note = ref<Note | undefined>(undefined)

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
      tab: checked.value,
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
  content.value = ''
  const markLastCreatedAt = Math.max(...marks.value.map(item => item.createdAt))
  note.value = await db.notes.where({ tab: checked.value }).first()
  const currentMarks = marks.value.filter(mark => mark.tab === checked.value);
  if (currentMarks.length === 0) {
    loading.value = false
    return
  }
  if (note.value && note.value.createdAt > markLastCreatedAt) {
    content.value = note.value.content
    loading.value = false
  } else {
    createNote()
  }
}

watch(checked, async () => {
  loading.value = true
  getNote()
}, {
  immediate: true
})
</script>

<style lang="scss" scoped>
.note-container{
  height: calc(100vh - 48px);
}
</style>