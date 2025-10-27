import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Cloud, CloudDownload, File, ImageIcon } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import { RepoNames } from "@/lib/sync/github.types";
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { PhotoProvider, PhotoView } from "react-photo-view";
import { convertImageByWorkspace } from "@/lib/utils";
import { appDataDir, join } from '@tauri-apps/api/path';
import { deleteFile } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile } from "@/lib/sync/gitlab";
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";

export function FileItem({ item }: { item: DirTree }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isComposing, setIsComposing] = useState(false) // 追踪输入法合成状态
  const inputRef = useRef<HTMLInputElement>(null)
  const { activeFilePath, setActiveFilePath, readArticle, setCurrentArticle, fileTree, setFileTree, loadFileTree } = useArticleStore()
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()
  const t = useTranslations('article.file')
  const [imageUrl, setImageUrl] = useState('')
  const isMobile = useIsMobile()
  
  const path = computedParentPath(item)
  const isRoot = path.split('/').length === 1
  const folderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(folderPath, cacheTree)

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

  async function handleSelectFile() {
    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      let path = ''
      if (item.isLocale) {
        path = computedParentPath(item)
      } else {
        path = activeFilePath
      }
      const url = await convertImageByWorkspace(path)
      setImageUrl(url)
    } else {
      setActiveFilePath(computedParentPath(item))
      readArticle(computedParentPath(item), item.sha, item.isLocale)
    }
  }

  async function handleDeleteFile() {
    // 添加确认弹窗
    const answer = await ask(t('deleteConfirm'), {
      title: item.name,
      kind: 'warning',
    });
    // 如果用户确认删除，则继续执行
    if (answer) {
      try {
        // 获取工作区路径信息
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const workspace = await getWorkspacePath()
        
        // 根据工作区类型正确删除文件
        const pathOptions = await getFilePathOptions(path)
        
        if (workspace.isCustom) {
          // 自定义工作区
          await remove(pathOptions.path)
        } else {
          // 默认工作区
          await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        // 更新文件树
        if (currentFolder) {
          const index = currentFolder.children?.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1 && currentFolder.children) {
            const current = currentFolder.children[index]
            if (current.sha) {
              current.isLocale = false
            } else {
              currentFolder.children.splice(index, 1)
            }
          }
        } else {
          const index = cacheTree.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1) {
            const current = cacheTree[index]
            if (current.sha) {
              current.isLocale = false
            } else {
              cacheTree.splice(index, 1)
            }
          }
        }
        setFileTree(cacheTree)
        setActiveFilePath('')
        setCurrentArticle('')
      } catch (error) {
        console.error('Delete file failed:', error)
        toast({
          title: t('context.deleteLocalFile'),
          description: '删除文件失败: ' + error,
          variant: 'destructive'
        })
      }
    }
  }

  async function handleDeleteSyncFile() {
    const answer = await ask(t('context.deleteSyncFile') + '?', {
      title: item.name,
      kind: 'warning',
    });
    if (answer) {
      try {
        // 获取当前主要备份方式
        const store = await Store.load('store.json');
        const backupMethod = await store.get<'github' | 'gitee' | 'gitlab'>('primaryBackupMethod') || 'github';
        
        switch (backupMethod) {
          case 'github':
            await deleteFile({ path: activeFilePath, sha: item.sha as string, repo: RepoNames.sync });
            break;
          case 'gitee':
            await deleteGiteeFile({ path: activeFilePath, sha: item.sha as string, repo: RepoNames.sync });
            break;
          case 'gitlab':
            await deleteGitlabFile({ path: activeFilePath, sha: item.sha as string, repo: RepoNames.sync });
            break;
        }
        
        // 更新文件树
        await loadFileTree()

        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileSuccess'),
        });
      } catch (error) {
        console.error(error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
    setIsEditing(true)
    setTimeout(() => inputRef.current?.focus(), 300);
  }

  async function handleRename() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    let finalName = name
    
    // 如果输入为空字符串，生成默认文件名
    if (!name || name.trim() === '') {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
      finalName = await generateUniqueFilename(parentPath, 'Untitled')
      setName(finalName)
    } else {
      // 统一处理：将空格替换为下划线，确保本地和远程文件名一致
      finalName = name.replace(/\s+/g, '_')
      setName(finalName)
    }
  
    if (finalName && finalName.trim() !== '' && finalName !== item.name) {
      // 确保新文件名如果需要.md后缀则添加后缀
      let displayName = finalName;
      if (item.name === '' && !displayName.endsWith('.md')) {
        displayName += '.md';
      }
      
      // 更新缓存树中的名称
      if (currentFolder && currentFolder.children) {
        const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
        if (fileIndex !== undefined && fileIndex !== -1) {
          currentFolder.children[fileIndex].name = displayName
          currentFolder.children[fileIndex].isEditing = false
        }
      } else {
        const fileIndex = cacheTree.findIndex(file => file.name === item.name)
        if (fileIndex !== -1 && fileIndex !== undefined) {
          cacheTree[fileIndex].name = displayName
          cacheTree[fileIndex].isEditing = false
        }
      }
      
      // 确定是重命名现有文件还是创建新文件
      if (item.name !== '') {
        // 重命名现有文件
        // 获取源路径和目标路径
        const oldPathOptions = await getFilePathOptions(path)
        const newPathRelative = path.split('/').slice(0, -1).join('/') + '/' + displayName
        const newPathOptions = await getFilePathOptions(newPathRelative)
        
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
        // 创建新文件
        let newFilePath = finalName
        if (!newFilePath.endsWith('.md')) {
          newFilePath += '.md'
        }
        
        // 获取新文件的完整路径
        const parentPath = path.split('/').slice(0, -1).join('/')
        const fullRelativePath = parentPath ? `${parentPath}/${newFilePath}` : newFilePath
        const pathOptions = await getFilePathOptions(fullRelativePath)
        
        // 检查文件是否已存在
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          toast({ title: '文件名已存在' })
          setTimeout(() => inputRef.current?.focus(), 300);
          return
        } else {
          // 创建新文件
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
        }
      }
      
      // 构建新文件的完整路径用于激活文件
      let newPath = path.split('/').slice(0, -1).join('/') + '/' + (name.endsWith('.md') ? name : name + '.md')
      // 判断 newPath 是否以 / 开头
      if (newPath.startsWith('/')) {
        newPath = newPath.slice(1)
      }
      setActiveFilePath(newPath)
      // 新建文件后自动选择该文件并读取内容
      readArticle(newPath, '', true)
    } else {
      // 处理取消创建或无变更的情况
      if (item.name === '') {
        // 只有当原文件名为空（新建文件）时才删除列表项
        if (currentFolder && currentFolder.children) {
          const index = currentFolder?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.children) {
            currentFolder?.children?.splice(index, 1)
          }
        } else {
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
        }
      } else {
        // 对于重命名现有文件，如果没有输入新名称，则保持原状态
        if (currentFolder && currentFolder.children) {
          const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
          if (fileIndex !== undefined && fileIndex !== -1) {
            currentFolder.children[fileIndex].isEditing = false
          }
        } else {
          const fileIndex = cacheTree.findIndex(file => file.name === item.name)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            cacheTree[fileIndex].isEditing = false
          }
        }
      }
    }
    
    setFileTree(cacheTree)
    setIsEditing(false)
  }

  async function handleShowFileManager() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 确定文件所在的目录路径
    const folderPath = item.parent ? computedParentPath(item.parent) : ''
    
    // 根据工作区类型确定正确的路径
    if (workspace.isCustom) {
      // 自定义工作区 - 直接使用工作区路径
      const pathOptions = await getFilePathOptions(folderPath)
      openPath(pathOptions.path)
    } else {
      // 默认工作区 - 使用 AppData 目录
      const appDir = await appDataDir()
      openPath(await join(appDir, 'article', folderPath))
    }
  }

  async function handleDragStart(ev: React.DragEvent<HTMLDivElement>) {
    ev.dataTransfer.setData('text', path)
  }

  async function handleCopyFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteFile() {
    if (!clipboardItem) {
      toast({ title: t('clipboard.empty'), variant: 'destructive' })
      return
    }

    // This function only handles file paste operations
    if (clipboardItem.isDirectory) {
      toast({ title: t('clipboard.notSupported'), variant: 'destructive' })
      return
    }

    try {
      const sourcePath = `article/${clipboardItem.path}`
      const targetDir = path.substring(0, path.lastIndexOf('/'))
      const targetPath = `article/${targetDir}/${clipboardItem.name}`
      
      // Check if file already exists at target location
      const fileExists = await exists(targetPath, { baseDir: BaseDirectory.AppData })
      if (fileExists) {
        const confirmOverwrite = await ask(t('clipboard.confirmOverwrite'), {
          title: item.name,
          kind: 'warning',
        })
        if (!confirmOverwrite) return
      }

      // Read content from source file
      const content = await readTextFile(sourcePath, { baseDir: BaseDirectory.AppData })
      
      // Write to target location
      await writeTextFile(targetPath, content, { baseDir: BaseDirectory.AppData })
      
      // If cut operation, delete the original file
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

  async function handleEditEnd() {
    if (currentFolder && currentFolder.children) {
      const index = currentFolder?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.children) {
        currentFolder?.children?.splice(index, 1)
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
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={`${path === activeFilePath ? 'file-manange-item active' : 'file-manange-item'} ${!isRoot && 'translate-x-5 !w-[calc(100%-22px)]'}`}
            onClick={handleSelectFile}
            onContextMenu={handleSelectFile}
          >
            {
              isEditing ? 
              <div className="flex gap-1 items-center w-full select-none">
                <span className={item.parent ? 'size-0' : 'size-4 ml-1'} />
                <File className="size-4" />
                <Input
                  ref={inputRef}
                  className="h-5 rounded-sm text-xs px-1 font-normal flex-1 mr-1"
                  value={name}
                  onBlur={handleRename}
                  onChange={handleInputChange}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(e) => {
                    if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                      handleRename()
                    } else if (e.code === 'Escape') {
                      handleEditEnd()
                    }
                  }}
                />
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ? 
              <PhotoProvider>
                <PhotoView src={imageUrl}>
                  <span
                    draggable
                    onDragStart={handleDragStart}
                    title={item.name}
                    className={`${item.isLocale ? '' : 'opacity-50'} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                    <div className="flex flex-1 gap-1 select-none relative">
                      <span className={item.parent ? 'size-0' : 'size-4 ml-1'}></span>
                      <div className="relative">
                        <ImageIcon className="size-4" />
                        { item.sha && item.isLocale && <Cloud className="size-2.5 absolute left-0 bottom-0 z-10 bg-primary-foreground" /> }
                      </div>
                      <span className="text-xs flex-1 line-clamp-1">{item.name}</span>
                    </div>
                    {isMobile && (
                      <MobileActionMenu className="ml-1">
                        <MobileMenuItem onClick={handleShowFileManager}>
                          {t('context.viewDirectory')}
                        </MobileMenuItem>
                        <MobileSeparator />
                        <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                          {t('context.cut')}
                        </MobileMenuItem>
                        <MobileMenuItem onClick={handleCopyFile}>
                          {t('context.copy')}
                        </MobileMenuItem>
                        <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                          {t('context.paste')}
                        </MobileMenuItem>
                        <MobileSeparator />
                        <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                          {t('context.rename')}
                        </MobileMenuItem>
                        <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                          {t('context.deleteSyncFile')}
                        </MobileMenuItem>
                        <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                          {t('context.deleteLocalFile')}
                        </MobileMenuItem>
                      </MobileActionMenu>
                    )}
                  </span>
                </PhotoView>
              </PhotoProvider> :
              <span
                draggable
                onDragStart={handleDragStart}
                title={item.name}
                className={`${item.isLocale ? '' : 'opacity-50'} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                <div className="flex flex-1 gap-1 select-none relative">
                  <span className={item.parent ? 'size-0' : 'size-4 ml-1'}></span>
                  <div className="relative">
                    { item.isLocale ? <File className="size-4" /> : <CloudDownload className="size-4" /> }
                    { item.sha && item.isLocale && <Cloud className="size-2.5 absolute left-0 bottom-0 z-10 bg-primary-foreground" /> }
                  </div>
                  <span className="text-xs flex-1 line-clamp-1">{item.name}</span>
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem inset onClick={handleShowFileManager}>
            {t('context.viewDirectory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile}>
            {t('context.cut')}
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleCopyFile}>
            {t('context.copy')}
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!clipboardItem} onClick={handlePasteFile}>
            {t('context.paste')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename}>
            {t('context.rename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.sha} inset className="text-red-900" onClick={handleDeleteSyncFile}>
            {t('context.deleteSyncFile')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-red-900" onClick={handleDeleteFile}>
            {t('context.deleteLocalFile')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}