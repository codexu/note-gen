'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import { platform } from '@tauri-apps/plugin-os'

import { ActivityHeatmap } from '@/components/activity/activity-heatmap'
import { Button } from '@/components/ui/button'
import { loadActivityCalendarData } from '@/lib/activity'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'
import { SyncStateEnum, type UserInfo } from '@/lib/sync/github.types'
import { getOptionalSyncRepoName } from '@/lib/sync/repo-utils'
import { testS3Connection } from '@/lib/sync/s3'
import { testWebDAVConnection } from '@/lib/sync/webdav'
import { testCloudFolderConnection } from '@/lib/sync/cloud-folder'
import type { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { cn } from '@/lib/utils'
import { MobileMeActivityDrawer } from './mobile-me-activity-drawer'
import { buildActivityDaySummaryText, buildProfileCardData, getBackupMethodStatus, getBackupProviderName, getCurrentActivityStreak, getCurrentWeekActivityCount } from './mobile-me-helpers'
import { MobileMeProfileCard } from './mobile-me-profile-card'
import { MobileUpdateSettings } from './mobile-update-settings'
import { SettingTab } from './setting-tab'

const MOBILE_HEATMAP_WEEKS = 16
const MOBILE_ME_SCROLL_KEY = 'mobile-me-scroll-top'
const MOBILE_ACTIVITY_CACHE_TTL = 30_000

let mobileActivityCache: ActivityCalendarData | null = null
let mobileActivityCacheTime = 0

function getInitialSelectedDay(data: ActivityCalendarData | null) {
  if (!data) return undefined
  return data.days.find((day) => day.day === data.endDate)
    || [...data.days].reverse().find((day) => day.totalCount > 0)
}

const embeddedContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.14,
      staggerChildren: 0.06,
    },
  },
}

const embeddedItemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1],
    },
  },
}

export function MobileMePage({
  embedded = false,
  animateEntrance = true,
  refreshOnMount = true,
  onNavigate,
}: {
  embedded?: boolean
  animateEntrance?: boolean
  refreshOnMount?: boolean
  onNavigate?: () => void
}) {
  const tActivity = useTranslations('activity')
  const tMe = useTranslations('mobile.me')
  const tSync = useTranslations('settings.sync')
  const reduceMotion = useReducedMotion()

  const [activityData, setActivityData] = useState<ActivityCalendarData | null>(
    () => mobileActivityCache
  )
  const [selectedDay, setSelectedDay] = useState<ActivityDaySummary | undefined>(
    () => getInitialSelectedDay(mobileActivityCache)
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(() => !mobileActivityCache)
  const [cloudFolderProvider, setCloudFolderProvider] = useState<CloudFolderConfig['provider']>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const restoredScrollRef = useRef(false)
  const refreshOnMountRef = useRef(refreshOnMount)

  const {
    primaryBackupMethod,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
  } = useSettingStore()
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
    cloudFolderConnected,
    selfHostedConnected,
  } = useSyncStore()

  async function refreshActivity() {
    setLoading(true)
    try {
      const nextData = await loadActivityCalendarData()
      mobileActivityCache = nextData
      mobileActivityCacheTime = Date.now()
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
    if (!refreshOnMountRef.current) return
    if (
      mobileActivityCache
      && Date.now() - mobileActivityCacheTime < MOBILE_ACTIVITY_CACHE_TTL
    ) {
      return
    }
    refreshActivity()
  }, [])

  useEffect(() => {
    if (!refreshOnMountRef.current) return

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
              getOptionalSyncRepoName('github'),
            ])
            const user = await getUserInfo()
            const githubUser = user && typeof user === 'object' && 'data' in user
              ? user.data as UserInfo
              : undefined

            if (!cancelled && githubUser) {
              syncState.setUserInfo(githubUser)
              await settingState.setGithubUsername(githubUser.login)
            }

            if (!repoName) {
              syncState.setSyncRepoState(SyncStateEnum.fail)
              return
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
              getOptionalSyncRepoName('gitee'),
            ])
            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGiteeUserInfo(user)
            }

            if (!repoName) {
              syncState.setGiteeSyncRepoState(SyncStateEnum.fail)
              return
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
              getOptionalSyncRepoName('gitlab'),
            ])
            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGitlabUserInfo(user)
              await settingState.setGitlabUsername(user.username)
            }

            if (!repoName) {
              syncState.setGitlabSyncProjectState(SyncStateEnum.fail)
              return
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
              getOptionalSyncRepoName('gitea'),
            ])
            const user = await getUserInfo()
            if (!cancelled && user) {
              syncState.setGiteaUserInfo(user)
              await settingState.setGiteaUsername(user.login)
            }

            if (!repoName) {
              syncState.setGiteaSyncRepoState(SyncStateEnum.fail)
              return
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
          case 'cloudFolder': {
            const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
            if (!cancelled) setCloudFolderProvider(config?.provider)
            if (!config?.path) return
            const connected = await testCloudFolderConnection(config).catch(() => false)
            if (!cancelled) syncState.setCloudFolderConnected(connected)
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
          case 'cloudFolder':
            syncState.setCloudFolderConnected(false)
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
  }, [
    primaryBackupMethod,
    workspacePath,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
  ])

  useLayoutEffect(() => {
    if (restoredScrollRef.current) return
    if (!containerRef.current) return

    const savedScrollTop = window.sessionStorage.getItem(MOBILE_ME_SCROLL_KEY)
    if (!savedScrollTop) {
      restoredScrollRef.current = true
      return
    }

    containerRef.current.scrollTop = Number(savedScrollTop)
    restoredScrollRef.current = true
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
    cloudFolderConnected,
    selfHostedConnected,
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
    cloudFolderConnected,
    selfHostedConnected,
    tMe,
  ])

  const profileProviderType = useMemo<'git' | 'storage' | 'unconfigured'>(() => {
    const hasGitIdentity = Boolean(profile.avatarUrl)
    if (hasGitIdentity) return 'git'
    if (primaryBackupMethod === 'local' || primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav' || primaryBackupMethod === 'cloudFolder') return 'storage'
    if (syncStatus === tMe('sync.unconfigured')) return 'unconfigured'
    return 'git'
  }, [profile.avatarUrl, primaryBackupMethod, syncStatus, tMe])

  const providerName = useMemo(() => {
    if (primaryBackupMethod === 'local') return tMe('sync.localOnly')
    if (syncStatus === tMe('sync.unconfigured')) {
      return tMe('sync.localOnly')
    }

    const cloudFolderName = platform() === 'ios' && cloudFolderProvider !== 'oneDrive'
      ? tSync('iCloud.title')
      : tSync('oneDrive.title')
    return getBackupProviderName(
      primaryBackupMethod,
      cloudFolderName,
      tSync('selfHosted.title'),
    )
  }, [cloudFolderProvider, primaryBackupMethod, syncStatus, tMe, tSync])

  const profileCardName = useMemo(() => {
    if (profileProviderType === 'git') {
      return profile.name
    }

    return tMe('profile.syncPlatform')
  }, [profile.name, profileProviderType, tMe])

  function handleSelectDay(day: ActivityDaySummary) {
    setSelectedDay(day)
    setDrawerOpen(true)
  }

  return (
    <div
      id="mobile-me"
      ref={containerRef}
      className={cn(
        "mobile-setting-screen flex h-full w-full flex-col overflow-y-auto",
        !embedded && "mobile-under-dock-scroll"
      )}
      onScroll={(event) => {
        window.sessionStorage.setItem(MOBILE_ME_SCROLL_KEY, String(event.currentTarget.scrollTop))
      }}
    >
      <motion.div
        className="flex flex-1 flex-col gap-4 px-3 py-4"
        variants={embeddedContainerVariants}
        initial={embedded && animateEntrance && !reduceMotion ? "hidden" : false}
        animate="visible"
      >
        <motion.div variants={embeddedItemVariants}>
          <MobileUpdateSettings />
        </motion.div>

        <motion.div variants={embeddedItemVariants}>
          <MobileMeProfileCard
            name={profileCardName}
            avatarUrl={profile.avatarUrl}
            syncStatus={syncStatus}
            providerName={providerName}
            providerType={profileProviderType}
          />
        </motion.div>

        <motion.section variants={embeddedItemVariants} className="mobile-dock-surface rounded-[1.35rem] p-4">
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
        </motion.section>

        <motion.section variants={embeddedItemVariants} className="grid grid-cols-2 gap-3">
          <div className="mobile-dock-surface rounded-[1.35rem] p-4">
            <p className="text-xs text-muted-foreground">{tMe('stats.weekly')}</p>
            <p className="mt-2 text-2xl font-semibold">{currentWeekCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tMe('stats.weeklyHint')}</p>
          </div>
          <div className="mobile-dock-surface rounded-[1.35rem] p-4">
            <p className="text-xs text-muted-foreground">{tMe('stats.streak')}</p>
            <p className="mt-2 text-2xl font-semibold">{currentStreak}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tMe('stats.streakHint')}</p>
          </div>
        </motion.section>

        <motion.section variants={embeddedItemVariants} className="flex flex-col gap-3 px-1">
          <div className="px-1">
            <h2 className="text-base font-semibold">{tMe('settings.title')}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {tMe('settings.description')}
            </p>
          </div>
          <SettingTab
            restoreSheetOnNavigate={embedded}
            onNavigate={onNavigate}
          />
        </motion.section>
      </motion.div>

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
          canvas: tActivity('labels.canvas'),
        }}
      />
    </div>
  )
}
