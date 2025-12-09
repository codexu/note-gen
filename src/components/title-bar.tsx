'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { ImageUp, Search, Settings, Highlighter, SquarePen, Minus, Square, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import useImageStore from '@/stores/imageHosting'
import { PinToggle } from './pin-toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

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
  const { imageRepoUserInfo } = useImageStore()
  const [items, setItems] = useState([
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
    {
      title: t('navigation.search'),
      url: '/core/search',
      icon: Search,
    },
  ])

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

  useEffect(() => {
    async function initGithubImageHosting() {
      const store = await Store.load('store.json')
      const githubImageUsername = await store.get<string>('githubImageUsername')
      const githubImageAccessToken = await store.get<string>('githubImageAccessToken')
      if (githubImageUsername && githubImageAccessToken && !items.find(item => item.url === '/core/image')) {
        setItems([...items, {
          title: t('navigation.githubImageHosting'),
          url: '/core/image',
          icon: ImageUp,
        }])
      }
    }
    initGithubImageHosting()
  }, [imageRepoUserInfo])

  async function menuHandler(item: typeof items[0]) {
    // 如果是搜索按钮，打开搜索对话框
    if (item.url === '/core/search') {
      onSearchClick?.()
      return
    }

    // 如果是当前页面，执行 toggle 切换显示/隐藏
    if (pathname === '/core/article' && item.url === '/core/article') {
      toggleFileSidebar()
    } else if (pathname === '/core/record' && item.url === '/core/record') {
      toggleNoteSidebar()
    } else {
      // 如果是路由切换，确保对应的侧边栏显示
      if (item.url === '/core/article') {
        await showFileSidebar()
      } else if (item.url === '/core/record') {
        await showNoteSidebar()
      }
      router.push(item.url)
    }
    const store = await Store.load('store.json')
    store.set('currentPage', item.url)
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
        {/* 左侧导航按钮 */}
        <div className="flex items-center gap-1 px-2 shrink-0">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.url}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 ${pathname === item.url ? 'bg-accent' : ''}`}
                    onClick={() => menuHandler(item)}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{item.title}</p>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        {/* 中间拖拽区域 */}
        <div
          className="flex-1 h-full cursor-default"
          onMouseDown={handleStartDrag}
          data-tauri-drag-region
        />

        {/* 右侧按钮 */}
        <div className="flex items-center gap-1 px-2 shrink-0">
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
          <div className="flex items-center shrink-0">
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
