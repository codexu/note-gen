'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Search, Settings, Minus, Square, X, PanelLeft, PanelRight, SquarePen, Cog, CalendarDays } from 'lucide-react'
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
import useUpdateStore from '@/stores/update'
import React from 'react'
import { ControlText } from '@/app/core/main/mark/control-text'
import { ControlRecording } from '@/app/core/main/mark/control-recording'
import { ControlScan } from '@/app/core/main/mark/control-scan'
import { ControlImage } from '@/app/core/main/mark/control-image'
import { ControlLink } from '@/app/core/main/mark/control-link'
import { ControlFile } from '@/app/core/main/mark/control-file'
import { ControlTodo } from '@/app/core/main/mark/control-todo'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { DraggableToolbarItem } from './draggable-toolbar-item'
import { useToolbarShortcuts } from '@/hooks/use-toolbar-shortcuts'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
  onActivityClick?: () => void
  activityOpen?: boolean
}

export function TitleBar({ onSearchClick, onActivityClick, activityOpen = false }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible, toggleLeftSidebar, toggleCenterPanel, toggleRightSidebar } = useSidebarStore()
  
  // 检查关闭面板后是否会导致"仅左"状态或无面板状态
  const wouldCauseLeftOnly = (currentVisible: boolean, panel: 'left' | 'center' | 'right') => {
    // 如果面板本来就不可见，不会导致问题（打开面板总是允许的）
    if (!currentVisible) return false
    
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    if (visibleCount === 1) return true // 不允许关闭最后一个面板
    
    if (visibleCount === 2) {
      // 只有当关闭中间或右侧面板会导致"仅左"状态时才阻止
      if (panel === 'center' && leftSidebarVisible && !rightSidebarVisible) return true
      if (panel === 'right' && leftSidebarVisible && !centerPanelVisible) return true
      // 关闭左侧面板不会导致"仅左"状态（它会变成"仅中"或"仅右"），所以允许
    }
    
    return false
  }
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()
  const { activeFilePath } = useArticleStore()
  const { hasUpdate } = useUpdateStore()
  const t = useTranslations()
  const { isModifierPressed } = useToolbarShortcuts()

  const getFileName = () => {
    if (!activeFilePath) return ''
    const parts = activeFilePath.split('/')
    return parts[parts.length - 1]
  }

  const searchPlaceholder = getFileName() || t('navigation.searchPlaceholder')


  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  )

  // 处理拖拽结束
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = recordToolbarConfig.findIndex((item) => item.id === active.id)
      const newIndex = recordToolbarConfig.findIndex((item) => item.id === over.id)
      
      const newItems = arrayMove(recordToolbarConfig, oldIndex, newIndex)
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index
      }))
      setRecordToolbarConfig(updatedItems)
    }
  }

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
        <div id="onboarding-target-record-toolbar" className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          <TooltipProvider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={recordToolbarConfig.filter(item => item.enabled).map(item => item.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex">
                  {recordToolbarConfig
                    .filter(item => item.enabled)
                    .sort((a, b) => a.order - b.order)
                    .map((item, index) => {
                      const renderToolbarItem = () => {
                        switch (item.id) {
                          case 'text':
                            return <ControlText />
                          case 'recording':
                            return <ControlRecording />
                          case 'scan':
                            return <ControlScan />
                          case 'image':
                            return <ControlImage />
                          case 'link':
                            return <ControlLink />
                          case 'file':
                            return <ControlFile />
                          case 'todo':
                            return <ControlTodo />
                          default:
                            return null
                        }
                      }
                      
                      return (
                        <DraggableToolbarItem
                          key={item.id}
                          id={item.id}
                          shortcutNumber={index + 1}
                          showShortcut={isModifierPressed && index < 9}
                        >
                          {renderToolbarItem()}
                        </DraggableToolbarItem>
                      )
                    })}
                </div>
              </SortableContext>
            </DndContext>
          </TooltipProvider>
        </div>

        {/* 中间搜索输入框 */}
        <div className="flex-1 flex items-center justify-center px-4 min-w-[200px] max-w-[600px] mx-auto" data-tauri-drag-region>
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
                className={`h-8 w-8 ${wouldCauseLeftOnly(leftSidebarVisible, 'left') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(leftSidebarVisible, 'left')) {
                    toggleLeftSidebar()
                  }
                }}
              >
                <PanelLeft className={`h-4 w-4 ${!leftSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{leftSidebarVisible ? t('navigation.hideLeftSidebar') : t('navigation.showLeftSidebar')}</p>
            </TooltipContent>
          </Tooltip>

          {/* 中间面板切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(centerPanelVisible, 'center') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(centerPanelVisible, 'center')) {
                    toggleCenterPanel()
                  }
                }}
              >
                <SquarePen className={`h-4 w-4 ${!centerPanelVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{centerPanelVisible ? t('navigation.hideCenterPanel') : t('navigation.showCenterPanel')}</p>
            </TooltipContent>
          </Tooltip>

          {/* 右侧边栏切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(rightSidebarVisible, 'right') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(rightSidebarVisible, 'right')) {
                    toggleRightSidebar()
                  }
                }}
              >
                <PanelRight className={`h-4 w-4 ${!rightSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{rightSidebarVisible ? t('navigation.hideRightSidebar') : t('navigation.showRightSidebar')}</p>
            </TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${activityOpen ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
                onClick={onActivityClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.activity')}</p>
            </TooltipContent>
          </Tooltip>

          <SyncToggle />
          
          <PinToggle />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 relative ${pathname.includes('/core/setting') ? 'bg-primary/50 hover:bg-primary/60' : ''}`}
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
                {hasUpdate && !pathname.includes('/core/setting') && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{pathname.includes('/core/setting') ? t('common.back') : t('common.settings')}</p>
            </TooltipContent>
          </Tooltip>
          
          <AppStatus />
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
