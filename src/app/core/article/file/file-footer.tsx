'use client'

import { Button } from "@/components/ui/button"
import { FolderOpen, FolderSync, SortAsc, SortDesc, ChevronsDownUp, ChevronsUpDown, ArrowDownAZ, Calendar, Clock, ChevronDown, FolderPlus } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useArticleStore from "@/stores/article"
import { useTranslations } from 'next-intl'
import { useMemo } from "react"
import { TooltipButton } from "@/components/tooltip-button"
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

export function FileFooter() {
  const { workspacePath, workspaceHistory, setWorkspacePath } = useSettingStore()
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
    collapsibleList
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
    } catch (error) {
      console.error('重置工作区失败:', error)
    }
  }

  return (
    <div className="border-t h-6 flex items-center justify-between px-1 overflow-hidden gap-1">
      {/* 左侧：工作区选择器 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex justify-between h-6 border-0 bg-transparent hover:bg-accent focus:ring-0 text-sm flex-1 px-2"
          >
            <span className="truncate text-xs">{currentWorkspaceName}</span>
            <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
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

      {/* 右侧：排序、展开、刷新 */}
      <div className="flex items-center gap-0.5">
        {/* 排序 */}
        <TooltipProvider>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 relative">
                    {sortDirection === 'asc' ? <SortAsc className={`!size-3.5 ${sortType !== 'none' ? 'text-primary' : ''}`} /> : <SortDesc className={`!size-3.5 ${sortType !== 'none' ? 'text-primary' : ''}`} />}
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
        <TooltipButton 
          icon={collapsibleList.length > 0 ? <ChevronsDownUp className="!size-3.5" /> : <ChevronsUpDown className="!size-3.5" />} 
          tooltipText={collapsibleList.length > 0 ? tToolbar('collapseAll') : tToolbar('expandAll')} 
          onClick={toggleAllFolders}
          size="sm"
        />

        {/* 刷新 */}
        <TooltipButton 
          icon={<FolderSync className="!size-3.5" />} 
          tooltipText={tToolbar('refresh')} 
          onClick={loadFileTree}
          size="sm"
        />
      </div>
    </div>
  )
}
