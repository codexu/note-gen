'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { lstat, readDir } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import { FolderOpen, HardDrive } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import { ToggleGroup } from '@/components/ui/toggle-group'
import useSettingStore from '@/stores/setting'
import { ensureWorkspaceDirectory } from '@/lib/managed-workspace'
import { isAbsoluteFsPath } from '@/lib/workspace'
import { releaseUnusedIOSFolderAccess, switchWorkspaceDirectory } from '@/lib/switch-workspace'
import { pickIOSSyncFolder, type IOSFolderAccess } from '@/lib/sync/cloud-folder'
import { SetupStepActions, type SetupStepProps } from './setup-step-actions'
import { SetupOption } from './setup-option'

export function SetupWorkspaceStep({ onNext, onBack }: SetupStepProps) {
  const t = useTranslations('initialSetup')
  const currentPath = useSettingStore(state => state.workspacePath)
  const [choice, setChoice] = useState(currentPath ? 'custom' : 'default')
  const [customPath, setCustomPath] = useState(currentPath)
  const [defaultPath, setDefaultPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const selection = useRef<IOSFolderAccess | undefined>(undefined)
  const operationPending = useRef(false)
  const controller = useRef<AbortController | null>(null)

  const describeError = (cause: unknown) => cause instanceof Error && !cause.message.startsWith('WORKSPACE_')
    ? cause.message
    : t('workspace.failed')

  useEffect(() => {
    mounted.current = true
    controller.current = new AbortController()
    void appDataDir().then(root => join(root, 'article')).then(path => {
      if (mounted.current) setDefaultPath(path)
    }).catch(() => undefined)
    return () => {
      mounted.current = false
      controller.current?.abort()
      const unusedAccess = selection.current
      selection.current = undefined
      void releaseUnusedIOSFolderAccess(unusedAccess)
    }
  }, [])

  async function selectFolder() {
    if (operationPending.current) return
    operationPending.current = true
    setError('')
    setBusy(true)
    let unusedAccess: IOSFolderAccess | undefined
    try {
      const access = platform() === 'ios' ? await pickIOSSyncFolder() : null
      unusedAccess = access ?? undefined
      const path = platform() === 'ios' ? access?.path : await open({ directory: true, multiple: false, title: t('workspace.chooseFolder') })
      if (!mounted.current) return
      if (typeof path !== 'string') return
      if (!isAbsoluteFsPath(path) || path.startsWith('content://')) {
        setError(t('workspace.unsupportedDirectory'))
        return
      }
      const metadata = await lstat(path)
      if (!metadata.isDirectory || metadata.isSymlink) throw new Error(t('workspace.invalidDirectory'))
      await readDir(path)
      if (!mounted.current) return
      const previousSelection = selection.current
      selection.current = access ?? undefined
      unusedAccess = undefined
      setCustomPath(path)
      setChoice('custom')
      await releaseUnusedIOSFolderAccess(previousSelection, path)
    } catch (cause) {
      if (mounted.current) setError(describeError(cause))
    } finally {
      await releaseUnusedIOSFolderAccess(unusedAccess, selection.current?.path)
      operationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function continueSetup() {
    if (operationPending.current) return
    if (choice === 'custom' && !customPath) return
    operationPending.current = true
    setBusy(true)
    setError('')
    let submittedAccess: IOSFolderAccess | undefined
    try {
      const path = choice === 'default' ? '' : customPath
      if (!path) await ensureWorkspaceDirectory(defaultPath || await join(await appDataDir(), 'article'))
      if (!mounted.current) return
      if (path) {
        // The transaction owns this authorization until it finishes; closing
        // the wizard must not revoke access while files are being reopened.
        submittedAccess = selection.current
        selection.current = undefined
      }
      await switchWorkspaceDirectory(path, submittedAccess, { signal: controller.current?.signal })
      if (mounted.current && !controller.current?.signal.aborted) onNext()
    } catch (cause) {
      if (mounted.current) {
        selection.current = submittedAccess ?? selection.current
        if (!controller.current?.signal.aborted) setError(describeError(cause))
      }
    } finally {
      operationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="app-panel-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 py-2">
        <ToggleGroup type="single" value={choice} onValueChange={value => { if (value) setChoice(value) }}
          disabled={busy} className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2" aria-label={t('steps.workspace')}>
          <SetupOption value="default" icon={HardDrive} label={t('workspace.default')} hint={t('workspace.defaultDescription')} selected={choice === 'default'} />
          <SetupOption value="custom" icon={FolderOpen} label={t('workspace.custom')} hint={t('workspace.customDescription')} selected={choice === 'custom'} />
        </ToggleGroup>
        <Item variant="muted">
          <ItemContent className="min-w-0">
            <ItemTitle>{t('workspace.location')}</ItemTitle>
            <p className="text-xs leading-relaxed break-all text-muted-foreground" dir="auto">
              {choice === 'default' ? defaultPath || t('welcome.defaultFolder') : customPath || t('workspace.notSelected')}
            </p>
          </ItemContent>
          {choice === 'custom' && <ItemActions>
            <Button type="button" variant="outline" className="h-10" disabled={busy} onClick={() => void selectFolder()}>
              <FolderOpen data-icon="inline-start" />{t(customPath ? 'workspace.changeFolder' : 'workspace.browse')}
            </Button>
          </ItemActions>}
        </Item>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
      <SetupStepActions onBack={onBack} onNext={() => void continueSetup()} nextLabel={t('workspace.apply')}
        busy={busy} disableNext={choice === 'custom' && !customPath} />
    </div>
  )
}
