"use client"
import {TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  FilePlus, 
  FolderGit2, 
  FolderPlus, 
  FolderSync, 
  LoaderCircle,
  SortAsc,
  SortDesc,
  Clock,
  Calendar,
  ArrowDownAZ,
  ChevronsDownUp,
  ChevronsUpDown,
  BookA,
  FolderInput,
} from "lucide-react"
import * as React from "react"
import { TooltipButton } from "@/components/tooltip-button"
import useArticleStore from "@/stores/article"
import { open } from '@tauri-apps/plugin-shell';
import useSettingStore from "@/stores/setting"
import { RepoNames } from "@/lib/sync/github.types"
import { GitlabInstanceType } from "@/lib/sync/gitlab.types"
import { GiteaInstanceType } from "@/lib/sync/gitea.types"
import { useTranslations } from "next-intl"
import { debounce } from "lodash-es"
import useVectorStore from "@/stores/vector"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useUsername from "@/hooks/use-username"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readDir, copyFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getWorkspacePath } from '@/lib/workspace'
import { toast } from '@/hooks/use-toast'

export function FileToolbar() {
  const { newFolder, loadFileTree, newFile, fileTreeLoading, sortType, setSortType, sortDirection, setSortDirection, toggleAllFolders, collapsibleList } = useArticleStore()
  const {
    primaryBackupMethod,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
    gitlabInstanceType,
    gitlabCustomUrl,
    giteaInstanceType,
    giteaCustomUrl
  } = useSettingStore()
  const { processAllDocuments, isProcessing, isVectorDbEnabled, setVectorDbEnabled } = useVectorStore()
  const t = useTranslations('article.file.toolbar')

  const username = useUsername()

  const debounceNewFile = debounce(newFile, 200)
  const debounceNewFolder = debounce(newFolder, 200)
  const [isImporting, setIsImporting] = React.useState(false)

  const repoName = React.useMemo(() => {
    switch (primaryBackupMethod) {
      case 'github':
        return githubCustomSyncRepo.trim() || RepoNames.sync
      case 'gitee':
        return giteeCustomSyncRepo.trim() || RepoNames.sync
      case 'gitlab':
        return gitlabCustomSyncRepo.trim() || RepoNames.sync
      case 'gitea':
        return giteaCustomSyncRepo.trim() || RepoNames.sync
      default:
        return RepoNames.sync
    }
  }, [primaryBackupMethod, githubCustomSyncRepo, giteeCustomSyncRepo, gitlabCustomSyncRepo, giteaCustomSyncRepo])

  async function openRemoteRepo() {
    if (!username || !primaryBackupMethod) return

    let baseUrl = ''
    
    switch (primaryBackupMethod) {
      case 'github':
        baseUrl = 'https://github.com'
        break
      case 'gitee':
        baseUrl = 'https://gitee.com'
        break
      case 'gitlab':
        // 处理 Gitlab 自建实例
        if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED && gitlabCustomUrl) {
          baseUrl = gitlabCustomUrl.replace(/\/$/, '') // 移除末尾斜杠
        } else if (gitlabInstanceType === GitlabInstanceType.JIHULAB) {
          baseUrl = 'https://jihulab.com'
        } else {
          baseUrl = 'https://gitlab.com'
        }
        break
      case 'gitea':
        // 处理 Gitea 自建实例
        if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED && giteaCustomUrl) {
          baseUrl = giteaCustomUrl.replace(/\/$/, '') // 移除末尾斜杠
        } else {
          baseUrl = 'https://gitea.com'
        }
        break
      default:
        return
    }

    open(`${baseUrl}/${username}/${repoName}`)
  }

  // 递归复制文件夹中的所有 markdown 文件和图片
  async function copyMarkdownFilesRecursively(
    sourceDir: string,
    targetDir: string,
    relativePath: string = ''
  ): Promise<number> {
    let copiedCount = 0
    
    try {
      const entries = await readDir(sourceDir)
      
      for (const entry of entries) {
        // 跳过隐藏文件和文件夹
        if (entry.name.startsWith('.')) {
          continue
        }
        
        const sourcePath = await join(sourceDir, entry.name)
        const newRelativePath = relativePath ? await join(relativePath, entry.name) : entry.name
        const targetPath = await join(targetDir, newRelativePath)
        
        if (entry.isDirectory) {
          // 递归处理子文件夹
          const subDirCopied = await copyMarkdownFilesRecursively(
            sourcePath,
            targetDir,
            newRelativePath
          )
          copiedCount += subDirCopied
        } else if (entry.isFile) {
          // 检查是否是 markdown 文件或图片文件
          const isMd = entry.name.endsWith('.md')
          const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(entry.name)
          
          if (isMd || isImage) {
            // 确保目标文件夹存在
            const targetDirPath = relativePath ? await join(targetDir, relativePath) : targetDir
            if (!(await exists(targetDirPath))) {
              await mkdir(targetDirPath, { recursive: true })
            }
            
            // 复制文件
            await copyFile(sourcePath, targetPath)
            copiedCount++
          }
        }
      }
    } catch (error) {
      console.error('Error copying files:', error)
      throw error
    }
    
    return copiedCount
  }

  async function handleImportMarkdown() {
    try {
      setIsImporting(true)
      
      // 打开文件夹选择对话框
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t('importMarkdown')
      })
      
      if (!selectedPath) {
        setIsImporting(false)
        return
      }
      
      // 获取工作区路径
      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom ? workspace.path : await join(await import('@tauri-apps/api/path').then(m => m.appDataDir()), 'article')
      
      // 递归复制所有 markdown 文件和图片
      const copiedCount = await copyMarkdownFilesRecursively(selectedPath as string, targetDir)
      
      // 刷新文件树
      await loadFileTree()
      
      // 显示成功提示
      toast({
        title: t('importSuccess'),
        description: t('importSuccessDesc', { count: copiedCount })
      })
    } catch (error) {
      console.error('Import markdown error:', error)
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive'
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="flex justify-between items-center h-12 border-b px-2">
      <div>
        {/* 新建 */}
        <TooltipButton icon={<FilePlus />} tooltipText={t('newArticle')} onClick={debounceNewFile} />
        {/* 新建文件夹 */}
        <TooltipButton icon={<FolderPlus />} tooltipText={t('newFolder')} onClick={debounceNewFolder} />
        {/* 导入 Markdown */}
        <TooltipButton 
          icon={isImporting ? <LoaderCircle className="animate-spin size-4" /> : <FolderInput />} 
          tooltipText={isImporting ? t('importing') : t('importMarkdown')} 
          onClick={handleImportMarkdown}
          disabled={isImporting}
        />
        {/* 向量数据库 */}
        <TooltipButton 
          icon={isProcessing ? <LoaderCircle className="animate-spin size-4" /> : <BookA className={isVectorDbEnabled ? "text-primary" : ""} />} 
          tooltipText={isProcessing ? t('processingVectors') : (isVectorDbEnabled ? t('calculateVectors') : t('enableVectorDb'))} 
          onClick={isVectorDbEnabled ? processAllDocuments : () => setVectorDbEnabled(true)}
          disabled={isProcessing} 
        />
        {/* 同步 */}
        {
          primaryBackupMethod && username ?
            <TooltipButton
              icon={fileTreeLoading ? <LoaderCircle className="animate-spin size-4" /> : <FolderGit2 />}
              tooltipText={fileTreeLoading ? t('loadingSync') : t('accessRepo')}
              disabled={!username}
              onClick={openRemoteRepo}
            />
            : null
        }
      </div>
      <div>
        <TooltipProvider>
          {/* 排序 */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9">
                    {sortDirection === 'asc' ? <SortAsc className={`h-4 w-4 ${sortType !== 'none' ? 'text-primary' : ''}`} /> : <SortDesc className={`h-4 w-4 ${sortType !== 'none' ? 'text-primary' : ''}`} />}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('sort')}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortType('name')} className={sortType === 'name' ? 'bg-accent' : ''}>
                <ArrowDownAZ className="mr-2 h-4 w-4" />
                {t('sortByName')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortType('created')} className={sortType === 'created' ? 'bg-accent' : ''}>
                <Calendar className="mr-2 h-4 w-4" />
                {t('sortByCreated')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortType('modified')} className={sortType === 'modified' ? 'bg-accent' : ''}>
                <Clock className="mr-2 h-4 w-4" />
                {t('sortByModified')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} className="border-t mt-1 pt-1">
                {sortDirection === 'asc' ? (
                  <>
                    <SortDesc className="mr-2 h-4 w-4" />
                    {t('sortDesc')}
                  </>
                ) : (
                  <>
                    <SortAsc className="mr-2 h-4 w-4" />
                    {t('sortAsc')}
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
        {/* 折叠/展开 */}
        <TooltipButton 
          icon={collapsibleList.length > 0 ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />} 
          tooltipText={collapsibleList.length > 0 ? t('collapseAll') : t('expandAll')} 
          onClick={toggleAllFolders} 
        />
        {/* 刷新 */}
        <TooltipButton icon={<FolderSync />} tooltipText={t('refresh')} onClick={loadFileTree} />
      </div>
    </div>
  )
}
