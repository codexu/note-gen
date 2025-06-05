'use client'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FileSidebar } from "./file"
import { MdEditor } from './md-editor'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"

function getDefaultLayout() {
  const layout = localStorage.getItem("react-resizable-panels:layout");
  if (layout) {
    return JSON.parse(layout);
  }
  return [25, 75]
}

function ResizebleWrapper({
  defaultLayout,
}: {
  defaultLayout: number[];
}) {
  const { fileSidebarVisible } = useSidebarStore()
  const onLayout = (sizes: number[]) => {
    localStorage.setItem("react-resizable-panels:layout", JSON.stringify(sizes));
  };

  return (
    <ResizablePanelGroup direction="horizontal" onLayout={onLayout}>
      <ResizablePanel defaultSize={defaultLayout[0]} className={`${fileSidebarVisible ? 'max-w-[420px] min-w-[300px]' : '!flex-[0]'}`}>
        <FileSidebar />
      </ResizablePanel>
      <ResizableHandle className={fileSidebarVisible ? 'w-[1px]' : 'w-[0]'} />
      <ResizablePanel defaultSize={defaultLayout[1]}>
        <MdEditor />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Page() {
  const defaultLayout = getDefaultLayout();
  return <ResizebleWrapper defaultLayout={defaultLayout} />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })