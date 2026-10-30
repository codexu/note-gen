'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { exists, readFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { openPath } from '@tauri-apps/plugin-opener'
import { Check, FolderOpen, Link2, Loader2, MoreHorizontal, Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import emitter from '@/lib/emitter'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { getDb } from '@/db'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { authenticatedClient } from '@/lib/self-hosted-sync/profile'
import type { WorkspaceCapability, WorkspaceInvitation, WorkspaceMember } from '@/lib/self-hosted-sync/protocol'
import {
  bindLibrary, createLibrary, ensureLibraryLocalWorkspace, getCurrentWorkspaceRoot, listLibraries,
  markLibraryRemoteDeleted, type SelfHostedLibrary,
} from '@/lib/self-hosted-sync/workspaces'
import { getDefaultArticleAbsolutePath } from '@/lib/workspace'
import { bytesToBase64Url, hashBytes } from '@/lib/self-hosted-sync/blob'
import { enqueueAssetSnapshot, enqueueFileSnapshot } from '@/lib/self-hosted-sync/outbox'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSkillsStore } from '@/stores/skills'

const ROLE_CAPABILITIES: Record<'viewer' | 'editor' | 'manager', WorkspaceCapability[]> = {
  viewer: ['content.read', 'history.view'],
  editor: ['content.read', 'content.create', 'content.update', 'content.delete', 'history.view'],
  manager: [
    'content.read', 'content.create', 'content.update', 'content.delete',
    'history.view', 'history.restore', 'member.invite', 'member.update',
    'member.remove', 'workspace.rename',
  ],
}

const CAPABILITIES = Object.keys({
  'content.read': true, 'content.create': true, 'content.update': true, 'content.delete': true,
  'history.view': true, 'history.restore': true, 'member.invite': true,
  'member.update': true, 'member.remove': true, 'workspace.rename': true,
  'workspace.delete': true,
}) as WorkspaceCapability[]

const CONFLICT_TRANSLATION_KEYS: Record<string, 'snapshot-diverged' | 'remote-delete-local-edit' | 'viewer-local-edit' | 'protocol-conflict' | 'symlink-ignored'> = {
  'snapshot-diverged': 'snapshot-diverged',
  'remote-delete-local-edit': 'remote-delete-local-edit',
  'viewer-local-edit': 'viewer-local-edit',
  'protocol-conflict': 'protocol-conflict',
  'symlink-ignored': 'symlink-ignored',
}

interface ConflictRow {
  id: string
  workspaceId: string
  conflictType: string
  localCopyPath: string | null
  createdAt: number
  relativePath: string | null
  localRoot: string | null
}

export function SelfHostedWorkspaces({ profileId }: { profileId: string }) {
  const t = useTranslations('settings.sync.selfHosted')
  const workspacePath = useSettingStore(state => state.workspacePath)
  const setWorkspacePath = useSettingStore(state => state.setWorkspacePath)
  const loadWorkspaceCollapsibleList = useArticleStore(state => state.loadWorkspaceCollapsibleList)
  const loadFileTree = useArticleStore(state => state.loadFileTree)
  const setActiveFilePath = useArticleStore(state => state.setActiveFilePath)
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [libraries, setLibraries] = useState<SelfHostedLibrary[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<WorkspaceInvitation[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [conflicts, setConflicts] = useState<ConflictRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [libraryName, setLibraryName] = useState('')
  const [inviteLogin, setInviteLogin] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor' | 'manager'>('editor')
  const [capabilities, setCapabilities] = useState<WorkspaceCapability[]>(ROLE_CAPABILITIES.editor)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [conflictTargetId, setConflictTargetId] = useState('')
  const [currentLocalRoot, setCurrentLocalRoot] = useState('')

  const refresh = useCallback(async () => {
    const [{ client }, nextLibraries, conflictRows, localRoot] = await Promise.all([
      authenticatedClient(profileId),
      listLibraries(profileId),
      (await getDb()).select<ConflictRow[]>(
        `select c.id, c.workspace_id as workspaceId, c.conflict_type as conflictType,
           c.local_copy_path as localCopyPath, c.created_at as createdAt,
           m.relative_path as relativePath, b.local_root as localRoot
         from self_hosted_conflicts c
         join self_hosted_workspace_bindings b on b.workspace_id = c.workspace_id
         left join self_hosted_object_mappings m on m.workspace_id = c.workspace_id and m.object_id = c.object_id
         where c.state = 'unresolved' and b.profile_id = $1 order by c.created_at desc`, [profileId]
      ),
      getCurrentWorkspaceRoot(),
    ])
    setLibraries(nextLibraries)
    setCurrentLocalRoot(localRoot)
    setConflicts(conflictRows)
    setPendingInvitations(await client.pendingInvitations())
    const retainedSelectedId = nextLibraries.some(library => library.id === selectedId)
      ? selectedId
      : null
    const nextSelected = nextLibraries.find(library => library.localRoot === localRoot)?.id
      ?? retainedSelectedId ?? nextLibraries[0]?.id ?? null
    setSelectedId(nextSelected)
    setMembers(nextSelected ? await client.members(nextSelected).catch(() => []) : [])
  }, [profileId, selectedId])

  useEffect(() => {
    void refresh().catch(error => {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    })
  }, [refresh, t])

  useEffect(() => {
    const discovered = (event: { profileId: string }) => {
      if (event.profileId !== profileId) return
      void refresh().catch(error => {
        console.warn('[self-hosted-sync] Unable to refresh discovered workspaces', error)
      })
    }
    emitter.on('self-hosted-workspaces-discovered', discovered)
    return () => emitter.off('self-hosted-workspaces-discovered', discovered)
  }, [profileId, refresh])

  async function prepareWorkspaceSwitch() {
    const articleState = useArticleStore.getState()
    if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) return false
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
    await refreshSkills()
  }

  async function switchLocalWorkspace(
    localRoot: string,
    prepared = false,
    nextWorkspacePath = localRoot,
  ) {
    if (localRoot === currentLocalRoot && nextWorkspacePath === workspacePath) return true
    if (!prepared && !await prepareWorkspaceSwitch()) return false
    const previousWorkspacePath = workspacePath
    try {
      await setWorkspacePath(nextWorkspacePath)
      await restoreWorkspaceContent()
      return true
    } catch (error) {
      console.error('[self-hosted-sync] workspace.switch-failed', { localRoot, error })
      try {
        if (await prepareWorkspaceSwitch()) {
          await setWorkspacePath(previousWorkspacePath)
          await restoreWorkspaceContent()
        }
      } catch (rollbackError) {
        console.error('[self-hosted-sync] workspace.switch-rollback-failed', { rollbackError })
      }
      throw error
    }
  }

  async function createNewLibrary() {
    const localRoot = currentLocalRoot || await getCurrentWorkspaceRoot()
    setBusy(true)
    try {
      const currentIsBound = libraries.some(library => library.localRoot === localRoot)
      if (currentIsBound && !libraryName.trim()) return
      if (currentIsBound && !await prepareWorkspaceSwitch()) return
      const workspaceId = await createLibrary(
        profileId,
        libraryName.trim(),
        currentIsBound ? null : localRoot,
      )
      const targetRoot = await ensureLibraryLocalWorkspace(profileId, workspaceId)
      if (currentIsBound && !await switchLocalWorkspace(targetRoot, true)) return
      setSelectedId(workspaceId)
      setLibraryName('')
      await refreshSelfHostedSyncRuntime()
      await refresh()
      toast.success(t('libraryCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function selectLibrary(workspaceId: string) {
    setBusy(true)
    try {
      const library = libraries.find(item => item.id === workspaceId)
      if (!library) return
      const localRoot = await ensureLibraryLocalWorkspace(profileId, workspaceId)
      if (!await switchLocalWorkspace(localRoot, false, library.default ? '' : localRoot)) return
      setSelectedId(workspaceId)
      await refreshSelfHostedSyncRuntime()
      await refresh()
      toast.success(t('libraryBound'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function accept(invitationId: string) {
    setBusy(true)
    try {
      const { client } = await authenticatedClient(profileId)
      const { workspaceId } = await client.acceptInvitation(invitationId)
      await ensureLibraryLocalWorkspace(profileId, workspaceId)
      await refreshSelfHostedSyncRuntime()
      await refresh()
      toast.success(t('workspaceAdded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function inviteAccount() {
    if (!selectedId || !inviteLogin.trim()) return
    const { client } = await authenticatedClient(profileId)
    await client.inviteAccount(selectedId, { login: inviteLogin.trim(), role, capabilities })
    setInviteLogin('')
    await refresh()
    toast.success(t('invitationCreated'))
  }

  async function createLink() {
    if (!selectedId) return
    const { client } = await authenticatedClient(profileId)
    const invitation = await client.createInvitationLink(selectedId, { role, capabilities })
    if (invitation.token) {
      const server = await client.capabilities()
      const link = new URL('/invitations/accept', server.web.accountUrl)
      link.searchParams.set('token', invitation.token)
      await writeText(link.toString())
    }
    toast.success(t('linkCopied'))
  }

  async function changeMemberRole(member: WorkspaceMember, nextRole: 'viewer' | 'editor' | 'manager') {
    if (!selectedId) return
    const { client } = await authenticatedClient(profileId)
    await client.updateMember(selectedId, member.accountId, {
      role: nextRole,
      capabilities: ROLE_CAPABILITIES[nextRole],
    })
    await refresh()
  }

  async function removeMember(accountId: string) {
    if (!selectedId) return
    const { client } = await authenticatedClient(profileId)
    await client.removeMember(selectedId, accountId)
    await refresh()
  }

  async function deleteWorkspace(workspace: SelfHostedLibrary) {
    if (workspace.default || !workspace.capabilities.includes('workspace.delete')) return
    const defaultWorkspace = libraries.find(item => item.default)
    if (!defaultWorkspace) {
      toast.error(t('defaultWorkspaceUnavailable'))
      return
    }
    setBusy(true)
    try {
      const defaultLocalRoot = await getDefaultArticleAbsolutePath('')
      if (defaultWorkspace.localRoot !== defaultLocalRoot) {
        await bindLibrary(profileId, defaultWorkspace.id, defaultLocalRoot, true)
      }
      if (!await prepareWorkspaceSwitch()) return
      const { client } = await authenticatedClient(profileId)
      await client.deleteWorkspace(workspace.id)
      await markLibraryRemoteDeleted(workspace.id)
      setLibraries(current => current.filter(item => item.id !== workspace.id))
      setSelectedId(defaultWorkspace.id)
      setDeleteOpen(false)
      if (!await switchLocalWorkspace(defaultLocalRoot, true, '')) return
      await refreshSelfHostedSyncRuntime()
      await refresh()
      toast.success(t('workspaceDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function resolveConflict(id: string) {
    const database = await getDb()
    await database.execute(
      "update self_hosted_conflicts set state = 'resolved-local-kept', resolved_at = $1 where id = $2",
      [Date.now(), id]
    )
    await refresh()
    // Confirming the preserved copy must also release its rejected command;
    // mobile has no desktop status-bar retry button to perform this step.
    const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
    void getSelfHostedSyncRuntime().wake('manual-retry')
  }

  async function openConflictCopy(conflict: ConflictRow) {
    if (!conflict.localCopyPath || conflict.conflictType === 'symlink-ignored') return
    try {
      const portable = await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: conflict.localCopyPath })
      const backup = /^self-hosted-conflict-backups\/[a-f0-9-]+\.json$/.test(portable.normalized)
      const root = backup ? await appDataDir() : conflict.localRoot
      if (!root) throw new Error(t('conflictCopyUnavailable'))
      const path = await join(root, portable.normalized)
      if (!await exists(path)) throw new Error(t('conflictCopyUnavailable'))
      await openPath(path)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    }
  }

  async function transferViewerConflict(conflict: ConflictRow) {
    if (!conflict.localCopyPath || !conflictTargetId) return
    const source = libraries.find(library => library.id === conflict.workspaceId)
    const target = libraries.find(library => library.id === conflictTargetId)
    if (!source?.localRoot || !target?.localRoot || !target.owner || target.accessMode !== 'read-write') {
      toast.error(t('transferTargetUnavailable'))
      return
    }
    try {
      const bytes = await readFile(await join(source.localRoot, conflict.localCopyPath))
      let targetPath = conflict.localCopyPath
      if (await exists(await join(target.localRoot, targetPath))) {
        const dot = targetPath.lastIndexOf('.')
        const suffix = `.viewer-copy-${Date.now()}`
        targetPath = dot > targetPath.lastIndexOf('/')
          ? `${targetPath.slice(0, dot)}${suffix}${targetPath.slice(dot)}`
          : `${targetPath}${suffix}`
      }
      const expectedHash = await hashBytes(bytes)
      await invoke('self_hosted_atomic_write', {
        workspaceId: target.id,
        objectId: null,
        workspaceRoot: target.localRoot,
        relativePath: targetPath,
        contents: bytesToBase64Url(bytes),
        expectedHash,
      })
      if (targetPath.toLowerCase().endsWith('.md')) {
        await enqueueFileSnapshot(targetPath, 'upsert', target.id)
      } else await enqueueAssetSnapshot(targetPath, 'upsert', target.id)
      await resolveConflict(conflict.id)
      toast.success(t('transferredToLibrary', { name: target.name }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    }
  }

  function changeRole(nextRole: 'viewer' | 'editor' | 'manager') {
    setRole(nextRole)
    setCapabilities(ROLE_CAPABILITIES[nextRole])
  }

  async function runMemberAction(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  function conflictLabel(conflictType: string) {
    const translationKey = CONFLICT_TRANSLATION_KEYS[conflictType]
    return translationKey ? t(`conflictTypes.${translationKey}`) : conflictType
  }

  const selected = libraries.find(library => library.id === selectedId)
  const currentLibrary = libraries.find(library => library.localRoot === currentLocalRoot)
  const canDeleteCurrent = Boolean(
    currentLibrary && !currentLibrary.default && currentLibrary.capabilities.includes('workspace.delete')
  )
  const duplicateLibraryNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const library of libraries) counts.set(library.name, (counts.get(library.name) ?? 0) + 1)
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
  }, [libraries])

  function libraryLabel(library: SelfHostedLibrary) {
    const identity = duplicateLibraryNames.has(library.name) ? ` · ${library.id.slice(0, 8)}` : ''
    const access = library.accessMode === 'read-only' ? t('readOnly') : t('readWrite')
    return `${library.name}${identity} · ${access}`
  }

  return (
    <Accordion type="multiple" defaultValue={['workspaces']} className="min-w-0 gap-4">
      <AccordionItem value="workspaces" className="not-last:border-b-0">
        <Card>
          <CardHeader>
            <AccordionTrigger className="p-0 hover:no-underline">
              <div className="flex flex-col gap-1">
                <CardTitle>{t('librariesTitle')}</CardTitle>
                <CardDescription>{t('librariesDescription')}</CardDescription>
              </div>
            </AccordionTrigger>
          </CardHeader>
          <AccordionContent className="pb-0">
            <CardContent className="flex min-w-0 flex-col gap-4 pb-(--card-spacing)">
              {currentLibrary && <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{currentLibrary.name}</span>
                <Badge variant="secondary">{currentLibrary.accessMode === 'read-only' ? t('readOnly') : t('readWrite')}</Badge>
              </div>}
              <Field>
                <FieldLabel>{t('switchWorkspace')}</FieldLabel>
                <Select
                  value={currentLibrary?.id ?? ''}
                  disabled={busy || libraries.length === 0}
                  onValueChange={value => void selectLibrary(value)}
                >
                  <SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0"><SelectValue placeholder={t('notBound')} /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {libraries.map(library => (
                        <SelectItem key={library.id} value={library.id}>{libraryLabel(library)}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="break-all">{t('currentWorkspacePath', { path: currentLocalRoot })}</FieldDescription>
              </Field>
              <Accordion type="single" collapsible>
                <AccordionItem value="create">
                  <AccordionTrigger>{t('createWorkspaceSection')}</AccordionTrigger>
                  <AccordionContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="self-hosted-library-name">{t('newLibraryName')}</FieldLabel>
                        <Input id="self-hosted-library-name" value={libraryName} onChange={event => setLibraryName(event.target.value)} placeholder={t('newLibraryName')} />
                        <FieldDescription>{t(currentLibrary ? 'createSeparateWorkspaceHint' : 'createFromCurrentHint')}</FieldDescription>
                      </Field>
                      <Button className="h-auto min-h-9 w-full whitespace-normal sm:w-fit" disabled={busy || (Boolean(currentLibrary) && !libraryName.trim())} onClick={() => void createNewLibrary()}>
                        {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
                        {t('createLibrary')}
                      </Button>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void refresh().catch(error => toast.error(error instanceof Error ? error.message : t('operationFailed')))}>
                <RefreshCw data-icon="inline-start" />{t('refresh')}
              </Button>
              {canDeleteCurrent && currentLibrary ? (
                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="ml-auto" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('workspaceActions')}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}><Trash2 />{t('deleteWorkspace')}</DropdownMenuItem></DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('deleteWorkspaceTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('deleteWorkspaceDescription', { name: currentLibrary.name })}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => void deleteWorkspace(currentLibrary)}>
                        {t('confirmDeleteWorkspace')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </CardFooter>
          </AccordionContent>
        </Card>
      </AccordionItem>

      {selected ? (
        <AccordionItem value="members" className="not-last:border-b-0">
          <Card>
            <CardHeader>
              <AccordionTrigger className="p-0 hover:no-underline">
                <div className="flex flex-col gap-1">
                  <CardTitle>{t('membersTitle', { name: selected.name })}</CardTitle>
                  <CardDescription>{t('membersDescription')}</CardDescription>
                </div>
              </AccordionTrigger>
            </CardHeader>
            <AccordionContent className="pb-0">
              <CardContent className="flex flex-col gap-4">
                {members.map(member => (
                  <div key={member.accountId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">{member.login}</p>
                      <p className="text-xs text-muted-foreground">{t(`roles.${member.role}`)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.role !== 'owner' && selected.capabilities.includes('member.update') ? (
                        <Select value={member.role} disabled={busy} onValueChange={value => void runMemberAction(() => changeMemberRole(member, value as 'viewer' | 'editor' | 'manager'))}>
                          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
                              <SelectItem value="editor">{t('roles.editor')}</SelectItem>
                              <SelectItem value="manager">{t('roles.manager')}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : null}
                      {member.role !== 'owner' && selected.capabilities.includes('member.remove') ? (
                        <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={t('removeMember')} onClick={() => void runMemberAction(() => removeMember(member.accountId))}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </AccordionContent>
          </Card>
        </AccordionItem>
      ) : null}

      {pendingInvitations.length > 0 || selected?.capabilities.includes('member.invite') ? (
        <AccordionItem value="invitations" className="not-last:border-b-0">
          <Card>
            <CardHeader>
              <AccordionTrigger className="p-0 hover:no-underline">
                <div className="flex flex-col gap-1">
                  <CardTitle>{t('invitationsTitle')}</CardTitle>
                  <CardDescription>{t('invitationsDescription')}</CardDescription>
                </div>
              </AccordionTrigger>
            </CardHeader>
            <AccordionContent className="pb-0">
              <CardContent className="flex flex-col gap-4">
                {pendingInvitations.map(invitation => (
                  <div key={invitation.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t('invitedBy', { login: invitation.inviterLogin ?? '' })}</p>
                      <p className="text-xs text-muted-foreground">{t('invitationRole', { role: t(`roles.${invitation.role}`) })}</p>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void accept(invitation.id)}>
                      <Check data-icon="inline-start" />{t('accept')}
                    </Button>
                  </div>
                ))}
                {selected?.capabilities.includes('member.invite') ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="self-hosted-invite-login">{t('accountLogin')}</FieldLabel>
                      <Input id="self-hosted-invite-login" value={inviteLogin} onChange={event => setInviteLogin(event.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>{t('roleTemplate')}</FieldLabel>
                      <Select value={role} onValueChange={value => changeRole(value as typeof role)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
                            <SelectItem value="editor">{t('roles.editor')}</SelectItem>
                            <SelectItem value="manager">{t('roles.manager')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="permissions">
                        <AccordionTrigger>{t('capabilities')}</AccordionTrigger>
                        <AccordionContent>
                          <FieldSet>
                            <FieldLegend className="sr-only">{t('capabilities')}</FieldLegend>
                            <FieldGroup className="grid gap-2 sm:grid-cols-2">
                              {CAPABILITIES.map(capability => (
                                <Field key={capability} orientation="horizontal" className="rounded-md border px-3 py-2">
                                  <FieldLabel htmlFor={`self-hosted-capability-${capability}`}>
                                    {t(`capabilityDescriptions.${capability}`)}
                                  </FieldLabel>
                                  <Switch
                                    id={`self-hosted-capability-${capability}`}
                                    checked={capabilities.includes(capability)}
                                    onCheckedChange={enabled => setCapabilities(current => enabled
                                      ? [...new Set([...current, capability])]
                                      : current.filter(item => item !== capability))}
                                  />
                                </Field>
                              ))}
                            </FieldGroup>
                          </FieldSet>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </FieldGroup>
                ) : null}
              </CardContent>
              {selected?.capabilities.includes('member.invite') ? (
                <CardFooter className="flex-wrap gap-2 [&>button]:h-auto [&>button]:min-h-9 [&>button]:whitespace-normal">
                  <Button disabled={!inviteLogin.trim() || busy} onClick={() => void runMemberAction(inviteAccount)}>
                    <UserPlus data-icon="inline-start" />{t('inviteAccount')}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void runMemberAction(createLink)}>
                    <Link2 data-icon="inline-start" />{t('copyInviteLink')}
                  </Button>
                </CardFooter>
              ) : null}
            </AccordionContent>
          </Card>
        </AccordionItem>
      ) : null}

      <AccordionItem value="conflicts" className="not-last:border-b-0">
        <Card>
          <CardHeader>
            <AccordionTrigger className="p-0 hover:no-underline">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex flex-wrap items-center gap-2">{t('conflictsTitle')}{conflicts.length > 0 && <Badge variant="secondary">{conflicts.length}</Badge>}</CardTitle>
                <CardDescription>{t('conflictsDescription')}</CardDescription>
              </div>
            </AccordionTrigger>
          </CardHeader>
          <AccordionContent className="pb-0">
            <CardContent className="flex flex-col gap-3">
              {conflicts.some(conflict => conflict.conflictType === 'viewer-local-edit') && libraries.some(library => library.owner && library.localRoot && library.accessMode === 'read-write') ? (
                <Select value={conflictTargetId} onValueChange={setConflictTargetId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={t('transferTarget')} /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {libraries.filter(library => library.owner && library.localRoot && library.accessMode === 'read-write').map(library => (
                        <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
              {conflicts.length === 0 ? <p className="text-sm text-muted-foreground">{t('noConflicts')}</p> : null}
              {conflicts.map(conflict => (
                <div key={conflict.id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="break-all text-sm font-medium">{conflict.relativePath ?? conflict.localCopyPath?.split('/').pop() ?? conflictLabel(conflict.conflictType)}</p>
                    <p className="break-words text-xs text-muted-foreground">{libraries.find(library => library.id === conflict.workspaceId)?.name ?? t('personalDataTitle')} · {new Date(conflict.createdAt).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{conflictLabel(conflict.conflictType)}</p>
                    {conflict.localCopyPath && <p className="break-all text-xs text-muted-foreground">{conflict.localCopyPath}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 [&>button]:h-auto [&>button]:min-h-8 [&>button]:whitespace-normal">
                    {conflict.localCopyPath && conflict.conflictType !== 'symlink-ignored' && <Button size="sm" variant="outline" onClick={() => void openConflictCopy(conflict)}>
                      <FolderOpen data-icon="inline-start" />{t('openConflictCopy')}
                    </Button>}
                    {conflict.conflictType === 'viewer-local-edit' ? (
                      <Button size="sm" disabled={!conflictTargetId} onClick={() => void transferViewerConflict(conflict)}>
                        {t('transferToLibrary')}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void runMemberAction(() => resolveConflict(conflict.id))}>
                      <Check data-icon="inline-start" />{t('markConflictResolved')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('conflictCopyRetained')}</p>
                </div>
              ))}
            </CardContent>
          </AccordionContent>
        </Card>
      </AccordionItem>
    </Accordion>
  )
}
