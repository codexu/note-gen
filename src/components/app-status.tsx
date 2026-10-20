import { checkSyncRepoState, getUserInfo } from "@/lib/sync/github";
import { useEffect, useRef } from "react";
import useSettingStore from "@/stores/setting";
import { SyncStateEnum, UserInfo } from "@/lib/sync/github.types";
import useSyncStore from "@/stores/sync";
import { getOptionalSyncRepoName } from "@/lib/sync/repo-utils";

export default function AppStatus() {
  const statusRequestRef = useRef(0)
  const {
    accessToken,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
    primaryBackupMethod,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
    setGithubUsername,
    setGitlabUsername,
    setGiteaUsername,
  } = useSettingStore()
  const { 
    setUserInfo, 
    setGiteeUserInfo,
    setGitlabUserInfo,
    setGiteaUserInfo,
    setSyncRepoState,
    setSyncRepoInfo,
    setGiteeSyncRepoState,
    setGiteeSyncRepoInfo,
    setGitlabSyncProjectState,
    setGitlabSyncProjectInfo,
    setGiteaSyncRepoState,
    setGiteaSyncRepoInfo
  } = useSyncStore()

  // 获取当前主要备份方式的用户信息
  async function handleGetUserInfo(requestId: number) {
    try {
      if (primaryBackupMethod === 'github') {
        if (accessToken) {
          setSyncRepoInfo(undefined)
          setSyncRepoState(SyncStateEnum.checking)
          const res = await getUserInfo()
          if (requestId !== statusRequestRef.current) return
          if (res) {
            setUserInfo(res.data as UserInfo)
            setGithubUsername(res.data.login)
          }
          await checkGithubRepos(requestId)
        }
      } else if (primaryBackupMethod === 'gitee') {
        if (giteeAccessToken) {
          // 获取 Gitee 用户信息
          setGiteeSyncRepoInfo(undefined)
          setGiteeSyncRepoState(SyncStateEnum.checking)
          const res = await import('@/lib/sync/gitee').then(module => module.getUserInfo())
          if (requestId !== statusRequestRef.current) return
          if (res) {
            setGiteeUserInfo(res)
          }
          // 注意：checkGiteeRepos 内部已经包含了 getUserInfo 调用，但这里保留以确保用户信息及时更新
          await checkGiteeRepos(requestId)
        }
      } else if (primaryBackupMethod === 'gitlab') {
        if (gitlabAccessToken) {
          // 获取 Gitlab 用户信息
          setGitlabSyncProjectInfo(undefined)
          setGitlabSyncProjectState(SyncStateEnum.checking)
          const { getUserInfo } = await import('@/lib/sync/gitlab')
          const res = await getUserInfo()
          if (requestId !== statusRequestRef.current) return
          if (res) {
            setGitlabUserInfo(res)
            setGitlabUsername(res.username)
          }
          await checkGitlabProjects(requestId)
        }
      } else if (primaryBackupMethod === 'gitea') {
        if (giteaAccessToken) {
          // 获取 Gitea 用户信息
          setGiteaSyncRepoInfo(undefined)
          setGiteaSyncRepoState(SyncStateEnum.checking)
          const { getUserInfo } = await import('@/lib/sync/gitea')
          const res = await getUserInfo()
          if (requestId !== statusRequestRef.current) return
          if (res) {
            setGiteaUserInfo(res)
            setGiteaUsername(res.username)
          }
          await checkGiteaRepos(requestId)
        }
      } else {
        setUserInfo(undefined)
        setGiteeUserInfo(undefined)
        setGitlabUserInfo(undefined)
        setGiteaUserInfo(undefined)
      }
    } catch (err) {
      console.error('Failed to get user info:', err)
      if (requestId !== statusRequestRef.current) return

      if (primaryBackupMethod === 'github') {
        setSyncRepoInfo(undefined)
        setSyncRepoState(SyncStateEnum.fail)
      } else if (primaryBackupMethod === 'gitee') {
        setGiteeSyncRepoInfo(undefined)
        setGiteeSyncRepoState(SyncStateEnum.fail)
      } else if (primaryBackupMethod === 'gitlab') {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
      } else if (primaryBackupMethod === 'gitea') {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    }
  }

  // 检查 GitHub 仓库状态（仅检查，不创建）
  async function checkGithubRepos(requestId: number) {
    try {
      // 检查同步仓库状态
      const githubRepo = await getOptionalSyncRepoName('github')
      if (requestId !== statusRequestRef.current) return
      if (!githubRepo) {
        setSyncRepoInfo(undefined)
        setSyncRepoState(SyncStateEnum.fail)
        return
      }
      const syncRepo = await checkSyncRepoState(githubRepo)
      if (requestId !== statusRequestRef.current) return
      if (syncRepo) {
        setSyncRepoInfo(syncRepo)
        setSyncRepoState(SyncStateEnum.success)
      } else {
        setSyncRepoInfo(undefined)
        setSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitHub repos:', err)
      if (requestId === statusRequestRef.current) setSyncRepoState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitlab 项目状态（仅检查，不创建）
  async function checkGitlabProjects(requestId: number) {
    try {
      const { checkSyncProjectState } = await import('@/lib/sync/gitlab')
      
      // 检查同步项目状态
      const gitlabRepo = await getOptionalSyncRepoName('gitlab')
      if (requestId !== statusRequestRef.current) return
      if (!gitlabRepo) {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
        return
      }
      const syncProject = await checkSyncProjectState(gitlabRepo)
      if (requestId !== statusRequestRef.current) return
      if (syncProject) {
        setGitlabSyncProjectInfo(syncProject)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitlab projects:', err)
      if (requestId === statusRequestRef.current) setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitea 仓库状态（仅检查，不创建）
  async function checkGiteaRepos(requestId: number) {
    try {
      const { checkSyncRepoState } = await import('@/lib/sync/gitea')
      
      // 检查同步仓库状态
      const giteaRepo = await getOptionalSyncRepoName('gitea')
      if (requestId !== statusRequestRef.current) return
      if (!giteaRepo) {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
        return
      }
      const syncRepo = await checkSyncRepoState(giteaRepo)
      if (requestId !== statusRequestRef.current) return
      if (syncRepo) {
        setGiteaSyncRepoInfo(syncRepo)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitea repos:', err)
      if (requestId === statusRequestRef.current) setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitee 仓库状态（仅检查，不创建）
  async function checkGiteeRepos(requestId: number) {
    try {
      const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitee')
      
      // 先获取用户信息，确保 giteeUsername 已设置
      await getUserInfo();
      if (requestId !== statusRequestRef.current) return
      
      // 检查同步仓库状态
      const giteeRepo = await getOptionalSyncRepoName('gitee')
      if (requestId !== statusRequestRef.current) return
      if (!giteeRepo) {
        setGiteeSyncRepoInfo(undefined)
        setGiteeSyncRepoState(SyncStateEnum.fail)
        return
      }
      const syncRepo = await checkSyncRepoState(giteeRepo)
      if (requestId !== statusRequestRef.current) return
      if (syncRepo) {
        setGiteeSyncRepoInfo(syncRepo)
        setGiteeSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteeSyncRepoInfo(undefined)
        setGiteeSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitee repos:', err)
      if (requestId === statusRequestRef.current) setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }

  // 监听 token 变化，获取用户信息
  useEffect(() => {
    const requestId = ++statusRequestRef.current
    if (accessToken || giteeAccessToken || gitlabAccessToken || giteaAccessToken) {
      void handleGetUserInfo(requestId)
    }

    return () => {
      if (statusRequestRef.current === requestId) statusRequestRef.current += 1
    }
  }, [
    accessToken,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
    primaryBackupMethod,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
  ])

  return null
}
