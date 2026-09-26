'use client'

import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, remove } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { openDeveloperTools, supportsNativeDeveloperTools } from '@/lib/developer-tools'
import useSettingStore from '@/stores/setting'
import { ConfigFileActions } from './config-file-actions'
import { AlertTriangle, Code2, Database, FolderX, Gauge, MonitorCog, Network } from 'lucide-react'
import { SettingSection } from '../components/setting-base'
import { DeveloperDiagnostics } from './developer-diagnostics'
import { SystemPermissions } from './system-permissions'
import { AppLockSettings } from './app-lock-settings'

export function AdvancedSettings({ showConfigFileActions = true }: { showConfigFileActions?: boolean }) {
  const t = useTranslations('settings.dev')
  const [proxy, setProxy] = useState('')
  const [pendingAction, setPendingAction] = useState<'data' | 'files' | null>(null)
  const developerMode = useSettingStore(state => state.developerMode)
  const setDeveloperMode = useSettingStore(state => state.setDeveloperMode)
  const developerPerformanceInfo = useSettingStore(state => state.developerPerformanceInfo)
  const setDeveloperPerformanceInfo = useSettingStore(state => state.setDeveloperPerformanceInfo)
  const desktop = supportsNativeDeveloperTools()
  const { toast } = useToast()

  async function handleOpenDeveloperTools() {
    try {
      await openDeveloperTools()
    } catch (error) {
      toast({
        title: t('openDeveloperToolsFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function handleClearData() {
    setPendingAction('data')
    try {
      const store = await Store.load('store.json')
      await store.clear()
      await remove('store.json', { baseDir: BaseDirectory.AppData })
      await remove('note.db', { baseDir: BaseDirectory.AppData })
      await message(t('dataClearedRestartDesc'), {
        title: t('dataClearedRestartTitle'),
        kind: 'info',
      })
      await getCurrentWindow().close()
    } finally {
      setPendingAction(null)
    }
  }

  async function handleClearFile() {
    setPendingAction('files')
    try {
      const folders = ['screenshot', 'article', 'clipboard', 'image']
      for (const folder of folders) {
        if (await exists(folder, { baseDir: BaseDirectory.AppData })) {
          await remove(folder, { baseDir: BaseDirectory.AppData, recursive: true })
        }
      }
      toast({ title: t('filesCleared') })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleProxyBlur() {
    const store = await Store.load('store.json')
    await store.set('proxy', proxy.trim())
    await store.save()
  }

  useEffect(() => {
    async function loadProxy() {
      const store = await Store.load('store.json')
      const storedProxy = await store.get<string>('proxy')
      if (storedProxy) setProxy(storedProxy)
    }

    void loadProxy()
  }, [])

  return (
    <>
      <SettingSection title={t('title')} desc={t('desc')}>
        <ItemGroup className="gap-3">
          <Item variant="outline">
            <ItemMedia variant="icon"><Network /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('proxyTitle')}</ItemTitle>
              <ItemDescription>{t('proxy')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <Input
                className="w-full sm:w-[280px]"
                placeholder={t('proxyPlaceholder')}
                value={proxy}
                onChange={(event) => setProxy(event.target.value)}
                onBlur={() => void handleProxyBlur()}
              />
            </ItemActions>
          </Item>
          {showConfigFileActions ? <ConfigFileActions /> : null}
        </ItemGroup>
      </SettingSection>

      <SystemPermissions />
      <AppLockSettings />

      <SettingSection title={t('developerTitle')} desc={t('developerDesc')}>
        <ItemGroup className="gap-3">
          <Item variant="warning">
            <ItemMedia variant="icon"><Code2 /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('developerModeTitle')}</ItemTitle>
              <ItemDescription>{t('developerModeDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <Switch
                checked={developerMode}
                onCheckedChange={setDeveloperMode}
                aria-label={t('developerModeTitle')}
              />
            </ItemActions>
          </Item>

          {developerMode ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2">
              {desktop ? (
                <Item variant="outline" size="sm">
                  <ItemMedia variant="icon"><MonitorCog /></ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('developerToolsTitle')}</ItemTitle>
                    <ItemDescription>{t('developerToolsDesc')}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto">
                    <Button variant="outline" size="sm" onClick={() => void handleOpenDeveloperTools()}>
                      {t('openDeveloperTools')}
                    </Button>
                  </ItemActions>
                </Item>
              ) : null}

              <Item variant="outline" size="sm">
                <ItemMedia variant="icon"><Gauge /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('performanceInfoTitle')}</ItemTitle>
                  <ItemDescription>{t('performanceInfoDesc')}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <Switch
                    checked={developerPerformanceInfo}
                    onCheckedChange={setDeveloperPerformanceInfo}
                    aria-label={t('performanceInfoTitle')}
                  />
                </ItemActions>
              </Item>

              <DeveloperDiagnostics />
            </div>
          ) : null}
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('dangerZoneTitle')} desc={t('dangerZoneDesc')}>
        <ItemGroup className="gap-3">
          <Item variant="outline">
            <ItemMedia variant="icon"><Database /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('clearDataTitle')}</ItemTitle>
              <ItemDescription>{t('clearDataDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={pendingAction !== null}>
                    {t('clearButton')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia><AlertTriangle /></AlertDialogMedia>
                    <AlertDialogTitle>{t('clearDataTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('clearDataConfirm')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancelButton')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void handleClearData()}>
                      {t('confirmClearButton')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon"><FolderX /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('clearFileTitle')}</ItemTitle>
              <ItemDescription>{t('clearFileDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={pendingAction !== null}>
                    {t('clearButton')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia><AlertTriangle /></AlertDialogMedia>
                    <AlertDialogTitle>{t('clearFileTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('clearFilesConfirm')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancelButton')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void handleClearFile()}>
                      {t('confirmClearButton')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>
    </>
  )
}
