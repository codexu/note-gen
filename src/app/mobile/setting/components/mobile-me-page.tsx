'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'

import { ActivityHeatmap } from '@/components/activity/activity-heatmap'
import { Button } from '@/components/ui/button'
import { loadActivityCalendarData } from '@/lib/activity'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'
import { SyncStateEnum, type UserInfo } from '@/lib/sync/github.types'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { testS3Connection } from '@/lib/sync/s3'
import { testWebDAVConnection } from '@/lib/sync/webdav'
import type { S3Config, WebDAVConfig } from '@/types/sync'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { MobileMeActivityDrawer } from './mobile-me-activity-drawer'
import { buildActivityDaySummaryText, buildProfileCardData, getBackupMethodStatus, getBackupProviderName, getCurrentActivityStreak, getCurrentWeekActivityCount } from './mobile-me-helpers'
import { MobileMeProfileCard } from './mobile-me-profile-card'
import { SettingTab } from './setting-tab'

const MOBILE_HEATMAP_WEEKS = 16
const MOBILE_ME_SCROLL_KEY = 'mobile-me-scroll-top'

export function MobileMePage() {
  const tActivity = useTranslations('activity')
  const tMe = useTranslations('mobile.me')

  const [activityData, setActivityData] = useState<ActivityCalendarData | null>(null)
  const [selectedDay, setSelectedDay] = useState<ActivityDaySummary | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const restoredScrollRef = useRef(false)

  const { primaryBackupMethod } = useSettingStore()
  const {
    userInfo,
    giteeUserInfo,
    gitlabUserInfo,
    giteaUserInfo,
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
  } = useSyncStore()

  async function refreshActivity() {
    setLoading(true)
    try {
      const nextData = await loadActivityCalendarData()
      setActivityData(nextData)
      setSelectedDay((currentDay) => {
        if (currentDay) {
          return nextData.days.find((day) => day.day === currentDay.day) || currentDay
        }

        return nextData.days.find((day) => day.day === nextData.endDate)
          || [...nextData.days].reverse().find((day) => day.totalCount > 0)
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshActivity()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSyncProfile() {
      const store = await Store.load('store.json')
      const syncState = useSyncStore.getState()
      const settingState = useSettingStore.getState()

      try {
        switch (primaryBackupMethod) {
          case 'github': {
            const accessToken = await store.get<string>('accessToken')
            if (!accessToken) return

            syncState.setSyncRepoState(SyncStateEnum.checking)

            const [{ getUserInfo, checkSyncRepoState }, repoName] = await Promise.all([
              import('@/lib/sync/github'),
              getSyncRepoName('github'),
            ])

            const user = await getUserInfo()
            const githubUser = user && typeof user === 'object' && 'data' in user
              ? user.data as UserInfo
              : undefined

            if (!cancelled && githubUser) {
              syncState.setUserInfo(githubUser)
              await settingState.setGithubUsername(githubUser.login)
            }

            const repo = await checkSyncRepoState(repoName)
            if (cancelled) return

            if (repo) {
              syncState.setSyncRepoInfo(repo)
              syncState.setSyncRepoState(SyncStateEnum.success)
            } else {
              syncState.setSyncRepoInfo(undefined)
              syncState.setSyncRepoState(SyncStateEnum.fail)
            }
            return
          }
          case 'gitee': {
            const accessToken = await store.get<string>('giteeAccessToken')
            if (!accessToken) return

            syncState.setGiteeSyncRepoState(SyncStateEnum.checking)

            const [{ getUserInfo, checkSyncRepoState }, repoName] = await Promise.all([
              import('@/lib/sync/gitee'),
              getSyncRepoName('gitee'),
            ])

            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGiteeUserInfo(user)
            }

            const repo = await checkSyncRepoState(repoName)
            if (cancelled) return

            if (repo) {
              syncState.setGiteeSyncRepoInfo(repo)
              syncState.setGiteeSyncRepoState(SyncStateEnum.success)
            } else {
              syncState.setGiteeSyncRepoInfo(undefined)
              syncState.setGiteeSyncRepoState(SyncStateEnum.fail)
            }
            return
          }
          case 'gitlab': {
            const accessToken = await store.get<string>('gitlabAccessToken')
            if (!accessToken) return

            syncState.setGitlabSyncProjectState(SyncStateEnum.checking)

            const [{ getUserInfo, checkSyncProjectState }, repoName] = await Promise.all([
              import('@/lib/sync/gitlab'),
              getSyncRepoName('gitlab'),
            ])

            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGitlabUserInfo(user)
              await settingState.setGitlabUsername(user.username)
            }

            const project = await checkSyncProjectState(repoName)
            if (cancelled) return

            if (project) {
              syncState.setGitlabSyncProjectInfo(project)
              syncState.setGitlabSyncProjectState(SyncStateEnum.success)
            } else {
              syncState.setGitlabSyncProjectInfo(undefined)
              syncState.setGitlabSyncProjectState(SyncStateEnum.fail)
            }
            return
          }
          case 'gitea': {
            const accessToken = await store.get<string>('giteaAccessToken')
            if (!accessToken) return

            syncState.setGiteaSyncRepoState(SyncStateEnum.checking)

            const [{ getUserInfo, checkSyncRepoState }, repoName] = await Promise.all([
              import('@/lib/sync/gitea'),
              getSyncRepoName('gitea'),
            ])

            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGiteaUserInfo(user)
              await settingState.setGiteaUsername(user.login)
            }

            const repo = await checkSyncRepoState(repoName)
            if (cancelled) return

            if (repo) {
              syncState.setGiteaSyncRepoInfo(repo)
              syncState.setGiteaSyncRepoState(SyncStateEnum.success)
            } else {
              syncState.setGiteaSyncRepoInfo(undefined)
              syncState.setGiteaSyncRepoState(SyncStateEnum.fail)
            }
            return
          }
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (!s3Config?.bucket) return

            const connected = await testS3Connection(s3Config).catch(() => false)
            if (!cancelled) {
              syncState.setS3Connected(connected)
            }
            return
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (!webdavConfig?.url || !webdavConfig?.username || !webdavConfig?.password) return

            const connected = await testWebDAVConnection(webdavConfig).catch(() => false)
            if (!cancelled) {
              syncState.setWebDAVConnected(connected)
            }
            return
          }
          default:
            return
        }
      } catch (error) {
        if (cancelled) return
        console.error('[MobileMePage] Failed to load sync profile:', error)

        switch (primaryBackupMethod) {
          case 'github':
            syncState.setSyncRepoState(SyncStateEnum.fail)
            break
          case 'gitee':
            syncState.setGiteeSyncRepoState(SyncStateEnum.fail)
            break
          case 'gitlab':
            syncState.setGitlabSyncProjectState(SyncStateEnum.fail)
            break
          case 'gitea':
            syncState.setGiteaSyncRepoState(SyncStateEnum.fail)
            break
          case 's3':
            syncState.setS3Connected(false)
            break
          case 'webdav':
            syncState.setWebDAVConnected(false)
            break
          default:
            break
        }
      }
    }

    loadSyncProfile()

    return () => {
      cancelled = true
    }
  }, [primaryBackupMethod])

  useEffect(() => {
    if (restoredScrollRef.current) return
    if (!containerRef.current) return

    const savedScrollTop = window.sessionStorage.getItem(MOBILE_ME_SCROLL_KEY)
    if (!savedScrollTop) {
      restoredScrollRef.current = true
      return
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!containerRef.current) return
        containerRef.current.scrollTop = Number(savedScrollTop)
        restoredScrollRef.current = true
      })
    })
  }, [activityData])

  const currentWeekCount = useMemo(() => getCurrentWeekActivityCount(activityData), [activityData])
  const currentStreak = useMemo(() => getCurrentActivityStreak(activityData), [activityData])
  const visibleWeeks = useMemo(
    () => activityData ? activityData.weeks.slice(-MOBILE_HEATMAP_WEEKS) : [],
    [activityData]
  )

  const profile = useMemo(() => buildProfileCardData({
    primaryBackupMethod,
    githubUser: userInfo,
    giteeUser: giteeUserInfo,
    gitlabUser: gitlabUserInfo,
    giteaUser: giteaUserInfo,
    fallbackName: tMe('profile.deviceName'),
    fallbackSubtitle: tMe('profile.deviceSubtitle'),
    streak: currentStreak,
    streakLabel: tMe('profile.streak'),
  }), [primaryBackupMethod, userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo, tMe, currentStreak])

  const daySummary = useMemo(() => buildActivityDaySummaryText(selectedDay, {
    empty: tMe('activity.drawerEmpty'),
    summary: tMe('activity.drawerSummary'),
  }), [selectedDay, tMe])

  const syncStatus = useMemo(() => getBackupMethodStatus({
    primaryBackupMethod,
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
    configuredLabel: tMe('sync.configured'),
    unavailableLabel: tMe('sync.unconfigured'),
  }), [
    primaryBackupMethod,
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
    tMe,
  ])

  const profileProviderType = useMemo<'git' | 'storage' | 'unconfigured'>(() => {
    const hasGitIdentity = Boolean(profile.avatarUrl)
    if (hasGitIdentity) return 'git'
    if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') return 'storage'
    if (syncStatus === tMe('sync.unconfigured')) return 'unconfigured'
    return 'git'
  }, [profile.avatarUrl, primaryBackupMethod, syncStatus, tMe])

  const providerName = useMemo(() => {
    if (syncStatus === tMe('sync.unconfigured')) {
      return tMe('sync.localOnly')
    }

    return getBackupProviderName(primaryBackupMethod)
  }, [primaryBackupMethod, syncStatus, tMe])

  const profileCardName = useMemo(() => {
    if (profileProviderType === 'git') {
      return profile.name
    }

    return tMe('profile.syncPlatform')
  }, [profile.name, profileProviderType, tMe])

  const profileCardSubtitle = useMemo(() => {
    if (profileProviderType === 'git' && providerName) {
      return tMe('profile.gitSubtitle', { provider: providerName })
    }

    if (profileProviderType === 'storage' && providerName) {
      return tMe('profile.storageSubtitle', { provider: providerName })
    }

    return tMe('profile.unconfiguredSubtitle')
  }, [profileProviderType, providerName, tMe])

  function handleSelectDay(day: ActivityDaySummary) {
    setSelectedDay(day)
    setDrawerOpen(true)
  }

  return (
    <div
      id="mobile-me"
      ref={containerRef}
      className="flex h-full w-full flex-col overflow-y-auto"
      onScroll={(event) => {
        window.sessionStorage.setItem(MOBILE_ME_SCROLL_KEY, String(event.currentTarget.scrollTop))
      }}
    >
      <div className="flex-1 space-y-4 px-3 py-4">
        <MobileMeProfileCard
          name={profileCardName}
          subtitle={profileCardSubtitle}
          avatarUrl={profile.avatarUrl}
          syncStatus={syncStatus}
          providerName={providerName}
          providerType={profileProviderType}
        />

        <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{tActivity('drawer.title')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {activityData ? tMe('activity.range', { count: MOBILE_HEATMAP_WEEKS }) : tMe('activity.rangePlaceholder')}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={refreshActivity} aria-label={tActivity('refresh')}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {loading && !activityData ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{tActivity('loading')}</div>
          ) : activityData ? (
            <>
              <ActivityHeatmap
                weeks={visibleWeeks}
                selectedDay={selectedDay?.day}
                onSelectDay={handleSelectDay}
                compact
                adaptive
                labels={{
                  dayCount: tActivity('heatmap.dayCount'),
                  emptyDay: tActivity('heatmap.emptyDay'),
                }}
              />
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{tMe('activity.tip')}</p>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{tActivity('empty')}</div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{tMe('stats.weekly')}</p>
            <p className="mt-2 text-2xl font-semibold">{currentWeekCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tMe('stats.weeklyHint')}</p>
          </div>
          <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{tMe('stats.streak')}</p>
            <p className="mt-2 text-2xl font-semibold">{currentStreak}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tMe('stats.streakHint')}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-border/60 bg-card shadow-sm">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-base font-semibold">{tMe('settings.title')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{tMe('settings.description')}</p>
          </div>
          <SettingTab />
        </section>
      </div>

      <MobileMeActivityDrawer
        day={selectedDay}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        summaryText={daySummary}
        labels={{
          title: tActivity('detail.title'),
          description: tMe('activity.drawerEmpty'),
          empty: tActivity('detail.empty'),
          records: tActivity('labels.record'),
          writing: tActivity('labels.writing'),
          chats: tActivity('labels.chat'),
        }}
      />
    </div>
  )
}
