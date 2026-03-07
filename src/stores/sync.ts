import { GithubRepoInfo, UserInfo, SyncStateEnum } from '@/lib/sync/github.types'
import { GiteeRepoInfo } from '@/lib/sync/gitee'
import { GitlabUserInfo, GitlabProjectInfo } from '@/lib/sync/gitlab.types'
import { GiteaUserInfo, GiteaRepositoryInfo } from '@/lib/sync/gitea.types'
import { create } from 'zustand'

interface SyncState {
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

  webdavFileEtags: Record<string, string>
  setWebDAVFileEtags: (etags: Record<string, string>) => void
  updateWebDAVFileEtag: (path: string, etag: string) => void
  removeWebDAVFileEtag: (path: string) => void
}

const useSyncStore = create<SyncState>((set) => ({
  // Github 相关状态
  userInfo: undefined,
  setUserInfo: (userInfo) => {
    set({ userInfo })
  },

  syncRepoState: SyncStateEnum.fail,
  setSyncRepoState: (syncRepoState) => {
    set({ syncRepoState })
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
    set({ giteeSyncRepoState })
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
    set({ gitlabSyncProjectState })
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
    set({ giteaSyncRepoState })
  },
  giteaSyncRepoInfo: undefined,
  setGiteaSyncRepoInfo: (giteaSyncRepoInfo) => {
    set({ giteaSyncRepoInfo })
  },

  // S3 相关状态
  s3Connected: false,
  setS3Connected: (connected) => {
    set({ s3Connected: connected })
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
    set({ webdavConnected: connected })
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