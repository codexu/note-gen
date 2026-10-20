'use client'

import { useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { ArrowRightLeft, FolderOpen, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { toast } from '@/hooks/use-toast'
import {
  getIOSWorkspaceFolderAccess,
  getICloudSyncFolder,
  migrateWorkspaceToCloudFolder,
  pickIOSSyncFolder,
  releaseIOSSyncFolder,
  restoreIOSSyncFolder,
  setIOSWorkspaceFolderAccess,
  testCloudFolderConnection,
  type IOSFolderAccess,
} from '@/lib/sync/cloud-folder'
import { disconnectOneDrive } from '@/lib/sync/onedrive'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSkillsStore } from '@/stores/skills'
import useSyncStore from '@/stores/sync'
import type { CloudFolderConfig } from '@/types/sync'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'

type ICloudFolderSyncProps = {
  onActiveProviderChange?: (provider: 'folder') => void
}

export function ICloudFolderSync({ onActiveProviderChange }: ICloudFolderSyncProps) {
  const t = useTranslations('settings.sync.iCloud')
  const { workspacePath, setWorkspacePath } = useSettingStore()
  const setCloudFolderConnected = useSyncStore(state => state.setCloudFolderConnected)
  const {
    loadWorkspaceCollapsibleList,
    loadFileTree,
    setActiveFilePath,
  } = useArticleStore()
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [config, setConfig] = useState<CloudFolderConfig>({ path: '' })
  const [initialized, setInitialized] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState('')

  const normalizedCloudPath = config.path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedWorkspacePath = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const workspaceIsCovered = Boolean(
    normalizedCloudPath
    && normalizedWorkspacePath
    && (normalizedWorkspacePath === normalizedCloudPath
      || normalizedWorkspacePath.startsWith(`${normalizedCloudPath}/`)),
  )

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        const store = await Store.load('store.json')
        const saved = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        if (!saved?.path || saved.provider === 'oneDrive') return

        let next = saved
        if (saved.bookmarkBase64) {
          const restored = await restoreIOSSyncFolder(saved.bookmarkBase64)
          next = {
            path: restored.path,
            bookmarkBase64: restored.bookmarkBase64,
            displayName: restored.displayName,
          }
        } else {
          next = { ...saved, path: await getICloudSyncFolder() }
        }
        const connected = await testCloudFolderConnection(next)
        if (cancelled) return
        setConfig(next)
        setCloudFolderConnected(connected)
        if (JSON.stringify(saved) !== JSON.stringify(next)) {
          await store.set('cloudFolderSyncConfig', next)
          await store.save()
        }
      } catch (cause) {
        if (cancelled) return
        console.error('Failed to initialize the iOS cloud folder:', cause)
        setCloudFolderConnected(false)
        setError(cause instanceof Error ? cause.message : t('accessFailedDescription'))
      } finally {
        if (!cancelled) setInitialized(true)
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [setCloudFolderConnected, t])

  async function saveConfig(next: CloudFolderConfig) {
    const store = await Store.load('store.json')
    const previous = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (previous?.provider === 'oneDrive') await disconnectOneDrive()
    await store.set('cloudFolderSyncConfig', { ...next, provider: 'folder' } satisfies CloudFolderConfig)
    await store.save()
    setConfig({ ...next, provider: 'folder' })
  }

  async function chooseFolder() {
    if (selecting) return
    setSelecting(true)
    setError('')
    let selectedAccess: IOSFolderAccess | null = null
    try {
      const selected = await pickIOSSyncFolder()
      if (!selected) return
      selectedAccess = selected
      const next: CloudFolderConfig = {
        provider: 'folder',
        path: selected.path,
        bookmarkBase64: selected.bookmarkBase64,
        displayName: selected.displayName,
      }
      const connected = await testCloudFolderConnection(next)
      if (!connected) throw new Error(t('accessFailedDescription'))
      const autoDataSyncQueue = await import('@/lib/sync/auto-data-sync-queue')
      await autoDataSyncQueue.prepareAutoDataSyncForRepositoryChange()
      try {
        await saveConfig(next)
        setCloudFolderConnected(true)
        onActiveProviderChange?.('folder')
      } finally {
        autoDataSyncQueue.finishAutoDataSyncRepositoryChange()
      }

      const normalizedSelectedPath = selected.path.replace(/\\/g, '/').replace(/\/+$/, '')
      if (
        normalizedWorkspacePath === normalizedSelectedPath
        || normalizedWorkspacePath.startsWith(`${normalizedSelectedPath}/`)
      ) {
        await setIOSWorkspaceFolderAccess(selected)
      }
    } catch (cause) {
      console.error('Failed to select the iOS cloud folder:', cause)
      if (selectedAccess?.bookmarkBase64 && selectedAccess.path !== config.path) {
        await releaseIOSSyncFolder(selectedAccess.bookmarkBase64).catch(() => undefined)
      }
      setError(cause instanceof Error ? cause.message : t('accessFailedDescription'))
    } finally {
      setSelecting(false)
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

  async function refreshWorkspaceContent() {
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

  async function migrateWorkspace() {
    if (!config.path || migrating) return
    const accepted = await confirm(t('migrationConfirm'), {
      title: t('migrationConfirmTitle'),
      kind: 'warning',
    })
    if (!accepted) return
    if (!await prepareWorkspaceSwitch()) return

    const previousWorkspacePath = workspacePath
    const previousWorkspaceAccess = await getIOSWorkspaceFolderAccess()
    const nextWorkspaceAccess: IOSFolderAccess | null = config.bookmarkBase64
      ? {
          path: config.path,
          bookmarkBase64: config.bookmarkBase64,
          displayName: config.displayName || t('folder'),
        }
      : null
    setMigrating(true)
    try {
      const result = await migrateWorkspaceToCloudFolder(config, workspacePath || undefined)
      try {
        await setIOSWorkspaceFolderAccess(nextWorkspaceAccess
          ? { ...nextWorkspaceAccess, path: result.targetPath }
          : null)
        await setWorkspacePath(result.targetPath)
        await refreshWorkspaceContent()
      } catch (cause) {
        if (!await prepareWorkspaceSwitch()) {
          throw new Error('无法在回滚工作区前保存当前编辑内容')
        }
        await setIOSWorkspaceFolderAccess(previousWorkspaceAccess)
        await setWorkspacePath(previousWorkspacePath)
        await refreshWorkspaceContent()
        throw cause
      }
      toast({
        title: t('migrationSuccess'),
        description: t('migrationSuccessDescription', { count: result.copiedFiles }),
      })
      if (
        previousWorkspaceAccess?.bookmarkBase64
        && previousWorkspaceAccess.bookmarkBase64 !== nextWorkspaceAccess?.bookmarkBase64
      ) {
        await releaseIOSSyncFolder(previousWorkspaceAccess.bookmarkBase64).catch(() => undefined)
      }
    } catch (cause) {
      console.error('Cloud folder workspace migration failed:', cause)
      toast({
        title: t('migrationFailed'),
        description: cause instanceof Error ? cause.message : t('migrationFailedDescription'),
        variant: 'destructive',
      })
    } finally {
      setMigrating(false)
    }
  }

  if (!initialized) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('folder')}</FieldLabel>
            <div className="flex min-w-0 gap-2">
              <InputGroup className="min-w-0 flex-1">
                <InputGroupInput
                  readOnly
                  value={config.displayName || config.path}
                  placeholder={t('empty')}
                  title={config.path || t('empty')}
                />
              </InputGroup>
              <Button disabled={selecting} onClick={() => void chooseFolder()}>
                {selecting ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FolderOpen data-icon="inline-start" />
                )}
                {selecting ? t('selecting') : config.path ? t('change') : t('choose')}
              </Button>
            </div>
            <FieldDescription>{t('folderDescription')}</FieldDescription>
          </Field>

          {error ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t('accessFailedTitle')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {config.path && !workspaceIsCovered ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{t('workspaceWarningTitle')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{t('workspaceWarningDescription')}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={migrating}
                  onClick={() => void migrateWorkspace()}
                >
                  {migrating ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <ArrowRightLeft data-icon="inline-start" />
                  )}
                  {migrating ? t('migrating') : t('migrateWorkspace')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
