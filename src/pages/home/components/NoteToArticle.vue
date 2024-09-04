<template>
  <v-dialog v-model="isActive" max-width="500">
    <template v-slot:activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        color="surface-variant"
        text="Open Dialog"
        variant="flat"
      ></v-btn>
    </template>

    <template v-slot:default>
      <v-card title="生成文章">
        <v-card-text>
          <div class="text-medium-emphasis mb-4">
            这篇笔记只是一篇空洞的草稿，生成文章去完善它吧！
          </div>
          <v-text-field v-model="note.title" label="标题" required></v-text-field>
          <p class="text-caption text-medium-emphasis">*创建 “{{ note.title }}.md” 文件。</p>
          <p class="text-caption text-medium-emphasis">*生成后将移除对应的 Marks（文章中可查看） 和 Notes。</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            :loading="loading"
            text="生成"
            @click="genArticle"
          ></v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-dialog>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { writeTextFile, BaseDirectory, exists, createDir } from '@tauri-apps/api/fs';
import { db, Note } from '../../../db';
import useMarkStore from '../../../stores/marks.ts';
import { clone } from 'lodash';

console.log(BaseDirectory.AppData);

const emit = defineEmits(['created'])

const markStore = useMarkStore()

const isActive = ref(false)
const loading = ref(false)
const note = ref<Note>({} as Note)

function showDialog(data: Note) {
  isActive.value = true
  note.value = data
}

async function genArticle() {
  loading.value = true
  // 判断是否存在 article 文件夹
  if (!(await exists('article', { dir: BaseDirectory.AppData }))) {
    await createDir('article', { dir: BaseDirectory.AppData })
  }
  const file = `article/${note.value.title}.md`
  await writeTextFile(
    file,
    note.value.content,
    { dir: BaseDirectory.AppData }
  )
  await db.articles.add({
    title: note.value.title,
    file,
    description: '',
    keywords: [],
    markIds: clone(note.value.markIds),
    createdAt: new Date().getTime(),
    updatedAt: new Date().getTime()
  })
  await db.notes.delete(note.value.id)
  for (let index = 0; index < note.value.markIds.length; index++) {
    const markId = note.value.markIds[index];
    await db.marks.update(markId, { status: false })
  }
  await markStore.getMarks(note.value.tab)
  loading.value = false
  isActive.value = false
  emit('created')
}

defineExpose({
  showDialog
})
</script>
