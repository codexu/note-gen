import { getFiles as getGithubFiles } from '@/lib/sync/github'
import { GithubContent } from '@/lib/sync/github.types'
import { getFiles as getGiteeFiles } from '@/lib/sync/gitee'
import { getFiles as getGiteaFiles } from '@/lib/sync/gitea'
import { getFiles as getGitlabFiles } from '@/lib/sync/gitlab'
import { GiteeFile } from '@/lib/sync/gitee'
import { GiteaDirectoryItem } from '@/lib/sync/gitea.types'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { hasNetworkConnection, ensureDirectoryExists, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { syncOnOpen } from '@/lib/sync/sync-manager'
import { sanitizeFilePath, hasInvalidFileNameChars } from '@/lib/sync/filename-utils'
import { getCurrentFolder, computedParentPath } from '@/lib/path'
import useVectorStore from './vector'
import { join, appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, DirEntry, exists, mkdir, readDir, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep, uniq } from 'lodash-es'
import { create } from 'zustand'
import { getFilePathOptions, getWorkspacePath, toWorkspaceRelativePath } from '@/lib/workspace'
import emitter from '@/lib/emitter'
import { isSkillsFolder } from '@/lib/skills/utils'

// 缓存 Store 实例，避免每次都重新加载
let storeInstance: Store | null = null
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

export type SortType = 'name' | 'created' | 'modified' | 'none'
export type SortDirection = 'asc' | 'desc'

export interface DirTree extends DirEntry {
  children?: DirTree[]
  parent?: DirTree
  sha?: string
  isEditing?: boolean
  isLocale: boolean
  createdAt?: string
  modifiedAt?: string
  loading?: boolean  // 文件夹正在加载中
  vectorCalcStatus?: 'idle' | 'calculating' | 'completed'  // 向量计算状态
}

export interface Article {
  article: string
  path: string
}

// 查找文件夹节点
export const findFolderInTree = (path: string, tree: DirTree[]): DirTree | null => {
  for (const item of tree) {
    const itemPath = computedParentPath(item)
    if (itemPath === path && item.isDirectory) {
      return item
    }
    if (item.children && item.children.length > 0) {
      const found = findFolderInTree(path, item.children)
      if (found) return found
    }
  }
  return null
}

interface NoteState {
  loading: boolean
  setLoading: (loading: boolean) => void

  activeFilePath: string
  setActiveFilePath: (name: string) => void

  // 当前正在读取的文件路径，用于避免竞态条件
  readFilePath: string
  setReadFilePath: (path: string) => void

  // Tabs for multi-file editing
  openTabs: Array<{ id: string; path: string; name: string; isFolder: boolean }>
  setOpenTabs: (tabs: Array<{ id: string; path: string; name: string; isFolder: boolean }>) => void
  activeTabId: string
  setActiveTabId: (id: string) => void
  addTab: (tab: { id: string; path: string; name: string; isFolder: boolean }) => void
  removeTab: (id: string) => void
  cleanTabsByDeletedFile: (deletedPath: string) => Promise<void>
  cleanTabsByDeletedFolder: (deletedFolderPath: string) => Promise<void>
  clearTabs: () => void

  matchPosition: number | null
  setMatchPosition: (position: number | null) => void

  html2md: boolean
  initHtml2md: () => Promise<void>
  setHtml2md: (html2md: boolean) => Promise<void>

  showCloudFiles: boolean
  initShowCloudFiles: () => Promise<void>
  setShowCloudFiles: (show: boolean) => Promise<void>

  // Initialize tabs from store
  initOpenTabs: () => Promise<void>

  sortType: SortType
  sortDirection: SortDirection
  initSortSettings: () => Promise<void>
  initEventListeners: () => void
  setSortType: (sortType: SortType) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  sortFileTree: (tree: DirTree[]) => DirTree[]
  updateFileStats: (path: string, tree: DirTree[]) => Promise<DirTree[]>
  loadFileStatsIfNeeded: () => Promise<void>

  fileTree: DirTree[]
  fileTreeLoading: boolean
  setFileTree: (tree: DirTree[]) => void
  addFile: (file: DirTree) => void
  loadFileTree: () => Promise<void>
  loadRemoteSyncFiles: () => Promise<void>
  loadCollapsibleFiles: (folderName: string) => Promise<void>
  loadFolderRemoteFiles: (folderName: string) => Promise<void>
  newFolder: () => void
  newFile: () => void
  newFileOnFolder: (path: string) => void
  newFolderInFolder: (path: string) => void

  collapsibleList: string[]
  collapsibleListInitialized: boolean
  initCollapsibleList: () => Promise<void>
  setCollapsibleList: (name: string, value: boolean) => Promise<void>
  expandAllFolders: () => Promise<void>
  collapseAllFolders: () => Promise<void>
  toggleAllFolders: () => Promise<void>
  clearCollapsibleList: () => Promise<void>

  currentArticle: string
  isPulling: boolean // 新增：拉取状态
  justPulledFile: boolean // 标记是否刚从远程拉取文件（用于避免立即推送）
  readArticle: (path: string, sha?: string, isLocale?: boolean, autoSync?: boolean) => Promise<void>
  setCurrentArticle: (content: string) => void
  setIsPulling: (pulling: boolean) => void
  setJustPulledFile: (justPulled: boolean) => void
  saveCurrentArticle: (content: string) => Promise<void>
  // 防抖保存相关
  debounceSaveTimer: NodeJS.Timeout | null
  pendingSaveContent: string | null
  // 更新文件 sha 状态（推送成功后调用）
  updateFileSha: (path: string, sha: string) => void

  // 向量计算相关
  vectorCalcTimer: NodeJS.Timeout | null
  vectorCalcProgressInterval: NodeJS.Timeout | null
  vectorCalcProgress: number
  isVectorCalculating: boolean
  lastEditTime: number
  pendingVectorContent: { path: string; content: string } | null
  scheduleVectorCalculation: (path: string, content: string) => void
  executeVectorCalculation: () => Promise<void>
  cancelVectorCalculation: () => void
  triggerVectorCalculation: () => Promise<void> // 手动触发向量计算
  // 向量索引状态
  vectorIndexedFiles: Map<string, number> // 文件名 -> 向量索引时间戳
  checkFileVectorIndexed: (filename: string) => Promise<boolean>
  clearFileVector: (filename: string) => Promise<void>
  initVectorIndexedFiles: () => Promise<void> // 初始化向量索引状态
  // 向量计算状态更新
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => void

  allArticle: Article[]
  loadAllArticle: () => Promise<void>
}

const useArticleStore = create<NoteState>((set, get) => ({
  loading: false,

  // 防抖保存相关状态
  debounceSaveTimer: null,
  pendingSaveContent: null,

  setLoading: (loading: boolean) => { set({ loading }) },

  sortType: 'none',
  sortDirection: 'asc',
  initSortSettings: async () => {
    const store = await getStore()
    const sortType = await store.get<SortType>('sortType')
    const sortDirection = await store.get<SortDirection>('sortDirection')
    if (sortType) set({ sortType })
    if (sortDirection) set({ sortDirection })

    // 如果需要按时间排序，加载统计信息
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }

    // 初始化事件监听器
    get().initEventListeners()
  },

  // 初始化事件监听器
  initEventListeners: () => {
    // 监听同步推送完成事件，更新文件树的 sha 状态
    emitter.on('sync-push-completed', ((event: { path: string; success: boolean; sha?: string }) => {
      const { path, success, sha } = event
      if (success && sha) {
        get().updateFileSha(path, sha)
      }
    }) as any)
  },
  setSortType: async (sortType: SortType) => {
    set({ sortType })
    const store = await getStore()
    await store.set('sortType', sortType)
    
    // 如果需要按时间排序，先加载统计信息
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  setSortDirection: async (direction: SortDirection) => {
    set({ sortDirection: direction })
    const store = await getStore()
    await store.set('sortDirection', direction)
    
    // 如果当前是按时间排序，确保统计信息已加载
    const sortType = get().sortType
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  
  sortFileTree: (tree: DirTree[]) => {
    const sortType = get().sortType
    const sortDirection = get().sortDirection

    // 复制树结构，避免直接修改原始数据
    const sortedTree = cloneDeep(tree)

    // skills 文件夹始终置顶（在任何排序方式下，包括 sortType 为 'none' 时）
    const sortFunction = (a: DirTree, b: DirTree) => {
      const aIsSkills = a.isDirectory && isSkillsFolder(a.name)
      const bIsSkills = b.isDirectory && isSkillsFolder(b.name)
      if (aIsSkills && !bIsSkills) return -1
      if (!aIsSkills && bIsSkills) return 1

      // 如果排序类型为 'none'，在 skills 置顶后，文件夹在文件上方
      if (sortType === 'none') {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return 0
      }

      // 文件夹始终在文件上方
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      // 同类型的进行排序
      let result = 0
      switch (sortType) {
        case 'name':
          result = a.name.localeCompare(b.name)
          break
        case 'created':
          if (a.createdAt && b.createdAt) {
            result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        case 'modified':
          if (a.modifiedAt && b.modifiedAt) {
            result = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        default:
          result = 0
      }
      return sortDirection === 'asc' ? result : -result
    }

    sortedTree.sort(sortFunction)

    const sortChildren = (items: DirTree[]) => {
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          item.children.sort(sortFunction)
          sortChildren(item.children)
        }
      }
    }

    sortChildren(sortedTree)
    return sortedTree
  },

  activeFilePath: '',
  setActiveFilePath: async (path: string) => {
    // 切换文件时，先清空 currentArticle，避免内容覆盖
    set({ currentArticle: '', activeFilePath: path })
    const store = await getStore();
    await store.set('activeFilePath', path)
    // 触发事件，让推送队列重置计时器
    emitter.emit('article-opened', { path })

    // 触发读取文件内容（包括远程拉取）
    // 需要确保是文件而不是文件夹
    const fileName = path.split('/').pop() || ''
    if (fileName && fileName.includes('.')) {
      get().readArticle(path)
    }
  },

  // Tabs initialization - load from store
  openTabs: [],
  activeTabId: '',
  setOpenTabs: async (tabs) => {
    set({ openTabs: tabs })
    const store = await getStore();
    await store.set('openTabs', tabs)
  },
  setActiveTabId: async (id) => {
    set({ activeTabId: id })
    const store = await getStore();
    await store.set('activeTabId', id)
  },
  addTab: async (tab) => {
    const currentTabs = get().openTabs
    // Check if tab already exists
    if (currentTabs.find(t => t.path === tab.path)) {
      return
    }
    const newTabs = [...currentTabs, tab].slice(-10) // Limit to 10 tabs
    set({ openTabs: newTabs, activeTabId: tab.id })
    const store = await getStore();
    await store.set('openTabs', newTabs)
    await store.set('activeTabId', tab.id)
  },
  removeTab: async (id) => {
    const currentTabs = get().openTabs
    const newTabs = currentTabs.filter(t => t.id !== id)
    set({ openTabs: newTabs })
    const store = await getStore();
    await store.set('openTabs', newTabs)
  },

  // 清理已被删除的文件对应的 tabs（根据路径匹配）
  cleanTabsByDeletedFile: async (deletedPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const newTabs = currentTabs.filter(t => t.path !== deletedPath)

    // 如果有标签页被移除，更新状态
    if (newTabs.length !== currentTabs.length) {
      // 如果删除的是当前活动的 tab，自动选择另一个 tab
      const deletedTab = currentTabs.find(t => t.path === deletedPath)
      let newActiveTabId = currentActiveTabId
      let newActiveFilePath = currentActiveFilePath

      if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
        // 选择最后一个 tab
        const targetTab = newTabs[newTabs.length - 1]
        newActiveTabId = targetTab.id
        newActiveFilePath = targetTab.path
      } else if (deletedTab && currentActiveTabId === deletedTab.id) {
        // 没有其他 tab 了
        newActiveTabId = ''
        newActiveFilePath = ''
      }

      set({ openTabs: newTabs, activeTabId: newActiveTabId, activeFilePath: newActiveFilePath, currentArticle: '' })
      const store = await getStore();
      await store.set('openTabs', newTabs)
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
    }
  },

  // 清理已被删除的文件夹对应的 tabs（清理该文件夹下所有文件的 tabs）
  cleanTabsByDeletedFolder: async (deletedFolderPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const folderPrefix = deletedFolderPath.endsWith('/') ? deletedFolderPath : deletedFolderPath + '/'
    const newTabs = currentTabs.filter(t => !t.path.startsWith(folderPrefix))

    // 如果有标签页被移除，更新状态
    if (newTabs.length !== currentTabs.length) {
      // 如果删除的是当前活动的 tab，自动选择另一个 tab
      const deletedTab = currentTabs.find(t => t.path.startsWith(folderPrefix))
      let newActiveTabId = currentActiveTabId
      let newActiveFilePath = currentActiveFilePath

      if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
        // 选择最后一个 tab
        const targetTab = newTabs[newTabs.length - 1]
        newActiveTabId = targetTab.id
        newActiveFilePath = targetTab.path
      } else if (deletedTab && currentActiveTabId === deletedTab.id) {
        // 没有其他 tab 了
        newActiveTabId = ''
        newActiveFilePath = ''
      }

      set({ openTabs: newTabs, activeTabId: newActiveTabId, activeFilePath: newActiveFilePath, currentArticle: '' })
      const store = await getStore();
      await store.set('openTabs', newTabs)
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
    }
  },

  clearTabs: async () => {
    set({ openTabs: [], activeTabId: '' })
    const store = await getStore();
    await store.set('openTabs', [])
    await store.set('activeTabId', '')
  },

  matchPosition: null,
  setMatchPosition: (position: number | null) => {
    set({ matchPosition: position })
  },

  html2md: false,
  initHtml2md: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('html2md')
    set({ html2md: res || false })
  },
  setHtml2md: async (html2md: boolean) => {
    set({ html2md })
    const store = await getStore();
    store.set('html2md', html2md)
  },

  showCloudFiles: true,
  initShowCloudFiles: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('showCloudFiles')
    set({ showCloudFiles: res ?? true })
  },

  // Initialize open tabs from store
  initOpenTabs: async () => {
    const store = await getStore();
    const tabs = await store.get<Array<{ id: string; path: string; name: string; isFolder: boolean }>>('openTabs')
    const activeTabId = await store.get<string>('activeTabId')
    set({ openTabs: tabs || [], activeTabId: activeTabId || '' })
  },
  setShowCloudFiles: async (show: boolean) => {
    set({ showCloudFiles: show })
    const store = await getStore();
    await store.set('showCloudFiles', show)
  },

  fileTree: [],
  setFileTree: (tree: DirTree[]) => {
    const sortedTree = get().sortFileTree(tree)
    set({ fileTree: sortedTree })
  },
  addFile: (file: DirTree) => {
    set({ fileTree: [file, ...get().fileTree] })
  },
  fileTreeLoading: false,
  updateFileStats: async (basePath: string, tree: DirTree[]) => {
    const workspace = await getWorkspacePath()
    
    for (const entry of tree) {
      // 跳过非本地文件（远程同步文件）
      if (entry.isFile && entry.isLocale) {
        const filePath = await join(basePath, entry.name)
        try {
          let fileStat
          if (workspace.isCustom) {
            // 自定义工作区，使用绝对路径
            fileStat = await stat(filePath)
          } else {
            // 默认工作区，使用AppData路径
            const relPath = await toWorkspaceRelativePath(filePath)
            const pathOptions = await getFilePathOptions(relPath)
            fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          entry.createdAt = fileStat.birthtime?.toISOString()
          entry.modifiedAt = fileStat.mtime?.toISOString()
        } catch {
          // 静默失败，不阻塞排序功能
        }
      } else if (entry.isDirectory && entry.children) {
        const dirPath = await join(basePath, entry.name)
        await get().updateFileStats(dirPath, entry.children)
      }
    }
    return tree
  },
  
  // 按需加载文件统计信息（仅在需要排序时）
  loadFileStatsIfNeeded: async () => {
    const fileTree = get().fileTree
    
    // 检查是否已加载过统计信息（检查第一个文件）
    const hasStats = fileTree.some(entry => 
      entry.isFile && (entry.createdAt !== undefined || entry.modifiedAt !== undefined)
    )
    
    if (hasStats) {
      // 已经加载过，无需重复加载
      return
    }
    
    // 加载统计信息
    const workspace = await getWorkspacePath()
    // 使用正确的基础路径
    const basePath = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
    await get().updateFileStats(basePath, fileTree)
    set({ fileTree: [...fileTree] }) // 触发重新渲染
  },
  
  loadFileTree: async () => {
    set({ fileTreeLoading: true })
    set({ fileTree: [] })

    // 确保 collapsibleList 已初始化
    if (!get().collapsibleListInitialized) {
      await get().initCollapsibleList()
    }

    // 获取当前工作区路径
    const workspace = await getWorkspacePath()
    
    // 确保工作区目录存在
    if (workspace.isCustom) {
      // 自定义工作区
      const isWorkspaceExists = await exists(workspace.path)
      if (!isWorkspaceExists) {
        await mkdir(workspace.path)
      }
    } else {
      // 默认工作区
      const isArticleDir = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!isArticleDir) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
    }

    // 读取工作区文件（仅根目录）
    let dirs: DirTree[] = []
    if (workspace.isCustom) {
      // 自定义工作区
      dirs = (await readDir(workspace.path))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined
        }))
    } else {
      // 默认工作区
      dirs = (await readDir('article', { baseDir: BaseDirectory.AppData }))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined
        }))
    }
    
    // 为已展开的文件夹加载子内容
    const collapsibleList = get().collapsibleList
    if (collapsibleList.length > 0) {
      // 只加载根级别已展开的文件夹
      const rootExpandedFolders = dirs.filter(dir => dir.isDirectory && collapsibleList.includes(dir.name))
      for (const folder of rootExpandedFolders) {
        await loadFolderChildren(workspace, folder)
      }
    }
    
    // 递归加载已展开文件夹的子内容
    async function loadFolderChildren(workspace: any, folder: DirTree, parentPath: string = '') {
      const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
      const fullPath = await join(workspace.path, folderPath)
      
      let children: DirTree[] = []
      
      // 检查目录是否存在
      let dirExists = false
      try {
        if (workspace.isCustom) {
          dirExists = await exists(fullPath)
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      } catch {
        dirExists = false
      }
      
      // 如果目录存在，加载本地文件
      if (dirExists) {
        try {
          if (workspace.isCustom) {
            children = (await readDir(fullPath))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined
              })) as DirTree[]
          } else {
            const dirRelative = await toWorkspaceRelativePath(fullPath)
            const pathOptions = await getFilePathOptions(dirRelative)
            children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined
              })) as DirTree[]
          }
        } catch {
          // 读取失败，使用空数组
        }
      }
      
      folder.children = children
      
      // 递归加载子文件夹中已展开的文件夹
      for (const child of children) {
        if (child.isDirectory && collapsibleList.includes(`${folderPath}/${child.name}`)) {
          await loadFolderChildren(workspace, child, folderPath)
        }
      }
    }
        
    // 排序文件树
    const sortedDirs = get().sortFileTree(dirs)
    set({ fileTree: sortedDirs })

    // 先显示本地文件树
    set({ fileTreeLoading: false })

    // 初始化向量索引状态（异步，不阻塞界面）
    get().initVectorIndexedFiles()

    // 异步加载远程同步文件（不阻塞界面）
    get().loadRemoteSyncFiles()
  },
  
  // 加载远程同步文件（后台任务）
  loadRemoteSyncFiles: async () => {
    try {
      const store = await getStore();
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
      
      if (primaryBackupMethod === 'github') {
        const accessToken = await store.get<string>('accessToken')
        if (!accessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitee') {
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        if (!giteeAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitlab') {
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        if (!gitlabAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitea') {
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        if (!giteaAccessToken) {
          return
        }
      }
    
    // 只为根目录和本地存在的已展开文件夹加载远程文件
    // 云端文件夹默认折叠，不加载其子内容
    const workspace = await getWorkspacePath()
    const collapsibleList = get().collapsibleList
    const pathsToLoad: string[] = [''] // 总是加载根目录
    
    // 检查 collapsibleList 中的路径是否在本地存在
    for (const path of collapsibleList) {
      const fullPath = await join(workspace.path, path)
      let dirExists = false
      
      try {
        if (workspace.isCustom) {
          dirExists = await exists(fullPath)
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      } catch {
        dirExists = false
      }
      
      // 只有本地存在的文件夹才加载远程同步状态
      if (dirExists) {
        pathsToLoad.push(path)
      }
    }
    
    // 使用 Promise.all 并发请求所有路径的远程文件
    const loadPromises = pathsToLoad.map(async path => {
      try {
        let files;
        switch (primaryBackupMethod) {
          case 'github':
            const githubRepo = await getSyncRepoName('github');
            files = await getGithubFiles({ path, repo: githubRepo });
            break;
          case 'gitee':
            const giteeRepo = await getSyncRepoName('gitee');
            files = await getGiteeFiles({ path, repo: giteeRepo });
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab');
            files = await getGitlabFiles({ path, repo: gitlabRepo });
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea');
            files = await getGiteaFiles({ path, repo: giteaRepo });
            break;
        }

        if (files) {
          const dirs = get().fileTree
          files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
            // 过滤以"."开头的文件和文件夹
            if (file.name.startsWith('.')) {
              return;
            }
            
            // 只加载直接子项，不加载孙子项
            const relativePath = path ? file.path.substring(path.length + 1) : file.path
            const isDirectChild = !relativePath.includes('/')
            
            if (!isDirectChild) {
              return // 跳过非直接子项
            }
            
            const itemPath = file.path;
            let currentFolder: DirTree | undefined
            if (file.type === 'dir') {
              currentFolder = getCurrentFolder(itemPath, dirs)?.parent
            } else {
              const filePath = itemPath.split('/').slice(0, -1).join('/')
              currentFolder = getCurrentFolder(filePath, dirs)
            }
            if (itemPath.includes('/')) {
              const index = currentFolder?.children?.findIndex(item => item.name === file.name)
              if (index !== -1 && index !== undefined && currentFolder?.children) {
                currentFolder.children[index].sha = file.sha
              } else {
                currentFolder?.children?.push({
                  name: file.name,
                  isFile: file.type === 'file',
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: file.type === 'dir',
                  sha: file.sha,
                  isLocale: false,
                  children: file.type === 'dir' ? [] : undefined
                })
              }
            } else {
              const index = dirs.findIndex(item => item.name === file.name)
              if (index !== -1 && index !== undefined) {
                dirs[index].sha = file.sha
              } else {
                (dirs as any).push({
                  name: file.name,
                  isFile: file.type === 'file',
                  isSymlink: false,
                  parent: undefined,
                  isEditing: false,
                  isDirectory: file.type === 'dir',
                  sha: file.sha,
                  isLocale: false,
                  children: file.type === 'dir' ? [] : undefined
                })
              }
            }
          });
          set({ fileTree: dirs })
        }
      } catch {
      }
    });

    // 等待所有远程文件加载完成
    await Promise.all(loadPromises)
  } catch {
  }
},
  // 加载文件夹内部的本地和远程文件（按需加载）
  loadCollapsibleFiles: async (fullpath: string) => {
    const cacheTree: DirTree[] = get().fileTree
    const currentFolder = getCurrentFolder(fullpath, cacheTree)

    if (!currentFolder) {
      return
    }

    // 检查是否是目录（防止误将文件当作目录处理）
    if (!currentFolder.isDirectory) {
      return
    }

    // 如果已经加载过子内容，则跳过
    if (currentFolder.children && currentFolder.children.length > 0) {
      // 仅异步更新远程同步状态
      get().loadFolderRemoteFiles(fullpath)
      return
    }
    
    // 检查是否配置了云同步
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let hasCloudSync = false
    
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      hasCloudSync = !!accessToken
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      hasCloudSync = !!giteeAccessToken
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      hasCloudSync = !!gitlabAccessToken
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      hasCloudSync = !!giteaAccessToken
    }
    
    // 只有在配置了云同步时才设置加载状态
    if (hasCloudSync) {
      currentFolder.loading = true
      set({ fileTree: [...cacheTree] })
    }
    
    // 尝试加载本地子目录内容
    const workspace = await getWorkspacePath()
    const fullFolderPath = await join(workspace.path, fullpath)
    
    let children: DirTree[] = []
    
    // 检查目录是否存在
    let dirExists = false
    try {
      if (workspace.isCustom) {
        dirExists = await exists(fullFolderPath)
      } else {
        const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
        const pathOptions = await getFilePathOptions(dirRelative)
        dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      dirExists = false
    }
    
    // 如果目录存在，加载本地文件
    if (dirExists) {
      try {
        if (workspace.isCustom) {
          children = (await readDir(fullFolderPath))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined
            })) as DirTree[]
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined
            })) as DirTree[]
        }
      } catch {
        // 读取失败，使用空数组
      }
    }

    // 设置子节点（可能为空）
    currentFolder.children = children
    set({ fileTree: cacheTree })
    
    // 异步加载远程同步文件状态（不阻塞界面）
    // 这将会填充仅存在于云端的文件
    get().loadFolderRemoteFiles(fullpath)
  },
  
  // 加载特定文件夹的远程同步文件（后台任务）
  loadFolderRemoteFiles: async (fullpath: string) => {
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    // 检查是否配置了访问令牌
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      if (!accessToken) return
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      if (!giteeAccessToken) return
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      if (!gitlabAccessToken) return
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      if (!giteaAccessToken) return
    }
    
    try {
      let files;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo1 = await getSyncRepoName('github');
          files = await getGithubFiles({ path: fullpath, repo: githubRepo1 });
          break;
        case 'gitee':
          const giteeRepo1 = await getSyncRepoName('gitee');
          files = await getGiteeFiles({ path: fullpath, repo: giteeRepo1 });
          break;
        case 'gitlab':
          const gitlabRepo1 = await getSyncRepoName('gitlab');
          files = await getGitlabFiles({ path: fullpath, repo: gitlabRepo1 });
          break;
        case 'gitea':
          const giteaRepo1 = await getSyncRepoName('gitea');
          files = await getGiteaFiles({ path: fullpath, repo: giteaRepo1 });
          break;
      }
      
      if (files) {
        const cacheTree = get().fileTree
        const currentFolder = getCurrentFolder(fullpath, cacheTree)
        
        if (currentFolder) {
          files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
            // 过滤以"."开头的文件和文件夹
            if (file.name.startsWith('.')) {
              return;
            }
            
            // 只加载直接子项，不加载孙子项
            // 例如: fullpath='test', file.path='test/file.md' → 加载
            //      fullpath='test', file.path='test/sub/file.md' → 跳过
            const relativePath = fullpath ? file.path.substring(fullpath.length + 1) : file.path
            const isDirectChild = !relativePath.includes('/')
            
            if (!isDirectChild) {
              return // 跳过非直接子项
            }
            
            const index = currentFolder.children?.findIndex(item => item.name === file.name)
            if (index !== undefined && index !== -1 && currentFolder.children) {
              currentFolder.children[index].sha = file.sha
            } else {
              currentFolder.children?.push({
                name: file.name,
                isFile: file.type === 'file',
                isSymlink: false,
                parent: currentFolder,
                isEditing: false,
                isDirectory: file.type === 'dir',
                sha: file.sha,
                isLocale: false,
                children: file.type === 'file' ? undefined : []
              })
            }
          });
          
          // 移除加载状态
          currentFolder.loading = false
          set({ fileTree: cacheTree })
        }
      }
    } catch {
      // 确保加载状态被移除
      const cacheTree = get().fileTree
      const currentFolder = getCurrentFolder(fullpath, cacheTree)
      if (currentFolder) {
        currentFolder.loading = false
        set({ fileTree: [...cacheTree] })
      }
    }
  },
  newFolder: async () => {
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isDirectory)
    if (exists) {
      return
    }
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      children: []
    }

    try {
      cacheTree.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },
  newFile: async () => {
    // 检查现有树中是否已有空文件名的文件（正在编辑中）
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isFile)
    if (exists) {
      return
    }
  
    // 判断 activeFilePath 是否存在 parent
    const path = get().activeFilePath;
    if (path.includes('/')) {
      // 在当前活动文件的父文件夹下创建新文件
      const folderPath = path.split('/').slice(0, -1).join('/')
      const currentFolder = getCurrentFolder(folderPath, cacheTree)
      
      // 如果文件夹中已经有一个空名称的文件，不再创建新的
      if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
        return
      }
      
      // 确保文件夹是展开状态
      const collapsibleList = get().collapsibleList
      if (!collapsibleList.includes(folderPath)) {
        collapsibleList.push(folderPath)
        set({ collapsibleList })
      }
      
      if (currentFolder) {
        const newFile: DirTree = {
          name: '',
          isFile: true,
          isSymlink: false,
          parent: currentFolder,
          isEditing: true,
          isDirectory: false,
          isLocale: true,
          sha: '',
          children: []
        }
        currentFolder.children?.unshift(newFile)
        set({ fileTree: cacheTree })
      }
    } else {
      // 不存在 parent，直接在根目录下创建
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: undefined,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      }
      cacheTree.unshift(newFile)
      set({ fileTree: cacheTree })
    }
  },

  newFileOnFolder: async (path: string) => {
    // 获取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 获取工作区路径信息
    const workspace = await getWorkspacePath()
    
    // 创建新文件
    const file = `新建文件-${new Date().getTime()}.md`
    const fullPath = `${path}/${file}`
    const pathOptions = await getFilePathOptions(fullPath)
    
    // 写入空文件
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, '')
    } else {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    }

    // 更新树
    const node = {
      name: file,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isEditing: false,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
      get().setActiveFilePath(fullPath)
    } catch {
    }
  },
  newFolderInFolder: async (path: string) => {
    // 获取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 如果文件夹中已存在未命名文件夹，不创建新的
    const hasEmptyFolder = currentFolder?.children?.find(item => item.name === '' && item.isDirectory)
    if (hasEmptyFolder) {
      return
    }

    // 更新树
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },

  collapsibleList: [],
  collapsibleListInitialized: false,
  initCollapsibleList: async () => {
    // 防止重复初始化
    if (get().collapsibleListInitialized) {
      return
    }

    const store = await getStore();
    const res = await store.get<string[]>('collapsibleList')
    const activeFilePath = await store.get<string>('activeFilePath')
    set({
      collapsibleList: res ? uniq(res.filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i))) : [],
      collapsibleListInitialized: true
    })

    if (activeFilePath) {
      set({ activeFilePath })

      // 检查是否是文件夹（所有支持的文件扩展名都是文件，不是文件夹）
      if (!activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
        // 文件夹：确保展开并加载内容
        if (!get().collapsibleList.includes(activeFilePath)) {
          await get().setCollapsibleList(activeFilePath, true)
        }
        await get().loadCollapsibleFiles(activeFilePath)
      } else {
        // 文件：读取内容
        get().readArticle(activeFilePath)
      }
    }
  },
  
  setCollapsibleList: async (path: string, value: boolean) => {
    const collapsibleList = cloneDeep(get().collapsibleList)
    if (value) {
      collapsibleList.push(path)
    } else {
      const index = collapsibleList.indexOf(path)
      if (index !== -1) {
        collapsibleList.splice(index, 1)
      }
    }
    const store = await getStore();
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList: uniq(collapsibleList).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) })
  },
  
  expandAllFolders: async () => {
    // Get all folder paths from fileTree recursively
    const getAllFolderPaths = (tree: DirTree[], parentPath: string = ''): string[] => {
      let paths: string[] = []
      for (const item of tree) {
        if (!item.isFile) {
          const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name
          paths.push(currentPath)
          if (item.children && item.children.length > 0) {
            paths = [...paths, ...getAllFolderPaths(item.children, currentPath)]
          }
        }
      }
      return paths
    }
    
    const folderPaths = getAllFolderPaths(get().fileTree)
    const store = await getStore()
    await store.set('collapsibleList', folderPaths)
    set({ collapsibleList: uniq(folderPaths) })
    
    // Load all children for expanded folders
    for (const path of folderPaths) {
      await get().loadCollapsibleFiles(path)
    }
  },
  
  collapseAllFolders: async () => {
    const store = await getStore()
    await store.set('collapsibleList', [])
    set({ collapsibleList: [] })
  },
  
  toggleAllFolders: async () => {
    // If there are any expanded folders, collapse all; otherwise, expand all
    if (get().collapsibleList.length > 0) {
      await get().collapseAllFolders()
    } else {
      await get().expandAllFolders()
    }
  },
  clearCollapsibleList: async () => {
    set({ collapsibleList: [] })
    const store = await getStore()
    await store.set('collapsibleList', [])
  },

  currentArticle: '',
  readFilePath: '',
  isPulling: false, // 新增：拉取状态
  justPulledFile: false, // 标记是否刚从远程拉取文件

  setReadFilePath: (path: string) => {
    set({ readFilePath: path })
  },

  readArticle: async (path: string, sha?: string, autoSync = true) => {
    get().setLoading(true)

    // 设置当前正在读取的文件路径，用于避免竞态条件
    set({ readFilePath: path })

    // 处理文件名兼容性问题
    let actualPath = path
    if (hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
      // 更新活动文件路径为清理后的路径
      await get().setActiveFilePath(actualPath)
    }

    // 优先加载本地内容（快速响应）
    let localContent = ''

    // 辅助函数：查找文件信息
    const findFileInTree = (tree: DirTree[], targetPath: string): DirTree | null => {
      for (const item of tree) {
        const itemPath = computedParentPath(item)
        if (itemPath === targetPath && item.isFile) {
          return item
        }
        if (item.children && item.children.length > 0) {
          const found = findFileInTree(item.children, targetPath)
          if (found) return found
        }
      }
      return null
    }

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(actualPath)
      if (workspace.isCustom) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      // 检查是否是远程文件且本地内容为空
      const fileTree = get().fileTree
      const fileInfo = findFileInTree(fileTree, actualPath)
      const isRemoteFile = fileInfo && !fileInfo.isLocale

      // 如果是远程文件且本地内容为空，先显示编辑器（禁用），再异步拉取
      if (isRemoteFile && (!localContent || localContent.trim() === '')) {
        // 先设置当前内容为空，显示编辑器
        set({ currentArticle: '', loading: true })

        // 标记正在拉取
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        // 异步拉取远程内容
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            // 再次检查当前是否还是同一个文件
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
            }

            // 拉取成功后，更新文件树的 isLocale 状态为本地文件
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)

        return
      }

      // 正常的本地文件，显示内容（即使是空文件也正确显示）
      set({ currentArticle: localContent })
      // 本地内容加载完成，解除加载状态
      get().setLoading(false)
      // 检查文件的向量索引状态
      const filename = actualPath.split('/').pop() || actualPath
      get().checkFileVectorIndexed(filename)
    } catch (error) {
      // 本地文件不存在，检查是否是远程文件

      // 先查找文件信息（可能 fileTree 还没加载完成）
      const fileInfo = findFileInTree(get().fileTree, actualPath)

      // 检查是否是"文件不存在"错误（兼容不同平台的大小写）
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isFileNotFound = errorMsg.toLowerCase().includes('no such file') ||
                            errorMsg.toLowerCase().includes('not found') ||
                            errorMsg.toLowerCase().includes('系统找不到指定的路径')

      if (isFileNotFound && fileInfo && !fileInfo.isLocale) {
        // 先设置当前内容为空，显示编辑器
        set({ currentArticle: '', loading: true })

        // 标记正在拉取
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        // 异步拉取远程内容
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            // 再次检查当前是否还是同一个文件
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
            }

            // 拉取成功后，更新文件树的 isLocale 状态为本地文件
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)
      } else if (isFileNotFound) {
        // 本地文件，创建空白文件
        await ensureDirectoryExists(actualPath)
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(actualPath)

        try {
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
          set({ currentArticle: '' })
          get().setLoading(false)
        } catch {
          get().setLoading(false)
        }
      } else {
        set({ currentArticle: '' })
        get().setLoading(false)
      }
    }

    // 异步检查远程更新（使用新的 SyncManager）
    // 只有当当前读取的文件路径仍然是 actualPath 时才执行同步
    // 同时检查 activeFilePath 是否仍然匹配，防止竞态条件
    if (autoSync && await hasNetworkConnection()) {
      try {
        // 在执行同步前检查路径是否仍然匹配
        const currentReadPath = get().readFilePath
        const currentActivePath = get().activeFilePath
        if (currentReadPath === actualPath && currentActivePath === actualPath) {
          const result = await syncOnOpen(actualPath)
          // 在设置 content 前再次确认路径没有变化
          if (result?.updated && result.content && get().activeFilePath === actualPath) {
            // 拉取了新内容，更新 currentArticle
            set({ currentArticle: result.content })
          }
        }
      } catch {
      }
    }

    // 读取完成后清除 readFilePath（仅当没有其他 readArticle 在执行时）
    // 通过检查 activeFilePath 是否变化来判断
    if (get().activeFilePath === actualPath) {
      set({ readFilePath: '' })
    }
  },

  // 向量计算相关状态
  vectorCalcTimer: null as NodeJS.Timeout | null,
  vectorCalcProgressInterval: null as NodeJS.Timeout | null,
  vectorCalcProgress: 0, // 0-100，表示距离自动计算的进度
  isVectorCalculating: false,
  lastEditTime: 0,
  pendingVectorContent: null as { path: string; content: string } | null,
  // 向量索引状态
  vectorIndexedFiles: new Map<string, number>(), // 文件名 -> 向量索引时间戳

  setCurrentArticle: (content: string) => {
    set({ currentArticle: content })
  },

  setIsPulling: (pulling: boolean) => {
    set({ isPulling: pulling })
  },

  setJustPulledFile: (justPulled: boolean) => {
    set({ justPulledFile: justPulled })
  },

  // 更新文件 sha 状态（推送成功后调用）
  updateFileSha: (path: string, sha: string) => {
    const cacheTree = cloneDeep(get().fileTree)

    // 递归查找并更新文件的 sha
    const updateShaInTree = (items: DirTree[], depth: number = 0): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path && item.isFile) {
          item.sha = sha
          return true
        }
        if (item.children && updateShaInTree(item.children, depth + 1)) {
          return true
        }
      }
      return false
    }

    if (updateShaInTree(cacheTree)) {
      const sortedTree = get().sortFileTree(cacheTree)
      set({ fileTree: sortedTree })
    } else {
      // 未找到匹配的文件
    }
  },

  saveCurrentArticle: async (content: string) => {
    const path = get().activeFilePath
    const justPulled = get().justPulledFile

    if (path && content !== undefined && content !== null) {
      // 如果是从远程刚拉取的文件，不触发推送（避免 SHA 不匹配错误）
      if (justPulled) {
        // 清除标志
        get().setJustPulledFile(false)
        // 只保存本地文件，不触发同步推送
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, content)
        } else {
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }
        set({ currentArticle: content })
        return
      }

      // 清除之前的防抖定时器
      const existingTimer = get().debounceSaveTimer
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // 设置新的防抖定时器，500ms 后执行保存
      // 这样可以合并短时间内多次 content change
      // 保存 pendingContent 用于防抖检查
      set({ pendingSaveContent: content, debounceSaveTimer: undefined })
      const timer = setTimeout(async () => {
        const state = get()
        const debouncedContent = state.pendingSaveContent || content

        // Bug fix: 检查路径是否仍然匹配，避免文件切换时保存到错误的文件
        const currentActivePath = state.activeFilePath
        if (currentActivePath !== path) {
          // 文件已切换，取消保存
          set({ debounceSaveTimer: null, pendingSaveContent: null })
          return
        }

        set({ debounceSaveTimer: null, pendingSaveContent: null })

        // 执行实际保存操作
        const savePath = path
        const saveContent = debouncedContent
        const workspace = await getWorkspacePath()

        // 检查文件是否存在
        let isLocale = false
        const pathOptions = await getFilePathOptions(savePath)
        if (workspace.isCustom) {
          isLocale = await exists(pathOptions.path)
        } else {
          isLocale = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // 确保目录结构存在
        if (savePath.includes('/')) {
          let dir = ''
          const dirPath = savePath.split('/')
          for (let index = 0; index < dirPath.length - 1; index += 1) {
            dir += `${dirPath[index]}/`
            const dirOptions = await getFilePathOptions(dir)
            let dirExists = false
            if (workspace.isCustom) {
              dirExists = await exists(dirOptions.path)
            } else {
              dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
            }
            if (!dirExists) {
              if (workspace.isCustom) {
                await mkdir(dirOptions.path)
              } else {
                await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir })
              }
            }
          }
        }

        // 保存文件内容
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, saveContent)
        } else {
          await writeTextFile(pathOptions.path, saveContent, { baseDir: pathOptions.baseDir })
        }

        // 更新缓存树
        if (!isLocale) {
          const cacheTree = cloneDeep(get().fileTree)
          const current = savePath.includes('/') ? getCurrentFolder(savePath, cacheTree) : cacheTree.find(item => item.name === savePath)
          if (current) {
            current.isLocale = true

            // 更新父文件夹链的 isLocale 状态
            const updateParentFolders = async (node: DirTree | undefined) => {
              let parent = node
              const pathParts = savePath.split('/')
              let currentDepth = pathParts.length - 1

              while (parent && currentDepth > 0) {
                if (parent.isLocale) {
                  break
                }
                const parentPath = pathParts.slice(0, currentDepth).join('/')
                const parentOptions = await getFilePathOptions(parentPath)
                let parentExists = false
                try {
                  if (workspace.isCustom) {
                    parentExists = await exists(parentOptions.path)
                  } else {
                    parentExists = await exists(parentOptions.path, { baseDir: parentOptions.baseDir })
                  }
                } catch {
                  parentExists = false
                }
                if (parentExists) {
                  parent.isLocale = true
                  parent = parent.parent
                  currentDepth--
                } else {
                  break
                }
              }
            }

            await updateParentFolders(current.parent)
          }
          set({ fileTree: cacheTree })
        }

        // 触发防抖向量计算
        if (savePath.endsWith('.md')) {
          get().scheduleVectorCalculation(savePath, saveContent)
        }

        // 更新 currentArticle
        set({ currentArticle: saveContent })

        // 通知文件已保存，触发同步推送
        emitter.emit('article-saved', { path: savePath, content: saveContent })
      }, 500)

      // 保存待处理的内容（最新的内容）
      set({ debounceSaveTimer: timer as any, pendingSaveContent: content })
    }
  },

  // 安排向量计算（防抖5秒）
  scheduleVectorCalculation: (path: string, content: string) => {
    const state = get()
    
    // 清除之前的定时器
    if (state.vectorCalcTimer) {
      clearTimeout(state.vectorCalcTimer)
    }
    if (state.vectorCalcProgressInterval) {
      clearInterval(state.vectorCalcProgressInterval)
    }
    
    // 更新最后编辑时间和待处理内容
    const now = Date.now()
    set({ 
      lastEditTime: now,
      pendingVectorContent: { path, content },
      vectorCalcProgress: 0
    })
    
    // 创建进度更新定时器（每100ms更新一次进度）
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - get().lastEditTime
      const progress = Math.min((elapsed / 5000) * 100, 100)
      set({ vectorCalcProgress: progress })
      
      if (progress >= 100) {
        clearInterval(progressInterval)
      }
    }, 100)
    
    // 设置5秒后自动执行向量计算
    const timer = setTimeout(() => {
      clearInterval(progressInterval)
      get().executeVectorCalculation()
    }, 5000)
    
    set({ 
      vectorCalcTimer: timer as any,
      vectorCalcProgressInterval: progressInterval as any
    })
  },

  // 执行向量计算
  executeVectorCalculation: async () => {
    const state = get()
    
    // 如果没有待处理内容或正在计算中，直接返回
    if (!state.pendingVectorContent || state.isVectorCalculating) {
      return
    }
    
    try {
      set({ isVectorCalculating: true, vectorCalcProgress: 100 })
      
      const { path, content } = state.pendingVectorContent
      const vectorStore = useVectorStore.getState()

      // 执行向量计算
      await vectorStore.processDocument(path, content)
      // 更新向量索引状态
      const filename = path.split('/').pop() || path
      const newMap = new Map(get().vectorIndexedFiles)
      newMap.set(filename, Date.now())
      set({ vectorIndexedFiles: newMap })

      // 清除待处理内容和定时器
      if (state.vectorCalcTimer) {
        clearTimeout(state.vectorCalcTimer)
      }
      if (state.vectorCalcProgressInterval) {
        clearInterval(state.vectorCalcProgressInterval)
      }
      
      set({ 
        pendingVectorContent: null,
        vectorCalcTimer: null,
        vectorCalcProgressInterval: null,
        vectorCalcProgress: 0
      })
    } catch {
      set({ isVectorCalculating: false })
    }
  },

  // 取消向量计算
  cancelVectorCalculation: () => {
    const state = get()
    if (state.vectorCalcTimer) {
      clearTimeout(state.vectorCalcTimer)
    }
    if (state.vectorCalcProgressInterval) {
      clearInterval(state.vectorCalcProgressInterval)
    }
    set({
      vectorCalcTimer: null,
      vectorCalcProgressInterval: null,
      vectorCalcProgress: 0,
      pendingVectorContent: null
    })
  },

  // 检查文件是否已被向量索引
  checkFileVectorIndexed: async (filename: string) => {
    const { checkVectorDocumentExists, getVectorDocumentsByFilename } = await import('@/db/vector')
    const hasVector = await checkVectorDocumentExists(filename)
    if (hasVector) {
      // 获取向量文档记录更新时间
      const docs = await getVectorDocumentsByFilename(filename)
      if (docs.length > 0) {
        const latestTime = Math.max(...docs.map(d => d.updated_at))
        const newMap = new Map(get().vectorIndexedFiles)
        newMap.set(filename, latestTime)
        set({ vectorIndexedFiles: newMap })
        return true
      }
    }
    // 如果没有向量，从映射中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(filename)
    set({ vectorIndexedFiles: newMap })
    return false
  },

  // 清除文件的向量数据
  clearFileVector: async (filename: string) => {
    const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
    await deleteVectorDocumentsByFilename(filename)
    // 从映射中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(filename)
    set({ vectorIndexedFiles: newMap })
  },

  // 初始化向量索引状态 - 加载所有已索引的文件
  initVectorIndexedFiles: async () => {
    try {
      const { getAllVectorDocumentFilenames, getVectorDocumentsByFilename } = await import('@/db/vector')
      const indexedFiles = await getAllVectorDocumentFilenames()

      // 构建 vectorIndexedFiles Map
      const vectorIndexedMap = new Map<string, number>()
      for (const file of indexedFiles) {
        const docs = await getVectorDocumentsByFilename(file.filename)
        if (docs.length > 0) {
          const latestTime = Math.max(...docs.map(d => d.updated_at))
          vectorIndexedMap.set(file.filename, latestTime)
        }
      }

      set({ vectorIndexedFiles: vectorIndexedMap })
    } catch {
    }
  },

  // 手动触发向量计算（使用当前文章内容）
  triggerVectorCalculation: async () => {
    const state = get()
    if (!state.activeFilePath || state.isVectorCalculating) {
      return
    }

    // 使用当前文章内容
    const content = state.currentArticle
    if (!content) {
      return
    }

    // 设置待处理内容并执行
    set({
      pendingVectorContent: {
        path: state.activeFilePath,
        content
      }
    })

    await get().executeVectorCalculation()
  },

  // 设置向量计算状态
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => {
    const fileTree = get().fileTree

    // 递归查找并更新文件/文件夹的状态
    const updateStatus = (items: DirTree[]): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path) {
          item.vectorCalcStatus = status
          return true
        }
        if (item.children && updateStatus(item.children)) {
          return true
        }
      }
      return false
    }

    updateStatus(fileTree)
    set({ fileTree: [...fileTree] })
  },

  allArticle: [],
  loadAllArticle: async () => {
    const workspace = await getWorkspacePath()
    let allArticle: Article[] = []
    
    const readDirRecursively = async (dirPath: string, basePath: string, isCustomWorkspace: boolean): Promise<Article[]> => {
      let allArticles: Article[] = []
      
      // 读取当前目录内容
      const res = isCustomWorkspace 
        ? await readDir(dirPath)
        : await readDir(dirPath, { baseDir: BaseDirectory.AppData })
      
      // 过滤文件
      const files = res.filter(file => 
        file.isFile && 
        file.name !== '.DS_Store' && 
        !file.name.startsWith('.') && 
        file.name.endsWith('.md')
      )
      
      // 添加文件到结果列表
      for (const file of files) {
        // 构建相对路径
        const relativePath = await join(basePath, file.name)
        
        // 读取文件内容
        let article = ''
        if (isCustomWorkspace) {
          const fullPath = await join(dirPath, file.name)
          article = await readTextFile(fullPath)
        } else {
          article = await readTextFile(`${dirPath}/${file.name}`, { baseDir: BaseDirectory.AppData })
        }
        
        allArticles.push({ article, path: relativePath })
      }
      
      // 递归处理子目录
      const directories = res.filter(entry => 
        entry.isDirectory && 
        !entry.name.startsWith('.')
      )
      
      for (const dir of directories) {
        const newDirPath = await join(dirPath, dir.name)
        const newBasePath = await join(basePath, dir.name)
        const subDirArticles = await readDirRecursively(newDirPath, newBasePath, isCustomWorkspace)
        allArticles = [...allArticles, ...subDirArticles]
      }
      
      return allArticles
    }

    if (workspace.isCustom) {
      // 自定义工作区
      allArticle = await readDirRecursively(workspace.path, '', true)
    } else {
      // 默认工作区
      allArticle = await readDirRecursively('article', '', false)
    }

    set({ allArticle })
  }
}))

export default useArticleStore