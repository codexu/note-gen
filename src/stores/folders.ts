import { defineStore } from "pinia";
import { ref } from "vue";
import { BaseDirectory, createDir, exists, FileEntry, readDir, removeDir } from "@tauri-apps/api/fs";
import { ignoreFolders } from '../utils/createDefaultFolder.ts'
import { useLocalStorage } from "@vueuse/core";

export default defineStore('folderStore', () => {
  const loading = ref(false)
  const folders = ref<FileEntry[]>();
  const opened = useLocalStorage('articleTreeOpend', <string[]>[]);

  async function getFolders() {
    folders.value = await readDir('article', { dir: BaseDirectory.AppData, recursive: true });
    processEntries(folders.value)
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

  async function createFolder(name: string) {
    const isExists = await exists(`article/${name}`, { dir: BaseDirectory.AppData })
    if (!isExists) {
      await createDir(`article/${name}`, { dir: BaseDirectory.AppData })
      return true
    }
    return false
  }

  async function deleteFolder(item: FileEntry) {
    const isExists = await exists(item.path, { dir: BaseDirectory.AppData })
    if (isExists) {
      await removeDir(item.path, { dir: BaseDirectory.AppData })
    }
    await getFolders()
  }
  return {
    loading,
    opened,
    folders,
    getFolders,
    createFolder,
    deleteFolder
  }
})