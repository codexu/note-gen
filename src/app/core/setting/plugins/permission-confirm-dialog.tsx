'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PluginNotePicker } from '@/components/plugins/plugin-note-picker'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import useArticleStore, { type DirTree } from '@/stores/article'
import type {
  InstalledPlugin,
  PluginPermissionName,
} from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import { getPluginManifestFingerprint } from '@/lib/plugins/internal-types'
import {
  getInstalledPluginText,
  isSafeRelativePluginPath,
  isSafePluginNetworkOrigin,
  isNetworkOriginPermissionScope,
  isWorkspacePathPermissionScope,
  permissionOrder,
  resolvePluginText,
  splitPluginPaths,
} from './plugin-display'

interface PermissionConfirmDialogProps {
  plugin: InstalledPlugin | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: (plugin: InstalledPlugin) => Promise<void>
}

function folderChoices(tree: DirTree[], parent = ''): string[] {
  return tree.flatMap(entry => {
    if (!entry.isDirectory) return []
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (!isSafeRelativePluginPath(path) || /[,\n]/.test(path)) return []
    return [path, ...folderChoices(entry.children ?? [], path)]
  })
}

function fileChoices(tree: DirTree[], parent = ''): string[] {
  return tree.flatMap(entry => {
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (!isSafeRelativePluginPath(path) || /[,\n]/.test(path)) return []
    return entry.isDirectory ? fileChoices(entry.children ?? [], path) : [path]
  })
}

function folderSetting(plugin: InstalledPlugin | null) {
  return plugin?.manifest.contributes.settings?.find(setting => setting.type === 'string' && setting.permissionPaths?.length)
}

function folderTemplate(plugin: InstalledPlugin): string | undefined {
  const setting = folderSetting(plugin)
  if (!setting || setting.type !== 'string' || setting.scope !== 'workspace') return undefined
  const value = usePluginStore.getState().getWorkspaceState(plugin.manifest.id)?.settings[setting.key] ?? setting.default
  return typeof value === 'string' ? value : undefined
}

function fixedFolder(template: string): string {
  if (!isSafeRelativePluginPath(template)) return ''
  const fixed = template.replace(/\\/g, '/').split('/').filter(Boolean)
  const firstToken = fixed.findIndex(part => part.includes('{{'))
  const path = (firstToken < 0 ? fixed : fixed.slice(0, firstToken)).join('/')
  return path && isSafeRelativePluginPath(path) && !/[,\n]/.test(path) ? path : ''
}

export function PermissionConfirmDialog({
  plugin,
  open,
  onOpenChange,
  onConfirmed,
}: PermissionConfirmDialogProps) {
  const t = useTranslations('settings.plugins')
  const formId = useId()
  const locale = useLocale()
  const catalog = usePluginStore(state => state.catalog)
  const setPermissionGrants = usePluginStore((state) => state.setPermissionGrants)
  const currentWorkspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const currentPlugins = usePluginStore((state) => state.installed)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const [reviewIdentity, setReviewIdentity] = useState<{
    workspaceId: string | null
    fingerprint: string
  } | null>(null)
  const [selected, setSelected] = useState<Partial<Record<PluginPermissionName, boolean>>>({})
  const [pathValues, setPathValues] = useState<Partial<Record<PluginPermissionName, string>>>({})
  const [pathErrors, setPathErrors] = useState<Partial<Record<PluginPermissionName, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileTree = useArticleStore(state => state.fileTree)
  const files = useMemo(() => fileChoices(fileTree), [fileTree])
  const folders = useMemo(() => folderChoices(fileTree), [fileTree])
  const [template, setTemplate] = useState<string | undefined>()
  const [folder, setFolder] = useState('')
  const [initialFolder, setInitialFolder] = useState('')
  const binding = folderSetting(plugin)
  const boundPermissions = binding?.type === 'string' ? binding.permissionPaths ?? [] : []

  const permissions = useMemo(() => {
    if (!plugin) return []
    return permissionOrder.flatMap((permission) => {
      const declaration = plugin.manifest.permissions[permission]
      return declaration ? [{ permission, declaration }] : []
    })
  }, [plugin])

  useEffect(() => {
    setReviewIdentity(open && plugin ? {
      workspaceId: usePluginStore.getState().currentWorkspaceId,
      fingerprint: getPluginManifestFingerprint(plugin),
    } : null)
  }, [open, plugin])

  const currentPlugin = currentPlugins.find((item) => item.manifest.id === plugin?.manifest.id)
  const reviewIsCurrent = Boolean(reviewIdentity?.workspaceId
    && currentWorkspaceId === reviewIdentity.workspaceId
    && currentPlugin
    && getPluginManifestFingerprint(currentPlugin) === reviewIdentity.fingerprint)

  function assertReviewIsCurrent() {
    const current = usePluginStore.getState()
    const installed = current.installed.find((item) => item.manifest.id === plugin?.manifest.id)
    if (!reviewIdentity?.workspaceId
      || current.currentWorkspaceId !== reviewIdentity.workspaceId
      || !installed
      || getPluginManifestFingerprint(installed) !== reviewIdentity.fingerprint
      || current.operationPluginId) {
      throw new Error(t('permissionDialog.contextChanged'))
    }
  }

  useEffect(() => {
    if (!open || !plugin) return
    const workspaceState = usePluginStore.getState().getWorkspaceState(plugin.manifest.id)
    const firstReview = Object.keys(workspaceState?.permissions ?? {}).length === 0
    const nextSelected: Partial<Record<PluginPermissionName, boolean>> = {}
    const nextPaths: Partial<Record<PluginPermissionName, string>> = {}
    const template = folderTemplate(plugin)
    const suggestedFolder = template === undefined ? '' : fixedFolder(template) || '.'
    setTemplate(template)
    setFolder(suggestedFolder)
    setInitialFolder(suggestedFolder)
    for (const { permission, declaration } of permissions) {
      const grant = workspaceState?.permissions[permission]
      // Preselect on first review only; preserve refusals and leave newly added
      // optional permissions unselected when reviewing an existing installation.
      nextSelected[permission] = declaration.optional
        ? grant?.granted ?? firstReview
        : true
      if (isWorkspacePathPermissionScope(declaration.scope) || isNetworkOriginPermissionScope(declaration.scope)) {
        nextPaths[permission] = grant?.paths?.length
          ? grant.paths.map((path) => path || '.').join(', ')
          : declaration.scope === 'workspace-folder' ? '.' : ''
      }
    }
    setSelected(nextSelected)
    setPathValues(nextPaths)
    setPathErrors({})
    setError(null)
  }, [open, permissions, plugin])

  const sharedFolder = template !== undefined && boundPermissions.length > 0

  function effectivePaths(permission: PluginPermissionName): string {
    return sharedFolder && boundPermissions.includes(permission)
      ? folder : pathValues[permission] ?? ''
  }

  async function handleConfirm() {
    if (!plugin) return
    const nextErrors: Partial<Record<PluginPermissionName, string>> = {}

    for (const { permission, declaration } of permissions) {
      if (selected[permission] !== true || (!isWorkspacePathPermissionScope(declaration.scope) && !isNetworkOriginPermissionScope(declaration.scope))) continue
      const paths = splitPluginPaths(effectivePaths(permission))
      if (paths.length === 0) {
        nextErrors[permission] = t('permissionDialog.pathRequired')
      } else if (isNetworkOriginPermissionScope(declaration.scope)) {
        if (paths.some((origin) => !isSafePluginNetworkOrigin(origin))) {
          nextErrors[permission] = t('permissionDialog.originOnly')
        }
      } else if (paths.some((path) => !isSafeRelativePluginPath(path)
        || (path === '.' && declaration.scope !== 'workspace-folder'))) {
        nextErrors[permission] = t('permissionDialog.relativePathOnly')
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setPathErrors(nextErrors)
      return
    }

    setSaving(true)
    setError(null)
    try {
      assertReviewIsCurrent()
      if (sharedFolder && folderTemplate(plugin) !== template) {
        throw new Error(t('permissionDialog.contextChanged'))
      }
      if (sharedFolder && folder !== initialFolder) {
        // Keep the date subfolders while moving the fixed storage directory.
        const parts = template.replace(/\\/g, '/').split('/').filter(Boolean)
        const tokenIndex = parts.findIndex(part => part.includes('{{'))
        const suffix = tokenIndex < 0 ? '' : parts.slice(tokenIndex).join('/')
        const nextTemplate = `${folder === '.' ? '' : folder}${suffix ? `/${suffix}` : ''}`.replace(/^\/+/, '')
        await usePluginStore.getState().setSetting(plugin.manifest.id, binding!.key, nextTemplate)
        assertReviewIsCurrent()
        setTemplate(nextTemplate)
        setInitialFolder(folder)
      }
      const grantedAt = new Date().toISOString()
      await setPermissionGrants(plugin.manifest.id, permissions.map(({ permission, declaration }) => {
        const granted = selected[permission] === true
        return {
          permission,
          grant: {
            granted,
            grantedAt: granted ? grantedAt : undefined,
            paths: granted && (isWorkspacePathPermissionScope(declaration.scope) || isNetworkOriginPermissionScope(declaration.scope))
              ? splitPluginPaths(effectivePaths(permission))
              : undefined,
          },
        }
      }))
      assertReviewIsCurrent()
      await onConfirmed(plugin)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><ShieldCheck /></AlertDialogMedia>
          <AlertDialogTitle>{t('permissionDialog.title', { name: plugin ? getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id)).name : '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('permissionDialog.desc')}</AlertDialogDescription>
        </AlertDialogHeader>

        <FieldGroup className="max-h-[min(52vh,30rem)] overflow-y-auto pr-1">
          {sharedFolder ? (
            <Field data-invalid={Boolean(boundPermissions.map(permission => pathErrors[permission]).find(Boolean))}>
              <FieldLabel htmlFor={`${formId}-shared-folder`}>{t('permissionDialog.folderLabel')}</FieldLabel>
              <Select value={folder} disabled={saving} onValueChange={value => {
                setFolder(value)
                setPathErrors({})
              }}>
                <SelectTrigger id={`${formId}-shared-folder`} aria-invalid={Boolean(boundPermissions.map(permission => pathErrors[permission]).find(Boolean))}><SelectValue placeholder={t('permissionDialog.chooseFolder')} /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {[...new Set([folder, ...folders, '.'])].filter(Boolean).map(path => <SelectItem key={path} value={path}>{path === '.' ? t('permissionDialog.entireWorkspace') : path}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <FieldDescription>{t('permissionDialog.folderHelp', { folder: folder || '.' })}</FieldDescription>
              <FieldError>{boundPermissions.map(permission => pathErrors[permission]).find(Boolean)}</FieldError>
            </Field>
          ) : null}
          {permissions.map(({ permission, declaration }) => {
            const inputId = `${formId}-permission-${permission.replace('.', '-')}`
            const granted = selected[permission] === true
            return (
              <Field key={permission} className="rounded-lg border p-3" data-invalid={Boolean(pathErrors[permission])}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`${inputId}-enabled`}
                    checked={granted}
                    disabled={!declaration.optional || saving}
                    onCheckedChange={(checked) => {
                      setSelected((current) => ({ ...current, [permission]: checked === true }))
                      setPathErrors((current) => ({ ...current, [permission]: undefined }))
                    }}
                    aria-label={t('permissionDialog.togglePermission', {
                      permission: t(`permissionNames.${permission}`),
                    })}
                  />
                  <FieldContent>
                    <FieldTitle>
                      {t(`permissionNames.${permission}`)}
                      <Badge variant={declaration.optional ? 'outline' : 'secondary'}>
                        {declaration.optional ? t('optional') : t('required')}
                      </Badge>
                    </FieldTitle>
                    <FieldDescription>
                      {resolvePluginText(plugin?.manifest.id ?? '', declaration.description, locale)
                        || t(`permissionScopes.${declaration.scope}`)}
                    </FieldDescription>
                  </FieldContent>
                </div>

                {granted && !(sharedFolder && boundPermissions.includes(permission)) && (isWorkspacePathPermissionScope(declaration.scope) || isNetworkOriginPermissionScope(declaration.scope)) ? (
                  <div className="flex min-w-0 flex-col gap-3 pl-7">
                    {declaration.scope === 'workspace-folder' ? <Field>
                      <FieldLabel htmlFor={`${inputId}-folder`}>{t('permissionDialog.folderLabel')}</FieldLabel>
                      <Select value={splitPluginPaths(pathValues[permission] ?? '').length === 1 ? splitPluginPaths(pathValues[permission] ?? '')[0] : ''} disabled={saving} onValueChange={value => {
                        setPathValues(current => ({ ...current, [permission]: value }))
                        setPathErrors(current => ({ ...current, [permission]: undefined }))
                      }}>
                        <SelectTrigger className="w-full" id={`${inputId}-folder`} aria-invalid={Boolean(pathErrors[permission])}><SelectValue placeholder={t('permissionDialog.chooseFolder')} /></SelectTrigger>
                        <SelectContent><SelectGroup>
                          {[...new Set([...splitPluginPaths(pathValues[permission] ?? ''), ...folders, '.'])].map(path => <SelectItem key={path} value={path}>{path === '.' ? t('permissionDialog.entireWorkspace') : path}</SelectItem>)}
                        </SelectGroup></SelectContent>
                      </Select>
                      {pathValues[permission] ? <FieldDescription>{splitPluginPaths(pathValues[permission] ?? '').map(path => path === '.' ? t('permissionDialog.entireWorkspace') : path).join(', ')}</FieldDescription> : null}
                    </Field> : null}
                    {declaration.scope === 'workspace-file' || declaration.scope === 'workspace-files' ? <Field>
                      <FieldLabel htmlFor={`${inputId}-file`}>{t('permissionDialog.chooseFile')}</FieldLabel>
                      <PluginNotePicker id={`${inputId}-file`} label={t('permissionDialog.chooseFile')}
                        options={[...new Set([...splitPluginPaths(pathValues[permission] ?? ''), ...files])]
                          .filter(path => !permission.startsWith('notes.') || /\.md$/i.test(path))
                          .map(path => ({ label: path, value: path }))}
                        value={declaration.scope === 'workspace-file' ? pathValues[permission] ?? '' : ''}
                        disabled={saving} invalid={Boolean(pathErrors[permission])}
                        onChange={value => {
                          setPathValues(current => ({ ...current, [permission]: declaration.scope === 'workspace-files'
                            ? [...new Set([...splitPluginPaths(current[permission] ?? ''), value])].join(', ') : value }))
                          setPathErrors(current => ({ ...current, [permission]: undefined }))
                        }} />
                      {pathValues[permission] ? <FieldDescription>{pathValues[permission]}</FieldDescription> : null}
                    </Field> : null}
                    <Collapsible defaultOpen={isNetworkOriginPermissionScope(declaration.scope)}>
                      {isWorkspacePathPermissionScope(declaration.scope) ? (
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="group max-w-full">
                            <span className="truncate">{t('permissionDialog.advancedPaths')}</span>
                            <ChevronDown data-icon="inline-end" className="transition-transform group-data-[state=open]:rotate-180" />
                          </Button>
                        </CollapsibleTrigger>
                      ) : null}
                      <CollapsibleContent className="flex flex-col gap-2 pt-2">
                        <FieldLabel htmlFor={inputId}>{t(isNetworkOriginPermissionScope(declaration.scope) ? 'permissionDialog.originLabel' : 'permissionDialog.pathLabel')}</FieldLabel>
                        <Input
                          id={inputId}
                          value={pathValues[permission] ?? ''}
                          disabled={saving}
                          aria-invalid={Boolean(pathErrors[permission])}
                          placeholder={t(isNetworkOriginPermissionScope(declaration.scope) ? 'permissionDialog.originPlaceholder' : 'permissionDialog.pathPlaceholder')}
                          onChange={(event) => {
                            setPathValues((current) => ({ ...current, [permission]: event.target.value }))
                            setPathErrors((current) => ({ ...current, [permission]: undefined }))
                          }}
                        />
                        <FieldDescription>{t(isNetworkOriginPermissionScope(declaration.scope) ? 'permissionDialog.originHelp' : 'permissionDialog.pathHelp')}</FieldDescription>
                      </CollapsibleContent>
                    </Collapsible>
                    <FieldError>{pathErrors[permission]}</FieldError>
                  </div>
                ) : null}
              </Field>
            )
          })}
        </FieldGroup>

        {error || (reviewIdentity && !reviewIsCurrent) ? (
          <FieldError>{error ?? t('permissionDialog.contextChanged')}</FieldError>
        ) : null}

        <AlertDialogFooter className="flex-col sm:items-center">
          <Field orientation="horizontal" className="w-auto self-start sm:mr-auto sm:self-center">
            <Checkbox
              id={`${formId}-select-all`}
              checked={permissions.length > 0 && permissions.every(({ permission }) => selected[permission])
                ? true
                : permissions.some(({ permission }) => selected[permission]) ? 'indeterminate' : false}
              disabled={saving || !reviewIsCurrent || Boolean(operationPluginId) || !permissions.some(({ declaration }) => declaration.optional)}
              onCheckedChange={(checked) => {
                setSelected(Object.fromEntries(permissions.map(({ permission, declaration }) => [permission, !declaration.optional || checked === true])))
                setPathErrors({})
              }}
            />
            <FieldLabel htmlFor={`${formId}-select-all`}>{t('permissionDialog.selectAll')}</FieldLabel>
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row">
          <AlertDialogCancel disabled={saving}>{t('actions.cancel')}</AlertDialogCancel>
          <Button onClick={() => void handleConfirm()} disabled={saving || !reviewIsCurrent || Boolean(operationPluginId)}>
            {saving ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
            {saving ? t('actions.enabling') : t('permissionDialog.confirm')}
          </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

