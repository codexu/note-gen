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
            AI 已经帮你整理一篇笔记。
          </div>
          <v-text-field v-model="note.title" label="标题" required></v-text-field>
          <FolderSelect v-model="folder" />
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
import FolderSelect from '../../../components/FolderSelect.vue';
import { useRouter } from 'vue-router';
import { appDataDir } from '@tauri-apps/api/path';
import useFolderStore from '../../../stores/folders.ts';
import { storeToRefs } from 'pinia';

const router = useRouter()
const emit = defineEmits(['created'])
const folderStore = useFolderStore()

const { activated } = storeToRefs(folderStore)

const markStore = useMarkStore()

const isActive = ref(false)
const loading = ref(false)
const note = ref<Note>({} as Note)
const folder = ref('默认文件夹')

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
  const file = `article/${folder.value}/${note.value.title}.md`
  await writeTextFile(
    file,
    note.value.content,
    { dir: BaseDirectory.AppData }
  )
  for (let index = 0; index < note.value.markIds.length; index++) {
    const markId = note.value.markIds[index];
    console.log(markId);
    await db.marks.update(markId, { deleted: true })
  }
  await markStore.getMarks(note.value.tab)
  await db.notes.delete(note.value.id)
  loading.value = false
  isActive.value = false
  await folderStore.getFolders()
  const appDataDirPath = await appDataDir()
  activated.value[0] = `${appDataDirPath}${file}`
  router.push({
    name: 'article',
  })
  emit('created')
}

defineExpose({
  showDialog
})
</script>
