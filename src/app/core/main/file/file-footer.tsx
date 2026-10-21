'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  ArrowRight,
  ChevronsUpDown,
  CircleAlert,
  Cloud,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getDefaultArticleAbsolutePath } from '@/lib/workspace'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import { RepoNames } from '@/lib/sync/github.types'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useSkillsStore } from '@/stores/skills'
import { SYNC_PLATFORM_INFO } from '@/types/sync'

import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'

export function FileFooter() {
  const {
    workspacePath,
    workspaceHistory,
    setWorkspacePath,
    removeWorkspaceHistory,
    primaryBackupMethod,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
    accessToken,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
  } = useSettingStore()
  const { refreshSkills } = useSkillsStore()
  const {
    loadWorkspaceCollapsibleList,
    loadFileTree,
    setActiveFilePath,
  } = useArticleStore()
  const tFile = useTranslations('settings.file')
  const t = useTranslations('settings.sync.workspaceConnection')
  const tSync = useTranslations('settings.sync')
  const [open, setOpen] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const defaultWorkspaceName = tFile('workspace.defaultPath')
  const currentWorkspaceName = useMemo(
    () => getWorkspaceDisplayName(workspacePath, defaultWorkspaceName),
    [defaultWorkspaceName, workspacePath]
  )
  const currentWorkspacePath = workspacePath
    || defaultWorkspacePath
    || defaultWorkspaceName
  const repositoryConfiguration = (() => {
    switch (primaryBackupMethod) {
      case 'github': return { repo: githubCustomSyncRepo, token: accessToken }
      case 'gitee': return { repo: giteeCustomSyncRepo, token: giteeAccessToken }
      case 'gitlab': return { repo: gitlabCustomSyncRepo, token: gitlabAccessToken }
      case 'gitea': return { repo: giteaCustomSyncRepo, token: giteaAccessToken }
      default: return null
    }
  })()
  const repository = repositoryConfiguration
    ? repositoryConfiguration.repo.trim() || (workspacePath ? '' : RepoNames.sync)
    : ''
  const missingRepository = repositoryConfiguration !== null && !repository
  const missingConnection = repositoryConfiguration !== null && !repositoryConfiguration.token.trim()
  const localOnly = primaryBackupMethod === 'local'
  const platformName = primaryBackupMethod === 'cloudFolder'
    ? tSync('cloudFolder.title')
    : primaryBackupMethod === 'selfHosted'
      ? tSync('selfHosted.title')
      : SYNC_PLATFORM_INFO[primaryBackupMethod].name
  const targetName = localOnly ? t('localOnly') : missingRepository ? t('unbound') : repository || platformName
  const targetDescription = localOnly ? t('localDescription')
    : missingRepository ? t('unboundDescription')
      : missingConnection ? t('setupDescription')
        : repository ? t(workspacePath ? 'filesScope' : 'defaultScope') : platformName
  const needsAttention = missingRepository || missingConnection
  const TargetIcon = needsAttention ? CircleAlert
    : localOnly ? HardDrive : repositoryConfiguration ? GitBranch : Cloud
  const workspaceOptions = Array.from(new Set([workspacePath, ...workspaceHistory])).filter(Boolean)

  function openSyncSettings() {
    setOpen(false)
    useSettingsDialogStore.getState().openSettings('sync')
  }

  useEffect(() => {
    void getDefaultArticleAbsolutePath('')
      .then(setDefaultWorkspacePath)
      .catch((error) => console.error('获取默认工作区路径失败:', error))
  }, [])

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

  async function switchWorkspace(path: string) {
    if (switchingWorkspace) return
    if (path === workspacePath) {
      setOpen(false)
      return
    }
    if (!await prepareWorkspaceSwitch()) return

    const previousWorkspacePath = workspacePath
    setSwitchingWorkspace(true)

    try {
      await setWorkspacePath(path)
      await restoreWorkspaceContent()
      await refreshSkills()
      setOpen(false)
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
        title: tFile('workspace.switchFailed'),
        variant: 'destructive',
      })
    } finally {
      setSwitchingWorkspace(false)
    }
  }

  async function handleSelectWorkspace() {
    setOpen(false)

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: tFile('workspace.select'),
      })

      if (selected) await switchWorkspace(selected as string)
    } catch (error) {
      console.error('选择工作区失败:', error)
    }
  }

  function handleRemoveWorkspace(
    event: MouseEvent<HTMLButtonElement>,
    path: string
  ) {
    event.preventDefault()
    event.stopPropagation()
    void removeWorkspaceHistory(path)
  }

  return (
    <div className="relative flex w-fit shrink-0 items-center gap-1 text-xs">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                size="xs"
                disabled={switchingWorkspace}
                className="min-w-0 max-w-[min(20rem,35vw)] justify-start"
                aria-label={`${t('workspaceLabel')}: ${currentWorkspaceName}`}
                aria-expanded={open}
              >
                {switchingWorkspace ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FolderOpen data-icon="inline-start" />
                )}
                <span className="hidden text-muted-foreground xl:inline">{t('workspaceLabel')}</span>
                <span className="min-w-0 max-w-48 truncate">
                  {currentWorkspaceName}
                </span>
                <ChevronsUpDown data-icon="inline-end" className="opacity-50" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4} className="max-w-sm">
            <span className="block break-all">{currentWorkspacePath}</span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchInputRef.current?.focus()
          }}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <div className="flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t('workspaceLabel')}</span>
              <Badge variant="secondary">{t('current')}</Badge>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
                <FolderOpen className="size-5" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="truncate font-medium">{currentWorkspaceName}</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p tabIndex={0} className="truncate text-xs text-muted-foreground">{currentWorkspacePath}</p>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[min(32rem,calc(100vw-2rem))] break-all">
                    {currentWorkspacePath}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-background p-2.5">
              {localOnly ? <HardDrive className="size-4 shrink-0 text-muted-foreground" />
                : repositoryConfiguration ? <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                  : <Cloud className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t('targetLabel')}{!localOnly && ` · ${platformName}`}</p>
                <p className="truncate text-sm font-medium">{targetName}</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={openSyncSettings} aria-label={t('configure')}>
                <Settings2 />
              </Button>
            </div>
            {needsAttention ? (
              <Alert variant="warning" role="status">
                <CircleAlert />
                <AlertTitle>{t(missingRepository ? 'unboundTitle' : 'setupRequired')}</AlertTitle>
                <AlertDescription>{targetDescription}</AlertDescription>
              </Alert>
            ) : <p className="text-xs leading-relaxed text-muted-foreground">{targetDescription}</p>}
            {needsAttention && <Button size="sm" className="self-start" onClick={openSyncSettings}>
              <Settings2 data-icon="inline-start" />
              {t('configure')}
              <ArrowRight data-icon="inline-end" />
            </Button>}
          </div>
          <Separator />
          <Command className="min-h-0">
            <CommandInput ref={searchInputRef} placeholder={tFile('workspace.searchPlaceholder')} />
            <CommandList>
              <CommandEmpty>{tFile('workspace.noResults')}</CommandEmpty>
              <CommandGroup heading={tFile('workspace.actions')}>
                <CommandItem
                  value={tFile('workspace.select')}
                  disabled={switchingWorkspace}
                  onSelect={() => void handleSelectWorkspace()}
                >
                  <FolderPlus />
                  <span>{tFile('workspace.select')}</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={tFile('workspace.list')}>
                <CommandItem
                  value={`${defaultWorkspaceName} ${defaultWorkspacePath}`}
                  data-checked={!workspacePath}
                  aria-current={!workspacePath ? 'true' : undefined}
                  disabled={switchingWorkspace}
                  onSelect={() => void switchWorkspace('')}
                  className={cn(
                    'items-start [&>svg:last-child]:hidden',
                    !workspacePath && 'bg-accent'
                  )}
                >
                  {workspacePath ? (
                    <FolderOpen className="mt-0.5" />
                  ) : (
                    <FolderCheck className="mt-0.5" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {defaultWorkspaceName}
                    </span>
                    {defaultWorkspacePath && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate text-xs text-muted-foreground/70">
                            {defaultWorkspacePath}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[min(32rem,calc(100vw-2rem))] break-all">
                          {defaultWorkspacePath}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                  {!workspacePath && <Badge variant="secondary">{t('current')}</Badge>}
                </CommandItem>

                {workspaceOptions.map((path) => (
                  <CommandItem
                    key={path}
                    value={`${getWorkspaceDisplayName(path, defaultWorkspaceName)} ${path}`}
                    data-checked={path === workspacePath}
                    aria-current={path === workspacePath ? 'true' : undefined}
                    disabled={switchingWorkspace}
                    onSelect={() => void switchWorkspace(path)}
                    className={cn(
                      'items-start [&>svg:last-child]:hidden',
                      path === workspacePath && 'bg-accent'
                    )}
                  >
                    {path === workspacePath ? (
                      <FolderCheck className="mt-0.5" />
                    ) : (
                      <FolderOpen className="mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {getWorkspaceDisplayName(path, defaultWorkspaceName)}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate text-xs text-muted-foreground/70">
                            {path}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[min(32rem,calc(100vw-2rem))] break-all">
                          {path}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                    {path === workspacePath && <Badge variant="secondary">{t('current')}</Badge>}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={tFile('workspace.removeHistory')}
                          className="-mr-1 text-muted-foreground hover:text-destructive"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          onClick={(event) => handleRemoveWorkspace(event, path)}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {tFile('workspace.removeHistory')}
                      </TooltipContent>
                    </Tooltip>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            variant={needsAttention ? 'outline' : 'ghost'}
            className={cn('min-w-0 max-w-[min(22rem,35vw)]', needsAttention && 'border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/20')}
            onClick={openSyncSettings}
            aria-label={`${t('targetLabel')}: ${targetName}. ${t('configure')}`}
          >
            <TargetIcon data-icon="inline-start" />
            {repositoryConfiguration && !missingRepository && <span className="hidden text-muted-foreground lg:inline">{platformName}</span>}
            <span className="truncate">{missingConnection && !missingRepository ? t('setupRequired') : targetName}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex max-w-80 flex-col gap-1">
          <p className="break-all font-medium">{targetName}</p>
          <p>{targetDescription}</p>
          <p>{t('configure')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
