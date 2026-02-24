'use client'
import { SyncPlatformCard, StatusBadge } from "./components/sync-platform-card"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemMedia } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { OpenBroswer } from "@/components/open-broswer"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { Button } from "@/components/ui/button"
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/github"
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types"
import { DatabaseBackup } from "lucide-react"
import { Avatar, AvatarImage } from "@/components/ui/avatar"

dayjs.extend(relativeTime)

const GITHUB_CONFIG = {
  platform: 'github' as const,
  tokenKey: 'accessToken',
  tokenLabel: 'Github Access Token',
  tokenDesc: '',
  tokenUrl: 'https://github.com/settings/tokens/new',
  tokenUrlText: '',
}

export function GithubSync() {
  const t = useTranslations()
  const {
    accessToken,
    setAccessToken,
    primaryBackupMethod,
    setPrimaryBackupMethod,
    githubCustomSyncRepo,
    setGithubCustomSyncRepo
  } = useSettingStore()
  const {
    syncRepoState,
    setSyncRepoState,
    syncRepoInfo,
    setSyncRepoInfo
  } = useSyncStore()

  const getRepoName = () => githubCustomSyncRepo.trim() || RepoNames.sync

  async function checkGithubRepos() {
    try {
      setSyncRepoState(SyncStateEnum.checking)
      setSyncRepoInfo(undefined)

      await getUserInfo()
      const repoName = getRepoName()
      const syncRepo = await checkSyncRepoState(repoName)

      if (syncRepo) {
        setSyncRepoInfo(syncRepo)
        setSyncRepoState(SyncStateEnum.success)
      } else {
        setSyncRepoInfo(undefined)
        setSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitHub repos:', err)
      setSyncRepoInfo(undefined)
      setSyncRepoState(SyncStateEnum.fail)
    }
  }

  async function createGithubRepo() {
    try {
      setSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncRepo(repoName, true)
      if (info) {
        setSyncRepoInfo(info)
        setSyncRepoState(SyncStateEnum.success)
      } else {
        setSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create GitHub repo:', err)
      setSyncRepoState(SyncStateEnum.fail)
    }
  }

  const isPrimary = primaryBackupMethod === 'github'
  const isDisabled = !accessToken || syncRepoState !== SyncStateEnum.success

  return (
    <>
      <SyncPlatformCard
        config={GITHUB_CONFIG}
        accessToken={accessToken}
        setAccessToken={setAccessToken}
        syncRepoState={syncRepoState}
        syncRepoInfo={syncRepoInfo}
        customRepo={githubCustomSyncRepo}
        setCustomRepo={setGithubCustomSyncRepo}
        defaultRepoName={RepoNames.sync}
        onCheckRepo={checkGithubRepos}
        onCreateRepo={createGithubRepo}
      >
        {/* 自定义仓库信息展示 */}
        <div className="flex items-center gap-4">
          <Avatar className="size-12">
            <AvatarImage src={syncRepoInfo?.owner.avatar_url || ''} />
          </Avatar>
          <div>
            <h3 className="text-xl font-bold mb-1">
              <OpenBroswer title={syncRepoInfo?.full_name || ''} url={syncRepoInfo?.html_url || ''} />
            </h3>
            <p className="text-sm text-zinc-500">
              {t('settings.sync.createdAt', { time: dayjs(syncRepoInfo?.created_at).fromNow() })}，{t('settings.sync.updatedAt', { time: dayjs(syncRepoInfo?.updated_at).fromNow() })}
            </p>
          </div>
        </div>
      </SyncPlatformCard>

      {/* 主要备份方式设置 */}
      <div className="mt-8">
        {isPrimary ? (
          <Button disabled variant="outline">
            {t('settings.sync.isPrimaryBackup', { type: 'Github' })}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => setPrimaryBackupMethod('github')}
            disabled={isDisabled}
          >
            {t('settings.sync.setPrimaryBackup')}
          </Button>
        )}
      </div>
    </>
  )
}
