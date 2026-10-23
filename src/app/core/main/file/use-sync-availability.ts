'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SyncStateEnum } from '@/lib/sync/github.types'
import { checkSyncProviderStatus } from '@/lib/sync/provider-status'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSyncStore from '@/stores/sync'
import type { SyncPlatform } from '@/types/sync'
import { useShallow } from 'zustand/react/shallow'

import { getSyncConfiguration, type SyncConfigurationReason } from './file-tree-action-policy'

export type SyncAvailabilityStatus = 'not-configured' | 'checking' | 'available' | 'unavailable'

export function useSyncAvailability() {
  const settingsStatus = useSettingsHydrationStore(state => state.status)
  const credentials = useSettingStore(useShallow(state => ({
    primaryBackupMethod: state.primaryBackupMethod,
    accessToken: state.accessToken,
    githubUsername: state.githubUsername,
    giteeAccessToken: state.giteeAccessToken,
    gitlabAccessToken: state.gitlabAccessToken,
    gitlabUsername: state.gitlabUsername,
    giteaAccessToken: state.giteaAccessToken,
    giteaUsername: state.giteaUsername,
    workspacePath: state.workspacePath,
    githubCustomSyncRepo: state.githubCustomSyncRepo,
    giteeCustomSyncRepo: state.giteeCustomSyncRepo,
    gitlabCustomSyncRepo: state.gitlabCustomSyncRepo,
    giteaCustomSyncRepo: state.giteaCustomSyncRepo,
  })))
  const settingsOpen = useSettingsDialogStore(state => state.open)
  const providerCheck = useSyncStore(state => state.providerChecks[credentials.primaryBackupMethod])
  const context = useMemo(() => ({ credentials, settingsOpen, providerCheck }), [credentials, settingsOpen, providerCheck])
  const contextRef = useRef(context)
  contextRef.current = context
  const providerStates = useSyncStore(useShallow(state => ({
    github: state.syncRepoState,
    gitee: state.giteeSyncRepoState,
    gitlab: state.gitlabSyncProjectState,
    gitea: state.giteaSyncRepoState,
    s3: state.s3Connected,
    webdav: state.webdavConnected,
    cloudFolder: state.cloudFolderConnected,
    selfHosted: state.selfHostedConnected,
  })))
  const [state, setState] = useState<{
    configured: boolean
    platform: SyncPlatform
    reason?: SyncConfigurationReason
    context: typeof context | null
    failed?: boolean
  }>({
    configured: false,
    platform: credentials.primaryBackupMethod,
    context: null,
  })
  const [configurationChecking, setConfigurationChecking] = useState(true)
  const [configurationRevision, setConfigurationRevision] = useState(0)
  const configurationRequestRef = useRef(0)

  const refresh = useCallback(async (checkConnection = true) => {
    if (useSettingsHydrationStore.getState().status !== 'ready') {
      return { configured: false, platform: useSettingStore.getState().primaryBackupMethod }
    }
    const requestContext = contextRef.current
    const requestId = ++configurationRequestRef.current
    setConfigurationChecking(true)
    try {
      const next = await getSyncConfiguration()
      if (checkConnection && next.configured && (next.platform === 's3' || next.platform === 'webdav' || next.platform === 'cloudFolder')) {
        await checkSyncProviderStatus(next.platform)
      }
      if (configurationRequestRef.current === requestId && contextRef.current === requestContext) {
        setState({ ...next, context: requestContext })
      }
      return next
    } catch (error) {
      if (configurationRequestRef.current === requestId && contextRef.current === requestContext) {
        setState({ configured: false, platform: requestContext.credentials.primaryBackupMethod, context: requestContext, failed: true })
      }
      throw error
    } finally {
      if (configurationRequestRef.current === requestId) {
        setConfigurationChecking(false)
      }
    }
  }, [])

  useEffect(() => {
    if (settingsStatus !== 'ready') return
    setConfigurationRevision(revision => revision + 1)
    void refresh(false).catch(error => {
      console.warn('[sync-availability] Configuration refresh failed', error)
    })
    return () => { configurationRequestRef.current += 1 }
  }, [context, refresh, settingsStatus])

  const configurationCurrent = state.context === context && state.platform === credentials.primaryBackupMethod
  const configurationFailed = settingsStatus === 'error' || (!configurationChecking && configurationCurrent && Boolean(state.failed))
  let status: SyncAvailabilityStatus
  if (settingsStatus === 'error') {
    status = 'unavailable'
  } else if (settingsStatus !== 'ready' || configurationChecking || !configurationCurrent) {
    status = 'checking'
  } else if (state.failed) {
    status = 'unavailable'
  } else if (state.platform === 'local') {
    status = 'not-configured'
  } else if (state.reason === 'reauthentication-required') {
    status = 'unavailable'
  } else if (!state.configured) {
    const waitingForAccount = state.reason === 'missing-credentials'
      && ['github', 'gitee', 'gitlab', 'gitea'].includes(state.platform)
      && providerCheck !== 'settled'
    status = waitingForAccount ? 'checking' : 'not-configured'
  } else if (providerCheck === 'checking') {
    status = 'checking'
  } else if (
    state.platform === 's3'
    || state.platform === 'webdav'
    || state.platform === 'cloudFolder'
    || state.platform === 'selfHosted'
  ) {
    status = providerStates[state.platform] ? 'available'
      : providerCheck === 'settled' ? 'unavailable' : 'checking'
  } else {
    const providerState = providerStates[state.platform]
    status = providerState === SyncStateEnum.success
      ? 'available'
      : providerState === SyncStateEnum.checking || providerState === SyncStateEnum.creating || providerCheck !== 'settled'
        ? 'checking'
        : 'unavailable'
  }

  return {
    configured: settingsStatus === 'ready' && configurationCurrent && state.configured,
    platform: credentials.primaryBackupMethod,
    reason: configurationCurrent ? state.reason : undefined,
    status,
    configurationFailed,
    configurationRevision,
    refresh,
  }
}
