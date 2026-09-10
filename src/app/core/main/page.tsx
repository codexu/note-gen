'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import { PluginRightSidebar } from '@/components/plugins/plugin-right-sidebar'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useEffect, useState, useRef } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Layout, PanelImperativeHandle } from 'react-resizable-panels'
import { restoreEditorWindows } from '@/lib/editor-windows'
import { MainStatusBar } from './main-status-bar'

function getDefaultLayout(layoutKey: string) {
  const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
  const layout = localStorage.getItem(storageKey);
  
  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      // 验证总和是否为 100
      const sum = parsed.reduce((a: number, b: number) => a + b, 0);
      if (Math.abs(sum - 100) < 0.1) {
        return parsed;
      }
      // 如果总和不是 100，清除这个无效的值
      console.warn(`Invalid layout sum ${sum} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }
  
  // 根据布局组合返回默认值，但始终返回3个面板的尺寸
  switch (layoutKey) {
    case 'left-center-right':
      return [20, 50, 30]
    case 'left-center':
      return [30, 70, 0] // 右侧折叠
    case 'center-right':
      return [0, 60, 40] // 左侧折叠
    case 'left-right':
      return [50, 0, 50] // 中间折叠
    case 'left':
      return [100, 0, 0] // 只有左侧
    case 'center':
      return [0, 100, 0] // 只有中间
    case 'right':
      return [0, 0, 100] // 只有右侧
    default:
      return [30, 40, 30] // 默认三等分
  }
}

function ResizableWrapper() {
  const { 
    leftSidebarVisible, 
    centerPanelVisible, 
    rightSidebarVisible, 
    initSidebarState,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useSidebarStore()
  
  const leftPanelRef = useRef<PanelImperativeHandle>(null)
  const centerPanelRef = useRef<PanelImperativeHandle>(null)
  const rightPanelRef = useRef<PanelImperativeHandle>(null)
  
  const MIN_LEFT_SIDEBAR_WIDTH_PX = 320
  const MIN_RIGHT_SIDEBAR_WIDTH_PX = 280
  const MIN_EDITOR_WIDTH_PX = 400
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(24)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(!leftSidebarVisible)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(!rightSidebarVisible)

  useEffect(() => {
    void restoreEditorWindows()
  }, [])
  
  // 使用稳定的 layoutKey 用于存储，但不作为 React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')
  
  const calculateMinSizes = () => {
    const windowWidth = window.innerWidth
    const preferredSizes = {
      left: Math.min(Math.max(18, (MIN_LEFT_SIDEBAR_WIDTH_PX / windowWidth) * 100), 40),
      center: Math.min(Math.max(25, (MIN_EDITOR_WIDTH_PX / windowWidth) * 100), 50),
      right: Math.min(Math.max(15, (MIN_RIGHT_SIDEBAR_WIDTH_PX / windowWidth) * 100), 40),
    }
    const visibleMinimumTotal = (
      (leftSidebarVisible ? preferredSizes.left : 0)
      + (centerPanelVisible ? preferredSizes.center : 0)
      + (rightSidebarVisible ? preferredSizes.right : 0)
    )
    const scale = visibleMinimumTotal > 99 ? 99 / visibleMinimumTotal : 1

    setMinLeftSidebarSize(preferredSizes.left * (leftSidebarVisible ? scale : 1))
    setMinEditorSize(preferredSizes.center * (centerPanelVisible ? scale : 1))
    setMinRightSidebarSize(preferredSizes.right * (rightSidebarVisible ? scale : 1))
  }

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
  }, [initSidebarState])

  // 窗口或可见面板变化时，重新平衡各面板的最小宽度
  useEffect(() => {
    calculateMinSizes()

    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [centerPanelVisible, leftSidebarVisible, rightSidebarVisible])

  // 当面板可见性变化时，控制面板的折叠和展开
  useEffect(() => {
    const expandPanel = (panel: PanelImperativeHandle, fallbackSize: number) => {
      panel.expand()
      if (panel.getSize().asPercentage < 1) {
        panel.resize(`${fallbackSize}%`)
      }
    }

    const timer = setTimeout(() => {
      // 左侧面板
      if (leftPanelRef.current) {
        if (leftSidebarVisible) {
          expandPanel(leftPanelRef.current, minLeftSidebarSize)
        } else {
          leftPanelRef.current.collapse()
        }
      }
      
      // 中间面板
      if (centerPanelRef.current) {
        if (centerPanelVisible) {
          expandPanel(centerPanelRef.current, minEditorSize)
        } else {
          centerPanelRef.current.collapse()
        }
      }
      
      // 右侧面板
      if (rightPanelRef.current) {
        if (rightSidebarVisible) {
          expandPanel(rightPanelRef.current, minRightSidebarSize)
        } else {
          rightPanelRef.current.collapse()
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [leftSidebarVisible, centerPanelVisible, rightSidebarVisible, minEditorSize, minLeftSidebarSize, minRightSidebarSize])

  // 根据面板可见性渲染布局
  // 注意：左侧面板始终渲染，所以 layoutKey 用于存储，但实际布局计算需要考虑左侧始终存在
  
  // 计算实际需要的默认尺寸（所有面板始终存在）
  const getActualLayout = () => {
    const savedLayout = getDefaultLayout(layoutKey)
    
    // 所有面板都始终渲染，直接返回保存的布局或默认布局
    if (savedLayout.length === 3) {
      return savedLayout
    }
    
    // 如果保存的布局不是3个值，使用默认布局
    return [30, 40, 30] // 左侧30%，中间40%，右侧30%
  }
  
  const actualLayout = getActualLayout()

  const revealLeftPanel = () => {
    if (!leftSidebarVisible) {
      void toggleLeftSidebar()
      return
    }
    leftPanelRef.current?.expand()
  }

  const revealRightPanel = () => {
    if (!rightSidebarVisible) {
      void toggleRightSidebar()
      return
    }
    rightPanelRef.current?.expand()
  }
  
  const onLayout = (layout: Layout) => {
    // 保存当前面板布局
    const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
    const sizes = ['left', 'center', 'right'].map((id) => layout[id] ?? 0)
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  };

  // 根据可见面板数量动态构建布局
  const renderLayout = () => {
    const panels = []
    let index = 0

    // 左侧面板
    panels.push(
      <ResizablePanel
        key="left"
        id="left"
        panelRef={leftPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minLeftSidebarSize}%`}
        collapsible={true}
        collapsedSize="0%"
        onResize={(size) => setLeftPanelCollapsed(size.asPercentage < 0.1)}
      >
        <LeftSidebar />
      </ResizablePanel>
    )

    // 左侧和中间之间的分隔条
    // 当中间面板可见时显示；当中间面板不可见但左右都可见时也显示（作为左右分隔条）
    const shouldShowLeftHandle = centerPanelVisible || rightSidebarVisible
    const isLeftHandleCollapsed = leftPanelCollapsed || !leftSidebarVisible
    panels.push(
      <ResizableHandle
        key="handle-left-center"
        withHandle
        collapsed={isLeftHandleCollapsed}
        expandDirection="right"
        className={shouldShowLeftHandle ? undefined : 'hidden'}
        onClick={isLeftHandleCollapsed ? revealLeftPanel : undefined}
      />
    )

    // 中间面板
    panels.push(
      <ResizablePanel
        key="center"
        id="center"
        panelRef={centerPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minEditorSize}%`}
        collapsible={true}
        collapsedSize="0%"
      >
        <EditorLayout />
      </ResizablePanel>
    )

    // 中间和右侧之间的分隔条
    // 中间面板可见时作为右侧边界；仅左侧可见时保留右侧折叠句柄
    const shouldShowRightHandle = centerPanelVisible
      || (!centerPanelVisible && leftSidebarVisible && !rightSidebarVisible)
    const isRightHandleCollapsed = rightPanelCollapsed || !rightSidebarVisible
    panels.push(
      <ResizableHandle
        key="handle-center-right"
        withHandle
        collapsed={isRightHandleCollapsed}
        expandDirection="left"
        collapsedTriggerClassName="top-12 bottom-0"
        className={shouldShowRightHandle ? undefined : 'hidden'}
        onClick={isRightHandleCollapsed ? revealRightPanel : undefined}
      />
    )

    // 右侧面板
    panels.push(
      <ResizablePanel
        key="right"
        id="right"
        panelRef={rightPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minRightSidebarSize}%`}
        collapsible={true}
        collapsedSize="0%"
        onResize={(size) => setRightPanelCollapsed(size.asPercentage < 0.1)}
      >
        <PluginRightSidebar />
      </ResizablePanel>
    )

    return panels
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={onLayout}
        className="min-h-0 flex-1"
      >
        {renderLayout()}
      </ResizablePanelGroup>
      <MainStatusBar />
    </div>
  )
}

function Page() {
  useEffect(() => {
    // 保存当前页面路径
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()
  }, [])

  return <ResizableWrapper />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
