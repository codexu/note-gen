import { GithubRepoInfo, UserInfo, SyncStateEnum } from '@/lib/github.types'
import { GiteeRepoInfo } from '@/lib/gitee'
import { GitlabUserInfo, GitlabProjectInfo } from '@/lib/gitlab.types'
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
}))

export default useSyncStore