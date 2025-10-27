import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { filterSyncData, mergeSyncData } from '@/config/sync-exclusions'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles } from '@/lib/sync/github'
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee'
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles } from '@/lib/sync/gitlab'
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles } from '@/lib/sync/gitea'
import { getSyncRepoName } from '@/lib/sync/repo-utils'

interface SettingsSyncState {
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  
  uploadSettings: () => Promise<boolean>
  downloadSettings: () => Promise<boolean>
}

const useSettingsSyncStore = create<SettingsSyncState>((set) => ({
  syncState: false,
  setSyncState: (syncState) => set({ syncState }),
  
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => set({ lastSyncTime }),
  
  /**
   * 上传配置到远程仓库
   * 会自动过滤掉不应同步的字段（如工作区路径等）
   */
  uploadSettings: async () => {
    try {
      const store = await Store.load('store.json')
      const primaryBackupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea'>('primaryBackupMethod') || 'github'
      
      // 获取所有配置项
      const allSettings: Record<string, any> = {}
      const entries = await store.entries()
      
      for (const [key, value] of entries) {
        allSettings[key] = value
      }
      
      // 过滤掉不应同步的字段
      const syncableSettings = filterSyncData(allSettings)
      console.log(syncableSettings)
      
      // 转换为 JSON 字符串
      const content = JSON.stringify(syncableSettings, null, 2)
      
      // 转换为 base64
      const base64Content = btoa(unescape(encodeURIComponent(content)))
      
      // 获取仓库名称
      const repoName = await getSyncRepoName(primaryBackupMethod)
      
      // 根据主要备份方式选择上传函数
      let uploadFile: typeof uploadGithubFile
      
      switch (primaryBackupMethod) {
        case 'gitee':
          uploadFile = uploadGiteeFile
          break
        case 'gitlab':
          uploadFile = uploadGitlabFile
          break
        case 'gitea':
          uploadFile = uploadGiteaFile
          break
        default:
          uploadFile = uploadGithubFile
      }
      
      // 上传到远程仓库
      const result = await uploadFile({
        ext: 'json',
        file: base64Content,
        filename: 'settings.json',
        repo: repoName,
        path: '.data'
      })
      
      if (result) {
        // 更新最后同步时间
        const now = new Date().toISOString()
        set({ lastSyncTime: now })
        return true
      }
      
      return false
    } catch (error) {
      console.error('Failed to upload settings:', error)
      return false
    }
  },
  
  /**
   * 从远程仓库下载配置
   * 会保留本地的排除字段（如工作区路径等）
   */
  downloadSettings: async () => {
    try {
      const store = await Store.load('store.json')
      const primaryBackupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea'>('primaryBackupMethod') || 'github'
      
      // 获取本地配置（用于保留排除字段）
      const localSettings: Record<string, any> = {}
      const entries = await store.entries()
      
      for (const [key, value] of entries) {
        localSettings[key] = value
      }
      
      // 获取仓库名称
      const repoName = await getSyncRepoName(primaryBackupMethod)
      
      // 根据主要备份方式选择获取函数
      let getFiles: typeof githubGetFiles
      
      switch (primaryBackupMethod) {
        case 'gitee':
          getFiles = giteeGetFiles
          break
        case 'gitlab':
          getFiles = gitlabGetFiles
          break
        case 'gitea':
          getFiles = giteaGetFiles
          break
        default:
          getFiles = githubGetFiles
      }
      
      // 从远程仓库获取配置文件
      const files = await getFiles({
        path: '.data/settings.json',
        repo: repoName
      })
      
      if (!files || files.length === 0) {
        console.warn('No settings file found in remote repository')
        return false
      }
      
      // 解码 base64 内容
      const content = decodeURIComponent(escape(atob(files[0].content)))
      const remoteSettings = JSON.parse(content)
      
      // 合并配置：使用远程配置，但保留本地的排除字段
      const mergedSettings = mergeSyncData(localSettings, remoteSettings)
      
      // 保存合并后的配置到本地
      for (const [key, value] of Object.entries(mergedSettings)) {
        await store.set(key, value)
      }
      await store.save()
      
      // 更新最后同步时间
      const now = new Date().toISOString()
      set({ lastSyncTime: now })
      
      return true
    } catch (error) {
      console.error('Failed to download settings:', error)
      return false
    }
  }
}))

export default useSettingsSyncStore
