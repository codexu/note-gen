import { useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'

import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { RepoNames } from '@/lib/sync/github.types'
import {
  restoreGitSyncProviderStatus,
  subscribeRepositoryChecks,
  warmupRepositoryChecks,
} from '@/lib/sync/repository-check'
import { SYNC_REPO_PLATFORMS, type SyncRepoPlatform } from '@/lib/sync/workspace-repos'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'

let nonGitStartupCheck: Promise<void> | undefined

function warmupOtherSyncProviders(): Promise<void> {
  if (nonGitStartupCheck) return nonGitStartupCheck
  nonGitStartupCheck = (async () => {
    try {
      const store = await Store.load('store.json')
      const [s3, webdav, cloudFolder, { getDb, initAllDatabases }, { checkSyncProviderStatus }] = await Promise.all([
        store.get<S3Config>('s3SyncConfig'),
        store.get<WebDAVConfig>('webdavSyncConfig'),
        store.get<CloudFolderConfig>('cloudFolderSyncConfig'),
        import('@/db'),
        import('@/lib/sync/provider-status'),
      ])
      const platforms: SyncPlatform[] = []
      if (s3?.accessKeyId && s3.secretAccessKey && s3.region && s3.bucket) platforms.push('s3')
      if (webdav?.url && webdav.username && webdav.password) platforms.push('webdav')
      if (cloudFolder?.path) platforms.push('cloudFolder')
      const checks = platforms.map(checkSyncProviderStatus)
      checks.push((async () => {
        await initAllDatabases()
        const database = await getDb()
        const profiles = await database.select<Array<{ total: number }>>('select count(*) as total from self_hosted_sync_profiles')
        if ((profiles[0]?.total ?? 0) > 0) await checkSyncProviderStatus('selfHosted')
      })().catch(error => {
        console.error('Failed to initialize self-hosted sync status:', error)
        if (!useSyncStore.getState().providerChecks.selfHosted) {
          useSyncStore.getState().setProviderCheckSettled('selfHosted')
        }
      }))
      await Promise.allSettled(checks)
    } catch (error) {
      console.error('Failed to initialize sync provider status:', error)
      for (const platform of ['s3', 'webdav', 'cloudFolder', 'selfHosted'] as const) {
        if (!useSyncStore.getState().providerChecks[platform]) {
          useSyncStore.getState().setProviderCheckSettled(platform)
        }
      }
    }
  })()
  return nonGitStartupCheck
}

interface PreviousTargets {
  workspacePath: string
  repos: Record<SyncRepoPlatform, string>
  credentials: Record<SyncRepoPlatform, string>
}

export default function AppStatus() {
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const selfHostedConnected = useSyncStore(state => state.selfHostedConnected)
  const {
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
  const previousTargetsRef = useRef<PreviousTargets | null>(null)
  const githubCredential = JSON.stringify([accessToken])
  const giteeCredential = JSON.stringify([giteeAccessToken])
  const gitlabCredential = JSON.stringify([gitlabAccessToken, gitlabInstanceType, gitlabCustomUrl])
  const giteaCredential = JSON.stringify([giteaAccessToken, giteaInstanceType, giteaCustomUrl])

  useEffect(() => {
    if (!settingsReady || !selfHostedConnected) return
    let disposed = false
    const check = () => {
      if (document.visibilityState === 'hidden') return
      void import('@/lib/sync/provider-status').then(({ checkSyncProviderStatus }) => {
        if (!disposed) return checkSyncProviderStatus('selfHosted')
      }).catch(error => console.warn('[self-hosted-sync] Service availability check failed', error))
    }
    const offline = () => useSyncStore.getState().setSelfHostedServiceAvailable(false)
    check()
    const timer = setInterval(check, 30_000)
    window.addEventListener('online', check)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', check)
    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', check)
    }
  }, [settingsReady, selfHostedConnected])

  useEffect(() => {
    if (!settingsReady) return
    const unsubscribe = subscribeRepositoryChecks(() => setCacheRevision(revision => revision + 1))
    void warmupRepositoryChecks()
    void warmupOtherSyncProviders()
    return unsubscribe
  }, [settingsReady])

  useEffect(() => {
    if (!settingsReady) return
    const previous = previousTargetsRef.current
    const repos: Record<SyncRepoPlatform, string> = {
      github: githubCustomSyncRepo.trim() || (workspacePath ? '' : RepoNames.sync),
      gitee: giteeCustomSyncRepo.trim() || (workspacePath ? '' : RepoNames.sync),
      gitlab: gitlabCustomSyncRepo.trim() || (workspacePath ? '' : RepoNames.sync),
      gitea: giteaCustomSyncRepo.trim() || (workspacePath ? '' : RepoNames.sync),
    }
    const credentials: Record<SyncRepoPlatform, string> = {
      github: githubCredential,
      gitee: giteeCredential,
      gitlab: gitlabCredential,
      gitea: giteaCredential,
    }
    previousTargetsRef.current = { workspacePath, repos, credentials }

    void Promise.all(SYNC_REPO_PLATFORMS.map(platform => {
      const credentialsChanged = previous !== null && previous.credentials[platform] !== credentials[platform]
      const bindingChanged = previous !== null && previous.workspacePath === workspacePath && previous.repos[platform] !== repos[platform]
      return restoreGitSyncProviderStatus(platform, { check: credentialsChanged || bindingChanged })
    })).catch(error => {
      console.error('Failed to restore cached repository status:', error)
    })
  }, [
    settingsReady,
    cacheRevision,
    githubCredential,
    giteeCredential,
    gitlabCredential,
    giteaCredential,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
  ])

  return null
}
