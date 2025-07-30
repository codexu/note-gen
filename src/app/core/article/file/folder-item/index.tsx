import { ContextMenu, ContextMenuContent, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, mkdir, rename } from "@tauri-apps/plugin-fs";
import { ChevronRight, Cloud, Folder, FolderDot, FolderDown, FolderOpen, FolderOpenDot } from "lucide-react"
import { useEffect, useRef, useState } from "react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import useSettingStore from '@/stores/setting'
import SyncFolder from './sync-folder'
import { NewFile } from './new-file'
import { NewFolder } from './new-folder'
import { ViewDirectory } from './view-directory'
import { CutFolder } from './cut-folder'
import { CopyFolder } from './copy-folder'
import { PasteInFolder } from './paste-in-folder'
import { RenameFolder } from './rename-folder'
import { DeleteFolder } from './delete-folder'

export function FolderItem({ item }: { item: DirTree }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { assetsPath } = useSettingStore()

  const { 
    activeFilePath,
    loadFileTree,
    setActiveFilePath,
    collapsibleList,
    setCollapsibleList,
    fileTree,
    setFileTree
  } = useArticleStore()

  const path = computedParentPath(item)
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(path, cacheTree)
  const parentFolder = currentFolder?.parent

  function handleStartRename() {
    setIsEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // 创建或修改文件夹名称
  async function handleRename() {
    setName(name.replace(/ /g, '_')) // github 存储空格会报错，替换为下划线
  
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
  
    // 修改文件夹名称
    if (name && name !== item.name && item.name !== '') {
      // 更新缓存树中的名称
      if (parentFolder && parentFolder.children) {
        const folderIndex = parentFolder?.children?.findIndex(folder => folder.name === item.name)
        if (folderIndex !== undefined && folderIndex !== -1) {
          parentFolder.children[folderIndex].name = name
          parentFolder.children[folderIndex].isEditing = false
        }
      } else {
        const folderIndex = cacheTree.findIndex(folder => folder.name === item.name)
        cacheTree[folderIndex].name = name
        cacheTree[folderIndex].isEditing = false
      }
      
      // 获取源路径和目标路径
      const oldPathOptions = await getFilePathOptions(path)
      const newPathOptions = await getFilePathOptions(`${path.split('/').slice(0, -1).join('/')}/${name}`)
      
      // 根据工作区类型执行重命名操作
      if (workspace.isCustom) {
        await rename(oldPathOptions.path, newPathOptions.path)
      } else {
        await rename(oldPathOptions.path, newPathOptions.path, { 
          newPathBaseDir: BaseDirectory.AppData, 
          oldPathBaseDir: BaseDirectory.AppData 
        })
      }
    } else {
      // 新建文件夹
      if (name !== '') {
        // 将空格替换为下划线
        const sanitizedName = name.replace(/ /g, '_')
        setName(sanitizedName) // 更新状态中的名称
        
        // 检查文件夹是否已存在
        const newFolderPath = `${path}/${sanitizedName}`
        const pathOptions = await getFilePathOptions(newFolderPath)
        
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          toast({ title: '文件夹名已存在' })
          setTimeout(() => inputRef.current?.focus(), 300);
        } else {
          // 创建新文件夹
          if (workspace.isCustom) {
            await mkdir(pathOptions.path)
          } else {
            await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          
          // 更新缓存树
          if (parentFolder && parentFolder.children) {
            const index = parentFolder.children?.findIndex(item => item.name === '')
            parentFolder.children[index].name = sanitizedName
            parentFolder.children[index].isEditing = false
          } else {
            const index = cacheTree?.findIndex(item => item.name === '')
            cacheTree[index].name = sanitizedName
            cacheTree[index].isEditing = false
          }
        }
      } else {
        // 处理空名称情况（取消新建）
        if (currentFolder?.parent) {
          const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
            currentFolder.parent?.children?.splice(index, 1)
          }
        } else {
          const index = cacheTree.findIndex(item => item.name === '')
          cacheTree.splice(index, 1)
        }
      }
    } 
    setIsEditing(false)
    setFileTree(cacheTree)
  }



  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const renamePath = e.dataTransfer?.getData('text')
    if (renamePath) {
      const filename = renamePath.slice(renamePath.lastIndexOf('/') + 1)
      
      // 获取工作区路径信息
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      
      // 获取源路径和目标路径的选项
      const oldPathOptions = await getFilePathOptions(renamePath)
      const newPathOptions = await getFilePathOptions(`${path}/${filename}`)
      
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
      
      // 刷新文件树
      loadFileTree()
      
      // 更新活动文件路径和折叠状态
      if (renamePath === activeFilePath && !collapsibleList.includes(item.name)) {
        setCollapsibleList(item.name, true)
        setActiveFilePath(`${path}/${filename}`)
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



  function handleEditEnd() {
    if (currentFolder?.parent) {
      const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
        currentFolder.parent?.children?.splice(index, 1)
      }
    } else {
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
    }
    setFileTree(cacheTree)
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setName(name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  return (
    <CollapsibleTrigger className="w-full select-none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={`${isDragging ? 'file-on-drop' : ''} group file-manange-item flex select-none`}>
            <ChevronRight className="transition-transform size-4 ml-1 bg-sidebar group-hover:bg-transparent" />
            {
              isEditing ?
                <>
                  {
                    item.isLocale ?
                      <Folder className="size-4" /> :
                      <FolderDown className="size-4" />
                  }
                  <Input
                    ref={inputRef}
                    className="h-5 rounded-sm text-xs px-1 font-normal flex-1 mr-1"
                    value={name}
                    onBlur={handleRename}
                    onChange={(e) => { setName(e.target.value) }}
                    onKeyDown={(e) => {
                      if (e.code === 'Enter') {
                        handleRename()
                      } else if (e.code === 'Escape') {
                        handleEditEnd()
                      }
                    }}
                  />
                </> :
                <div
                  onDrop={(e) => handleDrop(e)}
                  onDragOver={e => handleDragOver(e)}
                  onDragLeave={(e) => handleDragleave(e)}
                  className={`${item.isLocale ? '' : 'opacity-50'} flex gap-1 items-center flex-1 select-none`}
                >
                  <div className="flex flex-1 gap-1 select-none relative">
                    <div className="relative">
                      {collapsibleList.includes(path) ? 
                        (assetsPath === item.name ? <FolderOpenDot className="size-4" /> : <FolderOpen className="size-4" />) :
                        (assetsPath === item.name ? <FolderDot className="size-4" /> : <Folder className="size-4" />)
                      }
                      {item.sha && item.isLocale && <Cloud className="size-2.5 absolute left-0 bottom-0 z-10 bg-primary-foreground" />}
                    </div>
                    <span className="text-xs line-clamp-1">{item.name}</span>
                  </div>
                </div>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <NewFile item={item} />
          <NewFolder item={item} />
          <ViewDirectory item={item} />
          <ContextMenuSeparator />
          <CutFolder item={item} />
          <CopyFolder item={item} />
          <PasteInFolder item={item} />
          <ContextMenuSeparator />
          <SyncFolder item={item} />
          <ContextMenuSeparator />
          <RenameFolder item={item} onStartRename={handleStartRename} />
          <DeleteFolder item={item} />
        </ContextMenuContent>
      </ContextMenu>
    </CollapsibleTrigger>
  )
}