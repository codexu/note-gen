'use client'

import { MessageSquare, Highlighter, SquarePen, Settings, User } from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'
import { cn } from "@/lib/utils"
import { Store } from "@tauri-apps/plugin-store"
import { useTranslations } from 'next-intl'
import { useSidebarStore } from "@/stores/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { SyncStateEnum, UserInfo } from "@/lib/sync/github.types"
import { getUserInfo } from "@/lib/sync/github"
import { useEffect } from "react"


export function AppFootbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { toggleFileSidebar } = useSidebarStore()
  const { 
    githubUsername,
    accessToken,
    primaryBackupMethod,
    giteeAccessToken,
    gitlabAccessToken,
    setGithubUsername,
    setGitlabUsername,
  } = useSettingStore()
  const {
    setUserInfo,
    setSyncRepoInfo,
    setSyncRepoState,
    setGiteeSyncRepoInfo,
    setGiteeSyncRepoState,
    setGitlabSyncProjectInfo,
    setGitlabSyncProjectState,
    setGiteeUserInfo,
    setGitlabUserInfo,
    giteeUserInfo,
    gitlabUserInfo,
  } = useSyncStore()
  const t = useTranslations()
  
  // 检查是否有 GitHub 或 Gitee 账号，用于显示头像
  const hasGithubAccount = Boolean(githubUsername && accessToken)
  const hasGiteeAccount = Boolean(giteeAccessToken)
  const hasGitlabAccount = Boolean(gitlabAccessToken)
  const showAvatar = hasGithubAccount || hasGiteeAccount

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
        }
      } else {
        setUserInfo(undefined)
        setGiteeUserInfo(undefined)
        setGitlabUserInfo(undefined)
      }
    } catch (err) {
      console.error('Failed to get user info:', err)
    }
  }
  
  // 确定使用哪个账号用于头像显示
  const username = primaryBackupMethod === 'github' && hasGithubAccount 
    ? githubUsername 
    : primaryBackupMethod === 'gitee' && hasGiteeAccount
    ? giteeUserInfo?.login
    : primaryBackupMethod === 'gitlab' && hasGitlabAccount
    ? gitlabUserInfo?.username
    : ''
    
  // 底部导航菜单项
  const items = [
    {
      title: t('navigation.chat'),
      url: "/mobile/chat",
      icon: MessageSquare,
    },
    {
      title: t('navigation.record'),
      url: "/mobile/record",
      icon: Highlighter,
    },
    {
      title: t('navigation.write'),
      url: "/mobile/writing",
      icon: SquarePen,
    },
    {
      title: t('navigation.setting'),
      url: "/mobile/setting",
      icon: Settings,
    },
  ]

  // 处理导航点击事件
  async function menuHandler(item: typeof items[0]) {
    if (pathname === '/core/article' && item.url === '/core/article') {
      toggleFileSidebar()
    } else {
      router.push(item.url)
    }
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
  }

  useEffect(() => {
    if (accessToken || giteeAccessToken || gitlabAccessToken) {
      handleGetUserInfo()
    }
  }, [accessToken, giteeAccessToken, gitlabAccessToken, primaryBackupMethod])

  return (
    <div className="w-full border-t bg-background h-14">
      <div className="flex h-full items-center justify-around">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => menuHandler(item)}
            className={cn(
              "flex flex-col items-center justify-center w-1/4 py-1 transition-colors relative",
              pathname === item.url
                ? "text-primary"
                : "text-muted-foreground hover:text-primary"
            )}
          >
            {/* 最后一项可能显示头像 */}
            {index === items.length - 1 && showAvatar && username ? (
              <div className="flex flex-col items-center">
                <Avatar className="h-6 w-6">
                  <AvatarImage 
                    src={`https://github.com/${username}.png`} 
                    alt="Profile" 
                  />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs mt-0.5">{item.title}</span>
                {pathname === item.url && (
                  <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary" />
                )}
              </div>
            ) : (
              <>
                <item.icon className="h-5 w-5" />
                <span className="text-xs mt-0.5">{item.title}</span>
                {pathname === item.url && (
                  <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary" />
                )}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
