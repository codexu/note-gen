'use client'

import { Button } from "@/components/ui/button"
import { FormItem } from "../components/setting-base"
import useSettingStore from "@/stores/setting"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"
import { useTranslations } from 'next-intl'
import useArticleStore from "@/stores/article"
import { X, FolderOpen, History, Trash2, ChevronDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useState } from "react"

export function SettingWorkspace() {
  const { 
    workspacePath, 
    setWorkspacePath, 
    workspaceHistory, 
    removeWorkspaceHistory, 
    clearWorkspaceHistory 
  } = useSettingStore()
  const {clearCollapsibleList, loadFileTree, setActiveFilePath, setCurrentArticle} = useArticleStore()
  const t = useTranslations('settings.file')
  const [open, setOpen] = useState(false)

  // 选择工作区目录
  async function handleSelectWorkspace() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('workspace.select')
      })
      
      if (selected) {
        const path = selected as string
        await switchWorkspace(path)
      }
    } catch (error) {
      console.error('选择工作区失败:', error)
    }
  }

  // 切换工作区（统一处理）
  async function switchWorkspace(path: string) {
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


  // 清空所有历史记录
  async function handleClearHistory() {
    await clearWorkspaceHistory()
  }

  // 重置为默认工作区
  async function handleResetWorkspace() {
    try {
      // 确保默认目录存在
      const exists1 = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!exists1) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
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
    <FormItem 
        title={t('workspace.current')} 
        desc={t('workspace.desc')}
      >
        <div className="space-y-3">
          {/* 当前工作区路径显示和选择 */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between p-3 h-auto text-left font-normal"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate text-sm">
                    {workspacePath || t('workspace.default')}
                  </span>
                </div>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput placeholder={t('workspace.searchPlaceholder')} />
                <CommandList>
                  <CommandEmpty>{t('workspace.noResults')}</CommandEmpty>
                  
                  {/* 选择新工作区 */}
                  <CommandGroup heading={t('workspace.actions')}>
                    <CommandItem
                      onSelect={() => {
                        setOpen(false)
                        handleSelectWorkspace()
                      }}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      {t('workspace.select')}
                    </CommandItem>
                    {workspacePath && (
                      <CommandItem
                        onSelect={() => {
                          setOpen(false)
                          handleResetWorkspace()
                        }}
                      >
                        <History className="mr-2 h-4 w-4" />
                        {t('workspace.reset')}
                      </CommandItem>
                    )}
                  </CommandGroup>

                  {/* 历史路径 */}
                  {workspaceHistory.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup heading={t('workspace.history')}>
                        {workspaceHistory.map((path, index) => (
                          <CommandItem
                            key={index}
                            onSelect={() => {
                              setOpen(false)
                              switchWorkspace(path)
                            }}
                          >
                            <div className="flex items-center justify-between w-full group">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <FolderOpen className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate" title={path}>
                                  {path}
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeWorkspaceHistory(path)
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </CommandItem>
                        ))}
                        {workspaceHistory.length > 1 && (
                          <CommandItem
                            onSelect={() => {
                              setOpen(false)
                              handleClearHistory()
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('workspace.clearHistory')}
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          
        </div>
    </FormItem>
  )
}
