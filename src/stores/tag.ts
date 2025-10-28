import { Tag, delTag, getTags, insertTags, deleteAllTags } from '@/db/tags'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github'
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee'
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab'
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

interface TagState {
  currentTagId: number
  setCurrentTagId: (id: number) => Promise<void>
  initTags: () => Promise<void>

  currentTag?: Tag
  getCurrentTag: () => void

  tags: Tag[]
  fetchTags: () => Promise<void>

  deleteTag: (id: number) => Promise<void>

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadTags: () => Promise<boolean>
  downloadTags: () => Promise<Tag[]>
}

const useTagStore = create<TagState>((set, get) => ({
  // 当前选择的 tag
  currentTagId: 1,
  setCurrentTagId: async(currentTagId: number) => {
    set({ currentTagId })
    const store = await Store.load('store.json');
    await store.set('currentTagId', currentTagId)
  },
  initTags: async () => {
    const store = await Store.load('store.json');
    const currentTagId = await store.get<number>('currentTagId')
    if (currentTagId) set({ currentTagId })
    get().getCurrentTag()
  },

  currentTag: undefined,
  getCurrentTag: () => {
    const tags = get().tags
    const getcurrentTagId = get().currentTagId
    const currentTag = tags.find((tag) => tag.id === getcurrentTagId)
    if (currentTag) {
      set({ currentTag })
    }
  },

  // 所有 tag
  tags: [],
  fetchTags: async () => {
    const tags = await getTags()
    set({ tags })
  },

  deleteTag: async (id: number) => {
    await delTag(id)
    await get().fetchTags()
    await get().setCurrentTagId(get().tags[0].id)
  },

  // 同步
  syncState: false,
  setSyncState: (syncState) => {
    set({ syncState })
  },
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => {
    set({ lastSyncTime })
  },
  uploadTags: async () => {
    set({ syncState: true })
    const path = '.data'
    const filename = 'tags.json'
    const tags = await getTags()
    const store = await Store.load('store.json');
    const jsonToBase64 = (data: Tag[]) => {
      return Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    }
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = false
    let res;
    let files: any;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo })
        res = await uploadGithubFile({
          ext: 'json',
          file: jsonToBase64(tags),
          repo: githubRepo,
          path,
          filename,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo })
        res = await uploadGiteeFile({
          ext: 'json',
          file: jsonToBase64(tags),
          repo: giteeRepo,
          path,
          filename,
          sha: files?.sha,
        })
        break;
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        files = await gitlabGetFiles({ path, repo: gitlabRepo })
        const tagFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGitlabFile({
          ext: 'json',
          file: jsonToBase64(tags),
          repo: gitlabRepo,
          path,
          filename,
          sha: tagFile?.sha || '',
        })
        break;
      case 'gitea':
        const giteaRepo = await getSyncRepoName('gitea')
        files = await giteaGetFiles({ path, repo: giteaRepo })
        const giteaTagFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGiteaFile({
          ext: 'json',
          file: jsonToBase64(tags),
          repo: giteaRepo,
          path,
          filename,
          sha: giteaTagFile?.sha || '',
        })
        break;
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
  },
  downloadTags: async () => {
    const path = '.data'
    const filename = 'tags.json'
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = []
    let files;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo })
        break;
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo })
        break;
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepo })
        break;
      case 'gitea':
        const giteaRepo2 = await getSyncRepoName('gitea')
        files = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepo2 })
        break;
    }
    if (files) {
      const configJson = decodeBase64ToString(files.content)
      result = JSON.parse(configJson)
    }
    await deleteAllTags()
    await insertTags(result)
    set({ syncState: false })
    return result
  },
}))

export default useTagStore