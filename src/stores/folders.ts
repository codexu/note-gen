import { defineStore } from "pinia";
import { nextTick, ref, watch } from "vue";
import { BaseDirectory, createDir, exists, FileEntry, readDir, readTextFile, removeDir, removeFile } from "@tauri-apps/api/fs";
import { ignoreFolders } from '../utils/createDefaultFolder.ts'
import { useLocalStorage } from "@vueuse/core";

export default defineStore('folderStore', () => {
  const loading = ref(false)
  const folders = ref<FileEntry[]>();
  const opened = useLocalStorage('articleTreeOpend', <string[]>[]);
  const activated = useLocalStorage('articleTreeSelected', <string[]>[]);

  const article = ref({
    title: '',
    content: '',
    path: '',
  })

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

  function resetArticle() {
    article.value.title = ''
    article.value.content = ''
    article.value.path = ''
  }

  async function deleteFile(item: FileEntry) {
    const isExists = await exists(item.path, { dir: BaseDirectory.AppData })
    if (isExists) {
      await removeFile(item.path, { dir: BaseDirectory.AppData })
    }
    await getFolders()
    activated.value[0] = ''
    resetArticle()
  }

  async function readArticle() {
    await nextTick()
    resetArticle()
    console.log(article.value.content);
    const path = activated.value[0]
    if (path) {
      loading.value = true
      article.value.title = path.split('/').pop()?.split('.')[0] || ''
      article.value.content = await readTextFile(path, { dir: BaseDirectory.AppData })
      article.value.path = path
      await getFolders()
      loading.value = false
    }
  }

  return {
    loading,
    opened,
    activated,
    article,
    folders,
    getFolders,
    createFolder,
    deleteFolder,
    deleteFile,
    readArticle
  }
})