'use client'

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { FolderOpen, FolderSync, SortAsc, SortDesc, ChevronsDownUp, ChevronsUpDown, ArrowDownAZ, Calendar, Clock } from "lucide-react"
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
} from "@/components/ui/dropdown-menu"
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"

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

  // 切换工作区
  async function handleWorkspaceChange(path: string) {
    // 处理特殊的默认工作区值
    const targetPath = path === '__default__' ? '' : path
    if (targetPath === workspacePath) return
    
    try {
      await setWorkspacePath(targetPath)
      await clearCollapsibleList()
      setActiveFilePath('')
      setCurrentArticle('')
      await loadFileTree()
    } catch (error) {
      console.error('切换工作区失败:', error)
    }
  }

  return (
    <div className="border-t bg-muted/30 h-6 flex items-center justify-between px-1 overflow-hidden gap-1">
      {/* 左侧：工作区选择器 */}
      <Select value={workspacePath} onValueChange={handleWorkspaceChange}>
        <SelectTrigger className="h-6 border-0 bg-transparent hover:bg-transparent focus:ring-0 text-sm flex-1">
          <span className="truncate text-xs">{currentWorkspaceName}</span>
        </SelectTrigger>
        <SelectContent>
          {/* 默认工作区 */}
          <SelectItem value="__default__">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              <span>{tFile('workspace.defaultPath')}</span>
            </div>
          </SelectItem>
          {/* 历史工作区 */}
          {workspaceHistory.map((path, index) => (
            <SelectItem key={index} value={path}>
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                <span>{getWorkspaceName(path)}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
