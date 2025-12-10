'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { MdEditor } from '../article/md-editor'
import Chat from '../record/chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useEffect, useRef } from 'react'
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
  
  const onLayout = (sizes: number[]) => {
    localStorage.setItem("react-resizable-panels:main-layout", JSON.stringify(sizes));
  };

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
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
        minSize={20}
        maxSize={40}
        collapsible={true}
        collapsedSize={0}
      >
        <LeftSidebar />
      </ResizablePanel>
      <ResizableHandle className={leftSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      
      {/* 中间 - Markdown 编辑器 */}
      <ResizablePanel defaultSize={defaultLayout[1]} minSize={30}>
        <MdEditor />
      </ResizablePanel>
      <ResizableHandle className={rightSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      
      {/* 右侧边栏 - 对话组件 */}
      <ResizablePanel 
        ref={rightPanelRef}
        defaultSize={defaultLayout[2]}
        minSize={20}
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
