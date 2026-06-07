'use client'

import { MessageSquare, Highlighter, SquarePen, Settings, User, Plus } from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'
import { cn } from "@/lib/utils"
import { Store } from "@tauri-apps/plugin-store"
import { useTranslations } from 'next-intl'
import { useSidebarStore } from "@/stores/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { UserInfo } from "@/lib/sync/github.types"
import { getUserInfo } from "@/lib/sync/github"
import { useEffect, useState } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { MobileRecordTools } from '@/components/mobile-record-tools'
import {
  getAutoDataSyncState,
  subscribeAutoDataSyncState,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'

type MobileSyncIndicator = 'none' | 'syncing' | 'warning' | 'attention'

// 普通导航按钮组件
interface NormalNavButtonProps {
  item: {
    title: string
    url: string
    icon: React.ComponentType<{ className?: string }>
  }
  isActive: boolean
  syncIndicator?: MobileSyncIndicator
  onClick: () => void
}

function getSyncIndicatorClassName(indicator: MobileSyncIndicator) {
  switch (indicator) {
    case 'attention':
      return 'bg-destructive'
    case 'warning':
      return 'bg-amber-500'
    case 'syncing':
      return 'bg-primary animate-pulse'
    case 'none':
    default:
      return ''
  }
}

function NormalNavButton({ item, isActive, syncIndicator = 'none', onClick }: NormalNavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center w-1/5 py-1 transition-colors relative",
        isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
      )}
    >
      <item.icon className="h-5 w-5" />
      <span className="text-xs mt-0.5">{item.title}</span>
      {syncIndicator !== 'none' ? (
        <span className={cn('absolute right-4 top-1 size-2 rounded-full', getSyncIndicatorClassName(syncIndicator))} />
      ) : null}
      {isActive && (
        <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary" />
      )}
    </button>
  )
}

// 头像导航按钮组件
interface AvatarNavButtonProps {
  item: {
    title: string
    url: string
  }
  isActive: boolean
  avatarUrl: string
  syncIndicator?: MobileSyncIndicator
  onClick: () => void
}

function AvatarNavButton({ item, isActive, avatarUrl, syncIndicator = 'none', onClick }: AvatarNavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center w-1/5 py-1 transition-colors relative",
        isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
      )}
    >
      <div className="flex flex-col items-center">
        <div className="relative">
          <Avatar className="h-6 w-6">
            <AvatarImage
              src={avatarUrl}
              alt="Profile"
            />
            <AvatarFallback>
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          {syncIndicator !== 'none' ? (
            <span className={cn('absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background', getSyncIndicatorClassName(syncIndicator))} />
          ) : null}
        </div>
        <span className="text-xs mt-0.5">{item.title}</span>
        {isActive && (
          <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary" />
        )}
      </div>
    </button>
  )
}

function getMobileSyncIndicator(
  autoDataSyncEnabled: boolean,
  autoDataSyncState: AutoDataSyncState
): MobileSyncIndicator {
  if (!autoDataSyncEnabled) {
    return 'none'
  }

  if (autoDataSyncState.phase === 'failed' || autoDataSyncState.phase === 'conflict') {
    return 'attention'
  }

  if (autoDataSyncState.phase === 'waiting_provider') {
    return 'warning'
  }

  if (
    autoDataSyncState.isSyncing ||
    autoDataSyncState.phase === 'checking_remote' ||
    autoDataSyncState.phase === 'uploading' ||
    autoDataSyncState.phase === 'downloading'
  ) {
    return 'syncing'
  }

  return 'none'
}

export function AppFootbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { toggleFileSidebar } = useSidebarStore()
  const [quickRecordOpen, setQuickRecordOpen] = useState(false)
  const [autoDataSyncState, setAutoDataSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())
  const { 
    githubUsername,
    accessToken,
    primaryBackupMethod,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
    autoDataSyncEnabled,
    setGithubUsername,
    setGitlabUsername,
    setGiteaUsername,
  } = useSettingStore()
  const {
    setUserInfo,
    setSyncRepoInfo,
    setGiteeSyncRepoInfo,
    setGitlabSyncProjectInfo,
    setGiteeUserInfo,
    setGitlabUserInfo,
    setGiteaSyncRepoInfo,
    setGiteaUserInfo,
    giteeUserInfo,
    gitlabUserInfo,
    giteaUserInfo,
  } = useSyncStore()
  const t = useTranslations()
  
  // 检查是否有 GitHub、Gitee、Gitlab 或 Gitea 账号，用于显示头像
  const hasGithubAccount = Boolean(githubUsername && accessToken)
  const hasGiteeAccount = Boolean(giteeAccessToken)
  const hasGitlabAccount = Boolean(gitlabAccessToken)
  const hasGiteaAccount = Boolean(giteaAccessToken)
  const showAvatar = hasGithubAccount || hasGiteeAccount || hasGitlabAccount || hasGiteaAccount
  const syncIndicator = getMobileSyncIndicator(autoDataSyncEnabled, autoDataSyncState)

  // 获取当前主要备份方式的用户信息
  async function handleGetUserInfo() {
    try {
      if (primaryBackupMethod === 'github') {
        if (accessToken) {
          setSyncRepoInfo(undefined)
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
          const res = await import('@/lib/sync/gitee').then(module => module.getUserInfo())
          if (res) {
            setGiteeUserInfo(res)
          }
        }
      } else if (primaryBackupMethod === 'gitlab') {
        if (gitlabAccessToken) {
          // 获取 Gitlab 用户信息
          setGitlabSyncProjectInfo(undefined)
          const { getUserInfo } = await import('@/lib/sync/gitlab')
          const res = await getUserInfo()
          if (res) {
            setGitlabUserInfo(res)
            setGitlabUsername(res.username)
          }
        }
      } else if (primaryBackupMethod === 'gitea') {
        if (giteaAccessToken) {
          // 获取 Gitea 用户信息
          setGiteaSyncRepoInfo(undefined)
          const { getUserInfo } = await import('@/lib/sync/gitea')
          const res = await getUserInfo()
          if (res) {
            setGiteaUserInfo(res)
            setGiteaUsername(res.username)
          }
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
  
  // 根据主备份方式获取正确的头像地址
  const getAvatarUrl = () => {
    switch (primaryBackupMethod) {
      case 'github':
        if (hasGithubAccount && githubUsername) {
          return `https://github.com/${githubUsername}.png`
        }
        break
      case 'gitee':
        if (hasGiteeAccount && giteeUserInfo?.avatar_url) {
          return giteeUserInfo.avatar_url
        }
        break
      case 'gitlab':
        if (hasGitlabAccount && gitlabUserInfo?.avatar_url) {
          return gitlabUserInfo.avatar_url
        }
        break
      case 'gitea':
        if (hasGiteaAccount && giteaUserInfo?.avatar_url) {
          return giteaUserInfo.avatar_url
        }
        break
      default:
        return ''
    }
    return ''
  }

  const avatarUrl = getAvatarUrl()
    
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
      title: t('navigation.quickRecord'),
      url: "#quick-record",
      icon: Plus,
      isQuickRecord: true,
    },
    {
      title: t('navigation.write'),
      url: "/mobile/writing",
      icon: SquarePen,
    },
    {
      title: t('navigation.me'),
      url: "/mobile/setting",
      icon: Settings,
    },
  ]

  // 处理导航点击事件
  async function menuHandler(item: typeof items[0]) {
    if (item.isQuickRecord) {
      // 快捷记录按钮：打开浮动弹窗
      setQuickRecordOpen(!quickRecordOpen)
      return
    }
    
    if (pathname === '/core/article' && item.url === '/core/article') {
      toggleFileSidebar()
    } else {
      router.push(item.url)
    }
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
  }

  useEffect(() => {
    if (accessToken || giteeAccessToken || gitlabAccessToken || giteaAccessToken) {
      handleGetUserInfo()
    }
  }, [accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, primaryBackupMethod])

  useEffect(() => subscribeAutoDataSyncState(setAutoDataSyncState), [])

  return (
    <div className="w-full border-t bg-background h-14 relative">
      <div className="flex h-full items-center justify-around">
        {items.map((item, index) => {
          // 快捷记录按钮 - 使用 Popover
          if (item.isQuickRecord) {
            return (
              <Popover key={index} open={quickRecordOpen} onOpenChange={setQuickRecordOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-1/5 flex items-center justify-center"
                    aria-label={item.title}
                    title={item.title}
                  >
                    <span
                      className={cn(
                        "inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95",
                        quickRecordOpen && "ring-2 ring-primary/30"
                      )}
                    >
                      <Plus className="size-6" />
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  side="top"
                  sideOffset={10}
                  collisionPadding={12}
                  className="w-[min(92vw,360px)] rounded-2xl p-3"
                >
                    <MobileRecordTools onClose={() => setQuickRecordOpen(false)} />
                </PopoverContent>
              </Popover>
            )
          }
          
          // 头像按钮（最后一项且有头像）
          const isAvatarButton = index === items.length - 1 && showAvatar && avatarUrl
          const itemSyncIndicator = item.url === '/mobile/setting' ? syncIndicator : 'none'
          if (isAvatarButton) {
            return (
              <AvatarNavButton
                key={index}
                item={item}
                isActive={pathname === item.url}
                avatarUrl={avatarUrl}
                syncIndicator={itemSyncIndicator}
                onClick={() => menuHandler(item)}
              />
            )
          }
          
          // 普通按钮
          return (
            <NormalNavButton
              key={index}
              item={item}
              isActive={pathname === item.url}
              syncIndicator={itemSyncIndicator}
              onClick={() => menuHandler(item)}
            />
          )
        })}
      </div>
    </div>
  )
}
