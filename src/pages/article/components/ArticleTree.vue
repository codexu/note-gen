<template>
  <div class="flex-1">
    <v-treeview
      :items="entries"
      v-model:opened="opened"
      item-title="name"
      item-value="path"
      density="compact"
      open-on-click
      activatable
    >
      <template v-slot:prepend="{ item, isOpen }">
        <v-icon v-if="item.children && item.children.length" class="scale-75">
          {{ isOpen ? 'mdi-folder-open-outline' : 'mdi-folder-outline' }}
        </v-icon>
        <v-icon v-else-if="item.children" class="scale-75">
          mdi-folder-hidden
        </v-icon>
        <v-icon v-else class="scale-75">
          mdi-language-markdown
        </v-icon>
      </template>
      <template v-slot:append="{ item }">
        <v-icon class="scale-75 hidden" @click="deleteFolder(item)">
          mdi-close
        </v-icon>
      </template>
    </v-treeview>
  </div>
</template>

<script lang="ts" setup>
import { readDir, BaseDirectory, FileEntry, removeDir, exists } from '@tauri-apps/api/fs';
import { useLocalStorage } from '@vueuse/core';
import { onMounted, ref } from 'vue';
import { VTreeview } from 'vuetify/labs/VTreeview'
import { ignoreFolders } from '../../../utils/createDefaultFolder.ts'

const opened = useLocalStorage('articleTreeOpend', <string[]>[]);
const entries = ref<FileEntry[]>();

async function getFolders() {
  entries.value = await readDir('article', { dir: BaseDirectory.AppData, recursive: true });
  processEntries(entries.value)
}

function processEntries(entries: FileEntry[]) {
  entries.forEach((entry, index) => {
    if (entry.name && ignoreFolders.includes(entry.name)) {
      entries.splice(index, 1)
    }
    if (entry.children) {
      processEntries(entry.children)
    }
  })
}

async function deleteFolder(item: FileEntry) {
  const isExists = await exists(item.path, { dir: BaseDirectory.AppData })
  if (isExists) {
    await removeDir(item.path, { dir: BaseDirectory.AppData })
  }
  await getFolders()
}

onMounted(async() => {
  getFolders()
})

</script>

<style lang="scss" scoped>
:deep() {
  .v-list{
    padding: 0 !important;
    background: transparent;
  }
  .v-list-item{
    padding: 0 !important;
    padding-left: 8px !important;
    min-height: 32px !important;
  }
  .v-list-item-title{
    @apply text-sm;
  }
  .v-list-item-action{
    display: none;
  }
  .v-treeview-group.v-list-group .v-list-group__items .v-list-item{
    padding-inline-start: calc(0px + var(--indent-padding)) !important;
  }
  .v-list-item__prepend{
    width: 26px;
  }
  .v-list-item__append{
    margin-right: 4px;
  }
  .v-list-item{
    &:hover{
      .v-list-item__append .v-icon {
        display: block;
      }
    }
  }
}
</style>
