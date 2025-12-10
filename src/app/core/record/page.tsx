'use client'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { NoteSidebar } from "./mark"
import Chat from './chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"

function getDefaultLayout() {
  const layout = localStorage.getItem("react-resizable-panels:record-layout");
  if (layout) {
    return JSON.parse(layout);
  }
  return [25, 75]
}

function ResizableWrapper({
  defaultLayout,
}: {
  defaultLayout: number[];
}) {
  const { noteSidebarVisible } = useSidebarStore()
  const onLayout = (sizes: number[]) => {
    localStorage.setItem("react-resizable-panels:record-layout", JSON.stringify(sizes));
  };

  return (
    <ResizablePanelGroup direction="horizontal" onLayout={onLayout} className="h-full">
      <ResizablePanel defaultSize={defaultLayout[0]} className={`${noteSidebarVisible ? 'max-w-[560px] min-w-[340px]' : '!flex-[0]'}`}>
        <NoteSidebar />
      </ResizablePanel>
      <ResizableHandle className={noteSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      <ResizablePanel defaultSize={defaultLayout[1]}>
        <Chat />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Page() {
  const defaultLayout = getDefaultLayout();
  return <ResizableWrapper defaultLayout={defaultLayout} />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
