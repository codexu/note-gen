import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir } from '@tauri-apps/api/path';
import { ChevronRight, Cloud, Folder, FolderDown } from "lucide-react"
import { useEffect, useRef, useState } from "react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { open } from "@tauri-apps/plugin-shell";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { ask } from '@tauri-apps/plugin-dialog';

export function FolderItem({ item }: { item: DirTree }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useTranslations('article.file')
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()

  const { 
    activeFilePath,
    loadFileTree,
    setActiveFilePath,
    collapsibleList,
    setCollapsibleList,
    fileTree,
    setFileTree,
    newFolderInFolder
  } = useArticleStore()

  const path = computedParentPath(item)
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(path, cacheTree)
  const parentFolder = currentFolder?.parent

  async function handleDeleteFolder(evnet: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    evnet.stopPropagation()
    try {
      // 获取工作区路径信息
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      
      // 根据工作区类型正确删除文件夹
      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        // 自定义工作区
        await remove(pathOptions.path)
      } else {
        // 默认工作区
        await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
      
      // 更新文件树
      if (parentFolder) {
        const index = parentFolder.children?.findIndex(folder => folder.name === currentFolder.name)
        if (index!== -1 && index !== undefined && parentFolder.children) {
          parentFolder.children.splice(index, 1)
          setFileTree(cacheTree)
        }
      } else {
        const index = cacheTree?.findIndex(folder => folder.name === currentFolder?.name)
        if (index!== -1 && index !== undefined && cacheTree) {
          cacheTree.splice(index, 1)
          setFileTree(cacheTree)
        }
      }
    } catch (error) {
      console.error('删除文件夹失败:', error)
      toast({
        title: '删除失败',
        description: '文件夹内存在文件或无法访问！',
        variant: 'destructive',
      })
    }
  }

  async function handleStartRename() {
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

  async function handleShowFileManager() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 根据工作区类型确定正确的路径
    if (workspace.isCustom) {
      // 自定义工作区 - 直接使用工作区路径
      const pathOptions = await getFilePathOptions(path)
      open(pathOptions.path)
    } else {
      // 默认工作区 - 使用 AppData 目录
      const appDir = await appDataDir()
      open(`${appDir}/article/${path}`)
    }
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

  function newFileHandler(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    // 创建临时文件节点，并将其设为编辑状态，与 newFile 保持一致
    const cacheTree = cloneDeep(fileTree)
    const currentFolder = getCurrentFolder(path, cacheTree)
    
    // 如果文件夹中已经有一个空名称的文件，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true)
    }
    
    if (currentFolder) {
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      }
      currentFolder.children?.unshift(newFile)
      setFileTree(cacheTree)
    }
  }

  function newFolderHandler(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    // 如果当前文件夹未展开，则先展开
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true)
    }
    newFolderInFolder(path)
  }

  async function handleCopyFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteInFolder() {
    if (!clipboardItem) {
      toast({ title: t('clipboard.empty'), variant: 'destructive' })
      return
    }

    try {
      const sourcePath = `article/${clipboardItem.path}`
      const targetPath = `article/${path}/${clipboardItem.name}`
      
      // Check if target already exists
      const targetExists = await exists(targetPath, { baseDir: BaseDirectory.AppData })
      
      if (targetExists) {
        const confirmOverwrite = await ask(t('clipboard.confirmOverwrite'), {
          title: 'NoteGen',
          kind: 'warning',
        })
        if (!confirmOverwrite) return
      }

      if (clipboardItem.isDirectory) {
        // For directories, need to copy recursively
        // Create target directory
        await mkdir(targetPath, { baseDir: BaseDirectory.AppData })
        
        // Copy recursively using readDir, readTextFile, and writeTextFile
        const copyDirRecursively = async (src: string, dest: string) => {
          const entries = await readDir(src, { baseDir: BaseDirectory.AppData })
          
          for (const entry of entries) {
            const srcPath = `${src}/${entry.name}`
            const destPath = `${dest}/${entry.name}`
            
            if (entry.isDirectory) {
              // It's a directory
              await mkdir(destPath, { baseDir: BaseDirectory.AppData })
              await copyDirRecursively(srcPath, destPath)
            } else {
              // It's a file
              try {
                const content = await readTextFile(srcPath, { baseDir: BaseDirectory.AppData })
                await writeTextFile(destPath, content, { baseDir: BaseDirectory.AppData })
              } catch (err) {
                console.error(`Error copying file ${srcPath}:`, err)
              }
            }
          }
        }
        
        await copyDirRecursively(sourcePath, targetPath)
      } else {
        // For files, just copy the file
        try {
          const content = await readTextFile(sourcePath, { baseDir: BaseDirectory.AppData })
          await writeTextFile(targetPath, content, { baseDir: BaseDirectory.AppData })
        } catch (err) {
          console.error(`Error copying file ${sourcePath}:`, err)
          throw err
        }
      }
      
      // If cut operation, delete the original
      if (clipboardOperation === 'cut') {
        await remove(sourcePath, { baseDir: BaseDirectory.AppData })
        // Clear clipboard after cut & paste operation
        setClipboardItem(null, 'none')
      }

      // Refresh file tree
      loadFileTree()
      toast({ title: t('clipboard.pasted') })
    } catch (error) {
      console.error('Paste operation failed:', error)
      toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' })
    }
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
                      {item.isLocale ? <Folder className="size-4" /> : <FolderDown className="size-4" /> }
                      {item.sha && item.isLocale && <Cloud className="size-2.5 absolute left-0 bottom-0 z-10 bg-primary-foreground" />}
                    </div>
                    <span className="text-xs line-clamp-1">{item.name}</span>
                  </div>
                </div>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem inset disabled={!!item.sha && !item.isLocale} onClick={newFileHandler}>
            {t('context.newFile')}
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!!item.sha && !item.isLocale} onClick={newFolderHandler}>
            {t('context.newFolder')}
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleShowFileManager}>
            {t('context.viewDirectory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFolder}>
            {t('context.cut')}
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleCopyFolder}>
            {t('context.copy')}
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!clipboardItem} onClick={handlePasteInFolder}>
            {t('context.paste')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem inset onClick={handleStartRename}>
            {t('context.rename')}
          </ContextMenuItem>
          <ContextMenuItem inset className="text-red-900" onClick={(e) => { handleDeleteFolder(e); }}>
            {t('context.delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </CollapsibleTrigger>
  )
}