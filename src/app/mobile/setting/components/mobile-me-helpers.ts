import { endOfWeek, startOfWeek } from 'date-fns'

import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'
import { SyncStateEnum } from '@/lib/sync/github.types'

type SyncProvider = 'local' | 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'

interface BuildProfileCardDataInput {
  primaryBackupMethod: SyncProvider
  githubUser?: { login?: string | null; name?: string | null; avatar_url?: string | null }
  giteeUser?: { login?: string | null; name?: string | null; avatar_url?: string | null }
  gitlabUser?: { username?: string | null; name?: string | null; avatar_url?: string | null }
  giteaUser?: { login?: string | null; full_name?: string | null; avatar_url?: string | null }
  fallbackName: string
  fallbackSubtitle: string
  streak: number
  streakLabel: string
}

interface QuickLinkStatusInput {
  primaryBackupMethod: SyncProvider
  syncRepoState?: SyncStateEnum
  giteeSyncRepoState?: SyncStateEnum
  gitlabSyncProjectState?: SyncStateEnum
  giteaSyncRepoState?: SyncStateEnum
  s3Connected?: boolean
  webdavConnected?: boolean
  cloudFolderConnected?: boolean
  selfHostedConnected?: boolean
  configuredLabel: string
  unavailableLabel: string
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return `${year}-${month}-${day}`
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function getCurrentWeekActivityCount(data: ActivityCalendarData | null) {
  if (!data) return 0

  const now = new Date()
  const weekStart = formatDateInTimeZone(startOfWeek(now, { weekStartsOn: 1 }), data.timeZone)
  const weekEnd = formatDateInTimeZone(endOfWeek(now, { weekStartsOn: 1 }), data.timeZone)

  return data.days.reduce((total, day) => {
    if (day.day >= weekStart && day.day <= weekEnd) {
      return total + day.totalCount
    }

    return total
  }, 0)
}

export function getCurrentActivityStreak(data: ActivityCalendarData | null) {
  if (!data) return 0

  const dayMap = new Map(data.days.map((day) => [day.day, day]))
  const cursor = new Date()
  let streak = 0

  while (true) {
    const currentDay = formatDateInTimeZone(cursor, data.timeZone)
    const summary = dayMap.get(currentDay)

    if (!summary || summary.totalCount <= 0) {
      break
    }

    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

export function buildActivityDaySummaryText(
  day: ActivityDaySummary | undefined,
  labels: {
    empty: string
    summary: string
  }
) {
  if (!day || day.totalCount <= 0) {
    return labels.empty
  }

  return labels.summary
    .replace('{total}', String(day.totalCount))
    .replace('{record}', String(day.counts.record))
    .replace('{writing}', String(day.counts.writing))
    .replace('{chat}', String(day.counts.chat))
    .replace('{canvas}', String(day.counts.canvas))
}

export function buildProfileCardData({
  primaryBackupMethod,
  githubUser,
  giteeUser,
  gitlabUser,
  giteaUser,
  fallbackName,
  fallbackSubtitle,
  streak,
  streakLabel,
}: BuildProfileCardDataInput) {
  switch (primaryBackupMethod) {
    case 'github':
      if (githubUser?.login || githubUser?.name) {
        return {
          name: githubUser.name || githubUser.login || fallbackName,
          subtitle: streak > 0 ? streakLabel.replace('{count}', String(streak)) : '@' + (githubUser.login || githubUser.name),
          avatarUrl: githubUser.avatar_url || '',
        }
      }
      break
    case 'gitee':
      if (giteeUser?.login || giteeUser?.name) {
        return {
          name: giteeUser.name || giteeUser.login || fallbackName,
          subtitle: streak > 0 ? streakLabel.replace('{count}', String(streak)) : '@' + (giteeUser.login || giteeUser.name),
          avatarUrl: giteeUser.avatar_url || '',
        }
      }
      break
    case 'gitlab':
      if (gitlabUser?.username || gitlabUser?.name) {
        return {
          name: gitlabUser.name || gitlabUser.username || fallbackName,
          subtitle: streak > 0 ? streakLabel.replace('{count}', String(streak)) : '@' + (gitlabUser.username || gitlabUser.name),
          avatarUrl: gitlabUser.avatar_url || '',
        }
      }
      break
    case 'gitea':
      if (giteaUser?.login || giteaUser?.full_name) {
        return {
          name: giteaUser.full_name || giteaUser.login || fallbackName,
          subtitle: streak > 0 ? streakLabel.replace('{count}', String(streak)) : '@' + (giteaUser.login || giteaUser.full_name),
          avatarUrl: giteaUser.avatar_url || '',
        }
      }
      break
    default:
      break
  }

  return {
    name: fallbackName,
    subtitle: streak > 0 ? streakLabel.replace('{count}', String(streak)) : fallbackSubtitle,
    avatarUrl: '',
  }
}

export function getBackupMethodStatus({
  primaryBackupMethod,
  syncRepoState,
  giteeSyncRepoState,
  gitlabSyncProjectState,
  giteaSyncRepoState,
  s3Connected,
  webdavConnected,
  cloudFolderConnected,
  selfHostedConnected,
  configuredLabel,
  unavailableLabel,
}: QuickLinkStatusInput) {
  const isConnected = (() => {
    switch (primaryBackupMethod) {
      case 'local':
        return true
      case 'github':
        return syncRepoState === SyncStateEnum.success
      case 'gitee':
        return giteeSyncRepoState === SyncStateEnum.success
      case 'gitlab':
        return gitlabSyncProjectState === SyncStateEnum.success
      case 'gitea':
        return giteaSyncRepoState === SyncStateEnum.success
      case 's3':
        return Boolean(s3Connected)
      case 'webdav':
        return Boolean(webdavConnected)
      case 'cloudFolder':
        return Boolean(cloudFolderConnected)
      case 'selfHosted':
        return Boolean(selfHostedConnected)
      default:
        return false
    }
  })()

  return isConnected ? configuredLabel : unavailableLabel
}

export function getBackupProviderName(
  primaryBackupMethod: SyncProvider,
  cloudFolderName = 'Cloud Drive',
  selfHostedName = 'Self-hosted',
) {
  switch (primaryBackupMethod) {
    case 'github':
      return 'GitHub'
    case 'gitee':
      return 'Gitee'
    case 'gitlab':
      return 'GitLab'
    case 'gitea':
      return 'Gitea'
    case 's3':
      return 'S3'
    case 'webdav':
      return 'WebDAV'
    case 'cloudFolder':
      return cloudFolderName
    case 'selfHosted':
      return selfHostedName
    default:
      return toTitleCase(primaryBackupMethod)
  }
}

export function getModelLabel(model: string, fallback: string) {
  if (!model) return fallback

  return model
    .split(/[/:]/)
    .filter(Boolean)
    .pop() || fallback
}
