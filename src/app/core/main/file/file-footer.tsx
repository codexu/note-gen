'use client'

import { Button } from "@/components/ui/button"
import { FolderOpen, FolderSync, SortAsc, SortDesc, ChevronsDownUp, ChevronsUpDown, ArrowDownAZ, Calendar, Clock, ChevronDown, FolderPlus, Cloud } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useArticleStore from "@/stores/article"
import { useSkillsStore } from "@/stores/skills"
import { useTranslations } from 'next-intl'
import { useMemo } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { BottomBarIconButton } from "@/components/bottom-bar-icon-button"

export function FileFooter() {
  const { workspacePath, workspaceHistory, setWorkspacePath } = useSettingStore()
  const { refreshSkills } = useSkillsStore()
  const {
    clearCollapsibleList,
    loadFileTree,
    setActiveFilePath,
    setCurrentArticle,
    sortType,
    setSortType,
    sortDirection,
    setSortDirection,
    toggleAllFolders,
    collapsibleList,
    showCloudFiles,
    setShowCloudFiles
  } = useArticleStore()
  const tFile = useTranslations('settings.file')
  const tToolbar = useTranslations('article.file.toolbar')

  // 获取文件夹名称
  const getWorkspaceName = (path: string) => {
    if (!path) return tFile('workspace.defaultPath')
    return path.split('/').pop() || path.split('\\').pop() || path
  }

  // 当前工作区名称
  const currentWorkspaceName = useMemo(() => {
    return getWorkspaceName(workspacePath)
  }, [workspacePath, tFile])

  // 选择工作区目录
  async function handleSelectWorkspace() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: tFile('workspace.select')
      })
      
      if (selected) {
        const path = selected as string
        await switchWorkspace(path)
      }
    } catch (error) {
      console.error('选择工作区失败:', error)
    }
  }

  // 切换工作区
  async function switchWorkspace(path: string) {
    if (path === workspacePath) return

    try {
      await setWorkspacePath(path)
      await clearCollapsibleList()
      setActiveFilePath('')
      setCurrentArticle('')
      await loadFileTree()
      await refreshSkills()
    } catch (error) {
      console.error('切换工作区失败:', error)
    }
  }

  // 重置为默认工作区
  async function handleResetWorkspace() {
    try {
      await setWorkspacePath('')
      await clearCollapsibleList()
      setActiveFilePath('')
      setCurrentArticle('')
      await loadFileTree()
      await refreshSkills()
    } catch (error) {
      console.error('重置工作区失败:', error)
    }
  }

  return (
    <div className="flex h-6 items-center justify-between gap-1 overflow-hidden border-t border-border bg-background px-2 text-xs text-muted-foreground">
      {/* 左侧：工作区选择器 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-5 flex-1 justify-between border-0 bg-transparent px-1.5 text-xs text-muted-foreground hover:bg-accent focus:ring-0"
          >
            <span className="truncate text-xs">{currentWorkspaceName}</span>
            <ChevronDown className="ml-1 size-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* 选择新工作区 */}
          <DropdownMenuLabel>{tFile('workspace.actions')}</DropdownMenuLabel>
          <DropdownMenuItem onClick={handleSelectWorkspace}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {tFile('workspace.select')}
          </DropdownMenuItem>
          {workspacePath && (
            <DropdownMenuItem onClick={handleResetWorkspace}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {tFile('workspace.defaultPath')}
            </DropdownMenuItem>
          )}
          
          {/* 历史工作区 */}
          {workspaceHistory.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{tFile('workspace.history')}</DropdownMenuLabel>
              {workspaceHistory.map((path, index) => (
                <DropdownMenuItem key={index} onClick={() => switchWorkspace(path)}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  <span className="truncate" title={path}>{getWorkspaceName(path)}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          
          {/* 默认工作区 */}
          {!workspacePath && workspaceHistory.length === 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <FolderOpen className="mr-2 h-4 w-4" />
                {tFile('workspace.defaultPath')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" />

      {/* 右侧：排序、云端开关、展开、刷新 */}
      <div className="flex items-center gap-1">
        {/* 云端文件开关 */}
        <BottomBarIconButton
          icon={<Cloud className={`size-3 ${showCloudFiles ? 'text-primary' : 'opacity-40'}`} />}
          label={showCloudFiles ? tToolbar('hideCloudFiles') : tToolbar('showCloudFiles')}
          onClick={() => setShowCloudFiles(!showCloudFiles)}
          active={showCloudFiles}
        />

        {/* 排序 */}
        <TooltipProvider>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative size-5 rounded-sm">
                    {sortDirection === 'asc' ? <SortAsc className={`size-3 ${sortType !== 'none' ? 'text-primary' : ''}`} /> : <SortDesc className={`size-3 ${sortType !== 'none' ? 'text-primary' : ''}`} />}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tToolbar('sort')}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortType('name')} className={sortType === 'name' ? 'bg-accent' : ''}>
                <ArrowDownAZ className="mr-2 h-4 w-4" />
                {tToolbar('sortByName')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortType('created')} className={sortType === 'created' ? 'bg-accent' : ''}>
                <Calendar className="mr-2 h-4 w-4" />
                {tToolbar('sortByCreated')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortType('modified')} className={sortType === 'modified' ? 'bg-accent' : ''}>
                <Clock className="mr-2 h-4 w-4" />
                {tToolbar('sortByModified')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} className="border-t mt-1 pt-1">
                {sortDirection === 'asc' ? (
                  <>
                    <SortDesc className="mr-2 h-4 w-4" />
                    {tToolbar('sortDesc')}
                  </>
                ) : (
                  <>
                    <SortAsc className="mr-2 h-4 w-4" />
                    {tToolbar('sortAsc')}
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>

        {/* 折叠/展开 */}
        <BottomBarIconButton 
          icon={collapsibleList.length > 0 ? <ChevronsDownUp className="size-3" /> : <ChevronsUpDown className="size-3" />} 
          label={collapsibleList.length > 0 ? tToolbar('collapseAll') : tToolbar('expandAll')} 
          onClick={toggleAllFolders}
        />

        {/* 刷新 */}
        <BottomBarIconButton 
          icon={<FolderSync className="size-3" />} 
          label={tToolbar('refresh')} 
          onClick={loadFileTree}
        />
      </div>
    </div>
  )
}
