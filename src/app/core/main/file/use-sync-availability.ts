'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { SyncStateEnum } from '@/lib/sync/github.types'
import { checkSyncProviderStatus } from '@/lib/sync/provider-status'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSyncStore from '@/stores/sync'
import type { SyncPlatform } from '@/types/sync'
import { useShallow } from 'zustand/react/shallow'

import { getSyncConfiguration, type SyncConfigurationReason } from './file-tree-action-policy'

export type SyncAvailabilityStatus = 'not-configured' | 'checking' | 'available' | 'unavailable'

export function useSyncAvailability() {
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
  }>({
    configured: false,
    platform: credentials.primaryBackupMethod,
  })
  const [configurationChecking, setConfigurationChecking] = useState(true)
  const [configurationRevision, setConfigurationRevision] = useState(0)
  const configurationRequestRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++configurationRequestRef.current
    setConfigurationChecking(true)
    try {
      const next = await getSyncConfiguration()
      if (next.configured && (next.platform === 's3' || next.platform === 'webdav' || next.platform === 'cloudFolder')) {
        await checkSyncProviderStatus(next.platform)
      }
      if (configurationRequestRef.current === requestId) setState(next)
      return next
    } finally {
      if (configurationRequestRef.current === requestId) {
        setConfigurationChecking(false)
      }
    }
  }, [])

  useEffect(() => {
    setConfigurationRevision(revision => revision + 1)
    void refresh().catch(error => {
      console.warn('[sync-availability] Configuration refresh failed', error)
    })
  }, [credentials, refresh, settingsOpen])

  let status: SyncAvailabilityStatus
  if (state.platform === 'local') {
    status = 'not-configured'
  } else if (configurationChecking) {
    status = 'checking'
  } else if (state.reason === 'reauthentication-required') {
    status = 'unavailable'
  } else if (!state.configured) {
    status = 'not-configured'
  } else if (
    state.platform === 's3'
    || state.platform === 'webdav'
    || state.platform === 'cloudFolder'
    || state.platform === 'selfHosted'
  ) {
    status = providerStates[state.platform] ? 'available' : 'unavailable'
  } else {
    const providerState = providerStates[state.platform]
    status = providerState === SyncStateEnum.success
      ? 'available'
      : providerState === SyncStateEnum.checking || providerState === SyncStateEnum.creating
        ? 'checking'
        : 'unavailable'
  }

  return { ...state, status, configurationRevision, refresh }
}
