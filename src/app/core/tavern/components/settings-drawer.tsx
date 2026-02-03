'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  X,
  Settings,
  User,
  BookOpen,
  Sliders,
  FileText,
  Moon,
  Sun,
  Globe,
  Info,
  ChevronRight,
  Bot,
  MessageSquare,
  ListOrdered,
  Blocks,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { TavernPersona, getDefaultPersona } from '@/db/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const [currentPersona, setCurrentPersona] = useState<TavernPersona | null>(null)

  // 路由变化时自动关闭侧边栏
  useEffect(() => {
    if (open) {
      onClose()
    }
  }, [pathname])

  // 加载当前用户设定
  useEffect(() => {
    async function loadPersona() {
      const persona = await getDefaultPersona()
      setCurrentPersona(persona)
    }
    if (open) {
      loadPersona()
    }
  }, [open])

  // 导航并关闭侧边栏
  const navigateTo = (path: string) => {
    onClose() // 先关闭侧边栏
    // 延迟导航，等待关闭动画完成
    setTimeout(() => {
      router.push(path)
    }, 150)
  }

  // Tavern 功能菜单
  const tavernMenuItems = [
    {
      icon: User,
      label: '用户设定',
      description: '管理您的角色设定',
      path: '/core/tavern/personas',
    },
    {
      icon: MessageSquare,
      label: '群组聊天',
      description: '多角色群聊管理',
      path: '/core/tavern/groups',
    },
    {
      icon: BookOpen,
      label: '世界书',
      description: '全局知识库管理',
      path: '/core/tavern/world-info',
    },
    {
      icon: Sliders,
      label: '预设管理',
      description: '提示词模板配置',
      path: '/core/tavern/presets',
    },
    {
      icon: ListOrdered,
      label: '提示词管理器',
      description: '管理和排序提示词',
      path: '/core/tavern/prompts',
    },
    {
      icon: FileText,
      label: '正则脚本',
      description: '文本处理规则',
      path: '/core/tavern/regex',
    },
    {
      icon: Blocks,
      label: '扩展管理',
      description: '管理应用扩展',
      path: '/core/extensions',
    },
  ]

  // 系统设置菜单
  const settingsMenuItems = [
    {
      icon: Bot,
      label: 'AI 模型',
      description: '配置 AI 接口和模型',
      path: '/core/setting/ai',
    },
    {
      icon: MessageSquare,
      label: '提示词',
      description: '系统提示词设置',
      path: '/core/setting/prompt',
    },
    {
      icon: Settings,
      label: '通用设置',
      description: '应用常规配置',
      path: '/core/setting/general',
    },
  ]

  return (
    <>
      {/* 遮罩层 - 从顶栏下方开始 */}
      <div
        className={cn(
          'fixed inset-0 top-9 bg-black/50 z-40 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* 侧边栏 - 从顶栏下方开始 */}
      <div
        className={cn(
          'fixed left-0 top-9 h-[calc(100vh-36px)] w-80 bg-background z-50 shadow-2xl',
          'transform transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* 头部 - 用户信息区域 (Telegram 风格) */}
        <div className="bg-primary/10 p-4 pb-6">
          <div className="flex items-start justify-between mb-4">
            <Avatar className="h-16 w-16 border-2 border-background shadow-lg">
              {currentPersona?.avatarPath ? (
                <AvatarImage src={convertFileSrc(currentPersona.avatarPath)} />
              ) : null}
              <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
                {currentPersona?.name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-foreground/70 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div>
            <h2 className="font-semibold text-lg">
              {currentPersona?.name || '未设置用户'}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
              {currentPersona?.description || '点击用户设定来配置您的角色'}
            </p>
          </div>
        </div>

        {/* 菜单列表 */}
        <ScrollArea className="flex-1 h-[calc(100%-180px)]">
          <div className="py-2">
            {/* Tavern 功能 */}
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              角色卡功能
            </div>
            {tavernMenuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => navigateTo(item.path)}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
              >
                <item.icon className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            <Separator className="my-2" />

            {/* 系统设置 */}
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              系统设置
            </div>
            {settingsMenuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => navigateTo(item.path)}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
              >
                <item.icon className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            <Separator className="my-2" />

            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
            >
              {theme === 'dark' ? (
                <Moon className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Sun className="h-5 w-5 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium">主题</div>
                <div className="text-xs text-muted-foreground">
                  {theme === 'dark' ? '深色模式' : '浅色模式'}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            {/* 语言设置 */}
            <button
              onClick={() => navigateTo('/core/setting/general')}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
            >
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">语言</div>
                <div className="text-xs text-muted-foreground">简体中文</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            <Separator className="my-2" />

            {/* 关于 */}
            <button
              onClick={() => navigateTo('/core/setting/about')}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
            >
              <Info className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">关于</div>
                <div className="text-xs text-muted-foreground">版本信息和帮助</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </ScrollArea>

        {/* 底部版本信息 */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-background">
          <div className="text-xs text-muted-foreground text-center">
            TavernNote v0.1.0
          </div>
        </div>
      </div>
    </>
  )
}
