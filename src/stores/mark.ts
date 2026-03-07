import { deleteAllMarks, getAllMarks, getMarks, insertMarks, Mark, updateMark } from '@/db/marks'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { WebDAVConfig } from '@/types/sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand'
import { S3Config } from '@/types/sync'

export interface MarkQueue {
  queueId: string
  tagId: number
  type: Mark["type"]
  progress: string
  startTime: number
}

interface MarkState {
  trashState: boolean
  setTrashState: (flag: boolean) => void

  marks: Mark[]
  updateMark: (mark: Mark) => Promise<void>
  setMarks: (marks: Mark[]) => void
  fetchMarks: () => Promise<void>
  fetchAllTrashMarks: () => Promise<void>

  allMarks: Mark[]
  fetchAllMarks: () => Promise<void>

  queues: MarkQueue[]
  addQueue: (mark: MarkQueue) => void
  setQueue: (queueId: string, mark: Partial<MarkQueue>) => void
  removeQueue: (queueId: string) => void

  // 多选状态
  selectedMarkIds: Set<number>
  setSelectedMarkIds: (ids: Set<number>) => void
  toggleMarkSelection: (id: number) => void
  clearSelection: () => void
  selectAll: () => void
  isMultiSelectMode: boolean
  setMultiSelectMode: (mode: boolean) => void

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadMarks: () => Promise<boolean>
  downloadMarks: () => Promise<Mark[]>
}

const useMarkStore = create<MarkState>((set, get) => ({
  trashState: false,
  setTrashState: (flag) => {
    set({ trashState: flag })
  },

  marks: [],
  updateMark: async (mark) => {
    set((state) => {
      return {
        marks: state.marks.map(item => {
          if (item.id === mark.id) {
            return {
              ...item,
              ...mark
            }
          }
          return item
        })
      }
    })
    await updateMark(mark)
  },
  setMarks: (marks) => {
    set({ marks })
  },
  fetchMarks: async () => {
    const store = await Store.load('store.json');
    const currentTagId = await store.get<number>('currentTagId')
    if (!currentTagId) {
      return
    }
    const res = await getMarks(currentTagId)
    const decodeRes = res.map(item => {
      return {
        ...item,
        content: item.content || ''
      }
    }).filter((item) => item.deleted === 0)
    set({ marks: decodeRes })
  },
  fetchAllTrashMarks: async () => {
    const res = await getAllMarks()
    const decodeRes = res.map(item => {
      return {
        ...item,
        content: item.content || ''
      }
    }).filter((item) => item.deleted === 1)
    set({ marks: decodeRes })
  },

  allMarks: [],
  fetchAllMarks: async () => {
    const res = await getAllMarks()
    const decodeRes = res.map(item => {
      return {
        ...item,
        content: item.content || ''
      }
    }).filter((item) => item.deleted === 0)
    set({ allMarks: decodeRes })
  },

  queues: [],
  addQueue: (mark) => {
    set((state) => {
      return {
        queues: [mark, ...state.queues]
      }
    })
  },
  setQueue: (queueId, mark) => {
    set((state) => {
      return {
        queues: state.queues.map(item => {
          if (item.queueId === queueId) {
            return {
              ...item,
              ...mark
            }
          }
          return item
        })
      }
    })
  },
  removeQueue: (queueId) => {
    set((state) => {
      return {
        queues: state.queues.filter(item => item.queueId !== queueId)
      }
    })
  },

  // 多选状态
  selectedMarkIds: new Set<number>(),
  setSelectedMarkIds: (ids) => {
    set({ selectedMarkIds: ids })
  },
  toggleMarkSelection: (id) => {
    set((state) => {
      const newSelectedIds = new Set(state.selectedMarkIds)
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id)
      } else {
        newSelectedIds.add(id)
      }
      return { selectedMarkIds: newSelectedIds }
    })
  },
  clearSelection: () => {
    set({ selectedMarkIds: new Set<number>(), isMultiSelectMode: false })
  },
  selectAll: () => {
    const { marks } = get()
    const allIds = new Set(marks.map(mark => mark.id))
    set({ selectedMarkIds: allIds, isMultiSelectMode: true })
  },
  isMultiSelectMode: false,
  setMultiSelectMode: (mode) => {
    set({ isMultiSelectMode: mode })
    if (!mode) {
      set({ selectedMarkIds: new Set<number>() })
    }
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
  uploadMarks: async () => {
    set({ syncState: true })
    const path = '.data'
    const filename = 'marks.json'
    const marks = await getAllMarks()
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = false
    let files: any;
    let res;
    const fullPath = `${path}/${filename}`;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepoName = await getSyncRepoName('github')
        files = await githubGetFiles({ path: fullPath, repo: githubRepoName })
        res = await uploadGithubFile({
          file: JSON.stringify(marks),
          repo: githubRepoName,
          path: fullPath,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        const giteeRepoName = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: fullPath, repo: giteeRepoName })
        res = await uploadGiteeFile({
          file: JSON.stringify(marks),
          repo: giteeRepoName,
          path: fullPath,
          sha: files?.sha,
        })
        if (res) {
          result = true
        }
        break;
      case 'gitlab':
        const gitlabRepoName = await getSyncRepoName('gitlab')
        files = await gitlabGetFiles({ path, repo: gitlabRepoName })
        const markFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGitlabFile({
          file: JSON.stringify(marks),
          repo: gitlabRepoName,
          path,
          filename,
          sha: markFile?.sha || '',
        })
        break;
      case 'gitea':
        const giteaRepoName = await getSyncRepoName('gitea')
        files = await giteaGetFiles({ path, repo: giteaRepoName })
        const giteaMarkFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGiteaFile({
          file: JSON.stringify(marks),
          repo: giteaRepoName,
          path,
          filename,
          sha: giteaMarkFile?.sha || '',
        })
        break;
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const existingFile = await s3HeadObject(s3Config, s3Key)
          if (existingFile) {
            await s3Delete(s3Config, s3Key)
          }
          res = await s3Upload(s3Config, s3Key, JSON.stringify(marks))
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const existingFile = await webdavHeadObject(webdavConfig, webdavKey)
          if (existingFile) {
            await webdavDelete(webdavConfig, webdavKey)
          }
          res = await webdavUpload(webdavConfig, webdavKey, JSON.stringify(marks))
        }
        break;
      }
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
  },
  downloadMarks: async () => {
    const path = '.data'
    const filename = 'marks.json'
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = []
    let files;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepoName = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepoName })
        break;
      case 'gitee':
        const giteeRepoName = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepoName })
        break;
      case 'gitlab':
        const gitlabRepoName = await getSyncRepoName('gitlab')
        files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepoName })
        break;
      case 'gitea':
        const giteaRepoName = await getSyncRepoName('gitea')
        files = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepoName })
        break;
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const s3Result = await s3Download(s3Config, s3Key)
          if (s3Result) {
            // S3 返回的 content 是字符串，直接解析
            result = JSON.parse(s3Result.content)
          }
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const webdavResult = await webdavDownload(webdavConfig, webdavKey)
          if (webdavResult) {
            result = JSON.parse(webdavResult.content)
          }
        }
        break;
      }
    }
    // S3 已经直接解析到 result 了，这里处理 Git 平台
    if (files) {
      const configJson = decodeBase64ToString(files.content)
      result = JSON.parse(configJson)
    }
    if (result.length > 0) {
      await deleteAllMarks()
      await insertMarks(result)
    }
    set({ syncState: false })
    return result
  },
}))

export default useMarkStore