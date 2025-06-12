'use client'

import { MessageSquare, Highlighter, SquarePen, Settings, User } from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'
import { cn } from "@/lib/utils"
import { Store } from "@tauri-apps/plugin-store"
import { useTranslations } from 'next-intl'
import { useSidebarStore } from "@/stores/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import useSettingStore from "@/stores/setting"

export function AppFootbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { toggleFileSidebar } = useSidebarStore()
  const { 
    githubUsername,
    accessToken,
    primaryBackupMethod,
    giteeAccessToken
  } = useSettingStore()
  const t = useTranslations()
  
  // 检查是否有 GitHub 或 Gitee 账号，用于显示头像
  const hasGithubAccount = Boolean(githubUsername && accessToken)
  const hasGiteeAccount = Boolean(giteeAccessToken)
  const showAvatar = hasGithubAccount || hasGiteeAccount
  
  // 确定使用哪个账号用于头像显示
  const username = primaryBackupMethod === 'github' && hasGithubAccount 
    ? githubUsername 
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

  return (
    <div className="w-full h-40 border-t bg-background">
      <div className="flex items-center justify-around h-16">
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
