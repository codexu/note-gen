'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { MdEditor } from '../article/md-editor'
import Chat from '../record/chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelHandle } from 'react-resizable-panels'

function getDefaultLayout() {
  const layout = localStorage.getItem("react-resizable-panels:main-layout");
  if (layout) {
    return JSON.parse(layout);
  }
  return [20, 50, 30]
}

function ResizableWrapper({
  defaultLayout,
}: {
  defaultLayout: number[];
}) {
  const { leftSidebarVisible, rightSidebarVisible, initSidebarState } = useSidebarStore()
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  
  const MIN_SIDEBAR_WIDTH_PX = 360
  const MIN_EDITOR_WIDTH_PX = 400
  const [minSidebarSize, setMinSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  
  const calculateMinSizes = () => {
    const windowWidth = window.innerWidth
    const minSidebarPercent = Math.max(15, (MIN_SIDEBAR_WIDTH_PX / windowWidth) * 100)
    const minEditorPercent = Math.max(25, (MIN_EDITOR_WIDTH_PX / windowWidth) * 100)
    setMinSidebarSize(Math.min(minSidebarPercent, 40))
    setMinEditorSize(Math.min(minEditorPercent, 50))
  }
  
  const onLayout = (sizes: number[]) => {
    localStorage.setItem("react-resizable-panels:main-layout", JSON.stringify(sizes));
  };

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
    calculateMinSizes()
    
    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [])

  useEffect(() => {
    if (leftPanelRef.current) {
      if (leftSidebarVisible) {
        leftPanelRef.current.expand()
      } else {
        leftPanelRef.current.collapse()
      }
    }
  }, [leftSidebarVisible])

  useEffect(() => {
    if (rightPanelRef.current) {
      if (rightSidebarVisible) {
        rightPanelRef.current.expand()
      } else {
        rightPanelRef.current.collapse()
      }
    }
  }, [rightSidebarVisible])

  return (
    <ResizablePanelGroup direction="horizontal" onLayout={onLayout} className="h-full">
      {/* 左侧边栏 - 文件管理器和记录 */}
      <ResizablePanel 
        ref={leftPanelRef}
        defaultSize={defaultLayout[0]}
        minSize={minSidebarSize}
        maxSize={40}
        collapsible={true}
        collapsedSize={0}
      >
        <LeftSidebar />
      </ResizablePanel>
      <ResizableHandle className={leftSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      
      {/* 中间 - Markdown 编辑器 */}
      <ResizablePanel defaultSize={defaultLayout[1]} minSize={minEditorSize}>
        <MdEditor />
      </ResizablePanel>
      <ResizableHandle className={rightSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      
      {/* 右侧边栏 - 对话组件 */}
      <ResizablePanel 
        ref={rightPanelRef}
        defaultSize={defaultLayout[2]}
        minSize={minSidebarSize}
        maxSize={40}
        collapsible={true}
        collapsedSize={0}
      >
        <Chat />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Page() {
  const defaultLayout = getDefaultLayout();
  
  useEffect(() => {
    // 保存当前页面路径
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()
  }, [])
  
  return <ResizableWrapper defaultLayout={defaultLayout} />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
