<template>
  <v-autocomplete
    v-model="modelValue"
    @update:search="handleSearch"
    label="目录"
    item-title="name"
    item-value="name"
    no-data-text="暂无目录"
    :items="entries"
  >
    <template v-slot:no-data>
      <div class="flex">
        <v-btn
          @click="createFolder"
          size="large"
          block
          variant="plain"
          prepend-icon="mdi-folder-plus"
        >
          创建“{{ folder }}”
        </v-btn>
      </div>
    </template>
  </v-autocomplete>
</template>

<script lang="ts" setup>
import { readDir, BaseDirectory, FileEntry, createDir } from '@tauri-apps/api/fs';
import { onMounted, ref } from 'vue';
import { ignoreFolders } from '../utils/createDefaultFolder.ts'

const modelValue = defineModel<string>()

const folder = ref<string>('');
const entries = ref<FileEntry[]>();

async function getFolders() {
  const res = await readDir('article', { dir: BaseDirectory.AppData, recursive: true });
  entries.value = res.map(item => ({
    name: item.name,
    path: item.path
  })).filter(item => !ignoreFolders.includes(item.name || ''))
}

onMounted(async () => {
  getFolders()
})

function handleSearch(value: string) {
  folder.value = value
}

async function createFolder() {
  await createDir(`article/${folder.value}`, { dir: BaseDirectory.AppData })
  await getFolders()
  modelValue.value = folder.value
}
</script>

<style lang="scss" scoped>

</style>
