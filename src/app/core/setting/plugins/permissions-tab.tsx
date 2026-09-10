'use client'

import { useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { KeyRound, RotateCcw, Shield, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import {
  getPluginManifestFingerprint,
  type InstalledPlugin,
  type PluginPermissionName,
} from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import { getInstalledPluginText, permissionOrder } from './plugin-display'
import { PermissionConfirmDialog } from './permission-confirm-dialog'

export function PermissionsTab({ pluginId: filterPluginId }: { pluginId?: string }) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const catalog = usePluginStore(state => state.catalog)
  const sectionId = useId()
  const installed = usePluginStore((state) => state.installed)
  const currentWorkspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const revokePermission = usePluginStore((state) => state.revokePermission)
  const setEnablement = usePluginStore((state) => state.setEnablement)
  const isRequestedInAllWorkspaces = usePluginStore((state) => state.isRequestedInAllWorkspaces)
  const [revokingKey, setRevokingKey] = useState<string | null>(null)
  const [permissionPlugin, setPermissionPlugin] = useState<InstalledPlugin | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pluginById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.manifest.id, plugin])),
    [installed],
  )
  const workspaces = useMemo(() => {
    const entries = Object.entries(workspaceStates)
    return entries.sort(([leftId], [rightId]) => {
      if (leftId === currentWorkspaceId) return -1
      if (rightId === currentWorkspaceId) return 1
      return leftId.localeCompare(rightId)
    })
  }, [currentWorkspaceId, workspaceStates])

  async function handleRevoke(pluginId: string, permission: PluginPermissionName) {
    const key = `${pluginId}:${permission}`
    setRevokingKey(key)
    setError(null)
    try {
      await revokePermission(pluginId, permission)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRevokingKey(null)
    }
  }

  const visibleWorkspaces = workspaces.flatMap(([workspaceId, pluginStates]) => {
    const workspacePlugins = Object.entries(pluginStates).flatMap(([pluginId, pluginState]) => {
      const plugin = pluginById.get(pluginId)
      if (!plugin || (filterPluginId && pluginId !== filterPluginId) || Object.keys(plugin.manifest.permissions).length === 0) return []
      return [{ plugin, pluginState }]
    })
    return workspacePlugins.length ? [{ workspaceId, workspacePlugins }] : []
  })

  return (
    <div className="flex flex-col gap-5">
      <Alert>
        <Shield />
        <AlertTitle>{t('permissions.workspaceIsolationTitle')}</AlertTitle>
        <AlertDescription>{t('permissions.workspaceIsolationDesc')}</AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>{t('permissions.revokeFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {visibleWorkspaces.length > 0 ? visibleWorkspaces.map(({ workspaceId, workspacePlugins }) => {
        const current = workspaceId === currentWorkspaceId
        return (
          <section key={workspaceId} className="flex flex-col gap-3" aria-labelledby={`${sectionId}-workspace-${workspaceId}`}>
            <header className="flex flex-wrap items-center gap-2">
              <h3 id={`${sectionId}-workspace-${workspaceId}`} className="font-medium">
                {current ? t('permissions.currentWorkspace') : t('permissions.otherWorkspace')}
              </h3>
              {current ? <Badge variant="secondary">{t('permissions.current')}</Badge> : null}
              <code className="max-w-full truncate text-xs text-muted-foreground" title={workspaceId}>{workspaceId}</code>
            </header>
            {!current ? <p className="text-xs text-muted-foreground">{t('permissions.switchToManage')}</p> : null}

            <ItemGroup>
              {workspacePlugins.flatMap(({ plugin, pluginState }) => permissionOrder.flatMap((permission) => {
                const declaration = plugin.manifest.permissions[permission]
                if (!declaration) return []
                const grant = pluginState.permissions[permission]
                const expectedFingerprint = getPluginManifestFingerprint(plugin)
                const changed = Boolean(grant && grant.manifestFingerprint !== expectedFingerprint)
                const status = changed
                  ? 'changed'
                  : !grant
                    ? 'unreviewed'
                    : grant.granted
                      ? 'granted'
                      : 'denied'
                const revokeKey = `${plugin.manifest.id}:${permission}`
                const revoking = revokingKey === revokeKey
                const firstDeclaredPermission = permissionOrder.find(
                  (candidate) => Boolean(plugin.manifest.permissions[candidate]),
                )
                return [(
                  <Item role="listitem" key={`${workspaceId}:${revokeKey}:${expectedFingerprint}`} variant="outline">
                    <ItemMedia variant="icon"><KeyRound /></ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full flex-wrap">
                        <span>{getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id)).name}</span>
                        <Badge variant={status === 'granted' ? 'secondary' : status === 'changed' ? 'destructive' : 'outline'}>
                          {t(`permissions.status.${status}`)}
                        </Badge>
                        {declaration.optional ? <Badge variant="outline">{t('optional')}</Badge> : null}
                      </ItemTitle>
                      <ItemDescription>
                        {t(`permissionNames.${permission}`)} · {t(`permissionScopes.${declaration.scope}`)}
                      </ItemDescription>
                      {grant?.paths?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {grant.paths.map((path) => <Badge key={path} variant="outline" className="max-w-full"><code className="truncate" title={path}>{path}</code></Badge>)}
                        </div>
                      ) : null}
                    </ItemContent>
                    {current ? (
                      <ItemActions className="flex-wrap justify-end">
                        {permission === firstDeclaredPermission ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(revokingKey)}
                            onClick={() => setPermissionPlugin(plugin)}
                          >
                            <Shield data-icon="inline-start" />
                            {t('installed.reviewPermissions')}
                          </Button>
                        ) : null}
                        {grant?.granted ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={Boolean(revokingKey)}
                              aria-label={t('permissions.revokeAria', {
                                permission: t(`permissionNames.${permission}`),
                                name: getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id)).name,
                              })}
                            >
                              {revoking ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
                              {t('actions.revoke')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('permissions.confirmRevokeTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('permissions.confirmRevokeDesc', {
                                  permission: t(`permissionNames.${permission}`),
                                  name: getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id)).name,
                                })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                disabled={Boolean(revokingKey)}
                                onClick={() => void handleRevoke(plugin.manifest.id, permission)}
                              >
                                {t('actions.revoke')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        ) : null}
                      </ItemActions>
                    ) : null}
                  </Item>
                )]
              }))}
            </ItemGroup>
          </section>
        )
      }) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Shield /></EmptyMedia>
            <EmptyTitle>{t('permissions.empty')}</EmptyTitle>
            <EmptyDescription>{t('permissions.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <PermissionConfirmDialog
        plugin={permissionPlugin}
        open={Boolean(permissionPlugin)}
        onOpenChange={(open) => !open && setPermissionPlugin(null)}
        onConfirmed={async (plugin) => {
          await setEnablement(
            plugin.manifest.id,
            isRequestedInAllWorkspaces(plugin.manifest.id) ? 'all-workspaces' : 'workspace',
          )
        }}
      />
    </div>
  )
}
