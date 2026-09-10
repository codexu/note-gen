'use client'

import { getPluginRevocation } from '@/lib/plugins/internal-types'

import { useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Box,
  ChevronDown,
  CircleAlert,
  Code2,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PluginDisplaySettings } from './plugin-display-settings'
import { PluginListToolbar } from './plugin-list-toolbar'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type {
  InstalledPlugin,
  PluginEnablement,
  PluginPermissionName,
  PluginSettingContribution,
  PluginSettingValue,
  PluginWorkspaceState,
} from '@/lib/plugins/types'
import { getPluginManifestFingerprint, isPluginEnabledInWorkspace } from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import {
  getInstalledPluginText,
  isSafeRelativePluginPath,
  normalizeRelativePluginPath,
  resolvePluginText,
} from './plugin-display'
import { PermissionConfirmDialog } from './permission-confirm-dialog'
import { PermissionsTab } from './permissions-tab'
import { UpdatesTab } from './updates-tab'
import { PluginUsage } from '@/components/plugins/plugin-usage'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import useSettingStore from '@/stores/setting'

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function PluginSettingField({
  plugin,
  setting,
}: {
  plugin: InstalledPlugin
  setting: PluginSettingContribution
}) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const generatedId = useId()
  const inputId = `plugin-setting-${generatedId.replace(/:/g, '')}`
  const currentWorkspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const storedValue = usePluginStore((state) => setting.scope === 'device'
    ? state.deviceSettings[plugin.manifest.id]?.[setting.key]
    : currentWorkspaceId
      ? state.workspaceStates[currentWorkspaceId]?.[plugin.manifest.id]?.settings[setting.key]
      : undefined)
  const setSetting = usePluginStore((state) => state.setSetting)
  const value = storedValue ?? setting.default
  const [draft, setDraft] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const title = resolvePluginText(plugin.manifest.id, setting.title, locale)
  const description = resolvePluginText(plugin.manifest.id, setting.description, locale)
  const maxStringBytes = setting.type === 'string' ? setting.maxLength : undefined
  const draftBytes = setting.type === 'string' ? utf8ByteLength(draft) : 0
  const draftExceedsByteLimit = maxStringBytes !== undefined && draftBytes > maxStringBytes

  async function save(nextValue: PluginSettingValue) {
    setSaving(true)
    setError(null)
    try {
      const current = usePluginStore.getState()
      const currentPlugin = current.installed.find((item) => item.manifest.id === plugin.manifest.id)
      if (current.currentWorkspaceId !== currentWorkspaceId
        || !currentPlugin
        || getPluginManifestFingerprint(currentPlugin) !== getPluginManifestFingerprint(plugin)) {
        throw new Error(t('settings.contextChanged'))
      }
      await setSetting(plugin.manifest.id, setting.key, nextValue)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setDraft(String(value))
    } finally {
      setSaving(false)
    }
  }

  function commitDraft() {
    if (setting.type === 'number') {
      if (!draft.trim()) {
        setError(t('settings.invalidNumber'))
        return
      }
      const numberValue = Number(draft)
      if (!Number.isFinite(numberValue)) {
        setError(t('settings.invalidNumber'))
        return
      }
      if (numberValue !== value) void save(numberValue)
      return
    }

    if (maxStringBytes !== undefined && draftBytes > maxStringBytes) {
      setError(t('settings.byteLimitExceeded', { used: draftBytes, max: maxStringBytes }))
      return
    }

    const workspacePath = setting.type === 'workspace-file' || setting.type === 'workspace-folder'
    const nextValue = workspacePath ? normalizeRelativePluginPath(draft) : draft
    if (workspacePath
      && nextValue
      && !isSafeRelativePluginPath(nextValue)) {
      setError(t('settings.relativePathOnly'))
      return
    }
    if (nextValue !== value) void save(nextValue)
  }

  function updateDraft(nextDraft: string) {
    setDraft(nextDraft)
    if (setting.type === 'string' && setting.maxLength !== undefined) {
      const nextBytes = utf8ByteLength(nextDraft)
      setError(nextBytes > setting.maxLength
        ? t('settings.byteLimitExceeded', { used: nextBytes, max: setting.maxLength })
        : null)
      return
    }
    setError(null)
  }

  if (setting.type === 'boolean') {
    return (
      <Field orientation="responsive" data-invalid={Boolean(error)}>
        <FieldContent>
          <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldDescription>{t(`settings.scopes.${setting.scope}`)}</FieldDescription>
          <FieldError>{error}</FieldError>
        </FieldContent>
        <div className="flex items-center gap-2">
          {saving ? <Spinner /> : null}
          <Switch
            id={inputId}
            checked={value === true}
            aria-invalid={Boolean(error)}
            disabled={saving}
            onCheckedChange={(checked) => void save(checked)}
          />
        </div>
      </Field>
    )
  }

  if (setting.type === 'select') {
    return (
      <Field orientation="responsive" data-invalid={Boolean(error)}>
        <FieldContent>
          <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldDescription>{t(`settings.scopes.${setting.scope}`)}</FieldDescription>
          <FieldError>{error}</FieldError>
        </FieldContent>
        <div className="flex items-center gap-2">
          {saving ? <Spinner /> : null}
          <Select value={String(value)} disabled={saving} onValueChange={(nextValue) => void save(nextValue)}>
            <SelectTrigger id={inputId} className="w-48 max-w-full" aria-invalid={Boolean(error)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {setting.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {resolvePluginText(plugin.manifest.id, option.label, locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </Field>
    )
  }

  const multiline = setting.type === 'string' && (setting.maxLength ?? 0) > 1_000
  const control = multiline ? (
    <Textarea
      id={inputId}
      value={draft}
      disabled={saving}
      maxRows={8}
      aria-invalid={Boolean(error) || draftExceedsByteLimit}
      placeholder={'placeholder' in setting && setting.placeholder
        ? resolvePluginText(plugin.manifest.id, setting.placeholder, locale)
        : undefined}
      onChange={(event) => {
        updateDraft(event.target.value)
      }}
      onBlur={commitDraft}
    />
  ) : (
    <Input
      id={inputId}
      type={setting.type === 'number' ? 'number' : 'text'}
      value={draft}
      disabled={saving}
      min={setting.type === 'number' ? setting.min : undefined}
      max={setting.type === 'number' ? setting.max : undefined}
      step={setting.type === 'number' ? setting.step : undefined}
      aria-invalid={Boolean(error) || draftExceedsByteLimit}
      placeholder={'placeholder' in setting && setting.placeholder
        ? resolvePluginText(plugin.manifest.id, setting.placeholder, locale)
        : undefined}
      onChange={(event) => {
        updateDraft(event.target.value)
      }}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
      }}
    />
  )

  return (
    <Field data-invalid={Boolean(error) || draftExceedsByteLimit}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t(`settings.scopes.${setting.scope}`)}</Badge>
          {saving ? <Spinner /> : null}
        </div>
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {control}
      {(setting.type === 'workspace-file' || setting.type === 'workspace-folder') ? (
        <FieldDescription>{t('settings.relativePathHelp')}</FieldDescription>
      ) : null}
      {maxStringBytes !== undefined ? (
        <FieldDescription aria-live="polite">
          {t('settings.byteUsage', { used: draftBytes, max: maxStringBytes })}
        </FieldDescription>
      ) : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

function hasReviewedCurrentManifest(plugin: InstalledPlugin, workspaceState?: PluginWorkspaceState): boolean {
  const fingerprint = getPluginManifestFingerprint(plugin)
  const permissions = Object.keys(plugin.manifest.permissions)
  return permissions.every((permission) => {
    const declaration = plugin.manifest.permissions[permission as PluginPermissionName]
    const grant = workspaceState?.permissions[permission as PluginPermissionName]
    return Boolean(
      grant
      && grant.manifestFingerprint === fingerprint
      && (declaration?.optional || grant.granted),
    )
  })
}

export function InstalledPluginsTab({ enablePluginId, onEnablePromptHandled }: {
  enablePluginId?: string | null
  onEnablePromptHandled?: () => void
}) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const developerMode = useSettingStore(state => state.developerMode)
  const catalog = usePluginStore(state => state.catalog)
  const installed = usePluginStore((state) => state.installed)
  const currentWorkspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const runtimeStates = usePluginStore((state) => state.runtimeStates)
  const failures = usePluginStore((state) => state.failures)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const setEnablement = usePluginStore((state) => state.setEnablement)
  const isRequestedInAllWorkspaces = usePluginStore((state) => state.isRequestedInAllWorkspaces)
  const clearFailure = usePluginStore((state) => state.clearFailure)
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [permissionPlugin, setPermissionPlugin] = useState<InstalledPlugin | null>(null)
  const [permissionEnablement, setPermissionEnablement] = useState<PluginEnablement>('workspace')
  const [changingPluginId, setChangingPluginId] = useState<string | null>(null)
  const [clearingFailureId, setClearingFailureId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentStates = currentWorkspaceId ? workspaceStates[currentWorkspaceId] ?? {} : {}
  useEffect(() => {
    if (!enablePluginId) return
    const plugin = installed.find(item => item.manifest.id === enablePluginId)
    if (!plugin) return
    setQuery('')
    setExpanded(current => new Set(current).add(plugin.manifest.id))
    setPermissionEnablement(usePluginStore.getState().isRequestedInAllWorkspaces(plugin.manifest.id) ? 'all-workspaces' : 'workspace')
    setPermissionPlugin(plugin)
    onEnablePromptHandled?.()
  }, [enablePluginId, installed, onEnablePromptHandled])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const catalogById = new Map((catalog?.plugins ?? []).map(entry => [entry.id, entry]))
  const filteredPlugins = installed.filter((plugin) => {
    if (!normalizedQuery) return true
    const text = getInstalledPluginText(plugin, locale, catalogById.get(plugin.manifest.id))
    return [
      text.name,
      text.description,
      plugin.manifest.name,
      plugin.manifest.description ?? '',
      plugin.manifest.id,
      plugin.manifest.author?.name ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })

  async function changeEnablement(plugin: InstalledPlugin, enablement: PluginEnablement) {
    setChangingPluginId(plugin.manifest.id)
    setError(null)
    try {
      await setEnablement(plugin.manifest.id, enablement)
      if (enablement !== 'disabled') setExpanded(current => new Set(current).add(plugin.manifest.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally {
      setChangingPluginId(null)
    }
  }

  function requestEnablement(plugin: InstalledPlugin, enablement: PluginEnablement) {
    if (enablement === 'disabled') {
      void changeEnablement(plugin, 'disabled').catch(() => undefined)
      return
    }
    const workspaceState = currentStates[plugin.manifest.id]
    if (Object.keys(plugin.manifest.permissions).length > 0
      && !hasReviewedCurrentManifest(plugin, workspaceState)) {
      setPermissionEnablement(enablement)
      setPermissionPlugin(plugin)
      return
    }
    void changeEnablement(plugin, enablement).catch(() => undefined)
  }

  function handleToggle(plugin: InstalledPlugin, enabled: boolean) {
    requestEnablement(
      plugin,
      enabled
        ? isRequestedInAllWorkspaces(plugin.manifest.id) ? 'all-workspaces' : 'workspace'
        : 'disabled',
    )
  }

  async function handleClearFailure(pluginId: string) {
    setClearingFailureId(pluginId)
    setError(null)
    try {
      await clearFailure(pluginId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setClearingFailureId(null)
    }
  }

  async function handleRefresh() {
    setError(null)
    try {
      await refreshInstalled()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PluginListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={t('installed.searchPlaceholder')}
        searchLabel={t('installed.searchLabel')}
        refreshing={operationPluginId === '@installed-refresh'}
        disabled={Boolean(operationPluginId)}
        onRefresh={() => void handleRefresh()}
      />

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t('installed.operationFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {filteredPlugins.length > 0 ? (
        <ItemGroup>
          {filteredPlugins.map((plugin) => {
            const pluginState = currentStates[plugin.manifest.id]
            const requestedEnabled = pluginState?.enablement === 'workspace' || pluginState?.enablement === 'all-workspaces'
            const enabled = isPluginEnabledInWorkspace(plugin, pluginState)
            const requestedInAllWorkspaces = isRequestedInAllWorkspaces(plugin.manifest.id)
            const needsReview = (requestedEnabled || requestedInAllWorkspaces)
              && Object.keys(plugin.manifest.permissions).length > 0
              && !hasReviewedCurrentManifest(plugin, pluginState)
            const displayedEnablement = requestedInAllWorkspaces
              ? 'all-workspaces'
              : pluginState?.enablement ?? 'disabled'
            const isExpanded = expanded.has(plugin.manifest.id)
            const changing = changingPluginId === plugin.manifest.id
            const runtimeState = runtimeStates[plugin.manifest.id] ?? 'inactive'
            const revoked = getPluginRevocation(plugin, catalog)
            const failure = failures[plugin.manifest.id]
            const pluginText = getInstalledPluginText(plugin, locale, catalogById.get(plugin.manifest.id))
            const detailsId = `plugin-details-${plugin.manifest.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
            return (
              <Collapsible key={plugin.manifest.id} open={isExpanded} onOpenChange={(open) => setExpanded(current => {
                const next = new Set(current)
                if (open) next.add(plugin.manifest.id)
                else next.delete(plugin.manifest.id)
                return next
              })} asChild>
                <Item role="listitem" variant="outline" className="items-start">
                  <ItemMedia variant="icon">
                    {plugin.source === 'development' ? <Code2 /> : <Box />}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full flex-wrap">
                      <span className="truncate">{pluginText.name}</span>
                      <Badge variant="outline">
                        {t(`sources.${plugin.source}`)}
                      </Badge>
                      {plugin.verified ? <Badge variant="outline"><ShieldCheck />{t('labels.verified')}</Badge> : null}
                      {failure ? <Badge variant="destructive">{t('labels.attention')}</Badge> : null}
                      {needsReview ? <Badge variant="destructive">{t('installed.permissionReviewRequired')}</Badge> : null}
                    </ItemTitle>
                    {revoked !== undefined ? <p className="text-sm text-destructive">{t('installed.revoked', { reason: revoked })}</p> : null}
                    <ItemDescription>
                      {pluginText.description || t('installed.noDescription')}
                    </ItemDescription>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{plugin.manifest.author?.name ?? t('details.unknown')}</span><span aria-hidden>·</span>
                      {developerMode ? <><code>{plugin.manifest.id}</code><span aria-hidden>·</span></> : null}
                      <span>v{plugin.activeVersion}</span>
                      <span aria-hidden>·</span>
                      <span>{t(`runtime.${runtimeState}`)}</span>
                      {requestedInAllWorkspaces ? (
                        <><span aria-hidden>·</span><span>{t('installed.allWorkspaces')}</span></>
                      ) : null}
                    </div>
                  </ItemContent>
                  <ItemActions className="flex-wrap self-center">
                    {needsReview ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPermissionEnablement(
                            requestedInAllWorkspaces
                              ? 'all-workspaces'
                              : pluginState?.enablement === 'disabled'
                                ? 'workspace'
                                : pluginState?.enablement ?? 'workspace',
                          )
                          setPermissionPlugin(plugin)
                        }}
                      >
                        <ShieldCheck data-icon="inline-start" />
                        {t('installed.reviewPermissions')}
                      </Button>
                    ) : null}
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        {t('settings.title')}
                        <ChevronDown data-icon="inline-end" className={isExpanded ? 'rotate-180' : undefined} />
                      </Button>
                    </CollapsibleTrigger>
                    <div className="flex items-center gap-2">
                      {changing ? <Spinner /> : null}
                      <Switch
                        checked={enabled && revoked === undefined}
                        disabled={revoked !== undefined || changing || Boolean(operationPluginId)}
                        aria-label={enabled
                          ? t('installed.disableAria', { name: pluginText.name })
                          : t('installed.enableAria', { name: pluginText.name })}
                        onCheckedChange={(checked) => handleToggle(plugin, checked)}
                      />
                    </div>
                  </ItemActions>

                  <CollapsibleContent className="basis-full min-w-0">
                    <Separator className="mb-4" />
                    <div className="flex flex-col gap-4">
                      {failure ? (
                        <Alert variant="destructive">
                          <CircleAlert />
                          <AlertTitle>{t('installed.failureTitle', { code: failure.code })}</AlertTitle>
                          <AlertDescription className="flex flex-col gap-2">
                            <span>{failure.message}</span>
                            <span>{t('installed.failureCount', { count: failure.count })}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="self-start"
                              disabled={Boolean(clearingFailureId)}
                              onClick={() => void handleClearFailure(plugin.manifest.id)}
                            >
                              {clearingFailureId === plugin.manifest.id ? <Spinner data-icon="inline-start" /> : null}
                              {t('actions.clearFailure')}
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <Field orientation="responsive">
                        <FieldContent>
                          <FieldLabel htmlFor={`${detailsId}-enablement`}>{t('installed.enablementLabel')}</FieldLabel>
                          <FieldDescription>{t('installed.enablementDesc')}</FieldDescription>
                        </FieldContent>
                        <Select
                          value={displayedEnablement}
                          disabled={revoked !== undefined || changing || Boolean(operationPluginId)}
                          onValueChange={(value) => requestEnablement(plugin, value as PluginEnablement)}
                        >
                          <SelectTrigger id={`${detailsId}-enablement`} className="min-w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="disabled">{t('installed.enablement.disabled')}</SelectItem>
                              <SelectItem value="workspace">{t('installed.enablement.workspace')}</SelectItem>
                              <SelectItem value="all-workspaces">{t('installed.enablement.allWorkspaces')}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>

                      <PluginDisplaySettings key={getPluginManifestFingerprint(plugin)} plugin={plugin} />

                      <PluginUsage plugin={plugin} />

                      <Accordion type="multiple" defaultValue={['settings']}>
                        <AccordionItem value="settings">
                          <AccordionTrigger>{t('settings.title')}</AccordionTrigger>
                          <AccordionContent className="pt-2 pb-4">
                            {(plugin.manifest.contributes.settings?.length ?? 0) > 0 ? (
                              <div className="flex flex-col gap-3">
                                <p className="text-sm text-muted-foreground">{t('settings.desc')}</p>
                                <FieldGroup>
                                  {plugin.manifest.contributes.settings?.map((setting) => (
                                    <PluginSettingField
                                      key={`${currentWorkspaceId}:${getPluginManifestFingerprint(plugin)}:${setting.key}`}
                                      plugin={plugin}
                                      setting={setting}
                                    />
                                  ))}
                                </FieldGroup>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">{t('settings.none')}</p>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="permissions">
                          <AccordionTrigger>
                            <span className="flex items-center gap-2">{t('tabs.permissions')}<Badge variant="secondary">{Object.keys(plugin.manifest.permissions).length}</Badge></span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2 pb-4"><PermissionsTab pluginId={plugin.manifest.id} /></AccordionContent>
                        </AccordionItem>
                        {developerMode ? <AccordionItem value="technical">
                          <AccordionTrigger>{t('ux.technicalDetails')}</AccordionTrigger>
                          <AccordionContent className="pt-2 pb-4">
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                              <dt className="text-muted-foreground">{t('details.author')}</dt>
                              <dd>{plugin.manifest.author?.name ?? t('details.unknown')}</dd>
                              <dt className="text-muted-foreground">{t('details.apiVersion')}</dt>
                              <dd><code>{plugin.manifest.apiVersion}</code></dd>
                              <dt className="text-muted-foreground">{t('details.minAppVersion')}</dt>
                              <dd><code>{plugin.manifest.minAppVersion}</code></dd>
                              <dt className="text-muted-foreground">{t('details.platforms')}</dt>
                              <dd>{plugin.manifest.platforms.join(', ')}</dd>
                              <dt className="text-muted-foreground">{t('details.contentHash')}</dt>
                              <dd className="truncate" title={plugin.contentHash}><code>{plugin.contentHash}</code></dd>
                            </dl>
                          </AccordionContent>
                        </AccordionItem> : null}
                      </Accordion>
                      <Separator />
                      <section className="flex flex-col gap-3" aria-labelledby={`${detailsId}-versions`}>
                        <h4 id={`${detailsId}-versions`} className="font-medium">{t('tabs.updates')} / {t('actions.uninstall')}</h4>
                        <UpdatesTab pluginId={plugin.manifest.id} />
                      </section>
                    </div>
                  </CollapsibleContent>
                </Item>
              </Collapsible>
            )
          })}
        </ItemGroup>
      ) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Search /></EmptyMedia>
            <EmptyTitle>{query ? t('installed.noResults') : t('installed.empty')}</EmptyTitle>
            <EmptyDescription>{query ? t('installed.noResultsDesc') : t('installed.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <PermissionConfirmDialog
        plugin={permissionPlugin}
        open={Boolean(permissionPlugin)}
        onOpenChange={(open) => !open && setPermissionPlugin(null)}
        onConfirmed={(plugin) => changeEnablement(plugin, permissionEnablement)}
      />
    </div>
  )
}
