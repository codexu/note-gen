'use client'

import { Button } from "@/components/ui/button"
import useSettingStore from "@/stores/setting"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"
import { useTranslations } from 'next-intl'
import useArticleStore from "@/stores/article"
import { useSkillsStore } from "@/stores/skills"
import { X, FolderOpen, History, Trash2, ChevronDown, Loader2 } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/responsive-popover"
import { useState } from "react"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"
import { toast } from "@/hooks/use-toast"
import { prepareActiveEditorDeactivationDurably } from "@/lib/editor-deactivation"

export function SettingWorkspace({ showTitle = true }: { showTitle?: boolean }) {
  const {
    workspacePath,
    setWorkspacePath,
    workspaceHistory,
    removeWorkspaceHistory,
    clearWorkspaceHistory
  } = useSettingStore()
  const {loadWorkspaceCollapsibleList, loadFileTree, setActiveFilePath} = useArticleStore()
  const { refreshSkills } = useSkillsStore()
  const t = useTranslations('settings.file')
  const [open, setOpen] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)

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

  async function prepareWorkspaceSwitch() {
    const articleState = useArticleStore.getState()
    if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) {
      return false
    }
    await articleState.flushAllPendingArticleSaves()
    await articleState.settleAllVectorCalculations()
    return true
  }

  async function restoreWorkspaceContent() {
    await setActiveFilePath('', true, { deactivationAlreadyPrepared: true })
    const lastActivePath = await loadWorkspaceCollapsibleList()
    await loadFileTree()
    if (lastActivePath) {
      await setActiveFilePath(lastActivePath, true, {
        deactivationAlreadyPrepared: true,
        createIfMissing: false,
      })
    }
  }

  // 切换工作区（统一处理文件树、上次文件、Skills 和失败回滚）
  async function switchWorkspace(path: string) {
    if (switchingWorkspace || path === workspacePath) return
    if (!await prepareWorkspaceSwitch()) return

    const previousWorkspacePath = workspacePath
    setSwitchingWorkspace(true)
    try {
      await setWorkspacePath(path)
      await restoreWorkspaceContent()
      await refreshSkills()
    } catch (error) {
      console.error('切换工作区失败:', error)

      try {
        if (!await prepareWorkspaceSwitch()) {
          throw new Error('无法在回滚工作区前保存当前编辑内容')
        }
        await setWorkspacePath(previousWorkspacePath)
        await restoreWorkspaceContent()
        await refreshSkills()
      } catch (rollbackError) {
        console.error('恢复原工作区失败:', rollbackError)
      }

      toast({
        title: t('workspace.switchFailed'),
        variant: 'destructive',
      })
    } finally {
      setSwitchingWorkspace(false)
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
      await switchWorkspace('')
    } catch (error) {
      console.error('重置工作区失败:', error)
      toast({
        title: t('workspace.switchFailed'),
        variant: 'destructive',
      })
    }
  }

  return (
    <Field>
      {showTitle ? <FieldTitle>{t('workspace.current')}</FieldTitle> : null}
        <div className="flex flex-col gap-3">
          {/* 当前工作区路径显示和选择 */}
          <ResponsivePopover open={open} onOpenChange={setOpen} mobileTitle={t('workspace.current')}>
            <ResponsivePopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label={t('workspace.current')}
                disabled={switchingWorkspace}
                className="w-full justify-between p-3 h-auto text-left font-normal"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate text-sm">
                    {workspacePath || t('workspace.default')}
                  </span>
                </div>
                {switchingWorkspace ? (
                  <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
                ) : (
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                )}
              </Button>
            </ResponsivePopoverTrigger>
            <ResponsivePopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput placeholder={t('workspace.searchPlaceholder')} />
                <CommandList>
                  <CommandEmpty>{t('workspace.noResults')}</CommandEmpty>
                  
                  {/* 选择新工作区 */}
                  <CommandGroup heading={t('workspace.actions')}>
                    <CommandItem
                      disabled={switchingWorkspace}
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
                        disabled={switchingWorkspace}
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
                            disabled={switchingWorkspace}
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
                                className="size-8 p-0 text-destructive md:size-6 md:opacity-0 md:group-hover:opacity-100"
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
            </ResponsivePopoverContent>
          </ResponsivePopover>
          
        </div>
      <FieldDescription>{t('workspace.desc')}</FieldDescription>
    </Field>
  )
}
