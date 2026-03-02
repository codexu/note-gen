import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, Database, File, FileDown, FileUp, FolderOpen, ImageIcon, LoaderCircle, RefreshCwOff, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { platform } from '@tauri-apps/plugin-os';
import { Store } from '@tauri-apps/plugin-store';
import { RepoNames } from "@/lib/sync/github.types";
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { appDataDir, join } from '@tauri-apps/api/path';
import { deleteFile } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile } from "@/lib/sync/gitlab";
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import useSettingStore from "@/stores/setting";
import { VectorKnowledgeMenu } from "./vector-knowledge-menu";
import { isSkillsFolder } from "@/lib/skills/utils";

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

export function FileItem({ item, focusSidebar }: { item: DirTree; focusSidebar?: () => void }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isComposing, setIsComposing] = useState(false) // 追踪输入法合成状态
  const inputRef = useRef<HTMLInputElement>(null)
  const { activeFilePath, setActiveFilePath, readArticle, fileTree, setFileTree, loadFileTree, vectorIndexedFiles, checkFileVectorIndexed, cleanTabsByDeletedFile, cleanTabsByDeletedFolder } = useArticleStore()
  const setArticleState = useArticleStore.setState
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()
  const { fileManagerTextSize } = useSettingStore()
  const t = useTranslations('article.file')
  const isMobile = useIsMobile()

  // 检查路径是否在 skills 文件夹下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  // 向量状态更新回调
  const handleVectorUpdated = useCallback(() => {
    checkFileVectorIndexed(item.name)
  }, [item.name, checkFileVectorIndexed])

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

  const path = computedParentPath(item)

  // 检查文件是否被剪切
  const isCut = clipboardOperation === 'cut' && clipboardItem?.path === path

  // 检查文件是否已计算向量（skills 文件夹下的文件不显示）
  const hasVector = item.isFile && !isInSkillsFolder(path) && vectorIndexedFiles.has(item.name)

  // 向量计算状态图标
  const renderVectorIcon = () => {
    if (isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus

    if (status === 'calculating') {
      return <LoaderCircle className={`${iconSize} mr-2 animate-spin`} />
    } else if (status === 'completed' || hasVector) {
      return <Database className={`${iconSize} text-muted-foreground mr-2 opacity-60`} />
    }
    return null
  }

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
    // 让文件管理器获得焦点，以便响应快捷键
    focusSidebar?.()
    const currentPath = computedParentPath(item)

    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      // 图片文件：设置 activeFilePath，让 EditorLayout 显示图片编辑器
      setActiveFilePath(currentPath)
    } else if (item.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
      // Markdown/文本文件：设置 activeFilePath
      setActiveFilePath(currentPath)

      // 检查是否是远程文件
      // 读取内容的逻辑移到 EditorLayout 中处理，避免重复渲染
    } else {
      // 其他文件类型：设置 activeFilePath，让 EditorLayout 显示 UnsupportedFile 组件
      setActiveFilePath(currentPath)
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

        // 使用当前路径，而不是重新计算的路径
        const currentPath = computedParentPath(item)

        // 根据工作区类型正确删除文件
        const pathOptions = await getFilePathOptions(currentPath)

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
              // 有云端版本：只标记为非本地文件，保留云端文件
              current.isLocale = false
            } else {
              // 纯本地文件：直接从文件树中移除
              currentFolder.children.splice(index, 1)
            }
          }
        } else {
          const index = cacheTree.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1) {
            const current = cacheTree[index]
            if (current.sha) {
              // 有云端版本：只标记为非本地文件，保留云端文件
              current.isLocale = false
            } else {
              // 纯本地文件：直接从文件树中移除
              cacheTree.splice(index, 1)
            }
          }
        }
        setFileTree(cacheTree)

        // 删除向量数据库中的记录
        try {
          const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
          await deleteVectorDocumentsByFilename(item.name)
          // 从向量索引映射中移除
          const newMap = new Map(vectorIndexedFiles)
          newMap.delete(item.name)
          setArticleState({ vectorIndexedFiles: newMap })
        } catch (error) {
          console.error(`删除文件 ${item.name} 的向量数据失败:`, error)
        }

        // 清理已被删除的文件对应的 tabs（包括自动选择其他 tab）
        await cleanTabsByDeletedFile(currentPath)
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
      const currentPath = computedParentPath(item)

      try {
        // 获取当前主要备份方式
        const store = await Store.load('store.json');
        const backupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea'>('primaryBackupMethod') || 'github';

        let success = false
        switch (backupMethod) {
          case 'github': {
            const result = await deleteFile({ path: currentPath, sha: item.sha as string, repo: RepoNames.sync });
            success = !!result
            break;
          }
          case 'gitee': {
            const result = await deleteGiteeFile({ path: currentPath, sha: item.sha as string, repo: RepoNames.sync });
            success = result !== false
            break;
          }
          case 'gitlab': {
            const result = await deleteGitlabFile({ path: currentPath, sha: item.sha as string, repo: RepoNames.sync });
            success = !!result
            break;
          }
          case 'gitea': {
            const { deleteFile: deleteGiteaFile } = await import('@/lib/sync/gitea')
            const result = await deleteGiteaFile({ path: currentPath, sha: item.sha as string, repo: RepoNames.sync });
            success = !!result
            break;
          }
        }

        if (success) {
          // 只更新当前文件的状态，不刷新整个文件树
          const cacheTree = cloneDeep(fileTree)

          // 递归查找并更新文件状态
          const updateFileStatus = (items: typeof cacheTree): boolean => {
            for (const entry of items) {
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                entry.sha = undefined // 清除远程 SHA
                return true
              }
              if (entry.children && updateFileStatus(entry.children)) {
                return true
              }
            }
            return false
          }

          if (updateFileStatus(cacheTree)) {
            setFileTree(cacheTree)
          }

          toast({
            title: t('context.delete'),
            description: t('context.deleteSyncFileSuccess'),
          });
        } else {
          throw new Error('删除操作返回失败')
        }
      } catch (error) {
        console.error('[handleDeleteSyncFile] 删除远程文件失败:', error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
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
      let newPath = path.split('/').slice(0, -1).join('/') + '/' + displayName
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

    try {
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()

      // 粘贴目标：文件所在的目录（同级粘贴）
      const targetDir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''

      // 检查是否会造成循环嵌套
      if (clipboardItem.isDirectory) {
        // 检查是否粘贴到其子文件夹内部（targetDir 以 clipboardItem.path/ 开头）
        // 注意：允许粘贴到自身内部（targetDir === clipboardItem.path），但需要特殊处理避免循环
        if (targetDir.startsWith(clipboardItem.path + '/')) {
          toast({ title: '无法将父文件夹粘贴到其子文件夹内部', variant: 'destructive' })
          return
        }
      }

      if (clipboardItem.isDirectory) {
        // 粘贴文件夹
        const { generateCopyFoldername } = await import('@/lib/default-filename')
        const { mkdir, readDir } = await import('@tauri-apps/plugin-fs')

        const targetName = await generateCopyFoldername(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${targetName}` : targetName
        const targetPathOptions = await getFilePathOptions(targetPathRelative)
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)

        // 检查是否是粘贴到自身内部（需要避免循环引用）
        const isPasteIntoSelf = targetDir === clipboardItem.path

        // 创建目标文件夹
        if (workspace.isCustom) {
          await mkdir(targetPathOptions.path)
        } else {
          await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
        }

        // 递归复制文件夹内容
        const copyDirRecursively = async (srcRelative: string, destRelative: string) => {
          const entries = await readDir(
            srcRelative,
            workspace.isCustom ? {} : { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData }
          )

          for (const entry of entries) {
            const srcEntryPath = `${srcRelative}/${entry.name}`
            const destEntryPath = `${destRelative}/${entry.name}`

            if (entry.isDirectory) {
              // 如果粘贴到自身内部，跳过与目标文件夹同名的子文件夹（避免循环引用）
              if (isPasteIntoSelf && entry.name === targetName) {
                continue
              }

              if (workspace.isCustom) {
                await mkdir(destEntryPath)
              } else {
                await mkdir(destEntryPath, { baseDir: targetPathOptions.baseDir })
              }
              await copyDirRecursively(srcEntryPath, destEntryPath)
            } else {
              try {
                let content = ''
                if (workspace.isCustom) {
                  content = await readTextFile(srcEntryPath)
                  await writeTextFile(destEntryPath, content)
                } else {
                  content = await readTextFile(srcEntryPath, { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData })
                  await writeTextFile(destEntryPath, content, { baseDir: targetPathOptions.baseDir })
                }
              } catch (err) {
                console.error(`Error copying file ${srcEntryPath}:`, err)
              }
            }
          }
        }

        await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)

        // 如果是剪切操作，删除原文件夹
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path, { recursive: true })
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
          }
          // 清理已被删除的原文件夹对应的 tabs
          await cleanTabsByDeletedFolder(clipboardItem?.path || '')
          setClipboardItem(null, 'none')
        }
      } else {
        // 粘贴文件
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)
        const { generateCopyFilename } = await import('@/lib/default-filename')
        const uniqueFilename = await generateCopyFilename(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${uniqueFilename}` : uniqueFilename
        const targetPathOptions = await getFilePathOptions(targetPathRelative)

        // Read content from source file
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(sourcePathOptions.path)
          await writeTextFile(targetPathOptions.path, content)
        } else {
          content = await readTextFile(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          await writeTextFile(targetPathOptions.path, content, { baseDir: targetPathOptions.baseDir })
        }

        // If cut operation, delete the original file
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path)
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          }
          // 清理已被删除的原文件对应的 tabs
          await cleanTabsByDeletedFile(clipboardItem?.path || '')
          // Clear clipboard after cut & paste operation
          setClipboardItem(null, 'none')
        }
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
      setIsEditing(true)
      setName(name)
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
        handleDeleteFile()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 粘贴到文件所在目录（同级粘贴）
      if (customEvent.detail.targetPath === path) {
        handlePasteFile()
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
  }, [path, handleStartRename, handleDeleteFile, handlePasteFile])

  // 获取当前平台（用于显示快捷键）
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    try {
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
  }, [])

  // 快捷键显示文本
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={`${path === activeFilePath ? 'file-manange-item active' : 'file-manange-item'} ${!isRoot && 'translate-x-5 w-[calc(100%-20px)]!'}`}
            onClick={handleSelectFile}
          >
            {
              isEditing ? 
              <div className="flex gap-1 items-center w-full select-none">
                <span className={item.parent ? 'size-0' : `${iconSize} ml-1`} />
                <File className={iconSize} />
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
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ?
              <span
                draggable
                onDragStart={handleDragStart}
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                <div className="flex flex-1 gap-1 select-none relative items-center">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex items-center">
                    <ImageIcon className={iconSize} />
                  </div>
                  <span className={`text-${fileManagerTextSize} flex-1 line-clamp-1`}>{item.name}</span>
                  {path === activeFilePath && renderVectorIcon()}
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
              </span> :
              <span
                draggable
                onDragStart={handleDragStart}
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                <div className="flex flex-1 gap-1 select-none relative items-center">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex items-center">
                    { item.isLocale ? (item.sha ? <FileUp className={iconSize} /> : <File className={iconSize} />) : <FileDown className={iconSize} /> }
                  </div>
                  <span className={`text-${fileManagerTextSize} flex-1 line-clamp-1`}>{item.name}</span>
                  {path === activeFilePath && renderVectorIcon()}
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
          <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('context.viewDirectory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <VectorKnowledgeMenu
            item={item}
            hasVector={hasVector}
            onVectorUpdated={handleVectorUpdated}
          />
          <ContextMenuSeparator />
          <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.cut')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}X</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleCopyFile} menuType="file">
            <Copy className="mr-2 h-4 w-4" />
            {t('context.copy')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}C</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!clipboardItem} onClick={handlePasteFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.paste')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}V</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.rename')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{renameKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.sha} inset className="text-red-900" onClick={handleDeleteSyncFile} menuType="file">
            <RefreshCwOff className="mr-2 h-4 w-4" />
            {t('context.deleteSyncFile')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-red-900" onClick={handleDeleteFile} menuType="file">
            <Trash2 className="mr-2 h-4 w-4" />
            {t('context.deleteLocalFile')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{deleteKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}