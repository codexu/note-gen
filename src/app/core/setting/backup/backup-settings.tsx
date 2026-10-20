'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { message, open as openDialog } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import {
  ArchiveRestore,
  CheckCircle2,
  CloudUpload,
  FolderOpen,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  createManagedBackup,
  listManagedBackups,
  loadManagedBackupSettings,
  restoreManagedBackup,
  saveManagedBackupSettings,
  type ManagedBackupInfo,
  type ManagedBackupSchedule,
  type ManagedBackupSettings,
} from '@/lib/backup/managed-backup'

const DEFAULT_SETTINGS: ManagedBackupSettings = {
  directory: '',
  schedule: 'disabled',
  retention: 10,
  lastSuccessAt: null,
  lastError: null,
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function BackupSettings() {
  const t = useTranslations('settings.backup')
  const [settings, setSettings] = useState<ManagedBackupSettings>(DEFAULT_SETTINGS)
  const [backups, setBackups] = useState<ManagedBackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }), [])

  const refreshBackups = useCallback(async (directory: string) => {
    if (!directory) {
      setBackups([])
      return
    }
    try {
      setBackups(await listManagedBackups(directory))
    } catch (error) {
      toast.error(t('listError'), { description: String(error) })
    }
  }, [t])

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      const loaded = await loadManagedBackupSettings()
      if (cancelled) return
      setSettings(loaded)
      await refreshBackups(loaded.directory)
      if (!cancelled) setLoading(false)
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [refreshBackups])

  async function persist(next: ManagedBackupSettings) {
    setSettings(next)
    await saveManagedBackupSettings(next)
  }

  async function chooseDirectory() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('directory.dialogTitle'),
    })
    if (typeof selected !== 'string') return
    const next = { ...settings, directory: selected }
    await persist(next)
    await refreshBackups(selected)
  }

  async function clearDirectory() {
    const next = {
      ...settings,
      directory: '',
      schedule: 'disabled' as const,
      lastSuccessAt: null,
      lastError: null,
    }
    await persist(next)
    setBackups([])
  }

  async function createBackup() {
    setCreating(true)
    try {
      const backup = await createManagedBackup('manual', settings)
      const next = { ...settings, lastSuccessAt: backup.createdAt, lastError: null }
      setSettings(next)
      await refreshBackups(settings.directory)
      toast.success(t('createSuccess'))
    } catch (error) {
      const description = String(error)
      setSettings(current => ({ ...current, lastError: description }))
      toast.error(t('createError'), { description })
    } finally {
      setCreating(false)
    }
  }

  async function chooseBackupToRestore() {
    if (!settings.directory) {
      toast.error(t('directory.required'))
      return
    }
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: t('restore.chooseTitle'),
      filters: [{ name: 'NoteGen Backup', extensions: ['ngbackup'] }],
    })
    if (typeof selected === 'string') setRestoreTarget(selected)
  }

  async function confirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await createManagedBackup('pre-restore', settings)
      const store = await Store.load('store.json')
      const currentWorkspacePath = (await store.get<string>('workspacePath')) ?? ''
      const { db } = await import('@/db')
      await db.close()
      try {
        await restoreManagedBackup(restoreTarget, currentWorkspacePath)
      } catch (error) {
        await message(t('restore.failedDescription', { error: String(error) }), {
          title: t('restore.failedTitle'),
          kind: 'error',
        })
      }
      await relaunch()
    } catch (error) {
      toast.error(t('restore.safetyBackupError'), { description: String(error) })
      setRestoring(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('directory.title')}</CardTitle>
          <CardDescription>{t('directory.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <span className="block truncate">{settings.directory || t('directory.empty')}</span>
            </div>
            <Button variant="outline" onClick={() => void chooseDirectory()}>
              <FolderOpen />
              {t('directory.choose')}
            </Button>
            {settings.directory ? (
              <>
                <Button variant="ghost" onClick={() => void openPath(settings.directory)}>
                  {t('directory.open')}
                </Button>
                <Button variant="ghost" onClick={() => void clearDirectory()}>
                  {t('directory.clear')}
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('automation.title')}</CardTitle>
          <CardDescription>{t('automation.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel>{t('automation.schedule')}</FieldLabel>
                <FieldDescription>{t('automation.scheduleDescription')}</FieldDescription>
              </FieldContent>
              <Select
                value={settings.schedule}
                onValueChange={(value) => void persist({ ...settings, schedule: value as ManagedBackupSchedule })}
              >
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">{t('automation.disabled')}</SelectItem>
                  <SelectItem value="daily">{t('automation.daily')}</SelectItem>
                  <SelectItem value="weekly">{t('automation.weekly')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel>{t('automation.retention')}</FieldLabel>
                <FieldDescription>{t('automation.retentionDescription')}</FieldDescription>
              </FieldContent>
              <Select
                value={String(settings.retention)}
                onValueChange={(value) => void persist({ ...settings, retention: Number(value) })}
              >
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[3, 5, 10, 20, 50].map(value => (
                    <SelectItem key={value} value={String(value)}>{t('automation.copies', { count: value })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('manual.title')}</CardTitle>
          <CardDescription>
            {settings.lastSuccessAt
              ? t('manual.lastSuccess', { time: dateFormatter.format(settings.lastSuccessAt) })
              : t('manual.never')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled={!settings.directory || creating} onClick={() => void createBackup()}>
            {creating ? <Loader2 className="animate-spin" /> : <CloudUpload />}
            {creating ? t('manual.creating') : t('manual.create')}
          </Button>
          <Button variant="outline" disabled={!settings.directory} onClick={() => void chooseBackupToRestore()}>
            <ArchiveRestore />
            {t('restore.import')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('history.title')}</CardTitle>
          <CardDescription>{t('history.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {backups.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {settings.directory ? t('history.empty') : t('directory.required')}
            </div>
          ) : backups.map(backup => (
            <Item key={backup.path} variant="outline" className="items-center">
              <ItemMedia variant="icon">
                {backup.valid ? <CheckCircle2 className="text-emerald-600" /> : <ShieldAlert className="text-destructive" />}
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="truncate">{backup.name}</ItemTitle>
                <ItemDescription>
                  {backup.valid
                    ? `${dateFormatter.format(backup.createdAt)} · ${formatBytes(backup.size)}`
                    : backup.error || t('history.invalid')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {backup.workspaceIncluded ? <Badge variant="secondary">{t('history.workspace')}</Badge> : null}
                <Button size="sm" variant="outline" disabled={!backup.valid || restoring} onClick={() => setRestoreTarget(backup.path)}>
                  {t('restore.action')}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => !open && !restoring && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('restore.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('restore.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>{t('restore.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={restoring} onClick={(event) => { event.preventDefault(); void confirmRestore() }}>
              {restoring ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}
              {restoring ? t('restore.restoring') : t('restore.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
