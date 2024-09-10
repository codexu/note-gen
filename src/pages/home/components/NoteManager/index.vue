<template>
  <div class="h-12 flex justify-between items-center px-2 bg-gray-50 border-b-thin">
    <div class="flex-1 flex justify-between">
      <v-btn
        :loading="loading"
        variant="text"
        prepend-icon="mdi-file-document-check-outline"
        :disabled="genDisabled"
        @click="createNote"
      >整理笔记</v-btn>
      <v-btn
        :disabled="!(note && note.content.length)"
        variant="text"
        prepend-icon="mdi-file-export-outline"
        @click="exportArticle"
      >生成文章</v-btn>
    </div>
  </div>
  <section class="relative w-full note-container story-scroll">
    <div class="flex justify-between items-end px-4 mt-3" v-if="!loading && note">
      <p class="text-md font-bold text-gray-700">NOTE</p>
      <span class="text-xs text-gray-400">
        {{note?.title}}，{{ checkTextLength(content) }}字，{{ timeAgo }}
      </span>
    </div>
    <v-skeleton-loader
      v-if="loading"
      class="mx-auto h-full flex items-start"
      type="article"
    ></v-skeleton-loader>
    <MdPreview v-if="!loading" :modelValue="showContent" />
    <Empty v-if="!note" :disabled="genDisabled" />
  </section>
  <NoteToArticle ref="noteToArticleRef" @created="getNote" />
</template>

<script lang=ts setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { MdPreview } from 'md-editor-v3';
import useTabStore from '../../../../stores/tab.ts'
import useMarkStore from '../../../../stores/marks.ts'
import { db, Note } from '../../../../db.ts'
import { getCompletions, type Data } from '../../../../api/completions.ts'
import dayjs from 'dayjs';
import 'md-editor-v3/lib/style.css';
import { isEqual } from 'lodash';
import checkTextLength from '../../../../utils/checkTextLength.ts'
import NoteToArticle from './NoteToArticle.vue';
import Empty from './Empty.vue';
import emitter from '../../../../emitter.ts';

const tabStore = useTabStore()
const markStore = useMarkStore()

const { checked } = storeToRefs(tabStore)
const { enabledMarks } = storeToRefs(markStore)

const loading = ref<boolean>(false)
const content = ref<string>('');
const note = ref<Note | undefined>(undefined)

// 读取 note
async function getNote() {
  content.value = ''
  note.value = await db.notes.where({ tab: checked.value }).first()
  content.value = note.value?.content || ''
  loading.value = note.value?.generating || false
}

emitter.on('reloadNote', getNote)

const genDisabled = computed(() => {
  const marksIds = enabledMarks.value.map(item => item.id)
  const noteMarksId = note.value ? [...note.value?.markIds] : []
  return loading.value || isEqual(marksIds, noteMarksId)
})

const timeAgo = computed(() => {
  return dayjs(note.value?.createdAt).fromNow()
})

async function createNote() {
  loading.value = true
  content.value = ''
  const markIds = enabledMarks.value.map(item => item.id)
  // 创建笔记
  if (!note.value) {
    const id = await db.notes.add({
      title: '',
      content: content.value,
      markIds,
      generating: true,
      tab: checked.value,
      createdAt: new Date().getTime()
    })
    note.value = await db.notes.get(id)
  }

  const screenshotMarks = enabledMarks.value.filter(item => item.type === 'screenshot')
  const textMarks = enabledMarks.value.filter(item => item.type === 'text')
  const imageMarks = enabledMarks.value.filter(item => item.type === 'image')
  const request_content = `
    以下是通过截图后，使用OCR识别出的文字片段：
    ${screenshotMarks.map(item => item.content).join(';\n\n')}。
    以下是通过文本复制记录的片段：
    ${textMarks.map(item => item.content).join(';\n\n')}。
    以下是通过图片复制记录的片段描述：
    ${imageMarks.map(item => `
      描述：${item.description}，
      图片地址：${item.imgPath}
    `).join(';\n\n')}。

    请将这些片段整理成一篇详细完整的笔记，要满足以下要求：
    - 使用 Markdown 语法。
    - 请使用中文。
    - 如果是代码，必须完整保留，不要随意生成。
    - 笔记片段可能缺失，内容要补全。
    - 根据笔记内容，延伸出扩展知识。
    - 笔记顺序可能是错误的，要按照正确顺序排列。
    - 文字复制的内容尽量不要修改，只处理格式化后的内容。
    - 你通过图片记录的描述，尽量将图片地址链接到笔记中的匹配位置上，不明确的图片放在文章最后。
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
  if (note.value) {
    await db.notes.update(note.value.id, { generating: true })
  }
  getCompletions(data).then(async (res) => {
    content.value = res.data.choices[0].message.content
    await saveNote()
    loading.value = false
  })
}

const showContent = computed(() => {
  return content.value = content.value.replace(/^# (.*)$/m, '')
})

async function saveNote() {
  const markIds = enabledMarks.value.map(item => item.id)
  const title = (content.value.match(/^# (.*)$/m) as string[])[1]
  if (note.value) {
    await db.notes.update(note.value.id, {
      title,
      content: content.value,
      generating: false,
      markIds,
      createdAt: new Date().getTime()
    })
    getNote()
  }
}

const noteToArticleRef = ref<InstanceType<typeof NoteToArticle> | null>(null)
function exportArticle() {
  noteToArticleRef.value?.showDialog(note.value!)
}

watch(checked, async () => {
  await getNote()
}, { immediate: true })
</script>

<style lang="scss" scoped>
.note-container{
  height: calc(100vh - 48px);
}
:deep() {
  .md-editor-preview-wrapper{
    padding-top: 0;
  }
}
</style>