import { GithubRepoInfo, UserInfo } from '@/lib/github.types'
import { GiteeRepoInfo } from '@/lib/gitee'
import { create } from 'zustand'

export enum SyncStateEnum {
  checking = '检测中',
  success = '可用',
  creating = '创建中',
  fail = '不可用',
}

interface SyncState {
  // Github 相关状态
  userInfo?: UserInfo
  setUserInfo: (userInfo?: UserInfo) => void

  imageRepoState: SyncStateEnum
  setImageRepoState: (imageRepoState: SyncStateEnum) => void
  imageRepoInfo?: GithubRepoInfo
  setImageRepoInfo: (imageRepoInfo?: GithubRepoInfo) => void

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
}

const useSyncStore = create<SyncState>((set) => ({
  // Github 相关状态
  userInfo: undefined,
  setUserInfo: (userInfo) => {
    set({ userInfo })
  },

  imageRepoState: SyncStateEnum.fail,
  setImageRepoState: (imageRepoState) => {
    set({ imageRepoState })
  },
  imageRepoInfo: undefined,
  setImageRepoInfo: (imageRepoInfo) => {
    set({ imageRepoInfo })
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
}))

export default useSyncStore