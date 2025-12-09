'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Search, Settings, Highlighter, SquarePen, Minus, Square, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import { PinToggle } from './pin-toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
}

export function TitleBar({ onSearchClick }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const { toggleFileSidebar, toggleNoteSidebar, showFileSidebar, showNoteSidebar } = useSidebarStore()
  const t = useTranslations()
  
  // 主导航页面
  const mainPages = [
    {
      title: t('navigation.record'),
      url: '/core/record',
      icon: Highlighter,
    },
    {
      title: t('navigation.write'),
      url: '/core/article',
      icon: SquarePen,
    },
  ]
  
  // 当前激活的页面
  const currentPage = mainPages.find(page => pathname.startsWith(page.url))?.url || '/core/record'

  useEffect(() => {
    // 检查是否为移动设备
    setIsMobile(isMobileDevice())
    
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])

  async function handleTabChange(value: string) {
    // 如果点击的是当前页面，执行 toggle 切换显示/隐藏
    if (pathname.startsWith(value)) {
      if (value === '/core/article') {
        toggleFileSidebar()
      } else if (value === '/core/record') {
        toggleNoteSidebar()
      }
      return
    }
    
    // 路由切换，确保对应的侧边栏显示
    if (value === '/core/article') {
      await showFileSidebar()
    } else if (value === '/core/record') {
      await showNoteSidebar()
    }
    
    router.push(value)
    
    const store = await Store.load('store.json')
    store.set('currentPage', value)
  }

  const handleStartDrag = async (e: React.MouseEvent) => {
    // 防止拖拽时选中文本
    e.preventDefault()
    try {
      const window = getCurrentWindow()
      await window.startDragging()
    } catch (error) {
      console.error('Error starting drag:', error)
    }
  }

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow()
      await window.minimize()
    } catch (error) {
      console.error('Error minimizing window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow()
      await window.toggleMaximize()
    } catch (error) {
      console.error('Error maximizing window:', error)
    }
  }

  const handleClose = async () => {
    try {
      const window = getCurrentWindow()
      await window.close()
    } catch (error) {
      console.error('Error closing window:', error)
    }
  }

  // 移动端不显示标题栏
  if (isMobile) {
    return null
  }

  // 平台未知时不显示
  if (currentPlatform === 'unknown') {
    return null
  }

  // macOS: 红绿灯按钮在左侧，拖拽区域需要避开
  // Windows/Linux: 控制按钮在右侧，拖拽区域需要避开
  const isMacOS = currentPlatform === 'macos'

  return (
    <TooltipProvider>
      <div
        className="h-[36px] w-full flex flex-nowrap items-center select-none shrink-0 fixed top-0 left-0 right-0 z-[9999] border-b bg-background"
        style={{
          // macOS 红绿灯按钮在左侧，需要留出空间（约 70px）
          paddingLeft: isMacOS ? '70px' : '0',
        }}
      >
        {/* 左侧预留区域 - 可拖拽 */}
        <div 
          className="flex items-center gap-1 px-2 shrink-0 w-32"
          onMouseDown={handleStartDrag}
          data-tauri-drag-region
        >
          {/* 预留空白 */}
        </div>

        {/* 中间区域 - 包含拖拽区域和 Tabs */}
        <div className="flex-1 flex justify-center items-center relative">
          {/* 拖拽区域填充整个中间区域 */}
          <div
            className="absolute inset-0"
            onMouseDown={handleStartDrag}
            data-tauri-drag-region
          />
          {/* Tabs 在上层 */}
          <div className="relative z-10">
            <Tabs value={currentPage} onValueChange={handleTabChange}>
              <TabsList className="h-7">
                {mainPages.map((page) => {
                  const Icon = page.icon
                  return (
                    <TabsTrigger
                      key={page.url}
                      value={page.url}
                      className="px-3 py-0.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow gap-1"
                    >
                      <Icon className="size-3.5" />
                      <span className="text-xs">{page.title}</span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-1 px-2 shrink-0 relative z-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onSearchClick?.()}
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.search')}</p>
            </TooltipContent>
          </Tooltip>
          
          <PinToggle />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${pathname.includes('/core/setting') ? 'bg-accent' : ''}`}
                onClick={() => router.push('/core/setting')}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('common.settings')}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Windows 控制按钮 */}
        {!isMacOS && (
          <div className="flex items-center shrink-0 relative z-10">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMinimize}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMaximize}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
