'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Search, Settings, Minus, Square, X, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Cog } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import { PinToggle } from './pin-toggle'
import { SyncToggle } from './title-bar-toolbars/sync-toggle'
import AppStatus from './app-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import React from 'react'
import { ControlText } from '@/app/core/record/mark/control-text'
import { ControlRecording } from '@/app/core/record/mark/control-recording'
import { ControlScan } from '@/app/core/record/mark/control-scan'
import { ControlImage } from '@/app/core/record/mark/control-image'
import { ControlLink } from '@/app/core/record/mark/control-link'
import { ControlFile } from '@/app/core/record/mark/control-file'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
}

export function TitleBar({ onSearchClick }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const { leftSidebarVisible, rightSidebarVisible, toggleLeftSidebar, toggleRightSidebar } = useSidebarStore()
  const { recordToolbarConfig } = useSettingStore()
  const { activeFilePath } = useArticleStore()
  const t = useTranslations()

  const getFileName = () => {
    if (!activeFilePath) return ''
    const parts = activeFilePath.split('/')
    return parts[parts.length - 1]
  }

  const searchPlaceholder = getFileName() || t('navigation.searchPlaceholder')


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
        data-tauri-drag-region
      >
        {/* 左侧记录工具栏按钮 */}
        <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          <TooltipProvider>
            {recordToolbarConfig
              .filter(item => item.enabled)
              .sort((a, b) => a.order - b.order)
              .map(item => {
                switch (item.id) {
                  case 'text':
                    return <ControlText key={item.id} />
                  case 'recording':
                    return <ControlRecording key={item.id} />
                  case 'scan':
                    return <ControlScan key={item.id} />
                  case 'image':
                    return <ControlImage key={item.id} />
                  case 'link':
                    return <ControlLink key={item.id} />
                  case 'file':
                    return <ControlFile key={item.id} />
                  default:
                    return null
                }
              })}
          </TooltipProvider>
        </div>

        {/* 中间搜索输入框 */}
        <div className="flex-1 flex items-center justify-center px-4 min-w-[200px] max-w-[600px] mx-auto">
          <div 
            className="relative w-full h-6 max-w-md group cursor-pointer flex justify-center items-center border rounded-sm"
            onClick={() => onSearchClick?.()}
            data-tauri-drag-region="false"
          >
            <Search className="size-3.5 text-muted-foreground" />
            <div className="pl-2 text-xs text-muted-foreground transition-colors">
              <span className="truncate">{searchPlaceholder}</span>
            </div>
          </div>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          {/* 左侧边栏切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleLeftSidebar}
              >
                {leftSidebarVisible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{leftSidebarVisible ? t('navigation.hideLeftSidebar') : t('navigation.showLeftSidebar')}</p>
            </TooltipContent>
          </Tooltip>

          {/* 右侧边栏切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleRightSidebar}
              >
                {rightSidebarVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{rightSidebarVisible ? t('navigation.hideRightSidebar') : t('navigation.showRightSidebar')}</p>
            </TooltipContent>
          </Tooltip>
          
          <SyncToggle />
          
          <PinToggle />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${pathname.includes('/core/setting') ? 'bg-accent' : ''}`}
                onClick={() => {
                  if (pathname.includes('/core/setting')) {
                    router.push('/core/main')
                  } else {
                    router.push('/core/setting')
                  }
                }}
              >
                {pathname.includes('/core/setting') ? (
                  <Cog className="h-4 w-4" />
                ) : (
                  <Settings className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{pathname.includes('/core/setting') ? t('common.back') : t('common.settings')}</p>
            </TooltipContent>
          </Tooltip>
          
          <AppStatus inTitlebar />
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
