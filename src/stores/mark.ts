import { deleteAllMarks, getAllMarks, getMarks, insertMarks, Mark, updateMark } from '@/db/marks'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { WebDAVConfig } from '@/types/sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { getRemoteFileContent, hasEmptyRemoteFileContent, isMissingRemoteFileError } from '@/lib/sync/remote-file';
import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand'
import { S3Config } from '@/types/sync'
import { normalizeRecordFilters } from '@/app/core/main/mark/mark-filters'
import { normalizeRecordViewMode } from '@/app/core/main/mark/mark-view-mode.mjs'

interface RecordDataDownloadOptions {
  allowMissingRemote?: boolean
}

export interface MarkQueue {
  queueId: string
  tagId: number
  type: Mark["type"]
  progress: string
  startTime: number
}

export type RecordTimePreset = 'all' | 'today' | 'last7Days' | 'last30Days'
export type RecordViewMode = 'list' | 'compact' | 'cards'

export interface RecordFilters {
  search: string
  selectedTypes: Mark["type"][]
  timePreset: RecordTimePreset
  tagId: number | 'all'
}

const DEFAULT_RECORD_FILTERS: RecordFilters = {
  search: '',
  selectedTypes: [],
  timePreset: 'all',
  tagId: 'all',
}

async function persistRecordFilters(recordFilters: RecordFilters) {
  const store = await Store.load('store.json')
  await store.set('recordFilters', recordFilters)
}

async function persistRecordViewMode(recordViewMode: RecordViewMode) {
  const store = await Store.load('store.json')
  await store.set('recordViewMode', recordViewMode)
}

async function fetchVisibleMarks(trashState: boolean) {
  if (trashState) {
    const res = await getAllMarks()
    return res.map(item => ({
      ...item,
      content: item.content || ''
    })).filter((item) => item.deleted === 1)
  }

  const store = await Store.load('store.json')
  const currentTagId = await store.get<number>('currentTagId')
  if (!currentTagId) {
    return []
  }

  const res = await getMarks(currentTagId)
  return res.map(item => ({
    ...item,
    content: item.content || ''
  })).filter((item) => item.deleted === 0)
}

interface MarkState {
  trashState: boolean
  setTrashState: (flag: boolean) => Promise<void>

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
  visibleMarkIds: number[]
  setVisibleMarkIds: (ids: number[]) => void
  pendingScrollMarkId: number | null
  setPendingScrollMarkId: (id: number | null) => void
  highlightedMarkId: number | null
  setHighlightedMarkId: (id: number | null) => void
  activeMarkId: number | null
  setActiveMarkId: (id: number | null) => void
  clearActiveMark: () => void

  recordFilters: RecordFilters
  setRecordSearch: (search: string) => void
  toggleRecordType: (type: Mark["type"]) => void
  setRecordTimePreset: (preset: RecordTimePreset) => void
  setRecordTagId: (tagId: number | 'all') => void
  resetRecordFilters: () => void
  hasActiveRecordFilters: () => boolean
  initRecordFilters: () => Promise<void>

  recordViewMode: RecordViewMode
  setRecordViewMode: (mode: RecordViewMode) => void
  initRecordViewMode: () => Promise<void>

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadMarks: () => Promise<boolean>
  downloadMarks: (options?: RecordDataDownloadOptions) => Promise<Mark[]>
}

const useMarkStore = create<MarkState>((set, get) => ({
  trashState: false,
  setTrashState: async (flag) => {
    set({ trashState: flag, marks: [] })
    const marks = await fetchVisibleMarks(flag)
    set({ marks })
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
        }),
        allMarks: state.allMarks.map(item => {
          if (item.id === mark.id) {
            return {
              ...item,
              ...mark
            }
          }
          return item
        }),
      }
    })
    await updateMark(mark)
  },
  setMarks: (marks) => {
    set({ marks })
  },
  fetchMarks: async () => {
    const decodeRes = await fetchVisibleMarks(false)
    set({ marks: decodeRes })
  },
  fetchAllTrashMarks: async () => {
    const decodeRes = await fetchVisibleMarks(true)
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
    const { marks, visibleMarkIds } = get()
    const ids = visibleMarkIds.length > 0 ? visibleMarkIds : marks.map(mark => mark.id)
    const allIds = new Set(ids)
    set({ selectedMarkIds: allIds, isMultiSelectMode: true })
  },
  isMultiSelectMode: false,
  setMultiSelectMode: (mode) => {
    set({ isMultiSelectMode: mode })
    if (!mode) {
      set({ selectedMarkIds: new Set<number>() })
    }
  },
  visibleMarkIds: [],
  setVisibleMarkIds: (ids) => {
    set({ visibleMarkIds: ids })
  },
  pendingScrollMarkId: null,
  setPendingScrollMarkId: (id) => {
    set({ pendingScrollMarkId: id })
  },
  highlightedMarkId: null,
  setHighlightedMarkId: (id) => {
    set({ highlightedMarkId: id })
  },
  activeMarkId: null,
  setActiveMarkId: (id) => {
    set({ activeMarkId: id })
  },
  clearActiveMark: () => {
    set({ activeMarkId: null })
  },

  recordFilters: DEFAULT_RECORD_FILTERS,
  setRecordSearch: (search) => {
    set((state) => {
      const recordFilters = {
        ...state.recordFilters,
        search,
      }
      void persistRecordFilters(recordFilters)
      return { recordFilters }
    })
  },
  toggleRecordType: (type) => {
    set((state) => {
      const selectedTypes = state.recordFilters.selectedTypes.includes(type)
        ? state.recordFilters.selectedTypes.filter((item) => item !== type)
        : [...state.recordFilters.selectedTypes, type]

      const recordFilters = {
        ...state.recordFilters,
        selectedTypes,
      }
      void persistRecordFilters(recordFilters)

      return {
        recordFilters,
      }
    })
  },
  setRecordTimePreset: (preset) => {
    set((state) => {
      const recordFilters = {
        ...state.recordFilters,
        timePreset: preset,
      }
      void persistRecordFilters(recordFilters)
      return { recordFilters }
    })
  },
  setRecordTagId: (tagId) => {
    set((state) => {
      const recordFilters = {
        ...state.recordFilters,
        tagId,
      }
      void persistRecordFilters(recordFilters)
      return { recordFilters }
    })
  },
  resetRecordFilters: () => {
    void persistRecordFilters(DEFAULT_RECORD_FILTERS)
    set({
      recordFilters: DEFAULT_RECORD_FILTERS,
    })
  },
  hasActiveRecordFilters: () => {
    const { recordFilters } = get()
    return Boolean(
      recordFilters.search.trim() ||
      recordFilters.selectedTypes.length > 0 ||
      recordFilters.timePreset !== 'all' ||
      recordFilters.tagId !== 'all'
    )
  },
  initRecordFilters: async () => {
    const store = await Store.load('store.json')
    const savedFilters = await store.get<RecordFilters>('recordFilters')
    set({
      recordFilters: normalizeRecordFilters(savedFilters),
    })
  },

  recordViewMode: 'list',
  setRecordViewMode: (mode) => {
    const recordViewMode = normalizeRecordViewMode(mode) as RecordViewMode
    void persistRecordViewMode(recordViewMode)
    set({ recordViewMode })
  },
  initRecordViewMode: async () => {
    const store = await Store.load('store.json')
    const savedRecordViewMode = await store.get<RecordViewMode>('recordViewMode')
    const recordViewMode = normalizeRecordViewMode(savedRecordViewMode) as RecordViewMode
    if (savedRecordViewMode !== recordViewMode) {
      await store.set('recordViewMode', recordViewMode)
    }
    set({ recordViewMode })
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
    try {
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
        try {
          files = await giteeGetFiles({ path: fullPath, repo: giteeRepoName })
          const sha = files?.sha
          res = await uploadGiteeFile({
            file: JSON.stringify(marks),
            repo: giteeRepoName,
            path: fullPath,
            sha: sha,
          })
        } catch (err) {
          console.error('[mark store] Gitee upload error:', err)
        }
        if (res) {
          result = true
        }
        break;
      case 'gitlab': {
        const gitlabRepoName = await getSyncRepoName('gitlab')
        try {
          files = await gitlabGetFiles({ path, repo: gitlabRepoName })
        } catch (e) {
          console.error('[mark store] GitLab getFiles error:', e)
        }

        // 如果目录不存在（files 为 null），先创建目录标记文件
        if (!files) {
          try {
            await uploadGitlabFile({
              file: '',
              repo: gitlabRepoName,
              path,
              filename: '.gitkeep',
              sha: '',
            })
          } catch {
            // Ignore .gitkeep creation failures; the main upload path reports errors below.
          }
          // 重新获取文件列表
          files = await gitlabGetFiles({ path, repo: gitlabRepoName })
        }

        const markFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        try {
          res = await uploadGitlabFile({
            file: JSON.stringify(marks),
            repo: gitlabRepoName,
            path,
            filename,
            sha: markFile?.sha || '',
          })
        } catch (e) {
          console.error('[mark store] GitLab uploadFile error:', e)
        }
        break;
      }
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
    } catch (error) {
      console.error('[mark store] uploadMarks error:', error)
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
  },
  downloadMarks: async (options: RecordDataDownloadOptions = {}) => {
    const path = '.data'
    const filename = 'marks.json'
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result: Mark[] = []
    let hasRemoteData = false
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
            hasRemoteData = true
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
            hasRemoteData = true
          }
        }
        break;
      }
    }
    // S3 已经直接解析到 result 了，这里处理 Git 平台
    if (files) {
      try {
        if (!options.allowMissingRemote || !hasEmptyRemoteFileContent(files)) {
          const configJson = decodeBase64ToString(getRemoteFileContent(files, `${path}/${filename}`))
          result = JSON.parse(configJson)
          hasRemoteData = true
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        if (!options.allowMissingRemote || !isMissingRemoteFileError(message)) {
          throw error
        }
      }
    }
    if (hasRemoteData) {
      const { setAutoDataSyncApplyingRemote } = await import('@/lib/sync/auto-data-sync-queue')
      setAutoDataSyncApplyingRemote(true)
      try {
        await deleteAllMarks()
        await insertMarks(result)
        await get().fetchMarks()
      } finally {
        setAutoDataSyncApplyingRemote(false)
      }
    }
    set({ syncState: false })
    return result
  },
}))

export default useMarkStore
