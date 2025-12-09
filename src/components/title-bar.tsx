'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

export function TitleBar() {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)

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
    <div
      className="h-[36px] w-full flex items-center select-none shrink-0 fixed top-0 left-0 right-0 z-[9999]"
      style={{
        // macOS 红绿灯按钮在左侧，需要留出空间（约 70px）
        paddingLeft: isMacOS ? '70px' : '0',
        // Windows/Linux 控制按钮在右侧，需要留出空间（约 138px）
        paddingRight: !isMacOS ? '138px' : '0',
      }}
    >
      <div
        className="flex-1 h-full cursor-default"
        onMouseDown={handleStartDrag}
        // 使用 data-tauri-drag-region 作为备用
        data-tauri-drag-region
      />
    </div>
  )
}
