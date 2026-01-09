import { checkSyncRepoState, getUserInfo } from "@/lib/sync/github";
import { useEffect } from "react";
import useSettingStore from "@/stores/setting";
import { SyncStateEnum, UserInfo } from "@/lib/sync/github.types";
import useSyncStore from "@/stores/sync";
import { getSyncRepoName } from "@/lib/sync/repo-utils";

export default function AppStatus() {
  const { accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, primaryBackupMethod, setGithubUsername, setGitlabUsername, setGiteaUsername } = useSettingStore()
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
  async function handleGetUserInfo() {
    try {
      if (primaryBackupMethod === 'github') {
        if (accessToken) {
          setSyncRepoInfo(undefined)
          setSyncRepoState(SyncStateEnum.checking)
          const res = await getUserInfo()
          if (res) {
            setUserInfo(res.data as UserInfo)
            setGithubUsername(res.data.login)
          }
          await checkGithubRepos()
        }
      } else if (primaryBackupMethod === 'gitee') {
        if (giteeAccessToken) {
          // 获取 Gitee 用户信息
          setGiteeSyncRepoInfo(undefined)
          setGiteeSyncRepoState(SyncStateEnum.checking)
          const res = await import('@/lib/sync/gitee').then(module => module.getUserInfo())
          if (res) {
            setGiteeUserInfo(res)
          }
          // 注意：checkGiteeRepos 内部已经包含了 getUserInfo 调用，但这里保留以确保用户信息及时更新
          await checkGiteeRepos()
        }
      } else if (primaryBackupMethod === 'gitlab') {
        if (gitlabAccessToken) {
          // 获取 Gitlab 用户信息
          setGitlabSyncProjectInfo(undefined)
          setGitlabSyncProjectState(SyncStateEnum.checking)
          const { getUserInfo } = await import('@/lib/sync/gitlab')
          const res = await getUserInfo()
          if (res) {
            setGitlabUserInfo(res)
            setGitlabUsername(res.username)
          }
          await checkGitlabProjects()
        }
      } else if (primaryBackupMethod === 'gitea') {
        if (giteaAccessToken) {
          // 获取 Gitea 用户信息
          setGiteaSyncRepoInfo(undefined)
          setGiteaSyncRepoState(SyncStateEnum.checking)
          const { getUserInfo } = await import('@/lib/sync/gitea')
          const res = await getUserInfo()
          if (res) {
            setGiteaUserInfo(res)
            setGiteaUsername(res.username)
          }
          await checkGiteaRepos()
        }
      } else {
        setUserInfo(undefined)
        setGiteeUserInfo(undefined)
        setGitlabUserInfo(undefined)
        setGiteaUserInfo(undefined)
      }
    } catch (err) {
      console.error('Failed to get user info:', err)
    }
  }

  // 检查 GitHub 仓库状态（仅检查，不创建）
  async function checkGithubRepos() {
    try {
      // 检查同步仓库状态
      const githubRepo = await getSyncRepoName('github')
      const syncRepo = await checkSyncRepoState(githubRepo)
      if (syncRepo) {
        setSyncRepoInfo(syncRepo)
        setSyncRepoState(SyncStateEnum.success)
      } else {
        setSyncRepoInfo(undefined)
        setSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitHub repos:', err)
      setSyncRepoState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitlab 项目状态（仅检查，不创建）
  async function checkGitlabProjects() {
    try {
      const { checkSyncProjectState } = await import('@/lib/sync/gitlab')
      
      // 检查同步项目状态
      const gitlabRepo = await getSyncRepoName('gitlab')
      const syncProject = await checkSyncProjectState(gitlabRepo)
      if (syncProject) {
        setGitlabSyncProjectInfo(syncProject)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitlab projects:', err)
      setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitea 仓库状态（仅检查，不创建）
  async function checkGiteaRepos() {
    try {
      const { checkSyncRepoState } = await import('@/lib/sync/gitea')
      
      // 检查同步仓库状态
      const giteaRepo = await getSyncRepoName('gitea')
      const syncRepo = await checkSyncRepoState(giteaRepo)
      if (syncRepo) {
        setGiteaSyncRepoInfo(syncRepo)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitea repos:', err)
      setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }
  
  // 检查 Gitee 仓库状态（仅检查，不创建）
  async function checkGiteeRepos() {
    try {
      const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitee')
      
      // 先获取用户信息，确保 giteeUsername 已设置
      await getUserInfo();
      
      // 检查同步仓库状态
      const giteeRepo = await getSyncRepoName('gitee')
      const syncRepo = await checkSyncRepoState(giteeRepo)
      if (syncRepo) {
        setGiteeSyncRepoInfo(syncRepo)
        setGiteeSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteeSyncRepoInfo(undefined)
        setGiteeSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitee repos:', err)
      setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }

  // 监听 token 变化，获取用户信息
  useEffect(() => {
    if (accessToken || giteeAccessToken || gitlabAccessToken || giteaAccessToken) {
      handleGetUserInfo()
    }
  }, [accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, primaryBackupMethod])

  return null
}