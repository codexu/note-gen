<template>
  <MdEditor
    ref="editorRef"
    v-model="article.content"
    @onHtmlChanged="handleChange"
    style="width: 100%; border: none; flex: 1;"
  ></MdEditor>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { MdEditor } from 'md-editor-v3';
import type { ExposeParam } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import useFolderStore from '../../../../stores/folders.ts'
import { storeToRefs } from 'pinia';
import { BaseDirectory, writeTextFile } from '@tauri-apps/api/fs';

const editorRef = ref<ExposeParam>();

const folderStore = useFolderStore()

const { article, activated } = storeToRefs(folderStore)

async function handleChange() {
  await nextTick()
  if (activated.value[0] && article.value.content) {
    await writeTextFile(activated.value[0], article.value.content, { dir: BaseDirectory.AppData })
  }
}

watch(activated, async () => {
  await folderStore.readArticle()
}, {
  immediate: true
})
</script>
