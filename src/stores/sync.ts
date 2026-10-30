import { GithubRepoInfo, UserInfo, SyncStateEnum } from '@/lib/sync/github.types'
import { GiteeRepoInfo } from '@/lib/sync/gitee'
import { GitlabUserInfo, GitlabProjectInfo } from '@/lib/sync/gitlab.types'
import { GiteaUserInfo, GiteaRepositoryInfo } from '@/lib/sync/gitea.types'
import type { SyncPlatform } from '@/types/sync'
import { create } from 'zustand'

interface SyncState {
  providerChecks: Partial<Record<SyncPlatform, 'checking' | 'settled'>>
  setProviderChecking: (platform: SyncPlatform) => void
  setProviderCheckSettled: (platform: SyncPlatform) => void

  // Github 相关状态
  userInfo?: UserInfo
  setUserInfo: (userInfo?: UserInfo) => void

  syncRepoState: SyncStateEnum
  setSyncRepoState: (syncRepoState: SyncStateEnum) => void
  syncRepoInfo?: GithubRepoInfo
  setSyncRepoInfo: (syncRepoInfo?: GithubRepoInfo) => void

  // Gitee 相关状态
  giteeUserInfo?: any
  setGiteeUserInfo: (giteeUserInfo?: any) => void

  giteeSyncRepoState: SyncStateEnum
  setGiteeSyncRepoState: (giteeSyncRepoState: SyncStateEnum) => void
  giteeSyncRepoInfo?: GiteeRepoInfo
  setGiteeSyncRepoInfo: (giteeSyncRepoInfo?: GiteeRepoInfo) => void

  // Gitlab 相关状态
  gitlabUserInfo?: GitlabUserInfo
  setGitlabUserInfo: (gitlabUserInfo?: GitlabUserInfo) => void

  gitlabSyncProjectState: SyncStateEnum
  setGitlabSyncProjectState: (gitlabSyncProjectState: SyncStateEnum) => void
  gitlabSyncProjectInfo?: GitlabProjectInfo
  setGitlabSyncProjectInfo: (gitlabSyncProjectInfo?: GitlabProjectInfo) => void

  // Gitea 相关状态
  giteaUserInfo?: GiteaUserInfo
  setGiteaUserInfo: (giteaUserInfo?: GiteaUserInfo) => void

  giteaSyncRepoState: SyncStateEnum
  setGiteaSyncRepoState: (giteaSyncRepoState: SyncStateEnum) => void
  giteaSyncRepoInfo?: GiteaRepositoryInfo
  setGiteaSyncRepoInfo: (giteaSyncRepoInfo?: GiteaRepositoryInfo) => void

  // S3 相关状态
  s3Connected: boolean
  setS3Connected: (connected: boolean) => void

  s3FileEtags: Record<string, string>
  setS3FileEtags: (etags: Record<string, string>) => void
  updateS3FileEtag: (path: string, etag: string) => void
  removeS3FileEtag: (path: string) => void

  // WebDAV 相关状态
  webdavConnected: boolean
  setWebDAVConnected: (connected: boolean) => void

  cloudFolderConnected: boolean
  setCloudFolderConnected: (connected: boolean) => void

  selfHostedConnected: boolean
  setSelfHostedConnected: (connected: boolean) => void
  selfHostedServiceAvailable: boolean | null
  setSelfHostedServiceAvailable: (available: boolean) => void
  selfHostedRuntimeReady: boolean
  setSelfHostedRuntimeReady: (ready: boolean) => void

  webdavFileEtags: Record<string, string>
  setWebDAVFileEtags: (etags: Record<string, string>) => void
  updateWebDAVFileEtag: (path: string, etag: string) => void
  removeWebDAVFileEtag: (path: string) => void
}

const useSyncStore = create<SyncState>((set) => ({
  providerChecks: {},
  setProviderChecking: (platform) => {
    set(state => ({ providerChecks: { ...state.providerChecks, [platform]: 'checking' } }))
  },
  setProviderCheckSettled: (platform) => {
    set(state => ({ providerChecks: { ...state.providerChecks, [platform]: 'settled' } }))
  },

  // Github 相关状态
  userInfo: undefined,
  setUserInfo: (userInfo) => {
    set({ userInfo })
  },

  syncRepoState: SyncStateEnum.fail,
  setSyncRepoState: (syncRepoState) => {
    set(state => ({
      syncRepoState,
      providerChecks: { ...state.providerChecks, github: syncRepoState === SyncStateEnum.checking || syncRepoState === SyncStateEnum.creating ? 'checking' : 'settled' },
    }))
  },
  syncRepoInfo: undefined,
  setSyncRepoInfo: (syncRepoInfo) => {
    set({ syncRepoInfo })
  },

  // Gitee 相关状态
  giteeUserInfo: undefined,
  setGiteeUserInfo: (giteeUserInfo) => {
    set({ giteeUserInfo })
  },

  giteeSyncRepoState: SyncStateEnum.fail,
  setGiteeSyncRepoState: (giteeSyncRepoState) => {
    set(state => ({
      giteeSyncRepoState,
      providerChecks: { ...state.providerChecks, gitee: giteeSyncRepoState === SyncStateEnum.checking || giteeSyncRepoState === SyncStateEnum.creating ? 'checking' : 'settled' },
    }))
  },
  giteeSyncRepoInfo: undefined,
  setGiteeSyncRepoInfo: (giteeSyncRepoInfo) => {
    set({ giteeSyncRepoInfo })
  },

  // Gitlab 相关状态
  gitlabUserInfo: undefined,
  setGitlabUserInfo: (gitlabUserInfo) => {
    set({ gitlabUserInfo })
  },

  gitlabSyncProjectState: SyncStateEnum.fail,
  setGitlabSyncProjectState: (gitlabSyncProjectState) => {
    set(state => ({
      gitlabSyncProjectState,
      providerChecks: { ...state.providerChecks, gitlab: gitlabSyncProjectState === SyncStateEnum.checking || gitlabSyncProjectState === SyncStateEnum.creating ? 'checking' : 'settled' },
    }))
  },
  gitlabSyncProjectInfo: undefined,
  setGitlabSyncProjectInfo: (gitlabSyncProjectInfo) => {
    set({ gitlabSyncProjectInfo })
  },

  // Gitea 相关状态
  giteaUserInfo: undefined,
  setGiteaUserInfo: (giteaUserInfo) => {
    set({ giteaUserInfo })
  },

  giteaSyncRepoState: SyncStateEnum.fail,
  setGiteaSyncRepoState: (giteaSyncRepoState) => {
    set(state => ({
      giteaSyncRepoState,
      providerChecks: { ...state.providerChecks, gitea: giteaSyncRepoState === SyncStateEnum.checking || giteaSyncRepoState === SyncStateEnum.creating ? 'checking' : 'settled' },
    }))
  },
  giteaSyncRepoInfo: undefined,
  setGiteaSyncRepoInfo: (giteaSyncRepoInfo) => {
    set({ giteaSyncRepoInfo })
  },

  // S3 相关状态
  s3Connected: false,
  setS3Connected: (connected) => {
    set(state => ({ s3Connected: connected, providerChecks: { ...state.providerChecks, s3: 'settled' } }))
  },

  s3FileEtags: {},
  setS3FileEtags: (etags) => {
    set({ s3FileEtags: etags })
  },
  updateS3FileEtag: (path, etag) => {
    set((state) => ({
      s3FileEtags: { ...state.s3FileEtags, [path]: etag },
    }))
  },
  removeS3FileEtag: (path) => {
    set((state) => {
      const newEtags = { ...state.s3FileEtags }
      delete newEtags[path]
      return { s3FileEtags: newEtags }
    })
  },

  // WebDAV 相关状态
  webdavConnected: false,
  setWebDAVConnected: (connected) => {
    set(state => ({ webdavConnected: connected, providerChecks: { ...state.providerChecks, webdav: 'settled' } }))
  },

  cloudFolderConnected: false,
  setCloudFolderConnected: (connected) => {
    set(state => ({ cloudFolderConnected: connected, providerChecks: { ...state.providerChecks, cloudFolder: 'settled' } }))
  },

  selfHostedConnected: false,
  setSelfHostedConnected: (connected) => {
    set(state => ({ selfHostedConnected: connected,
      ...(!connected ? { selfHostedServiceAvailable: null } : {}),
      providerChecks: { ...state.providerChecks, selfHosted: 'settled' } }))
  },
  selfHostedServiceAvailable: null,
  setSelfHostedServiceAvailable: available => {
    set(state => ({ selfHostedServiceAvailable: available,
      providerChecks: { ...state.providerChecks, selfHosted: 'settled' } }))
  },
  selfHostedRuntimeReady: false,
  setSelfHostedRuntimeReady: (ready) => {
    set({ selfHostedRuntimeReady: ready })
  },

  webdavFileEtags: {},
  setWebDAVFileEtags: (etags) => {
    set({ webdavFileEtags: etags })
  },
  updateWebDAVFileEtag: (path, etag) => {
    set((state) => ({
      webdavFileEtags: { ...state.webdavFileEtags, [path]: etag },
    }))
  },
  removeWebDAVFileEtag: (path) => {
    set((state) => {
      const newEtags = { ...state.webdavFileEtags }
      delete newEtags[path]
      return { webdavFileEtags: newEtags }
    })
  },
}))

export default useSyncStore
