'use client'

import { useEffect, useRef, useState } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { openPath } from '@tauri-apps/plugin-opener'
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  CircleAlert,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Loader2,
  PencilLine,
  RefreshCw,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from '@/components/responsive-popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { RepositoryCheckResult } from '@/lib/sync/repository-check'
import { SyncStateEnum } from '@/lib/sync/github.types'
import type { SyncRepoPlatform, WorkspaceSyncRepos } from '@/lib/sync/workspace-repos'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'

type RepositoryActionResult = RepositoryCheckResult | 'create-error'
type RepositoryOperation = 'checking' | 'creating'
type RepositoryListStatus = 'idle' | 'loading' | 'success' | 'missing-token' | 'error'

interface WorkspaceRepoMappingProps {
  platform: SyncRepoPlatform
  workspaceOptions: string[]
  currentWorkspacePath: string
  workspaceRepos: Record<string, WorkspaceSyncRepos>
  defaultRepoName: string
  onRepoChange: (workspacePath: string, repo: string) => Promise<void>
}

export function WorkspaceRepoMapping({
  platform,
  workspaceOptions,
  currentWorkspacePath,
  workspaceRepos,
  defaultRepoName,
  onRepoChange,
}: WorkspaceRepoMappingProps) {
  const t = useTranslations()
  const defaultWorkspaceName = t('settings.file.workspace.defaultPath')
  const accessToken = useSettingStore(state => {
    switch (platform) {
      case 'github': return state.accessToken
      case 'gitee': return state.giteeAccessToken
      case 'gitlab': return state.gitlabAccessToken
      case 'gitea': return state.giteaAccessToken
    }
  })
  const [draftRepos, setDraftRepos] = useState<Record<string, string>>({})
  const [operations, setOperations] = useState<Record<string, RepositoryOperation | undefined>>({})
  const [results, setResults] = useState<Record<string, RepositoryActionResult>>({})
  const [repositoryNames, setRepositoryNames] = useState<string[]>([])
  const [repositoryListStatus, setRepositoryListStatus] = useState<RepositoryListStatus>('idle')
  const [repositoryPickerWorkspace, setRepositoryPickerWorkspace] = useState<string | null>(null)
  const [repositorySearch, setRepositorySearch] = useState('')
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState('')
  const autoCheckedReposRef = useRef<Record<string, string>>({})
  const requestIdsRef = useRef<Record<string, number>>({})
  const repositoryListRequestIdRef = useRef(0)
  const platformRef = useRef(platform)
  const currentWorkspacePathRef = useRef(currentWorkspacePath)

  platformRef.current = platform
  currentWorkspacePathRef.current = currentWorkspacePath

  function getConfiguredRepo(workspacePath: string) {
    return workspaceRepos[workspacePath]?.[platform]?.trim()
      || (workspacePath ? '' : defaultRepoName)
  }

  function resolveRepoName(workspacePath: string, repo: string) {
    return repo.trim() || (workspacePath ? '' : defaultRepoName)
  }

  function invalidateRequest(workspacePath: string) {
    requestIdsRef.current[workspacePath] = (requestIdsRef.current[workspacePath] || 0) + 1
  }

  function beginRequest(workspacePath: string) {
    const requestId = (requestIdsRef.current[workspacePath] || 0) + 1
    requestIdsRef.current[workspacePath] = requestId
    return requestId
  }

  function isRequestCurrent(workspacePath: string, requestId: number, requestPlatform: SyncRepoPlatform) {
    return requestIdsRef.current[workspacePath] === requestId
      && platformRef.current === requestPlatform
  }

  function setOperation(workspacePath: string, operation?: RepositoryOperation) {
    setOperations(current => ({ ...current, [workspacePath]: operation }))
  }

  function setResult(workspacePath: string, result?: RepositoryActionResult) {
    setResults(current => {
      const next = { ...current }
      if (result) next[workspacePath] = result
      else delete next[workspacePath]
      return next
    })
  }

  function updateDraftRepository(workspacePath: string, repo: string) {
    invalidateRequest(workspacePath)
    setDraftRepos(current => ({ ...current, [workspacePath]: repo }))
    setOperation(workspacePath)
    setResult(workspacePath)
  }

  function rememberRepositoryName(repo: string) {
    setRepositoryNames(current => current.some(
      item => item.toLocaleLowerCase() === repo.toLocaleLowerCase()
    ) ? current : [repo, ...current])
  }

  async function loadRepositoryNames() {
    const requestPlatform = platform
    const requestId = ++repositoryListRequestIdRef.current
    setRepositoryListStatus('loading')

    const { listRepositories } = await import('@/lib/sync/repository-check')
    const result = await listRepositories(requestPlatform)
    if (repositoryListRequestIdRef.current !== requestId || platformRef.current !== requestPlatform) return

    setRepositoryNames(result.repositories)
    setRepositoryListStatus(result.status)
  }

  function handleRepositoryPickerChange(workspacePath: string, open: boolean) {
    if (open) {
      setRepositoryPickerWorkspace(workspacePath)
      setRepositorySearch('')
      if (repositoryListStatus === 'idle' || repositoryListStatus === 'error') {
        void loadRepositoryNames()
      }
      return
    }

    setRepositoryPickerWorkspace(current => current === workspacePath ? null : current)
  }

  function handleSelectRepository(workspacePath: string, repo: string) {
    updateDraftRepository(workspacePath, repo)
    setRepositoryPickerWorkspace(null)
    setRepositorySearch('')
  }

  useEffect(() => {
    let cancelled = false

    async function resolveDefaultWorkspacePath() {
      const resolvedPath = await join(await appDataDir(), 'article')
      if (!cancelled) setDefaultWorkspacePath(resolvedPath)
    }

    void resolveDefaultWorkspacePath()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setDraftRepos({})
    setOperations({})
    setResults({})
    autoCheckedReposRef.current = {}
    Object.keys(requestIdsRef.current).forEach(invalidateRequest)
  }, [platform])

  useEffect(() => {
    setOperations({})
    setResults({})
    autoCheckedReposRef.current = {}
    Object.keys(requestIdsRef.current).forEach(invalidateRequest)
  }, [accessToken])

  useEffect(() => {
    repositoryListRequestIdRef.current += 1
    setRepositoryNames([])
    setRepositoryListStatus('idle')
    setRepositoryPickerWorkspace(null)
    setRepositorySearch('')
  }, [accessToken, platform])

  useEffect(() => {
    const timers = workspaceOptions.flatMap((workspacePath) => {
      const configuredRepo = getConfiguredRepo(workspacePath)
      const draftRepo = draftRepos[workspacePath]
      if (!configuredRepo || (draftRepo !== undefined && draftRepo.trim() !== configuredRepo)) return []

      const signature = `${platform}:${configuredRepo}`
      if (autoCheckedReposRef.current[workspacePath] === signature) return []

      const timer = window.setTimeout(() => {
        void handleCheckRepository(workspacePath, configuredRepo, false)
      }, 600)
      return [timer]
    })

    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [accessToken, defaultRepoName, draftRepos, platform, workspaceOptions, workspaceRepos])

  async function handleClearRepository(workspacePath: string, configuredRepo: string) {
    if (!configuredRepo || !workspacePath) return

    const requestPlatform = platform
    const requestId = beginRequest(workspacePath)
    setOperation(workspacePath, 'checking')
    setResult(workspacePath)

    try {
      await onRepoChange(workspacePath, '')
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      setDraftRepos(current => ({ ...current, [workspacePath]: '' }))
      autoCheckedReposRef.current[workspacePath] = ''
      if (workspacePath === currentWorkspacePathRef.current) {
        updateCurrentPlatformState(SyncStateEnum.fail)
      }
    } catch (error) {
      console.error('Failed to clear workspace repository:', error)
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setResult(workspacePath, 'error')
      }
    } finally {
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setOperation(workspacePath)
      }
    }
  }

  async function handleCheckRepository(
    workspacePath: string,
    repo: string,
    saveOnSuccess = true,
  ) {
    const resolvedRepo = resolveRepoName(workspacePath, repo)
    const configuredRepo = getConfiguredRepo(workspacePath)
    if (!resolvedRepo) {
      if (saveOnSuccess) await handleClearRepository(workspacePath, configuredRepo)
      return
    }

    const requestPlatform = platform
    const requestId = beginRequest(workspacePath)
    const updatesActiveTarget = !saveOnSuccess || resolvedRepo === configuredRepo
    setOperation(workspacePath, 'checking')
    setResult(workspacePath)

    if (updatesActiveTarget && workspacePath === currentWorkspacePathRef.current) {
      updateCurrentPlatformState(SyncStateEnum.checking)
    }

    try {
      const { checkRepository } = await import('@/lib/sync/repository-check')
      const result = await checkRepository(requestPlatform, resolvedRepo)
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return

      if (result === 'success' && saveOnSuccess && resolvedRepo !== configuredRepo) {
        await onRepoChange(workspacePath, resolvedRepo)
        if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
        setDraftRepos(current => ({ ...current, [workspacePath]: resolvedRepo }))
      }

      setResult(workspacePath, result)
      autoCheckedReposRef.current[workspacePath] = result === 'success'
        ? `${requestPlatform}:${resolvedRepo}`
        : ''

      if (result === 'success') rememberRepositoryName(resolvedRepo)

      if (workspacePath === currentWorkspacePathRef.current) {
        if (result === 'success') {
          updateCurrentPlatformState(SyncStateEnum.success)
        } else if (updatesActiveTarget) {
          updateCurrentPlatformState(SyncStateEnum.fail)
        }
      }
    } catch (error) {
      console.error('Failed to save checked workspace repository:', error)
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      setResult(workspacePath, 'error')
      if (updatesActiveTarget && workspacePath === currentWorkspacePathRef.current) {
        updateCurrentPlatformState(SyncStateEnum.fail)
      }
    } finally {
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setOperation(workspacePath)
      }
    }
  }

  async function handleCreateRepository(workspacePath: string, repo: string) {
    const resolvedRepo = resolveRepoName(workspacePath, repo)
    if (!resolvedRepo || results[workspacePath] !== 'not-found') return

    const requestPlatform = platform
    const requestId = beginRequest(workspacePath)
    setOperation(workspacePath, 'creating')

    try {
      const { createRepository } = await import('@/lib/sync/repository-check')
      const result = await createRepository(requestPlatform, resolvedRepo)
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return

      if (result === 'created') {
        await onRepoChange(workspacePath, resolvedRepo)
        if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
        setDraftRepos(current => ({ ...current, [workspacePath]: resolvedRepo }))
        setResult(workspacePath, 'success')
        rememberRepositoryName(resolvedRepo)
        autoCheckedReposRef.current[workspacePath] = `${requestPlatform}:${resolvedRepo}`
        if (workspacePath === currentWorkspacePathRef.current) {
          updateCurrentPlatformState(SyncStateEnum.success)
        }
      } else {
        setResult(workspacePath, result)
      }
    } catch (error) {
      console.error('Failed to save created workspace repository:', error)
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setResult(workspacePath, 'create-error')
      }
    } finally {
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setOperation(workspacePath)
      }
    }
  }

  function updateCurrentPlatformState(state: SyncStateEnum) {
    const syncStore = useSyncStore.getState()
    switch (platformRef.current) {
      case 'github':
        syncStore.setSyncRepoState(state)
        break
      case 'gitee':
        syncStore.setGiteeSyncRepoState(state)
        break
      case 'gitlab':
        syncStore.setGitlabSyncProjectState(state)
        break
      case 'gitea':
        syncStore.setGiteaSyncRepoState(state)
        break
    }
  }

  async function handleOpenWorkspace(workspacePath: string) {
    try {
      const resolvedPath = workspacePath || defaultWorkspacePath || await join(await appDataDir(), 'article')
      await openPath(resolvedPath)
    } catch (error) {
      console.error('Failed to open workspace path:', error)
    }
  }

  const workspaceGroups = [
    {
      key: 'current',
      title: t('settings.sync.currentWorkspaceGroup'),
      workspaces: workspaceOptions.filter(path => path === currentWorkspacePath),
    },
    {
      key: 'other',
      title: t('settings.sync.otherWorkspacesGroup'),
      workspaces: workspaceOptions.filter(path => path !== currentWorkspacePath),
    },
  ].filter(group => group.workspaces.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sync.workspaceRepoMapping')}</CardTitle>
        <CardDescription>{t('settings.sync.workspaceRepoMappingDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {workspaceGroups.map(group => (
            <section key={group.key} className="flex flex-col gap-2" aria-labelledby={`workspace-group-${group.key}`}>
              <h3
                id={`workspace-group-${group.key}`}
                className="px-1 text-xs font-medium text-muted-foreground"
              >
                {group.title}
              </h3>
              <ItemGroup className="gap-2">
                {group.workspaces.map((workspacePath) => {
            const workspaceName = getWorkspaceDisplayName(workspacePath, defaultWorkspaceName)
            const configuredRepo = getConfiguredRepo(workspacePath)
            const draftRepo = draftRepos[workspacePath] ?? configuredRepo
            const resolvedDraftRepo = resolveRepoName(workspacePath, draftRepo)
            const isCurrentWorkspace = workspacePath === currentWorkspacePath
            const result = results[workspacePath]
            const operation = operations[workspacePath]
            const isBusy = operation !== undefined
            const canClear = Boolean(workspacePath && configuredRepo && !resolvedDraftRepo)
            const canCheck = Boolean(resolvedDraftRepo || canClear)
            const normalizedRepositorySearch = repositorySearch.trim()
            const hasExactRepository = repositoryNames.some(
              repo => repo.toLocaleLowerCase() === normalizedRepositorySearch.toLocaleLowerCase()
            )
            const repositoryPickerOpen = repositoryPickerWorkspace === workspacePath
            const resultLabel = result
              ? t(`settings.sync.repositoryCheck.${result}`)
              : t('settings.sync.checkRepo')

            return (
              <Item
                key={workspacePath || '__default__'}
                variant="outline"
                className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ItemContent className="w-full min-w-0">
                      <ItemTitle className="w-full min-w-0">
                        <button
                          type="button"
                          className={cn(
                            'shrink-0 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                            isCurrentWorkspace ? 'text-primary' : 'text-muted-foreground/60'
                          )}
                          onClick={() => void handleOpenWorkspace(workspacePath)}
                          aria-label={t('settings.sync.openWorkspace', { workspace: workspaceName })}
                        >
                          {isCurrentWorkspace ? (
                            <FolderCheck className="size-4" />
                          ) : (
                            <FolderOpen className="size-4" />
                          )}
                        </button>
                        <span className={cn(
                          'min-w-0 flex-1 truncate',
                          !isCurrentWorkspace && 'text-muted-foreground'
                        )}>
                          {workspaceName}
                        </span>
                      </ItemTitle>
                    </ItemContent>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-md break-all">
                    {workspacePath || defaultWorkspacePath}
                  </TooltipContent>
                </Tooltip>
                <div className="flex items-center justify-center text-muted-foreground">
                  <ArrowDown className="size-4 md:hidden" aria-hidden="true" />
                  <ArrowRight className="hidden size-4 md:block" aria-hidden="true" />
                </div>
                <ItemActions className="w-full min-w-0 items-start">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel className="sr-only">
                      {t('settings.sync.repositoryForWorkspace', { workspace: workspaceName })}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <GitBranch className="size-4" aria-hidden="true" />
                      </InputGroupAddon>
                      <InputGroupInput
                        value={draftRepo}
                        disabled={isBusy}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={t('settings.sync.repositoryNamePlaceholder')}
                        onChange={(event) => {
                          updateDraftRepository(workspacePath, event.target.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || isBusy || result === 'not-found') return
                          event.preventDefault()
                          void handleCheckRepository(workspacePath, draftRepo)
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <ResponsivePopover
                          open={repositoryPickerOpen}
                          onOpenChange={(open) => handleRepositoryPickerChange(workspacePath, open)}
                          mobileTitle={t('settings.sync.selectRepository')}
                        >
                          <ResponsivePopoverTrigger asChild>
                            <InputGroupButton
                              size="icon-xs"
                              disabled={isBusy}
                              aria-label={t('settings.sync.selectRepository')}
                            >
                              {repositoryListStatus === 'loading' && repositoryPickerOpen ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <ChevronsUpDown data-icon="inline-start" />
                              )}
                            </InputGroupButton>
                          </ResponsivePopoverTrigger>
                          <ResponsivePopoverContent align="end" className="w-80 p-0">
                            <Command>
                              <CommandInput
                                value={repositorySearch}
                                onValueChange={setRepositorySearch}
                                placeholder={t('settings.sync.searchRepositories')}
                              />
                              <CommandList>
                                {repositoryListStatus === 'loading' ? (
                                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                                    <Spinner />
                                    {t('settings.sync.loadingRepositories')}
                                  </div>
                                ) : (
                                  <>
                                    <CommandEmpty>
                                      {repositoryListStatus === 'missing-token'
                                        ? t('settings.sync.repositoryCheck.missing-token')
                                        : repositoryListStatus === 'error'
                                          ? t('settings.sync.repositoryListError')
                                          : t('settings.sync.noRepositories')}
                                    </CommandEmpty>
                                    {normalizedRepositorySearch && !hasExactRepository ? (
                                      <CommandGroup heading={t('settings.sync.customRepository')}>
                                        <CommandItem
                                          value={normalizedRepositorySearch}
                                          onSelect={() => handleSelectRepository(workspacePath, normalizedRepositorySearch)}
                                        >
                                          <PencilLine />
                                          <span className="truncate">
                                            {t('settings.sync.useRepositoryName', { repo: normalizedRepositorySearch })}
                                          </span>
                                        </CommandItem>
                                      </CommandGroup>
                                    ) : null}
                                    {repositoryNames.length ? (
                                      <CommandGroup heading={t('settings.sync.repositoryList')}>
                                        {repositoryNames.map(repo => (
                                          <CommandItem
                                            key={repo}
                                            value={repo}
                                            data-checked={resolvedDraftRepo === repo}
                                            onSelect={() => handleSelectRepository(workspacePath, repo)}
                                          >
                                            <GitBranch />
                                            <span className="truncate">{repo}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    ) : null}
                                  </>
                                )}
                              </CommandList>
                              {repositoryListStatus !== 'loading' ? (
                                <>
                                  <Separator />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="justify-start"
                                    onClick={() => void loadRepositoryNames()}
                                  >
                                    <RefreshCw data-icon="inline-start" />
                                    {t('settings.sync.refreshRepositories')}
                                  </Button>
                                </>
                              ) : null}
                            </Command>
                          </ResponsivePopoverContent>
                        </ResponsivePopover>
                        {result === 'not-found' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                variant="destructive"
                                onClick={() => void handleCreateRepository(workspacePath, draftRepo)}
                                disabled={isBusy}
                                aria-label={isBusy
                                  ? t('settings.sync.creating')
                                  : t('settings.sync.createRepo')}
                              >
                                {isBusy ? (
                                  <Loader2 data-icon="inline-start" className="animate-spin" />
                                ) : (
                                  <FolderPlus data-icon="inline-start" />
                                )}
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {isBusy
                                ? t('settings.sync.creating')
                                : t('settings.sync.createRepo')}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                onClick={() => void handleCheckRepository(workspacePath, draftRepo)}
                                disabled={isBusy || !canCheck}
                                aria-label={operation === 'creating'
                                  ? t('settings.sync.creating')
                                  : operation === 'checking'
                                    ? t('settings.sync.checking')
                                    : resultLabel}
                              >
                                {isBusy ? (
                                  <Loader2 data-icon="inline-start" className="animate-spin" />
                                ) : result === 'success' ? (
                                  <CheckCircle2 data-icon="inline-start" className="text-emerald-600 dark:text-emerald-400" />
                                ) : result === 'error' || result === 'missing-token' || result === 'create-error' ? (
                                  <CircleAlert data-icon="inline-start" className="text-destructive" />
                                ) : (
                                  <Check data-icon="inline-start" />
                                )}
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {operation === 'creating'
                                ? t('settings.sync.creating')
                                : operation === 'checking'
                                  ? t('settings.sync.checking')
                                  : resultLabel}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                </ItemActions>
              </Item>
            )
                })}
              </ItemGroup>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
