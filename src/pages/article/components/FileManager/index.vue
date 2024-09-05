<template>
  <div class="w-64 h-screen flex flex-col border-e-thin bg-gray-50">
    <div class="flex justify-rounded h-12 items-center bg-gray-100 border-b-thin overflow-hidden relative">
      <FolderAdd />
      <v-icon size="small" class="flex-1 border-e-thin" v-tooltip="'搜索'">mdi-folder-search-outline</v-icon>
      <v-icon size="small" class="flex-1" v-tooltip="'打开文件夹'" @click="openFolder">mdi-folder-open-outline</v-icon>
    </div>
    <FileTree />
  </div>
</template>

<script lang="ts" setup>
import FileTree from './FileTree.vue';
import FolderAdd from './FolderAdd.vue';
import { open } from '@tauri-apps/api/shell';
import { appDataDir } from '@tauri-apps/api/path';

async function openFolder() {
  const dir = await appDataDir();
  console.log(dir);
  await open(`${dir}article`);
}
</script>
