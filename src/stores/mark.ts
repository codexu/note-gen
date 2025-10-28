import { deleteAllMarks, getAllMarks, getMarks, insertMarks, Mark, updateMark } from '@/db/marks'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand'

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
    const jsonToBase64 = (data: Mark[]) => {
      return Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    }
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = false
    let files: any;
    let res;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepoName = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepoName })
        res = await uploadGithubFile({
          ext: 'json',
        file: jsonToBase64(marks),
        repo: githubRepoName,
        path,
        filename,
        sha: files?.sha,
      })
      break;
    case 'gitee':
      const giteeRepoName = await getSyncRepoName('gitee')
      files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepoName })
      res = await uploadGiteeFile({
        ext: 'json',
        file: jsonToBase64(marks),
        repo: giteeRepoName,
        path,
        filename,
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
        ext: 'json',
        file: jsonToBase64(marks),
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
        ext: 'json',
        file: jsonToBase64(marks),
        repo: giteaRepoName,
        path,
        filename,
        sha: giteaMarkFile?.sha || '',
      })
      break;
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
    }
    if (files) {
      const configJson = decodeBase64ToString(files.content)
      result = JSON.parse(configJson)
    }
    await deleteAllMarks()
    await insertMarks(result)
    set({ syncState: false })
    return result
  },
}))

export default useMarkStore