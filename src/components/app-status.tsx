import { useEffect, useRef, useState } from 'react'

import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { RepoNames } from '@/lib/sync/github.types'
import {
  restoreGitSyncProviderStatus,
  subscribeRepositoryChecks,
  warmupRepositoryChecks,
} from '@/lib/sync/repository-check'
import { SYNC_REPO_PLATFORMS, type SyncRepoPlatform } from '@/lib/sync/workspace-repos'
import type { SyncPlatform } from '@/types/sync'

const nonGitStartupChecks = new Map<string, Promise<void>>()
let startupTarget: string | undefined

function isGitPlatform(platform: SyncPlatform): platform is SyncRepoPlatform {
  return SYNC_REPO_PLATFORMS.some(candidate => candidate === platform)
}

function warmupCurrentSyncProvider(platform: SyncPlatform, workspacePath: string): Promise<void> {
  const isActive = () => {
    const settings = useSettingStore.getState()
    return useSettingsHydrationStore.getState().status === 'ready'
      && settings.primaryBackupMethod === platform && settings.workspacePath === workspacePath
  }
  if (!isActive()) return Promise.resolve()
  const key = JSON.stringify([platform, workspacePath])
  if (startupTarget !== key) {
    startupTarget = key
    nonGitStartupChecks.clear()
  }
  if (platform === 'local' || isGitPlatform(platform)) return Promise.resolve()
  const existing = nonGitStartupChecks.get(key)
  if (existing) return existing
  const check = (async () => {
    if (!isActive()) return
    const { checkSyncProviderStatus } = await import('@/lib/sync/provider-status')
    if (!isActive()) return
    await checkSyncProviderStatus(platform, { isActive })
  })().catch(error => {
    if (!isActive()) return
    console.error('Failed to initialize sync provider status:', error)
    useSyncStore.getState().setProviderCheckSettled(platform)
  }).finally(() => {
    // A skipped stale warmup must not suppress a later activation of this target.
    if (!isActive() && nonGitStartupChecks.get(key) === check) nonGitStartupChecks.delete(key)
  })
  nonGitStartupChecks.set(key, check)
  return check
}

interface SelfHostedMonitor {
  subscribers: number
  stop: () => void
}

let selfHostedMonitor: SelfHostedMonitor | undefined

function subscribeSelfHostedAvailability(): () => void {
  if (!selfHostedMonitor) {
    let disposed = false
    const isActive = () => !disposed
      && useSettingsHydrationStore.getState().status === 'ready'
      && useSettingStore.getState().primaryBackupMethod === 'selfHosted'
    const check = () => {
      if (!isActive() || document.visibilityState === 'hidden') return
      void import('@/lib/sync/provider-status').then(({ checkSyncProviderStatus }) => {
        if (isActive()) return checkSyncProviderStatus('selfHosted', { isActive })
      }).catch(error => {
        if (isActive()) console.warn('[self-hosted-sync] Service availability check failed', error)
      })
    }
    const offline = () => {
      if (isActive()) useSyncStore.getState().setSelfHostedServiceAvailable(false)
    }
    const timer = setInterval(check, 30_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', check)
    selfHostedMonitor = {
      subscribers: 0,
      stop: () => {
        disposed = true
        clearInterval(timer)
        window.removeEventListener('online', check)
        window.removeEventListener('offline', offline)
        document.removeEventListener('visibilitychange', check)
      },
    }
  }
  const monitor = selfHostedMonitor
  monitor.subscribers++
  return () => {
    monitor.subscribers--
    if (monitor.subscribers === 0) {
      monitor.stop()
      if (selfHostedMonitor === monitor) selfHostedMonitor = undefined
    }
  }
}

interface PreviousTarget {
  platform: SyncRepoPlatform
  workspacePath: string
  repo: string
  credentials: string
}

export default function AppStatus() {
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const selfHostedConnected = useSyncStore(state => state.selfHostedConnected)
  const {
    primaryBackupMethod,
    accessToken,
    giteeAccessToken,
    gitlabAccessToken,
    giteaAccessToken,
    gitlabInstanceType,
    gitlabCustomUrl,
    giteaInstanceType,
    giteaCustomUrl,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
  } = useSettingStore()
  const [cacheRevision, setCacheRevision] = useState(0)
  const previousTargetRef = useRef<PreviousTarget | null>(null)
  const platform = isGitPlatform(primaryBackupMethod) ? primaryBackupMethod : null
  const repos: Record<SyncRepoPlatform, string> = {
    github: githubCustomSyncRepo,
    gitee: giteeCustomSyncRepo,
    gitlab: gitlabCustomSyncRepo,
    gitea: giteaCustomSyncRepo,
  }
  const credentials: Record<SyncRepoPlatform, string> = {
    github: JSON.stringify([accessToken]),
    gitee: JSON.stringify([giteeAccessToken]),
    gitlab: JSON.stringify([gitlabAccessToken, gitlabInstanceType, gitlabCustomUrl]),
    gitea: JSON.stringify([giteaAccessToken, giteaInstanceType, giteaCustomUrl]),
  }
  const currentRepo = platform ? repos[platform].trim() || (workspacePath ? '' : RepoNames.sync) : ''
  const currentCredentials = platform ? credentials[platform] : ''

  useEffect(() => {
    if (!settingsReady || primaryBackupMethod !== 'selfHosted' || !selfHostedConnected) return
    return subscribeSelfHostedAvailability()
  }, [settingsReady, primaryBackupMethod, selfHostedConnected])

  useEffect(() => {
    if (!settingsReady) return
    return subscribeRepositoryChecks(() => setCacheRevision(revision => revision + 1))
  }, [settingsReady])

  useEffect(() => {
    if (!settingsReady) return
    void warmupCurrentSyncProvider(primaryBackupMethod, workspacePath)
  }, [settingsReady, primaryBackupMethod, workspacePath])

  useEffect(() => {
    if (!settingsReady || !platform) {
      previousTargetRef.current = null
      return
    }
    const previous = previousTargetRef.current
    previousTargetRef.current = { platform, workspacePath, repo: currentRepo, credentials: currentCredentials }
    const credentialsChanged = previous?.platform === platform && previous.credentials !== currentCredentials
    const bindingChanged = previous?.platform === platform && previous.workspacePath === workspacePath
      && previous.repo !== currentRepo

    let disposed = false
    void (async () => {
      await warmupRepositoryChecks()
      const settings = useSettingStore.getState()
      if (disposed || settings.primaryBackupMethod !== platform || settings.workspacePath !== workspacePath) return
      await restoreGitSyncProviderStatus(platform, { check: credentialsChanged || bindingChanged })
    })().catch(error => {
      console.error('Failed to restore cached repository status:', error)
    })
    return () => { disposed = true }
  }, [settingsReady, cacheRevision, platform, workspacePath, currentRepo, currentCredentials])

  return null
}
