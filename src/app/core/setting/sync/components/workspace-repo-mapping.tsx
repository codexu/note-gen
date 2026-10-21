'use client'

import { useEffect, useRef, useState } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { openPath } from '@tauri-apps/plugin-opener'
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ChevronsUpDown,
  CircleAlert,
  FolderCheck,
  FolderOpen,
  GitBranch,
  Loader2,
  PencilLine,
  RefreshCw,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from '@/components/responsive-popover'
import { cn } from '@/lib/utils'
import { getCachedRepositoryCheck, subscribeRepositoryChecks, type RepositoryCheckResult } from '@/lib/sync/repository-check'
import { SyncStateEnum } from '@/lib/sync/github.types'
import type { SyncRepoPlatform, WorkspaceSyncRepos } from '@/lib/sync/workspace-repos'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'

type RepositoryActionResult = RepositoryCheckResult | 'create-error'
type RepositoryOperation = 'checking' | 'confirming' | 'saving' | 'creating' | 'unlinking'
type RepositoryMutation = Exclude<RepositoryOperation, 'checking' | 'confirming'>
type RepositoryListStatus = 'idle' | 'loading' | 'success' | 'missing-token' | 'error'
interface RepositoryConfirmation {
  workspacePath: string
  repo: string
  kind: 'bind' | 'create'
}

interface WorkspaceRepoMappingProps {
  active?: boolean
  platform: SyncRepoPlatform
  workspaceOptions: string[]
  currentWorkspacePath: string
  workspaceRepos: Record<string, WorkspaceSyncRepos>
  defaultRepoName: string
  onRepoChange: (workspacePath: string, repo: string) => Promise<void>
}

export function WorkspaceRepoMapping({
  active = true,
  platform,
  workspaceOptions,
  currentWorkspacePath,
  workspaceRepos,
  defaultRepoName,
  onRepoChange,
}: WorkspaceRepoMappingProps) {
  const t = useTranslations()
  const defaultWorkspaceName = t('settings.file.workspace.defaultPath')
  const isActivePlatform = useSettingStore(state => state.primaryBackupMethod === platform)
  const accessToken = useSettingStore(state => {
    switch (platform) {
      case 'github': return state.accessToken
      case 'gitee': return state.giteeAccessToken
      case 'gitlab': return state.gitlabAccessToken
      case 'gitea': return state.giteaAccessToken
    }
  })
  const connectionScope = useSettingStore(state => {
    switch (platform) {
      case 'gitlab': return JSON.stringify([state.gitlabInstanceType, state.gitlabCustomUrl])
      case 'gitea': return JSON.stringify([state.giteaInstanceType, state.giteaCustomUrl])
      default: return platform
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
  const [mutationRevision, setMutationRevision] = useState(0)
  const [repositoryCheckRevision, setRepositoryCheckRevision] = useState(0)
  const [confirmation, setConfirmation] = useState<RepositoryConfirmation | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const operationsRef = useRef<Record<string, RepositoryOperation | undefined>>({})
  const mutationsRef = useRef(new Map<string, RepositoryMutation>())
  const composingWorkspacesRef = useRef(new Set<string>())
  const focusedWorkspaceRef = useRef<string | null>(null)
  const confirmationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const confirmationResolverRef = useRef<((accepted: boolean) => void) | null>(null)
  const confirmationCloseResolverRef = useRef<(() => void) | null>(null)
  const confirmationFocusRef = useRef<HTMLElement | null>(null)
  const confirmationStatusIdRef = useRef('')
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
    operationsRef.current[workspacePath] = operation
    setOperations(current => ({ ...current, [workspacePath]: operation }))
  }

  function getMutationKey(workspacePath: string, targetPlatform = platform) {
    return JSON.stringify([targetPlatform, workspacePath])
  }

  function beginMutation(workspacePath: string, targetPlatform: SyncRepoPlatform, operation: RepositoryMutation) {
    const key = getMutationKey(workspacePath, targetPlatform)
    if (mutationsRef.current.has(key)) return
    mutationsRef.current.set(key, operation)
    setMutationRevision(revision => revision + 1)

    return () => {
      mutationsRef.current.delete(key)
      setMutationRevision(revision => revision + 1)
    }
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
    if (mutationsRef.current.has(getMutationKey(workspacePath))) return false
    const operation = operationsRef.current[workspacePath]
    if (operation && operation !== 'checking') return false
    invalidateRequest(workspacePath)
    setDraftRepos(current => ({ ...current, [workspacePath]: repo }))
    setOperation(workspacePath)
    setResult(workspacePath)
    return true
  }

  function restoreDraftRepository(workspacePath: string) {
    setDraftRepos(current => {
      const next = { ...current }
      delete next[workspacePath]
      return next
    })
    setResult(workspacePath)
  }

  function resolveRepositoryConfirmation(accepted: boolean) {
    const resolve = confirmationResolverRef.current
    if (!resolve) return
    confirmationResolverRef.current = null
    setConfirmationOpen(false)
    resolve(accepted)
  }

  function finishConfirmationClose() {
    const resolve = confirmationCloseResolverRef.current
    confirmationCloseResolverRef.current = null
    confirmationFocusRef.current = null
    setConfirmation(null)
    resolve?.()
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

    try {
      const { listRepositories } = await import('@/lib/sync/repository-check')
      if (repositoryListRequestIdRef.current !== requestId || platformRef.current !== requestPlatform) return
      const result = await listRepositories(requestPlatform)
      if (repositoryListRequestIdRef.current !== requestId || platformRef.current !== requestPlatform) return

      setRepositoryNames(result.repositories)
      setRepositoryListStatus(result.status)
    } catch (error) {
      console.error('Failed to load workspace repositories:', error)
      if (repositoryListRequestIdRef.current === requestId && platformRef.current === requestPlatform) {
        setRepositoryListStatus('error')
      }
    }
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
    handleRepositoryBlur(workspacePath, draftRepos[workspacePath] ?? getConfiguredRepo(workspacePath))
  }

  function handleSelectRepository(workspacePath: string, repo: string) {
    if (!updateDraftRepository(workspacePath, repo)) return
    setRepositoryPickerWorkspace(null)
    setRepositorySearch('')
    focusedWorkspaceRef.current = null
    void handleCheckRepository(workspacePath, repo, true)
  }

  function handleRepositoryBlur(workspacePath: string, repo: string) {
    if (confirmationResolverRef.current || confirmationCloseResolverRef.current) return
    focusedWorkspaceRef.current = null
    if (composingWorkspacesRef.current.has(workspacePath)) return
    const operation = operationsRef.current[workspacePath]
    if ((operation && operation !== 'checking') || mutationsRef.current.has(getMutationKey(workspacePath))) return
    if (!repo.trim()) {
      if (!workspacePath) restoreDraftRepository(workspacePath)
      return
    }
    if (repo.trim() === getConfiguredRepo(workspacePath)) return
    void handleCheckRepository(workspacePath, repo, true)
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
  }, [platform])

  useEffect(() => subscribeRepositoryChecks(() => {
    setRepositoryCheckRevision(revision => revision + 1)
  }), [])

  useEffect(() => {
    operationsRef.current = {}
    composingWorkspacesRef.current.clear()
    focusedWorkspaceRef.current = null
    setOperations({})
    setResults({})
    Object.keys(requestIdsRef.current).forEach(invalidateRequest)

    return () => {
      Object.keys(requestIdsRef.current).forEach(invalidateRequest)
      resolveRepositoryConfirmation(false)
      finishConfirmationClose()
    }
  }, [accessToken, active, connectionScope, currentWorkspacePath, platform])

  useEffect(() => {
    repositoryListRequestIdRef.current += 1
    setRepositoryNames([])
    setRepositoryListStatus('idle')
    setRepositoryPickerWorkspace(null)
    setRepositorySearch('')

    return () => {
      repositoryListRequestIdRef.current += 1
    }
  }, [accessToken, active, connectionScope, platform])

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function restoreCachedResults() {
      const entries = await Promise.all(workspaceOptions.map(async workspacePath => {
        const configuredRepo = getConfiguredRepo(workspacePath)
        if (!configuredRepo || (draftRepos[workspacePath] ?? configuredRepo).trim() !== configuredRepo) return null
        const requestId = requestIdsRef.current[workspacePath] || 0
        const result = await getCachedRepositoryCheck(platform, configuredRepo)
        return { workspacePath, requestId, result }
      }))
      if (cancelled) return

      setResults(current => {
        const next = { ...current }
        for (const entry of entries) {
          if (!entry || entry.result === undefined || operationsRef.current[entry.workspacePath]
            || (requestIdsRef.current[entry.workspacePath] || 0) !== entry.requestId) continue
          next[entry.workspacePath] = entry.result
        }
        return next
      })
    }

    void restoreCachedResults().catch(error => console.warn('Failed to restore repository status:', error))
    return () => { cancelled = true }
  }, [accessToken, active, connectionScope, currentWorkspacePath, defaultRepoName, draftRepos, mutationRevision, platform, repositoryCheckRevision, workspaceOptions, workspaceRepos])

  async function handleClearRepository(workspacePath: string, configuredRepo: string) {
    if (!configuredRepo || !workspacePath) return

    const requestPlatform = platform
    const finishMutation = beginMutation(workspacePath, requestPlatform, 'unlinking')
    if (!finishMutation) return
    const requestId = beginRequest(workspacePath)
    setOperation(workspacePath, 'unlinking')
    setResult(workspacePath)

    try {
      await onRepoChange(workspacePath, '')
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      setDraftRepos(current => {
        const next = { ...current }
        delete next[workspacePath]
        return next
      })
      if (workspacePath === currentWorkspacePathRef.current) {
        updateCurrentPlatformState(SyncStateEnum.fail)
      }
    } catch (error) {
      console.error('Failed to clear workspace repository:', error)
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setResult(workspacePath, 'error')
      }
    } finally {
      finishMutation()
      if (isRequestCurrent(workspacePath, requestId, requestPlatform)) {
        setOperation(workspacePath)
      }
    }
  }

  async function confirmRepositoryChange(
    workspacePath: string,
    repo: string,
    kind: 'bind' | 'create',
    requestId: number,
    requestPlatform: SyncRepoPlatform,
  ) {
    const previous = confirmationQueueRef.current
    let releaseQueue: (() => void) | undefined
    confirmationQueueRef.current = new Promise<void>(resolve => {
      releaseQueue = resolve
    })

    try {
      await previous
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return false
      const closed = new Promise<void>(resolve => {
        confirmationCloseResolverRef.current = resolve
      })
      const accepted = await new Promise<boolean>(resolve => {
        confirmationResolverRef.current = resolve
        confirmationFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        confirmationStatusIdRef.current = `workspace-repository-${requestPlatform}-${encodeURIComponent(workspacePath || '__default__')}-status`
        setConfirmation({ workspacePath, repo, kind })
        setConfirmationOpen(true)
      })
      await closed
      return accepted && isRequestCurrent(workspacePath, requestId, requestPlatform)
    } finally {
      releaseQueue?.()
    }
  }

  async function handleCheckRepository(
    workspacePath: string,
    repo: string,
    confirmChanges = false,
  ) {
    const resolvedRepo = repo.trim()
    const configuredRepo = getConfiguredRepo(workspacePath)
    if (!resolvedRepo) return

    const requestPlatform = platform
    const requestId = beginRequest(workspacePath)
    let finishMutation: (() => void) | undefined
    const updatesActiveTarget = resolvedRepo === configuredRepo
    setOperation(workspacePath, 'checking')
    setResult(workspacePath)

    try {
      const { checkRepository } = await import('@/lib/sync/repository-check')
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      const result = await checkRepository(requestPlatform, resolvedRepo, { force: true })
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      setResult(workspacePath, result)

      const createsRepository = result === 'not-found'
      const changesBinding = result === 'success' && resolvedRepo !== configuredRepo
      if (confirmChanges && (createsRepository || changesBinding)) {
        setOperation(workspacePath, 'confirming')
        const accepted = await confirmRepositoryChange(workspacePath, resolvedRepo, createsRepository ? 'create' : 'bind', requestId, requestPlatform)
        if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
        if (!accepted) {
          restoreDraftRepository(workspacePath)
          if (updatesActiveTarget) setResult(workspacePath, result)
          return
        }

        finishMutation = beginMutation(workspacePath, requestPlatform, createsRepository ? 'creating' : 'saving')
        if (!finishMutation) return
        setOperation(workspacePath, createsRepository ? 'creating' : 'saving')

        if (createsRepository) {
          const { createRepository } = await import('@/lib/sync/repository-check')
          if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
          const createResult = await createRepository(requestPlatform, resolvedRepo)
          if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
          if (createResult !== 'created') {
            setResult(workspacePath, createResult)
            return
          }
        }

        if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
        await onRepoChange(workspacePath, resolvedRepo)
        if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
        restoreDraftRepository(workspacePath)
        setResult(workspacePath, 'success')
        rememberRepositoryName(resolvedRepo)
        if (workspacePath === currentWorkspacePathRef.current) updateCurrentPlatformState(SyncStateEnum.success)
        return
      }

      if (result === 'success') rememberRepositoryName(resolvedRepo)

      if (updatesActiveTarget && workspacePath === currentWorkspacePathRef.current) {
        updateCurrentPlatformState(result === 'success' ? SyncStateEnum.success : SyncStateEnum.fail)
      }
    } catch (error) {
      console.error('Failed to save checked workspace repository:', error)
      if (!isRequestCurrent(workspacePath, requestId, requestPlatform)) return
      setResult(workspacePath, 'error')
      if (updatesActiveTarget && workspacePath === currentWorkspacePathRef.current) {
        updateCurrentPlatformState(SyncStateEnum.fail)
      }
    } finally {
      finishMutation?.()
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
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" aria-hidden="true" />
          {t('settings.sync.workspaceRepoMapping')}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {t('settings.sync.workspaceRepoMappingDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {workspaceGroups.map(group => (
          <section
            key={group.key}
            className="flex flex-col gap-3"
            aria-labelledby={`workspace-group-${platform}-${group.key}`}
          >
            <h3
              id={`workspace-group-${platform}-${group.key}`}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              {group.title}
              <Separator className="flex-1" />
              <span className="tabular-nums">{group.workspaces.length}</span>
            </h3>
            <div className="flex flex-col gap-3">
              {group.workspaces.map((workspacePath) => {
                const workspaceName = getWorkspaceDisplayName(workspacePath, defaultWorkspaceName)
                const configuredRepo = getConfiguredRepo(workspacePath)
                const draftRepo = draftRepos[workspacePath] ?? configuredRepo
                const resolvedDraftRepo = draftRepo.trim()
                const isCurrentWorkspace = workspacePath === currentWorkspacePath
                const hasBinding = Boolean(configuredRepo)
                const hasPendingChanges = resolvedDraftRepo !== configuredRepo
                const result = results[workspacePath]
                const operation = mutationsRef.current.get(getMutationKey(workspacePath)) || operations[workspacePath]
                const isBusy = operation !== undefined
                const isLocked = isBusy && operation !== 'checking'
                const hasConnectionError = Boolean(result && result !== 'success')
                const waitingForValidation = hasPendingChanges && Boolean(resolvedDraftRepo) && !result && !isBusy
                const canClear = Boolean(workspacePath && configuredRepo && !resolvedDraftRepo)
                const normalizedRepositorySearch = repositorySearch.trim()
                const hasExactRepository = repositoryNames.some(
                  repo => repo.toLocaleLowerCase() === normalizedRepositorySearch.toLocaleLowerCase()
                )
                const repositoryPickerOpen = repositoryPickerWorkspace === workspacePath
                const inputId = `workspace-repository-${platform}-${encodeURIComponent(workspacePath || '__default__')}`
                const resultId = `${inputId}-result`
                const warningId = `${inputId}-warning`
                const connectionLabel = operation === 'unlinking'
                  ? t('settings.sync.workspaceConnection.unlinking')
                  : operation === 'saving'
                    ? t('settings.sync.workspaceConnection.saving')
                    : operation === 'confirming'
                      ? t('settings.sync.workspaceConnection.pending')
                      : operation === 'creating'
                        ? t('settings.sync.creating')
                        : operation === 'checking'
                          ? t('settings.sync.workspaceConnection.checking')
                          : result === 'not-found'
                            ? t('settings.sync.workspaceConnection.notFound')
                            : hasConnectionError
                              ? t(hasPendingChanges
                                ? 'settings.sync.workspaceConnection.failed'
                                : 'settings.sync.workspaceConnection.connectionFailed')
                              : waitingForValidation
                                ? t('settings.sync.workspaceConnection.pending')
                                : t(hasBinding
                                  ? 'settings.sync.workspaceConnection.connected'
                                  : 'settings.sync.workspaceConnection.unbound')
                const describedBy = [!hasBinding && warningId, hasConnectionError && resultId].filter(Boolean).join(' ') || undefined
                const statusDescription = hasConnectionError && result
                  ? t(`settings.sync.repositoryCheck.${result}`)
                  : waitingForValidation || operation === 'confirming'
                    ? t('settings.sync.workspaceConnection.blurHint')
                    : configuredRepo || t('settings.sync.workspaceConnection.blurHint')
                const scopeDescription = !hasBinding
                  ? t(isActivePlatform
                    ? 'settings.sync.workspaceConnection.unboundDescription'
                    : 'settings.sync.workspaceConnection.unboundInactiveDescription')
                  : t(workspacePath
                    ? 'settings.sync.workspaceConnection.filesScope'
                    : 'settings.sync.workspaceConnection.defaultScope')

                return (
                  <div
                    key={workspacePath || '__default__'}
                    className={cn(
                      'overflow-hidden rounded-xl border bg-card',
                      isCurrentWorkspace
                        ? 'border-primary/35 bg-gradient-to-br from-primary/5 to-card shadow-sm'
                        : 'border-border'
                    )}
                  >
                    <div className="grid min-w-0 grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,0.85fr)_auto_minmax(0,1.15fr)] md:gap-5 md:p-5">
                      <div className="flex min-w-0 flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t('settings.sync.workspaceConnection.workspaceLabel')}
                          </span>
                          {isCurrentWorkspace && (
                            <Badge variant="default">
                              {t('settings.sync.workspaceConnection.current')}
                            </Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="group/workspace flex w-full min-w-0 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
                              onClick={() => void handleOpenWorkspace(workspacePath)}
                              aria-label={t('settings.sync.openWorkspace', { workspace: workspaceName })}
                            >
                              <span className={cn(
                                'flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors group-hover/workspace:bg-muted',
                                isCurrentWorkspace
                                  ? 'border-primary/15 bg-primary/10 text-primary'
                                  : 'border-border bg-muted/50 text-muted-foreground'
                              )}>
                                {isCurrentWorkspace ? (
                                  <FolderCheck className="size-5" aria-hidden="true" />
                                ) : (
                                  <FolderOpen className="size-5" aria-hidden="true" />
                                )}
                              </span>
                              <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                                <span className="block truncate font-medium leading-snug group-hover/workspace:text-primary">
                                  {workspaceName}
                                </span>
                                <span className="block truncate font-mono text-xs leading-relaxed text-muted-foreground">
                                  {workspacePath || defaultWorkspacePath || defaultWorkspaceName}
                                </span>
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[min(28rem,calc(100vw-2rem))] break-all">
                            {workspacePath || defaultWorkspacePath || defaultWorkspaceName}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center justify-center md:self-start md:pt-9" aria-hidden="true">
                        <span className={cn(
                          'flex size-7 items-center justify-center rounded-full border bg-background',
                          hasBinding
                            ? 'border-primary/20 text-primary'
                            : 'border-dashed border-warning/50 text-warning-foreground'
                        )}>
                          <ArrowDown className="size-3.5 md:hidden" />
                          <ArrowRight className="hidden size-3.5 md:block" />
                        </span>
                      </div>
                      <Field
                        className="min-w-0 gap-3"
                        data-invalid={result && result !== 'success' ? true : undefined}
                        onBlur={(event) => {
                          const next = event.relatedTarget
                          if (next instanceof Node && event.currentTarget.contains(next)) return
                          if (repositoryPickerOpen || (next instanceof Element && next.closest('[data-workspace-repository-picker]')?.getAttribute('data-workspace-repository-picker') === inputId)) return
                          handleRepositoryBlur(workspacePath, draftRepo)
                        }}
                      >
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <FieldLabel htmlFor={inputId} className="text-xs text-muted-foreground">
                            {t('settings.sync.workspaceConnection.repositoryLabel')}
                          </FieldLabel>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                asChild
                                variant={hasBinding && !isBusy && !waitingForValidation && !hasConnectionError ? 'success' : 'outline'}
                                className={cn(
                                  'cursor-pointer disabled:cursor-default disabled:opacity-70',
                                  isBusy || waitingForValidation
                                    ? 'border-warning/40 bg-warning/10 text-warning-foreground'
                                    : hasConnectionError
                                      ? 'border-destructive/25 bg-destructive/5 text-destructive'
                                      : !hasBinding
                                        ? 'border-warning/40 bg-warning/10 text-warning-foreground'
                                        : undefined
                                )}
                              >
                                <button
                                  id={`${inputId}-status`}
                                  type="button"
                                  disabled={isBusy || (!resolvedDraftRepo && !configuredRepo)}
                                  aria-busy={isBusy}
                                  aria-live="polite"
                                  aria-label={`${connectionLabel} · ${t('settings.sync.workspaceConnection.refresh')}`}
                                  onClick={() => {
                                    const repo = resolvedDraftRepo || configuredRepo
                                    if (!isBusy && repo) void handleCheckRepository(workspacePath, repo, repo !== configuredRepo)
                                  }}
                                >
                                  {operation === 'confirming' ? (
                                    <PencilLine aria-hidden="true" />
                                  ) : isBusy ? (
                                    <Loader2 className="animate-spin" aria-hidden="true" />
                                  ) : waitingForValidation ? (
                                    <PencilLine aria-hidden="true" />
                                  ) : !hasBinding || hasConnectionError ? (
                                    <CircleAlert aria-hidden="true" />
                                  ) : (
                                    <CheckCircle2 aria-hidden="true" />
                                  )}
                                  {connectionLabel}
                                </button>
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="flex max-w-80 flex-col items-start break-all">
                              <p>{statusDescription}</p>
                              <p>{t('settings.sync.workspaceConnection.refreshHint')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <InputGroup className="h-10 bg-background/80">
                          <InputGroupAddon>
                            <GitBranch className="size-4" aria-hidden="true" />
                          </InputGroupAddon>
                          <InputGroupInput
                            id={inputId}
                            value={draftRepo}
                            disabled={isLocked}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            aria-label={t('settings.sync.repositoryForWorkspace', { workspace: workspaceName })}
                            aria-describedby={describedBy}
                            aria-invalid={result && result !== 'success' ? true : undefined}
                            placeholder={t('settings.sync.repositoryNamePlaceholder')}
                            onChange={(event) => {
                              updateDraftRepository(workspacePath, event.target.value)
                            }}
                            onFocus={() => { focusedWorkspaceRef.current = workspacePath }}
                            onCompositionStart={() => {
                              composingWorkspacesRef.current.add(workspacePath)
                              invalidateRequest(workspacePath)
                            }}
                            onCompositionEnd={(event) => {
                              composingWorkspacesRef.current.delete(workspacePath)
                              updateDraftRepository(workspacePath, event.currentTarget.value)
                              if (focusedWorkspaceRef.current !== workspacePath) {
                                handleRepositoryBlur(workspacePath, event.currentTarget.value)
                              }
                            }}
                          />
                          <InputGroupAddon align="inline-end">
                            {canClear && (
                              <InputGroupButton
                                variant="destructive"
                                disabled={isBusy}
                                onClick={() => void handleClearRepository(workspacePath, configuredRepo)}
                              >
                                {t('settings.sync.workspaceConnection.unlink')}
                              </InputGroupButton>
                            )}
                            <ResponsivePopover
                              open={repositoryPickerOpen}
                              onOpenChange={(open) => handleRepositoryPickerChange(workspacePath, open)}
                              mobileTitle={t('settings.sync.selectRepository')}
                            >
                              <ResponsivePopoverTrigger asChild>
                                <InputGroupButton
                                  size="icon-xs"
                                  disabled={isLocked}
                                  aria-label={t('settings.sync.selectRepository')}
                                >
                                  {repositoryListStatus === 'loading' && repositoryPickerOpen ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : (
                                    <ChevronsUpDown data-icon="inline-start" />
                                  )}
                                </InputGroupButton>
                              </ResponsivePopoverTrigger>
                              <ResponsivePopoverContent align="end" className="w-80 p-0" data-workspace-repository-picker={inputId}>
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
                          </InputGroupAddon>
                        </InputGroup>
                        {result && result !== 'success' && (
                          <span id={resultId} role="status" className="sr-only">
                            {t(`settings.sync.repositoryCheck.${result}`)}
                          </span>
                        )}
                      </Field>
                    </div>
                    <div className={cn(
                      'flex min-w-0 items-center gap-2 border-t px-4 py-2.5 text-xs md:px-5',
                      hasBinding ? 'border-border/60 bg-muted/25 text-muted-foreground' : 'border-warning/20 bg-warning/5 text-warning-foreground'
                    )}>
                      {!hasBinding && <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span id={!hasBinding ? warningId : undefined} tabIndex={0} className="min-w-0 truncate">{scopeDescription}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-80">
                          {scopeDescription}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </CardContent>
      <AlertDialog open={confirmationOpen} onOpenChange={open => { if (!open) resolveRepositoryConfirmation(false) }}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (active) {
            const previous = confirmationFocusRef.current
            const target = previous && previous !== document.body && previous.isConnected && !previous.matches(':disabled')
              ? previous
              : document.getElementById(confirmationStatusIdRef.current)
            target?.focus({ preventScroll: true })
          }
          finishConfirmationClose()
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation && t(`settings.sync.workspaceConnection.${confirmation.kind}ConfirmTitle`)}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {confirmation && t(`settings.sync.workspaceConnection.${confirmation.kind}ConfirmDescription`, {
                workspace: getWorkspaceDisplayName(confirmation.workspacePath, defaultWorkspaceName),
                repo: confirmation.repo,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveRepositoryConfirmation(false)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveRepositoryConfirmation(true)}>
              {confirmation && t(`settings.sync.workspaceConnection.${confirmation.kind}ConfirmAction`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
