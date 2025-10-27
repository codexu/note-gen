import { decodeBase64ToString, getFiles as getGithubFiles } from '@/lib/sync/github'
import { GithubContent } from '@/lib/sync/github.types'
import { getFiles as getGiteeFiles } from '@/lib/sync/gitee'
import { getFiles as getGitlabFiles, getFileContent as getGitlabFileContent } from '@/lib/sync/gitlab'
import { GiteeFile } from '@/lib/sync/gitee'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getCurrentFolder } from '@/lib/path'
import useVectorStore from './vector'
import { join } from '@tauri-apps/api/path'
import { BaseDirectory, DirEntry, exists, mkdir, readDir, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep, uniq } from 'lodash-es'
import { create } from 'zustand'
import { getFilePathOptions, getWorkspacePath, toWorkspaceRelativePath } from '@/lib/workspace'

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
}

export interface Article {
  article: string
  path: string
}

interface NoteState {
  loading: boolean
  setLoading: (loading: boolean) => void

  activeFilePath: string 
  setActiveFilePath: (name: string) => void

  matchPosition: number | null
  setMatchPosition: (position: number | null) => void

  html2md: boolean
  initHtml2md: () => Promise<void>
  setHtml2md: (html2md: boolean) => Promise<void>

  sortType: SortType
  sortDirection: SortDirection
  setSortType: (sortType: SortType) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  sortFileTree: (tree: DirTree[]) => DirTree[]
  updateFileStats: (path: string, tree: DirTree[]) => Promise<DirTree[]>

  fileTree: DirTree[]
  fileTreeLoading: boolean
  setFileTree: (tree: DirTree[]) => void
  addFile: (file: DirTree) => void
  loadFileTree: () => Promise<void>
  loadCollapsibleFiles: (folderName: string) => Promise<void>
  newFolder: () => void
  newFile: () => void
  newFileOnFolder: (path: string) => void
  newFolderInFolder: (path: string) => void

  collapsibleList: string[]
  initCollapsibleList: () => Promise<void>
  setCollapsibleList: (name: string, value: boolean) => Promise<void>
  expandAllFolders: () => Promise<void>
  collapseAllFolders: () => Promise<void>
  toggleAllFolders: () => Promise<void>
  clearCollapsibleList: () => Promise<void>

  currentArticle: string
  readArticle: (path: string, sha?: string, isLocale?: boolean) => Promise<void>
  setCurrentArticle: (content: string) => void
  saveCurrentArticle: (content: string) => Promise<void>

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

  allArticle: Article[]
  loadAllArticle: () => Promise<void>
}

const useArticleStore = create<NoteState>((set, get) => ({
  loading: false,
  setLoading: (loading: boolean) => { set({ loading }) },

  sortType: 'none',
  sortDirection: 'asc',
  setSortType: async (sortType: SortType) => {
    set({ sortType })
    const store = await Store.load('store.json')
    await store.set('sortType', sortType)
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  setSortDirection: async (direction: SortDirection) => {
    set({ sortDirection: direction })
    const store = await Store.load('store.json')
    await store.set('sortDirection', direction)
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  
  sortFileTree: (tree: DirTree[]) => {
    const sortType = get().sortType
    const sortDirection = get().sortDirection
    if (sortType === 'none') return tree
    
    const sortedTree = cloneDeep(tree)
    
    const sortFunction = (a: DirTree, b: DirTree) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      
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
    set({ activeFilePath: path })
    const store = await Store.load('store.json');
    await store.set('activeFilePath', path)
  },

  matchPosition: null,
  setMatchPosition: (position: number | null) => {
    set({ matchPosition: position })
  },

  html2md: false,
  initHtml2md: async () => {
    const store = await Store.load('store.json');
    const res = await store.get<boolean>('html2md')
    set({ html2md: res || false })
  },
  setHtml2md: async (html2md: boolean) => {
    set({ html2md })
    const store = await Store.load('store.json');
    store.set('html2md', html2md)
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
      if (entry.isFile) {
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
        } catch (error) {
          console.error(`Error getting stats for ${filePath}:`, error)
        }
      } else if (entry.isDirectory && entry.children) {
        const dirPath = await join(basePath, entry.name)
        await get().updateFileStats(dirPath, entry.children)
      }
    }
    return tree
  },
  
  loadFileTree: async () => {
    set({ fileTreeLoading: true })
    set({ fileTree: [] })
    
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

    // 读取工作区文件
    let dirs: DirTree[] = []
    if (workspace.isCustom) {
      // 自定义工作区
      dirs = (await readDir(workspace.path))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.endsWith('.md') || file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i))).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined
        }))
    } else {
      // 默认工作区
      dirs = (await readDir('article', { baseDir: BaseDirectory.AppData }))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.endsWith('.md') || file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i))).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined
        }))
    }
    
    // 递归处理工作区下的所有文件和文件夹
    await processEntriesRecursively(workspace.path, dirs as DirTree[]);
    
    async function processEntriesRecursively(parent: string, entries: DirTree[]) {
      for (const entry of entries) {
        if (entry.isDirectory) {
          const dir = await join(parent, entry.name);
          let children: DirTree[] = []
          
          if (workspace.isCustom) {
            children = (await readDir(dir))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.endsWith('.md') || file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
              .map(file => ({
                ...file,
                parent: entry,
                isEditing: false,
                isLocale: true,
                sha: ''
              })) as DirTree[]
          } else {
            const dirRelative = await toWorkspaceRelativePath(dir)
            const pathOptions = await getFilePathOptions(dirRelative)
            children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.endsWith('.md') || file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
              .map(file => ({
                ...file,
                parent: entry,
                isEditing: false,
                isLocale: true,
                sha: ''
              })) as DirTree[]
          }
          
          entry.children = children
          await processEntriesRecursively(dir, children)
        }
      }
    }
    
    // 更新文件统计信息
    await get().updateFileStats(workspace.path, dirs)
        
    // 排序文件树
    const sortedDirs = get().sortFileTree(dirs)
    set({ fileTree: sortedDirs })
    
    // 读取 github/gitee 同步文件
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      if (!accessToken) {
        set({ fileTreeLoading: false })
        return
      }
    } else {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      if (!giteeAccessToken) {
        set({ fileTreeLoading: false })
        return
      }
    }
    const collapsibleList = ['', ...get().collapsibleList];
    collapsibleList.forEach(async path => {
      const store = await Store.load('store.json');
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      
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
      }

      if (files) {
        files.forEach((file: GithubContent | GiteeFile) => {
          // 过滤以"."开头的文件和文件夹
          if (file.name.startsWith('.')) {
            return;
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
          set({ fileTree: dirs })
        });
        set({ fileTreeLoading: false })
      }
    })
  },
  // 加载文件夹内部的 Github/Gitee 仓库文件
  loadCollapsibleFiles: async (fullpath: string) => {
    const cacheTree: DirTree[] = get().fileTree
    const currentFolder = getCurrentFolder(fullpath, cacheTree)

    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
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
    }
    
    if (files && currentFolder) {
      files.forEach((file: GithubContent | GiteeFile) => {
        // 过滤以"."开头的文件和文件夹
        if (file.name.startsWith('.')) {
          return;
        }
        
        const index = currentFolder.children?.findIndex(item => item.name === file.name)
        if (index !== undefined && index !== -1 && currentFolder.children) {
          currentFolder.children[index].sha = file.sha
        } else {
          currentFolder.children?.push({
            name: file.path.replace(`${fullpath}/`, ''),
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
      set({ fileTree: cacheTree })
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
    } catch (error) {
      console.error('newFolder error', error)
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
    } catch (error) {
      console.error('newFileOnFolder error', error)
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
    } catch (error) {
      console.error('newFolderInFolder error', error)
    }
  },

  collapsibleList: [],
  initCollapsibleList: async () => {
    const store = await Store.load('store.json');
    const res = await store.get<string[]>('collapsibleList')
    const activeFilePath = await store.get<string>('activeFilePath')
    if (activeFilePath) {
      set({ activeFilePath })
      get().readArticle(activeFilePath)
    }
    set({ collapsibleList: res ? uniq(res.filter(item => !item.includes('.md'))) : [] })
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
    const store = await Store.load('store.json');
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList: uniq(collapsibleList).filter(item => !item.includes('.md')) })
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
    const store = await Store.load('store.json')
    await store.set('collapsibleList', folderPaths)
    set({ collapsibleList: uniq(folderPaths) })
    
    // Load all children for expanded folders
    for (const path of folderPaths) {
      await get().loadCollapsibleFiles(path)
    }
  },
  
  collapseAllFolders: async () => {
    const store = await Store.load('store.json')
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
    const store = await Store.load('store.json')
    await store.set('collapsibleList', [])
  },

  currentArticle: '',
  readArticle: async (path: string, sha?: string, isLocale = true) => {
    get().setLoading(true)
    if (isLocale) {
      try {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        set({ currentArticle: content })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        try {
          // 如果本地文件不存在，尝试从Github/Gitee读取
          const store = await Store.load('store.json');
          const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
          let content = '';
          switch (primaryBackupMethod) {
            case 'github':
              const githubRepo2 = await getSyncRepoName('github');
              content = decodeBase64ToString(await getGithubFiles({ path, repo: githubRepo2 }))
              break;
            case 'gitee':
              const giteeRepo2 = await getSyncRepoName('gitee');
              content = decodeBase64ToString(await getGiteeFiles({ path, repo: giteeRepo2 }))
              break;
            case 'gitlab':
              const gitlabRepo2 = await getSyncRepoName('gitlab');
              content = decodeBase64ToString((await getGitlabFileContent({ path, ref: 'main', repo: gitlabRepo2 })).content)
              break;
            default:
              break;
          }
          set({ currentArticle: content })
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
          // 文件既不在本地也不在远程
        }
      }
    } else {
      const store = await Store.load('store.json');
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      
      let res;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo3 = await getSyncRepoName('github');
          res = await getGithubFiles({ path, repo: githubRepo3 })
          break;
        case 'gitee':
          const giteeRepo3 = await getSyncRepoName('gitee');
          res = await getGiteeFiles({ path, repo: giteeRepo3 })
          break;
        case 'gitlab':
          const gitlabRepo3 = await getSyncRepoName('gitlab');
          res = await getGitlabFileContent({ path, ref: 'main', repo: gitlabRepo3 })
          break;
        default:
          break;
      }
      set({ currentArticle: decodeBase64ToString(res.content) })
      get().saveCurrentArticle(decodeBase64ToString(res.content))
    }
    get().setLoading(false)
  },

  // 向量计算相关状态
  vectorCalcTimer: null as NodeJS.Timeout | null,
  vectorCalcProgressInterval: null as NodeJS.Timeout | null,
  vectorCalcProgress: 0, // 0-100，表示距离自动计算的进度
  isVectorCalculating: false,
  lastEditTime: 0,
  pendingVectorContent: null as { path: string; content: string } | null,

  setCurrentArticle: (content: string) => {
    set({ currentArticle: content })
  },
  
  saveCurrentArticle: async (content: string) => {
    if (content) {
      const path = get().activeFilePath
      const workspace = await getWorkspacePath()
      
      // 检查文件是否存在（根据是否是自定义工作区）
      let isLocale = false
      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        isLocale = await exists(pathOptions.path)
      } else {
        isLocale = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
      
      // 确保目录结构存在
      if (path.includes('/')) {
        let dir = ''
        const dirPath = path.split('/')
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
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }
      
      // 更新缓存树
      if (!isLocale) {
        const cacheTree = cloneDeep(get().fileTree)
        const current = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
        if (current) {
          current.isLocale = true
        }
        set({ fileTree: cacheTree })
      }
      
      // 触发防抖向量计算（不再直接计算）
      if (path.endsWith('.md')) {
        get().scheduleVectorCalculation(path, content)
      }
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
      
      // 如果向量数据库已启用，执行向量计算
      if (vectorStore.isVectorDbEnabled) {
        await vectorStore.processDocument(path, content)
      }
      
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
    } catch (error) {
      console.error('执行向量计算失败:', error)
    } finally {
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