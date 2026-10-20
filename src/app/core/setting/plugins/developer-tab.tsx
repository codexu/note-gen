'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Code2, Download, FileCode2, FolderOpen, Terminal, Trash2, TriangleAlert } from 'lucide-react'
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
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
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'
import { formatPluginDate, getInstalledPluginText } from './plugin-display'

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

export function DeveloperTab({ onImported }: { onImported?: (pluginId: string) => void }) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const developerMode = useSettingStore((state) => state.developerMode)
  const catalog = usePluginStore(state => state.catalog)
  const installed = usePluginStore((state) => state.installed)
  const logs = usePluginStore((state) => state.logs)
  const operationPluginId = usePluginStore((state) => state.operationPluginId)
  const importDevelopment = usePluginStore((state) => state.importDevelopment)
  const clearLogs = usePluginStore((state) => state.clearLogs)
  const [path, setPath] = useState('')
  const [filter, setFilter] = useState('@all')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const developmentPlugins = installed.filter((plugin) => plugin.source === 'development')
  const logPluginIds = useMemo(
    () => [...new Set(logs.map((entry) => entry.pluginId))].sort(),
    [logs],
  )
  useEffect(() => {
    if (filter !== '@all' && !logPluginIds.includes(filter)) setFilter('@all')
  }, [filter, logPluginIds])

  const filteredLogs = filter === '@all' ? logs : logs.filter((entry) => entry.pluginId === filter)
  const importing = operationPluginId === '@development-import'

  async function exportDiagnostics() {
    setError(null)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const path = await save({ defaultPath: 'notegen-plugin-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!path) return
      await writeTextFile(path, JSON.stringify({
        appVersion: useSettingStore.getState().version,
        createdAt: new Date().toISOString(),
        plugins: installed.filter(plugin => filter === '@all' || plugin.manifest.id === filter).map(plugin => ({
          id: plugin.manifest.id, version: plugin.activeVersion, source: plugin.source,
          runtime: usePluginStore.getState().runtimeStates[plugin.manifest.id] ?? 'inactive',
        })),
        logs: filteredLogs,
      }, null, 2))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  async function handleImport(sourcePath = path) {
    const normalizedPath = sourcePath.trim()
    setError(null)
    setSuccess(null)
    if (!normalizedPath) {
      setError(t('developer.pathRequired'))
      return
    }
    if (!isAbsolutePath(normalizedPath)) {
      setError(t('developer.absolutePathRequired'))
      return
    }
    try {
      const pluginId = await importDevelopment(normalizedPath)
      setSuccess(t('developer.importSuccess'))
      setPath('')
      onImported?.(pluginId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function chooseDevelopmentDirectory() {
    setError(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('developer.chooseFolder'),
      })
      if (typeof selected === 'string') setPath(selected)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (!developerMode) {
    return (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>{t('developer.disabledTitle')}</AlertTitle>
        <AlertDescription>{t('developer.disabledDesc')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium">{t('developer.importTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('ux.importHelp')}</p>
        </div>
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="plugin-development-path">{t('developer.pathLabel')}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="plugin-development-path"
                className="min-w-0 flex-1 basis-48"
                value={path}
                disabled={importing}
                aria-invalid={Boolean(error)}
                placeholder={t('developer.pathPlaceholder')}
                onChange={(event) => {
                  setPath(event.target.value)
                  setError(null)
                  setSuccess(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) void handleImport()
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={importing}
                onClick={() => void chooseDevelopmentDirectory()}
              >
                <FolderOpen data-icon="inline-start" />
                {t('developer.chooseFolder')}
              </Button>
              <Button disabled={importing || Boolean(operationPluginId && !importing)} onClick={() => void handleImport()}>
                {importing ? <Spinner data-icon="inline-start" /> : <FileCode2 data-icon="inline-start" />}
                {importing ? t('actions.importing') : t('actions.import')}
              </Button>
            </div>
            <FieldDescription>{t('developer.pathHelp')}</FieldDescription>
            <FieldError>{error}</FieldError>
          </Field>
        </FieldGroup>
        {success ? (
          <Alert>
            <Code2 />
            <AlertTitle>{success}</AlertTitle>
          </Alert>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">{t('developer.loadedTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('developer.autoReloadHelp')}</p>
        {developmentPlugins.length > 0 ? (
          <ItemGroup>
            {developmentPlugins.map((plugin) => {
              return (
                <Item role="listitem" key={plugin.manifest.id} variant="outline">
                  <ItemMedia variant="icon"><Code2 /></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{getInstalledPluginText(plugin, locale, catalog?.plugins.find(entry => entry.id === plugin.manifest.id)).name}</ItemTitle>
                    <ItemDescription className="break-all" title={plugin.developmentPath}>
                      {plugin.developmentPath ?? t('developer.pathUnavailable')}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              )
            })}
          </ItemGroup>
        ) : (
          <Empty className="min-h-36 border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Code2 /></EmptyMedia>
              <EmptyTitle>{t('developer.noDevelopmentPlugins')}</EmptyTitle>
              <EmptyDescription>{t('developer.noDevelopmentPluginsDesc')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">{t('developer.logsTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('developer.logsDesc')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="max-w-64" aria-label={t('developer.logFilterLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="@all">{t('developer.allLogs')}</SelectItem>
                  {logPluginIds.map((pluginId) => <SelectItem key={pluginId} value={pluginId}>{pluginId}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button variant="outline" size="default" onClick={() => void exportDiagnostics()}>
              <Download data-icon="inline-start" />{t('actions.exportDiagnostics')}
            </Button>
            <Button
              variant="outline"
              size="default"
              disabled={filteredLogs.length === 0}
              onClick={() => clearLogs(filter === '@all' ? undefined : filter)}
            >
              <Trash2 data-icon="inline-start" />{t('actions.clearLogs')}
            </Button>
          </div>
        </div>

        {filteredLogs.length > 0 ? (
          <div className="max-h-80 overflow-y-auto rounded-lg border" role="log" aria-label={t('developer.logsTitle')}>
            {filteredLogs.map((entry) => (
              <div key={entry.id} className="grid gap-1 border-b p-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={entry.level === 'error' ? 'destructive' : entry.level === 'warning' ? 'outline' : 'secondary'}>
                    {t(`developer.logLevels.${entry.level}`)}
                  </Badge>
                  <code>{entry.pluginId}</code>
                  {entry.code ? <code className="text-muted-foreground">{entry.code}</code> : null}
                  <time className="ml-auto text-muted-foreground" dateTime={entry.createdAt}>
                    {formatPluginDate(entry.createdAt, locale)}
                  </time>
                </div>
                <p className="break-words text-sm">{entry.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="min-h-36 border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Terminal /></EmptyMedia>
              <EmptyTitle>{t('developer.noLogs')}</EmptyTitle>
              <EmptyDescription>{t('developer.noLogsDesc')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}
