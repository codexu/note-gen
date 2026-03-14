'use client'
import React, { useEffect, useState, useMemo } from "react"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import useArticleStore, { DirTree } from "@/stores/article"
import { rename, writeTextFile, writeFile } from "@tauri-apps/plugin-fs"
import { FileItem } from './file-item'
import { FolderItem } from "./folder-item"
import { computedParentPath } from "@/lib/path"
import { writeDroppedFileToRoot } from "./root-drop"

// 递归过滤文件树，移除云端文件（如果 showCloudFiles 为 false）
function filterFileTree(tree: DirTree[], showCloud: boolean): DirTree[] {
  if (showCloud) return tree

  return tree
    .filter(item => item.isLocale)
    .map(item => ({
      ...item,
      children: item.children ? filterFileTree(item.children, showCloud) : undefined
    }))
}

function Tree({ item, focusSidebar }: { item: DirTree; focusSidebar: () => void }) {
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
    <FileItem item={item} focusSidebar={focusSidebar} /> :
    <li>
      <Collapsible
        onOpenChange={handleCollapse}
        className="group/collapsible [&[data-state=open]>button>.file-manange-item>svg:first-child]:rotate-90"
        open={collapsibleList.includes(path)}
      >
        <FolderItem item={item} focusSidebar={focusSidebar} />
        <CollapsibleContent className="pl-1">
          <ul className="pl-2">
            {item.children?.map((subItem) => (
              <Tree key={`${subItem.name}-${subItem.parent?.name}-${subItem.sha || ''}-${subItem.isLocale}`} item={subItem} focusSidebar={focusSidebar} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export function FileManager({ focusSidebar }: { focusSidebar: () => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const { activeFilePath, fileTree, loadFileTree, setActiveFilePath, addFile, showCloudFiles } = useArticleStore()

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
          newPathBaseDir: newPathOptions.baseDir,
          oldPathBaseDir: oldPathOptions.baseDir
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
          const { getFilePathOptions } = await import('@/lib/workspace')
          const sanitizedFileName = await writeDroppedFileToRoot({
            fileName: file.name,
            getFilePathOptions,
            writeTextFile,
          }, {
            kind: 'text',
            content: text,
          })

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
          const { getFilePathOptions } = await import('@/lib/workspace')
          const sanitizedImageFileName = await writeDroppedFileToRoot({
            fileName: file.name,
            getFilePathOptions,
            writeFile,
          }, {
            kind: 'binary',
            content: uint8Array,
          })

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

  // 根据开关状态过滤文件树 - 使用 useMemo 缓存结果
  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, showCloudFiles),
    [fileTree, showCloudFiles]
  )

  return (
    <div className={`flex-1 overflow-y-auto ${isDragging && 'outline-2 outline-black outline-dotted -outline-offset-4'}`}>
      <div className="flex-1 p-0">
        <div className="flex-1">
          <ul className="h-full">
            <div
              className="min-h-0.5"
              onDrop={(e) => handleDrop(e)}
              onDragOver={e => handleDragOver(e)}
              onDragLeave={(e) => handleDragleave(e)}
            >
            </div>
            {filteredFileTree.map((item) => (
              <Tree key={`${item.name}-${item.parent?.name || ''}-${item.sha || ''}-${item.isLocale}`} item={item} focusSidebar={focusSidebar} />
            ))}
            <div
              className="flex-1 min-h-1"
              onDrop={(e) => handleDrop(e)}
              onDragOver={e => handleDragOver(e)}
              onDragLeave={(e) => handleDragleave(e)}
            >
            </div>
          </ul>
        </div>
      </div>
    </div>
  )
}
