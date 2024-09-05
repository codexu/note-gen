<template>
  <div class="h-12 flex justify-between items-center pr-2 bg-gray-50 border-b-thin">
    <div class="flex-1 flex justify-between items-center">
      <div class="flex-1">
        <input
          @change="handleRename"
          v-model="article.title"
          class="min-w-[600px] outline-none px-4 font-bold text-md"
        ></input>
      </div>
      <div>
        <v-btn
          variant="text"
          prepend-icon="mdi-cloud-upload-outline"
        >发布</v-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import { renameFile } from '@tauri-apps/api/fs';
import useFolderStore from '../../../../stores/folders.ts'
const folderStore = useFolderStore()

const { article, activated } = storeToRefs(folderStore)

async function handleRename() {
  if (article.value.title) {
    const path = article.value.path.split('/').slice(0, -1).join('/') + `/${article.value.title}.md`
    activated.value[0] = path
    await renameFile(article.value.path, path)
    await folderStore.getFolders()
  }
}
</script>

<style lang="scss" scoped>
:deep() {
  .v-input{
    height: 48px;
  }
}
</style>
