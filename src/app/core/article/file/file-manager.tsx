'use client'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar"
import React, { useEffect, useState } from "react"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import useArticleStore, { DirTree } from "@/stores/article"
import { BaseDirectory, rename, writeTextFile, writeFile } from "@tauri-apps/plugin-fs"
import { FileItem } from './file-item'
import { FolderItem } from "./folder-item"
import { computedParentPath } from "@/lib/path"

function Tree({ item }: { item: DirTree }) {
  const { collapsibleList, setCollapsibleList, loadCollapsibleFiles } = useArticleStore()
  const path = computedParentPath(item)

  function handleCollapse(isOpen: boolean) {
    setCollapsibleList(path, isOpen)
    if (isOpen) {
      loadCollapsibleFiles(path)
    }
  }

  return (
    item.isFile ? 
    <FileItem item={item} /> :
    <SidebarMenuItem>
      <Collapsible
        onOpenChange={handleCollapse}
        className="group/collapsible [&[data-state=open]>button>.file-manange-item>svg:first-child]:rotate-90"
        open={collapsibleList.includes(path)}
      >
        <FolderItem item={item} />
        <CollapsibleContent className="pl-1">
          <SidebarMenuSub>
            {item.children?.map((subItem) => (
              <Tree key={subItem.name} item={subItem} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

export function FileManager() {
  const [isDragging, setIsDragging] = useState(false)
  const { activeFilePath, fileTree, loadFileTree, setActiveFilePath, addFile } = useArticleStore()

  async function handleDrop (e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const renamePath = e.dataTransfer?.getData('text')
    if (renamePath) {
      const filename = renamePath.slice(renamePath.lastIndexOf('/') + 1)
      
      // 获取工作区路径信息
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      
      // 获取源路径和目标路径的选项
      const oldPathOptions = await getFilePathOptions(renamePath)
      const newPathOptions = await getFilePathOptions(filename) // 直接使用文件名，表示根目录
      
      // 根据工作区类型执行重命名操作
      if (workspace.isCustom) {
        // 自定义工作区
        await rename(oldPathOptions.path, newPathOptions.path)
      } else {
        // 默认工作区
        await rename(oldPathOptions.path, newPathOptions.path, { 
          newPathBaseDir: BaseDirectory.AppData, 
          oldPathBaseDir: BaseDirectory.AppData 
        })
      }
      
      await loadFileTree()
      if (renamePath === activeFilePath) {
        setActiveFilePath(filename)
      }
    } else {
      const files = e.dataTransfer.files
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        // 接受 markdown 和图片文件
        if (file.name.endsWith('.md')) {
          const text = await file.text()
          // 处理文件名，将空格替换为下划线以保持一致性
          const sanitizedFileName = file.name.replace(/\s+/g, '_')

          await writeTextFile(`article/${sanitizedFileName}`, text, { baseDir: BaseDirectory.AppData })
          addFile({
            name: sanitizedFileName,
            isEditing: false,
            isLocale: true,
            isDirectory: false,
            isFile: true,
            isSymlink: false
          })
        } else if (file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
          // 处理图片文件，同样需要处理文件名以保持一致性
          const arrayBuffer = await file.arrayBuffer()
          const uint8Array = new Uint8Array(arrayBuffer)
          const sanitizedImageFileName = file.name.replace(/\s+/g, '_')
          await writeFile(`article/${sanitizedImageFileName}`, uint8Array, { baseDir: BaseDirectory.AppData })
          addFile({
            name: sanitizedImageFileName,
            isEditing: false,
            isLocale: true,
            isDirectory: false,
            isFile: true,
            isSymlink: false
          })
        }
      }
    }
    setIsDragging(false)
  }
  
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true)
  }

  function handleDragleave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false)
  }

  useEffect(() => {
    if (fileTree.length === 0) {
      loadFileTree()
    }
  }, [loadFileTree])

  return (
    <SidebarContent className={`${isDragging && 'outline-2 outline-black outline-dotted -outline-offset-4'}`}>
      <SidebarGroup className="flex-1 p-0">
        <SidebarGroupContent className="flex-1">
          <SidebarMenu className="h-full">
            <div
              className="min-h-0.5"
              onDrop={(e) => handleDrop(e)}
              onDragOver={e => handleDragOver(e)}
              onDragLeave={(e) => handleDragleave(e)}
            >
            </div>
            {fileTree.map((item) => (
              <Tree key={item.name + item.parent?.name} item={item} />
            ))}
            <div
              className="flex-1 min-h-1"
              onDrop={(e) => handleDrop(e)}
              onDragOver={e => handleDragOver(e)}
              onDragLeave={(e) => handleDragleave(e)}
            >
            </div>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}