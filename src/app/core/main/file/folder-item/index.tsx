import { ContextMenu, ContextMenuContent, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, mkdir, rename } from "@tauri-apps/plugin-fs";
import { ChevronRight, Folder, FolderDot, FolderDown, FolderOpen, FolderOpenDot, FolderUp, Loader2, LoaderCircle, Database, Sparkles } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import useSettingStore from '@/stores/setting'
import { isSkillsFolder } from "@/lib/skills/utils"
import SyncFolder from './sync-folder'
import { NewFile } from './new-file'
import { NewFolder } from './new-folder'
import { ViewDirectory } from './view-directory'
import { CutFolder } from './cut-folder'
import { CopyFolder } from './copy-folder'
import { DuplicateFolder } from './duplicate-folder'
import { PasteInFolder } from './paste-in-folder'
import { RenameFolder } from './rename-folder'
import { DeleteFolder } from './delete-folder'
import useClipboardStore from "@/stores/clipboard"
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "../mobile-action-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslations } from "next-intl"
import { FolderVectorMenu } from './folder-vector-menu'
import { pasteIntoFolder } from './paste-into-folder'
import emitter from '@/lib/emitter'
import { LinkedFolder } from '@/lib/files'

export function FolderItem({ item, focusSidebar }: { item: DirTree; focusSidebar?: () => void }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isComposing, setIsComposing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { assetsPath, fileManagerTextSize } = useSettingStore()
  const isMobile = useIsMobile()
  const t = useTranslations('article.file')

  // 检查路径是否在 skills 文件夹下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  // 根据文字大小映射图标大小
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5', 
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)

  const {
    activeFilePath,
    loadFileTree,
    setActiveFilePath,
    collapsibleList,
    setCollapsibleList,
    loadCollapsibleFiles,
    fileTree,
    setFileTree,
    vectorIndexedFiles
  } = useArticleStore()
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()

  const path = computedParentPath(item)
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(path, cacheTree)
  const parentFolder = currentFolder?.parent

  // 检查文件夹是否被剪切
  const isCut = clipboardOperation === 'cut' && clipboardItem?.path === path

  // 计算文件夹的向量状态
  const folderVectorStatus = useCallback(() => {
    let totalCount = 0
    let indexedCount = 0

    function countFiles(node: DirTree) {
      if (!node.children) {
        // 如果是文件（没有 children）
        if (node.name.endsWith('.md')) {
          totalCount++
          if (vectorIndexedFiles.has(computedParentPath(node))) {
            indexedCount++
          }
        }
        return
      }

      // 递归计算子节点
      node.children.forEach(child => countFiles(child))
    }

    countFiles(item)

    return {
      totalCount,
      indexedCount,
      hasVector: totalCount > 0 && indexedCount > 0,
      isComplete: totalCount > 0 && indexedCount === totalCount
    }
  }, [item, vectorIndexedFiles])

  // 渲染文件夹的向量状态图标
  const renderFolderVectorIcon = () => {
    if (isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus
    const vectorStatus = folderVectorStatus()

    if (status === 'calculating') {
      return (
        <div className="flex items-center mr-2">
          <LoaderCircle className={`${iconSize} animate-spin`} />
        </div>
      )
    } else if (status === 'completed' || vectorStatus.hasVector) {
      return (
        <div className="flex items-center mr-2">
          <span className={`text-xs text-muted-foreground ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`}>
            {vectorStatus.indexedCount}/{vectorStatus.totalCount}
          </span>
          <Database className={`${iconSize} text-muted-foreground ml-1 ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`} />
        </div>
      )
    }
    return null
  }

  // 移动端处理函数
  function handleNewFile() {
    // 创建临时文件节点，并将其设为编辑状态
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // 如果文件夹中已经有一个空名称的文件，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return;
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
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
      };
      currentFolder.children?.unshift(newFile);
      setFileTree(cacheTree);
    }
  }

  function handleNewFolder() {
    // 创建临时文件夹节点
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // 如果文件夹中已经有一个空名称的文件夹，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isDirectory)) {
      return;
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFolder: DirTree = {
        name: '',
        isFile: false,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: true,
        isLocale: true,
        sha: '',
        children: []
      };
      currentFolder.children?.unshift(newFolder);
      setFileTree(cacheTree);
    }
  }

  function handleStartRename() {
    // 延迟执行，确保上下文菜单完全关闭
    setTimeout(() => {
      setIsEditing(true)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 只选中文件名，不包含扩展名
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  // 粘贴到文件夹
  async function handlePasteInFolder() {
    await pasteIntoFolder({
      clipboardItem,
      clipboardOperation,
      folderPath: path,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
    })
  }

  // 删除文件夹
  async function handleDeleteFolder() {
    try {
      // 获取工作区路径信息
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      const { ask } = await import('@tauri-apps/plugin-dialog')
      const { remove } = await import('@tauri-apps/plugin-fs')

      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      })

      if (!confirmed) return

      // 根据工作区类型确定正确的路径
      const pathOptions = await getFilePathOptions(path)

      if (workspace.isCustom) {
        await remove(pathOptions.path, { recursive: true })
      } else {
        await remove(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
      }

      // 如果删除的文件夹包含当前活动文件，清除活动文件路径
      if (activeFilePath && activeFilePath.startsWith(path)) {
        setActiveFilePath('')
      }

      // 从文件树中移除该文件夹
      const cacheTree = cloneDeep(fileTree)
      const parentFolder = currentFolder?.parent

      if (parentFolder && parentFolder.children) {
        const index = parentFolder.children.findIndex(child => child.name === item.name)
        if (index !== -1) {
          parentFolder.children.splice(index, 1)
        }
      } else {
        const index = cacheTree.findIndex(child => child.name === item.name)
        if (index !== -1) {
          cacheTree.splice(index, 1)
        }
      }

      setFileTree(cacheTree)

      // 删除向量数据库中该文件夹下所有文件的记录
      try {
        const { getAllMarkdownFiles } = await import('@/lib/files')
        const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
        const allFiles = await getAllMarkdownFiles()

        // 找出该文件夹下的所有 Markdown 文件
        const folderPrefix = path.endsWith('/') ? path : path + '/'
        const filesInFolder = allFiles.filter(file => file.relativePath.startsWith(folderPrefix))

        // 删除这些文件的向量数据
        for (const file of filesInFolder) {
          const filename = file.relativePath
          try {
            await deleteVectorDocumentsByFilename(filename)
          } catch (error) {
            console.error(`删除文件 ${filename} 的向量数据失败:`, error)
          }
        }
      } catch (error) {
        console.error('删除文件夹向量数据失败:', error)
      }

      toast({ title: t('context.deleteSuccess') })
    } catch (error) {
      console.error('Delete folder failed:', error)
      toast({
        title: t('context.deleteFailed'),
        variant: 'destructive'
      })
    }
  }

  // 优化的输入处理，支持输入法
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    // 如果正在使用输入法合成，不进行空格替换
    if (isComposing) {
      setName(value)
      return
    }
    
    // 检查是否包含空格，只有包含空格时才需要处理光标位置
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 保持光标位置
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [isComposing])

  // 输入法合成开始
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 输入法合成结束，进行空格替换
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    const input = e.currentTarget
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    // 只有当值包含空格时才需要替换和恢复光标位置
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 计算新的光标位置（空格变为下划线，长度不变，所以位置保持不变）
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [])

  // 创建或修改文件夹名称
  async function handleRename() {
    // 统一处理：将空格替换为下划线，确保本地和远程文件名一致
    const sanitizedName = name.replace(/\s+/g, '_')
    setName(sanitizedName)

    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()

    // 修改文件夹名称
    if (sanitizedName && sanitizedName !== item.name && item.name !== '') {
      // 更新缓存树中的名称
      if (parentFolder && parentFolder.children) {
        const folderIndex = parentFolder?.children?.findIndex(folder => folder.name === item.name)
        if (folderIndex !== undefined && folderIndex !== -1) {
          parentFolder.children[folderIndex].name = sanitizedName
          parentFolder.children[folderIndex].isEditing = false
        }
      } else {
        const folderIndex = cacheTree.findIndex(folder => folder.name === item.name)
        cacheTree[folderIndex].name = sanitizedName
        cacheTree[folderIndex].isEditing = false
      }
      
      // 获取源路径和目标路径
      const oldPathOptions = await getFilePathOptions(path)
      const newPathOptions = await getFilePathOptions(`${path.split('/').slice(0, -1).join('/')}/${sanitizedName}`)
      
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
      // 已有文件夹但名称未改变，直接取消编辑
      if (item.name !== '' && sanitizedName === item.name) {
        setIsEditing(false)
        return
      }

      // 新建文件夹
      if (sanitizedName !== '') {
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
          return
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
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
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

  async function handleSelectFolder() {
    // 检查是否真的是目录（防止误将文件当作目录处理）
    if (!item.isDirectory) {
      return
    }

    // 让文件管理器获得焦点，以便响应快捷键
    focusSidebar?.()
    // 设置选中状态
    await setActiveFilePath(path)

    // 自动展开文件夹（如果未展开）
    if (!collapsibleList.includes(path)) {
      await setCollapsibleList(path, true)
    }

    // 加载文件夹内容
    await loadCollapsibleFiles(path)

    // 触发文件夹选择事件
    const folderName = path.split('/').pop() || path
    let fullPath: string
    const { getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    if (workspace.isCustom) {
      const pathParts = path.split('/')
      fullPath = workspace.path + '/' + pathParts.join('/')
    } else {
      fullPath = path
    }

    // 计算文件夹中的文件数量
    const { collectMarkdownFiles } = await import('@/lib/files')
    const files = await collectMarkdownFiles(path)

    // 获取向量索引状态
    const indexedCount = files.filter(f =>
      vectorIndexedFiles.has(f.path)
    ).length

    // 只有在有索引文件时才触发关联事件
    if (indexedCount > 0) {
      // 触发事件
      emitter.emit('folderSelected', {
        name: folderName,
        path: fullPath,
        relativePath: path,
        fileCount: files.length,
        indexedCount: indexedCount
      } as LinkedFolder)
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
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  // 监听文件管理器统一快捷键触发的自定义事件
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFolder()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 粘贴到当前文件夹
      if (customEvent.detail.targetPath === path) {
        handlePasteInFolder()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFolder, handlePasteInFolder])

  // 获取当前平台（用于显示快捷键）
  const [currentPlatform, setCurrentPlatform] = useState<'macos' | 'windows' | 'linux' | 'unknown'>('unknown')

  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os')
        const p = platform()
        if (p === 'macos') {
          setCurrentPlatform('macos')
        } else if (p === 'windows') {
          setCurrentPlatform('windows')
        } else if (p === 'linux') {
          setCurrentPlatform('linux')
        }
      } catch {
        setCurrentPlatform('unknown')
      }
    }
    detectPlatform()
  }, [])

  // 快捷键显示文本
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'

  return (
    <CollapsibleTrigger className="w-full select-none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`${isDragging ? 'file-on-drop' : ''} ${path === activeFilePath ? 'active' : ''} group file-manange-item flex select-none`}
            onClick={() => handleSelectFolder()}
            onContextMenu={(e) => {
              // 右键打开菜单时阻止冒泡，防止触发折叠/展开
              e.stopPropagation();
            }}
          >
            <ChevronRight
              className="transition-transform size-4 ml-1 bg-sidebar group-hover:bg-transparent"
              onClick={async (e) => {
                // 点击折叠箭头时只触发展开/折叠，阻止冒泡避免触发 handleSelectFolder
                e.stopPropagation();
                e.preventDefault();
                // 切换折叠状态
                const isExpanded = collapsibleList.includes(path)
                await setCollapsibleList(path, !isExpanded)
                // 如果是展开操作，加载文件夹内容
                if (!isExpanded) {
                  await loadCollapsibleFiles(path)
                }
              }}
            />
            {
              isEditing ?
                <>
                  {
                    item.isLocale ?
                      <Folder className={iconSize} /> :
                      <FolderDown className={iconSize} />
                  }
                  <Input
                    ref={inputRef}
                    className={`h-5 rounded-sm text-${fileManagerTextSize} px-1 font-normal flex-1 mr-1`}
                    value={name}
                    onBlur={handleRename}
                    onChange={handleInputChange}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={(e) => {
                      // 阻止删除快捷键冒泡到全局快捷键处理器
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.stopPropagation()
                      }
                      if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
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
                  className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex gap-1 items-center flex-1 select-none`}
                >
                  <div className="flex flex-1 gap-1 select-none relative items-center">
                    {item.loading ? (
                      <Loader2 className={`${iconSize} animate-spin text-primary`} />
                    ) : isSkillsFolder(item.name) ? (
                      <Sparkles className={`${iconSize} text-primary`} />
                    ) : collapsibleList.includes(path) ? (
                      assetsPath === item.name ? <FolderOpenDot className={iconSize} /> : (!item.isLocale ? <FolderDown className={iconSize} /> : (item.sha ? <FolderUp className={iconSize} /> : <FolderOpen className={iconSize} />))
                    ) : (
                      assetsPath === item.name ? <FolderDot className={iconSize} /> : (!item.isLocale ? <FolderDown className={iconSize} /> : (item.sha ? <FolderUp className={iconSize} /> : <Folder className={iconSize} />))
                    )}
                    <span className={`text-${fileManagerTextSize} line-clamp-1 ${item.loading ? 'text-muted-foreground' : ''}`}>{item.name}</span>
                  </div>
                  {/* 向量状态指示器 - 放在最右侧，skills 文件夹及其子内容不显示 */}
                  {renderFolderVectorIcon()}
                  {isMobile && (
                    <MobileActionMenu className="ml-1">
                      <MobileMenuItem onClick={handleNewFile} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFile')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={handleNewFolder} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFolder')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={() => {}}>
                        {t('context.viewDirectory')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <MobileMenuItem disabled>
                        {t('context.cut')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled>
                        {t('context.copy')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled>
                        {t('context.paste')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <MobileMenuItem disabled>
                        同步
                      </MobileMenuItem>
                      <MobileSeparator />
                      <MobileMenuItem onClick={handleStartRename} disabled={!!item.sha && !item.isLocale}>
                        {t('context.rename')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled className="text-red-600">
                        {t('context.delete')}
                      </MobileMenuItem>
                    </MobileActionMenu>
                  )}
                </div>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <NewFile item={item} />
          <NewFolder item={item} />
          <ViewDirectory item={item} />
          <ContextMenuSeparator />
          {/* skills 文件夹及其子内容不显示知识库选项 */}
          {!isInSkillsFolder(path) && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Database className="mr-2 h-4 w-4" />
                  {t('context.knowledgeBase')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <FolderVectorMenu item={item} />
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          <CutFolder item={item} shortcut={`${modKey}X`} />
          <CopyFolder item={item} shortcut={`${modKey}C`} />
          <DuplicateFolder item={item} />
          <PasteInFolder item={item} shortcut={`${modKey}V`} />
          <ContextMenuSeparator />
          <SyncFolder item={item} />
          <ContextMenuSeparator />
          <RenameFolder item={item} onStartRename={handleStartRename} shortcut={renameKey} />
          <DeleteFolder item={item} shortcut={deleteKey} />
        </ContextMenuContent>
      </ContextMenu>
    </CollapsibleTrigger>
  )
}
