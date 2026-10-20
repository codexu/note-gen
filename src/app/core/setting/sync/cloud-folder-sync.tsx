'use client'

import { useEffect, useState } from 'react'
import { confirm, open as openDialog } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { ArrowRightLeft, FolderInput, FolderOpen, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { migrateWorkspaceToCloudFolder, testCloudFolderConnection } from '@/lib/sync/cloud-folder'
import useSyncStore from '@/stores/sync'
import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import { useSkillsStore } from '@/stores/skills'
import type { CloudFolderConfig } from '@/types/sync'
import { toast } from '@/hooks/use-toast'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'

export function CloudFolderSync() {
  const t = useTranslations('settings.sync.cloudFolder')
  const setCloudFolderConnected = useSyncStore(state => state.setCloudFolderConnected)
  const { workspacePath, setWorkspacePath } = useSettingStore()
  const {
    loadWorkspaceCollapsibleList,
    loadFileTree,
    setActiveFilePath,
  } = useArticleStore()
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [config, setConfig] = useState<CloudFolderConfig>({ path: '' })
  const [initialized, setInitialized] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const normalizedCloudPath = config.path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedWorkspacePath = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const workspaceIsCovered = Boolean(
    normalizedCloudPath
    && normalizedWorkspacePath
    && (normalizedWorkspacePath === normalizedCloudPath
      || normalizedWorkspacePath.startsWith(`${normalizedCloudPath}/`))
  )

  useEffect(() => {
    let cancelled = false
    async function initialize() {
      const store = await Store.load('store.json')
      const saved = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (cancelled) return
      if (saved) setConfig(saved)
      setInitialized(true)
      if (saved?.path) void testConnection(saved)
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  async function saveConfig(next: CloudFolderConfig) {
    setConfig(next)
    const store = await Store.load('store.json')
    await store.set('cloudFolderSyncConfig', next)
    await store.save()
  }

  async function testConnection(target = config) {
    if (!target.path) return
    try {
      setCloudFolderConnected(await testCloudFolderConnection(target))
    } catch (error) {
      console.error('Cloud folder connection test failed:', error)
      setCloudFolderConnected(false)
    }
  }

  async function chooseFolder() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('dialogTitle'),
    })
    if (typeof selected !== 'string') return
    const next = { path: selected }
    setCloudFolderConnected(false)
    await saveConfig(next)
    await testConnection(next)
  }

  async function clearFolder() {
    setCloudFolderConnected(false)
    await saveConfig({ path: '' })
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
    if (!config.path || migrating || switchingWorkspace) return
    const accepted = await confirm(t('migrationConfirm'), {
      title: t('migrationConfirmTitle'),
      kind: 'warning',
    })
    if (!accepted) return
    if (!await prepareWorkspaceSwitch()) return

    const previousWorkspacePath = workspacePath
    setMigrating(true)
    try {
      const result = await migrateWorkspaceToCloudFolder(config, workspacePath || undefined)
      try {
        await setWorkspacePath(result.targetPath)
        await refreshWorkspaceContent()
      } catch (error) {
        if (!await prepareWorkspaceSwitch()) {
          throw new Error('无法在回滚工作区前保存当前编辑内容')
        }
        await setWorkspacePath(previousWorkspacePath)
        await refreshWorkspaceContent()
        throw error
      }
      toast({
        title: t('migrationSuccess'),
        description: t('migrationSuccessDescription', { count: result.copiedFiles }),
      })
    } catch (error) {
      console.error('Cloud workspace migration failed:', error)
      toast({
        title: t('migrationFailed'),
        description: error instanceof Error ? error.message : t('migrationFailedDescription'),
        variant: 'destructive',
      })
    } finally {
      setMigrating(false)
    }
  }

  async function switchToCloudWorkspace() {
    if (!config.path || migrating || switchingWorkspace) return
    if (!await prepareWorkspaceSwitch()) return

    const previousWorkspacePath = workspacePath
    setSwitchingWorkspace(true)
    try {
      await setWorkspacePath(config.path)
      await refreshWorkspaceContent()
    } catch (error) {
      console.error('Cloud workspace switch failed:', error)
      try {
        if (!await prepareWorkspaceSwitch()) {
          throw new Error('无法在回滚工作区前保存当前编辑内容')
        }
        await setWorkspacePath(previousWorkspacePath)
        await refreshWorkspaceContent()
      } catch (rollbackError) {
        console.error('Cloud workspace rollback failed:', rollbackError)
      }
      toast({
        title: t('switchWorkspaceFailed'),
        variant: 'destructive',
      })
    } finally {
      setSwitchingWorkspace(false)
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
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <InputGroup className="min-w-0 flex-1">
                <InputGroupInput
                  readOnly
                  value={config.path}
                  placeholder={t('empty')}
                  title={config.path || t('empty')}
                />
                {config.path ? (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t('clear')}
                      title={t('clear')}
                      onClick={() => void clearFolder()}
                    >
                      <Trash2 />
                    </InputGroupButton>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              <Button onClick={() => void chooseFolder()}>
                <FolderOpen data-icon="inline-start" />
                {t('choose')}
              </Button>
            </div>
            <FieldDescription>{t('folderDescription')}</FieldDescription>
          </Field>
          {config.path && !workspaceIsCovered ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{t('workspaceWarningTitle')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{t('workspaceWarningDescription')}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={migrating || switchingWorkspace}
                    onClick={() => void switchToCloudWorkspace()}
                  >
                    {switchingWorkspace ? (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <FolderInput data-icon="inline-start" />
                    )}
                    {switchingWorkspace ? t('switchingWorkspace') : t('switchWorkspace')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={migrating || switchingWorkspace}
                    onClick={() => void migrateWorkspace()}
                  >
                    {migrating ? (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <ArrowRightLeft data-icon="inline-start" />
                    )}
                    {migrating ? t('migrating') : t('migrateWorkspace')}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
