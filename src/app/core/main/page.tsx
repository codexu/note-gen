'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useUiV3 } from "@/lib/fork-ui"
import { usePageVisibility } from "@/lib/fork-overlays/use-page-visibility"
import useHomeStore from "@/stores/home"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import { PluginRightSidebar } from '@/components/plugins/plugin-right-sidebar'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Layout, PanelImperativeHandle } from 'react-resizable-panels'
import { restoreEditorWindows } from '@/lib/editor-windows'
import { MainStatusBar } from './main-status-bar'
import { ForkServices } from './fork-services'

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
      return [16, 54, 30] // Fork：原本 20，左側欄太寬
    case 'left-center':
      return [20, 80, 0] // 右侧折叠（Fork：原本 30）
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
  
  const isV3 = useUiV3() // Fork（almanac ALMNC-20）：v3 左欄固定 240px
  const pages = usePageVisibility()
  const homeLoaded = useHomeStore(state => state.loaded)
  const workspaceCovered = isV3 && ((pages.home && homeLoaded) || pages.decide || pages.collect
    || pages.threads || pages.week || pages.knowledge)
  const MIN_LEFT_SIDEBAR_WIDTH_PX = 240 // Fork：原本 320；almanac v5 規格 240px
  const MIN_RIGHT_SIDEBAR_WIDTH_PX = 280
  const MIN_EDITOR_WIDTH_PX = 400
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(24)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(!leftSidebarVisible)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(!rightSidebarVisible)
  const [leftPanelWidth, setLeftPanelWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageBox, setPageBox] = useState<PageBox | null>(null)

  // Fork（UI 一致性）：首頁與 Inbox 頁蓋在工作區面板上，位置與圓角跟工作區面板一致。
  // 直接量元素：面板是平貼（預設）還是卡片（自訂 CSS 的內距與圓角）都對得上。
  useEffect(() => {
    const container = containerRef.current
    const group = container?.querySelector<HTMLElement>(':scope > [data-slot="resizable-panel-group"]')
    if (!container || !group) return
    const panels = [...group.querySelectorAll<HTMLElement>(':scope > [data-slot="resizable-panel"]')]
    const measure = () => setPageBox(measurePageBox(container, group, panels))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(group)
    panels.forEach(panel => observer.observe(panel))
    return () => observer.disconnect()
  }, [leftPanelWidth, leftSidebarVisible, centerPanelVisible, rightSidebarVisible, leftPanelCollapsed, rightPanelCollapsed])

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
      left: Math.min(Math.max(12, (MIN_LEFT_SIDEBAR_WIDTH_PX / windowWidth) * 100), 40),
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
    const leftLayoutSize = actualLayout[index++]
    panels.push(
      <ResizablePanel
        key="left"
        id="left"
        panelRef={leftPanelRef}
        defaultSize={isV3 ? `${MIN_LEFT_SIDEBAR_WIDTH_PX}px` : `${leftLayoutSize}%`}
        minSize={isV3 ? `${MIN_LEFT_SIDEBAR_WIDTH_PX}px` : `${minLeftSidebarSize}%`}
        maxSize={isV3 ? `${MIN_LEFT_SIDEBAR_WIDTH_PX}px` : undefined}
        collapsible={true}
        collapsedSize="0%"
        onResize={(size) => {
          setLeftPanelCollapsed(size.asPercentage < 0.1)
          setLeftPanelWidth(size.inPixels)
        }}
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
        inert={workspaceCovered}
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
        inert={workspaceCovered}
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
    <div
      ref={containerRef}
      className="relative flex h-full min-h-0 flex-col"
      // Fork #31: relative 讓首頁、Inbox 頁蓋住編輯器與右側欄；--page-* 由 measurePageBox 量出來
      style={pageBoxStyle(pageBox)}
    >
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={onLayout}
        className="min-h-0 flex-1"
      >
        {renderLayout()}
      </ResizablePanelGroup>
      <MainStatusBar />
      <ForkServices />
    </div>
  )
}

interface PageBox { top: number, right: number, bottom: number, left: number, radius: string }

/** 首頁／Inbox 頁的外框：左緣接在左側欄之後，上下緣與圓角跟第一個看得到的工作區面板一樣。 */
function measurePageBox(container: HTMLElement, group: HTMLElement, panels: HTMLElement[]): PageBox {
  const box = container.getBoundingClientRect()
  const groupBox = group.getBoundingClientRect()
  const groupStyle = getComputedStyle(group)
  const visible = (panel: HTMLElement) => panel.getBoundingClientRect().width > 1
  const sidebar = panels.find(panel => panel.querySelector('[data-left-sidebar]'))
  const work = panels.find(panel => panel !== sidebar && visible(panel))
  const contentLeft = groupBox.left + parseFloat(groupStyle.paddingLeft)
  const contentRight = groupBox.right - parseFloat(groupStyle.paddingRight)
  const left = work
    ? work.getBoundingClientRect().left
    : sidebar && visible(sidebar) ? sidebar.getBoundingClientRect().right + 1 : contentLeft
  const reference = (work ?? sidebar)?.getBoundingClientRect()
  return {
    left: Math.max(0, Math.round(left - box.left)),
    right: Math.max(0, Math.round(box.right - contentRight)),
    top: reference ? Math.max(0, Math.round(reference.top - box.top)) : 0,
    bottom: reference ? Math.max(0, Math.round(box.bottom - reference.bottom)) : 28,
    radius: work ? getComputedStyle(work).borderTopLeftRadius : '0px',
  }
}

function pageBoxStyle(box: PageBox | null): CSSProperties {
  // 還沒量到之前：貼齊容器、留出狀態列（h-7）
  const value = box ?? { top: 0, right: 0, bottom: 28, left: 0, radius: '0px' }
  return {
    '--page-top': `${value.top}px`,
    '--page-right': `${value.right}px`,
    '--page-bottom': `${value.bottom}px`,
    '--page-left': `${value.left}px`,
    '--page-radius': value.radius,
  } as CSSProperties
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
