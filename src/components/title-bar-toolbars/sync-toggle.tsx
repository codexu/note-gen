"use client"

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import * as React from "react"
import { DownloadCloud, Loader2, UploadCloud, CloudSync, Download, Upload } from "lucide-react"
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from '@/hooks/use-toast'
import { useState, useEffect } from 'react'
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useChatStore from "@/stores/chat"
import useArticleStore from "@/stores/article"
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { Store } from "@tauri-apps/plugin-store"
import { uint8ArrayToBase64, decodeBase64ToString } from "@/lib/sync/github"
import { getRemoteFileContent } from "@/lib/sync/remote-file"
import { getSyncRepoName } from "@/lib/sync/repo-utils"
import { getGiteaApiBaseUrl } from "@/lib/sync/gitea"
import { fetch } from '@tauri-apps/plugin-http'

// GitLab 实例类型
enum GitlabInstanceType {
  OFFICIAL = 'official',
  JIHULAB = 'jihulab',
  SELF_HOSTED = 'self-hosted'
}

// GitLab 实例配置
const GITLAB_INSTANCES: Record<GitlabInstanceType, { name: string; baseUrl: string }> = {
  [GitlabInstanceType.OFFICIAL]: {
    name: 'GitLab',
    baseUrl: 'https://gitlab.com'
  },
  [GitlabInstanceType.JIHULAB]: {
    name: '极狐GitLab',
    baseUrl: 'https://jihulab.com'
  },
  [GitlabInstanceType.SELF_HOSTED]: {
    name: '自建 GitLab',
    baseUrl: ''
  }
}

// 获取 GitLab API 基础 URL
async function getGitlabApiBaseUrl(): Promise<string> {
  const store = await Store.load('store.json')
  const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType') || GitlabInstanceType.OFFICIAL

  console.log('[getGitlabApiBaseUrl] instanceType:', instanceType)

  if (instanceType === GitlabInstanceType.SELF_HOSTED) {
    let customUrl = await store.get<string>('gitlabCustomUrl') || ''
    console.log('[getGitlabApiBaseUrl] customUrl:', customUrl)
    customUrl = customUrl.replace(/\/+$/, '').trim()

    if (!customUrl) {
      throw new Error('自建 GitLab 实例的 URL 未配置')
    }

    // 用户使用 http://localhost:8080/ 这种本地地址，不需要添加 https://
    const baseUrl = `${customUrl}/api/v4`
    console.log('[getGitlabApiBaseUrl] Self-hosted baseUrl:', baseUrl)
    return baseUrl
  }

  const instance = GITLAB_INSTANCES[instanceType]
  if (!instance) {
    console.log('[getGitlabApiBaseUrl] Unknown instanceType, using OFFICIAL')
    // 未知类型，默认使用官方 GitLab
    return `${GITLAB_INSTANCES[GitlabInstanceType.OFFICIAL].baseUrl}/api/v4`
  }
  return `${instance.baseUrl}/api/v4`
}
import { s3Upload, s3Download, s3HeadObject, s3Delete, testS3Connection } from "@/lib/sync/s3"
import { webdavUpload, webdavDownload, webdavHeadObject, webdavDelete, testWebDAVConnection } from "@/lib/sync/webdav"
import { S3Config, WebDAVConfig, SyncPlatform } from "@/types/sync"
import { filterSyncData, mergeSyncData } from "@/config/sync-exclusions"
import { confirm, save, open as openDialog } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { SyncStateEnum } from "@/lib/sync/github.types"
import dayjs from "dayjs"
import { isMobileDevice } from "@/lib/check"

// ============ 通用辅助函数 ============
function encodePath(path: string, filename?: string): string {
  const fullPath = filename ? `${path}/${filename}` : path
  return fullPath.replace(/\s/g, '_').split('/').map(segment => encodeURIComponent(segment)).join('/')
}

// GitLab API 需要完整路径一起编码
function encodeGitLabPath(path: string, filename?: string): string {
  const fullPath = filename ? `${path}/${filename}` : path
  return encodeURIComponent(fullPath)
}

async function requestGitHub(method: string, url: string, body?: object) {
  const store = await Store.load('store.json')
  const accessToken = await store.get<string>('accessToken')

  const headers = new Headers()
  headers.append('Authorization', `Bearer ${accessToken}`)
  headers.append('Accept', 'application/vnd.github+json')
  headers.append('X-GitHub-Api-Version', '2022-11-28')
  headers.append('Content-Type', 'application/json')

  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

  if (response.status >= 200 && response.status < 300) {
    return method === 'GET' ? await response.json() : await response.json()
  }
  if (method === 'GET') return null

  const errorData = await response.json()
  throw { status: response.status, message: errorData.message || 'Request failed' }
}

async function requestGitee(method: string, url: string, body?: object) {
  const store = await Store.load('store.json')
  const giteeAccessToken = await store.get<string>('giteeAccessToken')

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')

  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

  if (response.status >= 200 && response.status < 300) {
    return method === 'GET' ? await response.json() : await response.json()
  }
  if (method === 'GET') return null

  const errorData = await response.json()
  throw { status: response.status, message: errorData.message || 'Request failed' }
}

async function requestGitLab(method: string, url: string, body?: object) {
  const store = await Store.load('store.json')
  const gitlabAccessToken = await store.get<string>('gitlabAccessToken')

  console.log('[requestGitLab] URL:', url)
  console.log('[requestGitLab] Method:', method)
  console.log('[requestGitLab] Token exists:', !!gitlabAccessToken)
  console.log('[requestGitLab] Token prefix:', gitlabAccessToken?.substring(0, 10))

  const headers = new Headers()
  headers.append('PRIVATE-TOKEN', gitlabAccessToken as string)
  headers.append('Content-Type', 'application/json')

  // 使用 @tauri-apps/plugin-http 的 fetch 避免 CORS 问题
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
  const response = await tauriFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

  console.log('[requestGitLab] Status:', response.status)

  if (response.status >= 200 && response.status < 300) {
    return method === 'GET' ? await response.json() : await response.json()
  }
  if (method === 'GET') return null

  const errorData = await response.json()
  console.log('[requestGitLab] Error:', errorData)
  throw { status: response.status, message: errorData.message || 'Request failed' }
}

async function requestGitea(method: string, url: string, body?: object) {
  const store = await Store.load('store.json')
  const giteaAccessToken = await store.get<string>('giteaAccessToken')

  const headers = new Headers()
  headers.append('Authorization', `token ${giteaAccessToken}`)
  headers.append('Content-Type', 'application/json')

  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

  if (response.status >= 200 && response.status < 300) {
    return method === 'GET' ? await response.json() : await response.json()
  }
  if (method === 'GET') return null

  const errorData = await response.json()
  throw { status: response.status, message: errorData.message || 'Request failed' }
}

// ============ GitHub 上传/下载函数 ============
async function githubUpload({ file, path, filename, sha, repo, accessToken, githubUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, githubUsername: string
}) {
  const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${encodePath(path, filename)}`
  return requestGitHub('PUT', url, { message: `Upload ${filename}`, content: file, sha })
}

async function githubGetFile({ path, repo, accessToken, githubUsername }: {
  path: string, repo: string, accessToken: string, githubUsername: string
}) {
  const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${encodePath(path)}`
  return requestGitHub('GET', url)
}

// ============ Gitee 上传/下载函数 ============
async function giteeUpload({ file, path, filename, sha, repo, accessToken, giteeUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, giteeUsername: string
}) {
  const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents/${encodePath(path, filename)}`
  return requestGitee(sha ? 'PUT' : 'POST', url, { access_token: accessToken, content: file, message: `Upload ${filename}`, branch: 'master', sha })
}

async function giteeGetFile({ path, repo, accessToken, giteeUsername }: {
  path: string, repo: string, accessToken: string, giteeUsername: string
}) {
  const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents/${encodePath(path)}?access_token=${accessToken}`
  return requestGitee('GET', url)
}

// ============ GitLab 上传/下载函数 ============
async function gitlabUpload({ file, path, filename, sha, accessToken, projectId }: {
  file: string, path: string, filename: string, sha?: string, accessToken: string, projectId: string
}) {
  const baseUrl = await getGitlabApiBaseUrl()
  const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeGitLabPath(path, filename)}`

  // 如果没有 sha，先尝试用 POST 创建
  if (!sha) {
    try {
      return await requestGitLab('POST', url, { branch: 'main', content: file, commit_message: `Upload ${filename}`, encoding: 'base64' })
    } catch (error: any) {
      // 如果是 404 错误，说明文件不存在，先获取 SHA 后再上传
      if (error.status === 404) {
        const existingFile = await gitlabGetFile({ path: `${path}/${filename}`, accessToken, projectId })
        if (existingFile) {
          sha = existingFile.file_sha || existingFile.sha
        }
      }
    }
  }

  // 如果有 sha，或者 POST 失败，用 PUT 更新
  return requestGitLab('PUT', url, { branch: 'main', content: file, commit_message: `Upload ${filename}`, encoding: 'base64', sha })
}

async function gitlabGetFile({ path, accessToken, projectId }: {
  path: string, accessToken: string, projectId: string
}) {
  const baseUrl = await getGitlabApiBaseUrl()
  const url = `${baseUrl}/projects/${projectId}/repository/files/${encodeGitLabPath(path)}?ref=main`
  return requestGitLab('GET', url)
}

// ============ Gitea 上传/下载函数 ============
async function giteaUpload({ file, path, filename, sha, repo, accessToken, giteaUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const baseUrl = await getGiteaApiBaseUrl()
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodePath(path, filename)}`

  // 如果没有 sha，先尝试用 POST 创建
  if (!sha) {
    try {
      return await requestGitea('POST', url, { content: file, message: `Upload ${filename}`, branch: 'main' })
    } catch (error: any) {
      // 如果是 422 错误，说明文件可能已存在，需要先获取 SHA
      if (error.status === 422) {
        const existingFile = await giteaGetFile({ path: `${path}/${filename}`, repo, accessToken, giteaUsername })
        if (existingFile) {
          sha = existingFile.sha
        }
      }
    }
  }

  // 如果有 sha 或者 POST 失败，用 PUT 更新
  return requestGitea('PUT', url, { content: file, message: `Upload ${filename}`, branch: 'main', sha })
}

async function giteaGetFile({ path, repo, accessToken, giteaUsername }: {
  path: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const baseUrl = await getGiteaApiBaseUrl()
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodePath(path)}?ref=main`
  return requestGitea('GET', url)
}

// ============ 方案状态类型 ============
type ProviderStatus = 'connected' | 'disconnected' | 'failed' | 'unconfigured'

interface ProviderInfo {
  platform: SyncPlatform
  name: string
  status: ProviderStatus
}

const DEFAULT_PROVIDER_LIST: ProviderInfo[] = [
  { platform: 'github', name: 'GitHub', status: 'unconfigured' },
  { platform: 'gitee', name: 'Gitee', status: 'unconfigured' },
  { platform: 'gitlab', name: 'GitLab', status: 'unconfigured' },
  { platform: 'gitea', name: 'Gitea', status: 'unconfigured' },
  { platform: 's3', name: 'S3', status: 'unconfigured' },
  { platform: 'webdav', name: 'WebDAV', status: 'unconfigured' },
]

interface SyncToggleProps {
  presentation?: 'popover' | 'drawer'
}

export function SyncToggle({ presentation = 'popover' }: SyncToggleProps) {
  const t = useTranslations()
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>(DEFAULT_PROVIDER_LIST)

  const { primaryBackupMethod, setPrimaryBackupMethod } = useSettingStore()
  const {
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
    setS3Connected,
    setWebDAVConnected
  } = useSyncStore()

  const { uploadMarks, downloadMarks, fetchMarks } = useMarkStore()
  const { uploadTags, downloadTags, fetchTags, currentTagId } = useTagStore()
  const { init } = useChatStore()
  const { loadFileTree, loadRemoteSyncFiles } = useArticleStore()

  const isMobile = isMobileDevice()

  // 加载各平台状态并自动检测
  useEffect(() => {
    async function loadProviderStatus() {
      try {
        const store = await Store.load('store.json')
        const accessToken = await store.get<string>('accessToken')
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        const githubUsername = await store.get<string>('githubUsername')
        const giteeUsername = await store.get<string>('giteeUsername')
        const giteaUsername = await store.get<string>('giteaUsername')
        const gitlabProjectId = await store.get<string>(`gitlab_${await getSyncRepoName('gitlab')}_project_id`)
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')

        // 移动端自动检测各平台状态
        if (isMobile) {
          // GitHub 检测
          if (githubUsername && accessToken && syncRepoState === SyncStateEnum.fail) {
            try {
              const { checkSyncRepoState } = await import('@/lib/sync/github')
              const repoName = await getSyncRepoName('github')
              const syncRepo = await checkSyncRepoState(repoName)
              if (syncRepo) {
                useSyncStore.getState().setSyncRepoState(SyncStateEnum.success)
              } else {
                useSyncStore.getState().setSyncRepoState(SyncStateEnum.fail)
              }
            } catch {
              useSyncStore.getState().setSyncRepoState(SyncStateEnum.fail)
            }
          }

          // Gitee 检测
          if (giteeUsername && giteeAccessToken && giteeSyncRepoState === SyncStateEnum.fail) {
            try {
              const { checkSyncRepoState } = await import('@/lib/sync/gitee')
              const repoName = await getSyncRepoName('gitee')
              const syncRepo = await checkSyncRepoState(repoName)
              if (syncRepo) {
                useSyncStore.getState().setGiteeSyncRepoState(SyncStateEnum.success)
              } else {
                useSyncStore.getState().setGiteeSyncRepoState(SyncStateEnum.fail)
              }
            } catch {
              useSyncStore.getState().setGiteeSyncRepoState(SyncStateEnum.fail)
            }
          }

          // GitLab 检测
          if (gitlabProjectId && gitlabAccessToken && gitlabSyncProjectState === SyncStateEnum.fail) {
            try {
              const { checkSyncProjectState } = await import('@/lib/sync/gitlab')
              const repoName = await getSyncRepoName('gitlab')
              const syncRepo = await checkSyncProjectState(repoName)
              if (syncRepo) {
                useSyncStore.getState().setGitlabSyncProjectState(SyncStateEnum.success)
              } else {
                useSyncStore.getState().setGitlabSyncProjectState(SyncStateEnum.fail)
              }
            } catch {
              useSyncStore.getState().setGitlabSyncProjectState(SyncStateEnum.fail)
            }
          }

          // Gitea 检测
          if (giteaUsername && giteaAccessToken && giteaSyncRepoState === SyncStateEnum.fail) {
            try {
              const { checkSyncRepoState } = await import('@/lib/sync/gitea')
              const repoName = await getSyncRepoName('gitea')
              const syncRepo = await checkSyncRepoState(repoName)
              if (syncRepo) {
                useSyncStore.getState().setGiteaSyncRepoState(SyncStateEnum.success)
              } else {
                useSyncStore.getState().setGiteaSyncRepoState(SyncStateEnum.fail)
              }
            } catch {
              useSyncStore.getState().setGiteaSyncRepoState(SyncStateEnum.fail)
            }
          }
        }

      const providerList: ProviderInfo[] = []

      // GitHub
      let githubStatus: ProviderStatus = 'unconfigured'
      if (githubUsername && accessToken) {
        githubStatus = syncRepoState === SyncStateEnum.success ? 'connected' : syncRepoState === SyncStateEnum.fail ? 'failed' : 'disconnected'
      }
      providerList.push({ platform: 'github', name: 'GitHub', status: githubStatus })

      // Gitee
      let giteeStatus: ProviderStatus = 'unconfigured'
      if (giteeUsername && giteeAccessToken) {
        giteeStatus = giteeSyncRepoState === SyncStateEnum.success ? 'connected' : giteeSyncRepoState === SyncStateEnum.fail ? 'failed' : 'disconnected'
      }
      providerList.push({ platform: 'gitee', name: 'Gitee', status: giteeStatus })

      // GitLab
      let gitlabStatus: ProviderStatus = 'unconfigured'
      if (gitlabProjectId && gitlabAccessToken) {
        gitlabStatus = gitlabSyncProjectState === SyncStateEnum.success ? 'connected' : gitlabSyncProjectState === SyncStateEnum.fail ? 'failed' : 'disconnected'
      }
      providerList.push({ platform: 'gitlab', name: 'GitLab', status: gitlabStatus })

      // Gitea
      let giteaStatus: ProviderStatus = 'unconfigured'
      if (giteaUsername && giteaAccessToken) {
        giteaStatus = giteaSyncRepoState === SyncStateEnum.success ? 'connected' : giteaSyncRepoState === SyncStateEnum.fail ? 'failed' : 'disconnected'
      }
      providerList.push({ platform: 'gitea', name: 'Gitea', status: giteaStatus })

      // S3
      let s3Status: ProviderStatus = 'unconfigured'
      if (s3Config?.bucket) {
        s3Status = s3Connected ? 'connected' : 'failed'
      }
      providerList.push({ platform: 's3', name: 'S3', status: s3Status })

      // WebDAV
      let webdavStatus: ProviderStatus = 'unconfigured'
      if (webdavConfig?.url && webdavConfig?.username && webdavConfig?.password) {
        webdavStatus = webdavConnected ? 'connected' : 'failed'
      }
      providerList.push({ platform: 'webdav', name: 'WebDAV', status: webdavStatus })

      setProviders(providerList)
      } catch (error) {
        console.error('[SyncToggle] Error loading provider status:', error)
      }
    }

    // 检测 S3 连接状态
    async function checkS3Status() {
      const store = await Store.load('store.json')
      const s3Config = await store.get<S3Config>('s3SyncConfig')
      if (s3Config?.bucket) {
        const isConnected = await testS3Connection(s3Config).catch(() => false)
        setS3Connected(isConnected)
      }
    }

    // 检测 WebDAV 连接状态
    async function checkWebDAVStatus() {
      const store = await Store.load('store.json')
      const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (webdavConfig?.url && webdavConfig?.username && webdavConfig?.password) {
        const isConnected = await testWebDAVConnection(webdavConfig).catch(() => false)
        setWebDAVConnected(isConnected)
      }
    }

    loadProviderStatus()

    // 弹窗打开时检测 S3 和 WebDAV 连接状态
    if (open) {
      checkS3Status()
      checkWebDAVStatus()
    }
  }, [open, syncRepoState, giteeSyncRepoState, gitlabSyncProjectState, giteaSyncRepoState, s3Connected, webdavConnected])

  // 获取当前方案的显示文本
  const getCurrentProviderDisplay = () => {
    const current = providers.find(p => p.platform === primaryBackupMethod)
    if (!current) {
      return DEFAULT_PROVIDER_LIST.find((provider) => provider.platform === primaryBackupMethod)?.name || ''
    }

    // 已配置时只显示名称，未配置时显示名称 + "未配置"
    if (current.status === 'unconfigured') {
      return `${current.name} ${t('settings.sync.status.unconfigured')}`
    }
    return current.name
  }

  // 获取状态图标
  const getStatusIcon = (status: ProviderStatus) => {
    if (status === 'connected') {
      return <span className="text-green-500">●</span>
    } else if (status === 'failed') {
      return <span className="text-red-500">●</span>
    } else if (status === 'disconnected') {
      return <span className="text-yellow-500">●</span>
    }
    return <span className="text-zinc-400">○</span>
  }

  // 处理方案切换
  const handleProviderChange = async (value: string) => {
    const selectedProvider = providers.find(p => p.platform === value)

    // 如果选择了未配置的方案，跳转到设置页面
    if (selectedProvider?.status === 'unconfigured') {
      await setPrimaryBackupMethod(value as SyncPlatform)
      // 跳转到同步设置页面，区分移动端和 PC 端
      const settingPath = isMobile ? '/mobile/setting/pages/sync' : '/core/setting?anchor=sync'
      router.push(settingPath)
      return
    }

    // 如果是 S3 或 WebDAV，切换后重新检测连接状态
    if (value === 's3' || value === 'webdav') {
      const store = await Store.load('store.json')
      if (value === 's3') {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config?.bucket) {
          const isConnected = await testS3Connection(s3Config).catch(() => false)
          setS3Connected(isConnected)
        }
      } else if (value === 'webdav') {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig?.url && webdavConfig?.username && webdavConfig?.password) {
          const isConnected = await testWebDAVConnection(webdavConfig).catch(() => false)
          setWebDAVConnected(isConnected)
        }
      }
    }

    await setPrimaryBackupMethod(value as SyncPlatform)

    // 切换方案后重新加载文件列表
    await loadFileTree()
    await loadRemoteSyncFiles()
  }

  // 上传到云端
  async function uploadAll() {
    const confirmRef = await confirm(t('settings.uploadStore.uploadConfirm'))
    if (!confirmRef) return
    setSyncing(true)

    try {
      const tagRes = await uploadTags()
      const markRes = await uploadMarks()

      const path = '.settings'
      const filename = 'store.json'

      const store = await Store.load('store.json');
      const allSettings: Record<string, any> = {}
      const entries = await store.entries()
      for (const [key, value] of entries) {
        allSettings[key] = value
      }

      const syncableSettings = filterSyncData(allSettings)
      const filteredContent = JSON.stringify(syncableSettings, null, 2)
      const file = new TextEncoder().encode(filteredContent)

      const primaryBackupMethod = await store.get<string>('primaryBackupMethod')
      const accessToken = await store.get<string>('accessToken')
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      const githubUsername = await store.get<string>('githubUsername')
      const giteeUsername = await store.get<string>('giteeUsername')
      const giteaUsername = await store.get<string>('giteaUsername')
      const gitlabProjectId = await store.get<string>(`gitlab_${await getSyncRepoName('gitlab')}_project_id`)
      let settingsRes;

      switch (primaryBackupMethod) {
        case 'github': {
          const githubRepo = await getSyncRepoName('github')
          const existingFile = await githubGetFile({ path: `${path}/${filename}`, repo: githubRepo, accessToken: accessToken!, githubUsername: githubUsername! })
          settingsRes = await githubUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            repo: githubRepo,
            accessToken: accessToken!,
            githubUsername: githubUsername!,
          })
          break;
        }
        case 'gitee': {
          const giteeRepo = await getSyncRepoName('gitee')
          const existingFile = await giteeGetFile({ path: `${path}/${filename}`, repo: giteeRepo, accessToken: giteeAccessToken!, giteeUsername: giteeUsername! })
          settingsRes = await giteeUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            repo: giteeRepo,
            accessToken: giteeAccessToken!,
            giteeUsername: giteeUsername!,
          })
          break;
        }
        case 'gitlab': {
          console.log('[uploadAll] GitLab - path:', path, 'filename:', filename, 'projectId:', gitlabProjectId)
          const existingFile = await gitlabGetFile({ path: `${path}/${filename}`, accessToken: gitlabAccessToken!, projectId: gitlabProjectId! })
          console.log('[uploadAll] GitLab existingFile:', existingFile)
          settingsRes = await gitlabUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            accessToken: gitlabAccessToken!,
            projectId: gitlabProjectId!,
          })
          break;
        }
        case 'gitea': {
          const giteaRepo = await getSyncRepoName('gitea')
          const existingFile = await giteaGetFile({ path: `${path}/${filename}`, repo: giteaRepo, accessToken: giteaAccessToken!, giteaUsername: giteaUsername! })
          settingsRes = await giteaUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            repo: giteaRepo,
            accessToken: giteaAccessToken!,
            giteaUsername: giteaUsername!,
          })
          break;
        }
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            const s3Key = `${path}/${filename}`
            const existingFile = await s3HeadObject(s3Config, s3Key)
            if (existingFile) {
              await s3Delete(s3Config, s3Key)
            }
            const result = await s3Upload(s3Config, s3Key, filteredContent)
            settingsRes = result ? { success: true } : null
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            const webdavKey = `${path}/${filename}`
            const existingFile = await webdavHeadObject(webdavConfig, webdavKey)
            if (existingFile) {
              await webdavDelete(webdavConfig, webdavKey)
            }
            const result = await webdavUpload(webdavConfig, webdavKey, filteredContent)
            settingsRes = result ? { success: true } : null
          }
          break;
        }
      }

      if (tagRes && markRes && settingsRes) {
        toast({
          description: t('record.mark.uploadSuccess'),
        })
      }
    } catch (error) {
      console.error('Upload failed:', error)
      toast({
        description: t('common.error'),
        variant: 'destructive'
      })
    }

    setSyncing(false)
  }

  // 从云端下载
  async function downloadAll() {
    const res = await confirm(t('settings.uploadStore.downloadConfirm'))
    if (!res) return
    setSyncing(true)

    try {
      const tagRes = await downloadTags()
      const markRes = await downloadMarks()

      if (tagRes && markRes) {
        await fetchTags()
        await fetchMarks()
        init(currentTagId)
      }

      const path = '.settings'
      const filename = 'store.json'
      const store = await Store.load('store.json');

      const localSettings: Record<string, any> = {}
      const entries = await store.entries()
      for (const [key, value] of entries) {
        localSettings[key] = value
      }

      const primaryBackupMethod = await store.get<string>('primaryBackupMethod')
      const accessToken = await store.get<string>('accessToken')
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      const githubUsername = await store.get<string>('githubUsername')
      const giteeUsername = await store.get<string>('giteeUsername')
      const giteaUsername = await store.get<string>('giteaUsername')
      const gitlabProjectId = await store.get<string>(`gitlab_${await getSyncRepoName('gitlab')}_project_id`)
      let remoteFile;

      switch (primaryBackupMethod) {
        case 'github': {
          const githubRepo = await getSyncRepoName('github')
          remoteFile = await githubGetFile({ path: `${path}/${filename}`, repo: githubRepo, accessToken: accessToken!, githubUsername: githubUsername! })
          break;
        }
        case 'gitee': {
          const giteeRepo = await getSyncRepoName('gitee')
          remoteFile = await giteeGetFile({ path: `${path}/${filename}`, repo: giteeRepo, accessToken: giteeAccessToken!, giteeUsername: giteeUsername! })
          break;
        }
        case 'gitlab': {
          remoteFile = await gitlabGetFile({ path: `${path}/${filename}`, accessToken: gitlabAccessToken!, projectId: gitlabProjectId! })
          break;
        }
        case 'gitea': {
          const giteaRepo = await getSyncRepoName('gitea')
          remoteFile = await giteaGetFile({ path: `${path}/${filename}`, repo: giteaRepo, accessToken: giteaAccessToken!, giteaUsername: giteaUsername! })
          break;
        }
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            const s3Key = `${path}/${filename}`
            const content = await s3Download(s3Config, s3Key)
            if (content) {
              remoteFile = { content }
            }
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            const webdavKey = `${path}/${filename}`
            const content = await webdavDownload(webdavConfig, webdavKey)
            if (content) {
              remoteFile = { content }
            }
          }
          break;
        }
      }

      if (remoteFile) {
        let remoteSettings: Record<string, any>
        if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
          const s3Content = (remoteFile as any).content?.content
          remoteSettings = JSON.parse(s3Content)
        } else {
          const configJson = decodeBase64ToString(getRemoteFileContent(remoteFile, `${path}/${filename}`))
          remoteSettings = JSON.parse(configJson)
        }

        const mergedSettings = mergeSyncData(localSettings, remoteSettings)

        const keys = Object.keys(mergedSettings)
        await Promise.allSettled(keys.map(async key => await store.set(key, mergedSettings[key])))
        await store.save()

        toast({
          description: t('record.mark.downloadSuccess') + t('common.restartToApply'),
        })
      }
    } catch (error) {
      console.error('Download failed:', error)
      toast({
        description: t('common.error'),
        variant: 'destructive'
      })
    }

    setSyncing(false)
  }

  // 导出本地备份
  async function handleExport() {
    try {
      setExporting(true);

      let filePath: string;

      if (isMobile) {
        filePath = `note-gen-backup-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
      } else {
        const selectedPath = await save({
          title: t('settings.backupSync.localBackup.exportDialog.title'),
          defaultPath: `note-gen-backup-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`,
          filters: [{
            name: 'ZIP Files',
            extensions: ['zip']
          }]
        });

        if (!selectedPath) {
          setExporting(false);
          return;
        }
        filePath = selectedPath;
      }

      const savedPath = await invoke<string>('export_app_data', { outputPath: filePath });

      toast({
        title: t('settings.backupSync.localBackup.exportSuccess'),
        description: isMobile
          ? `文件已保存到: ${savedPath}\n请在 Files App 中查看`
          : savedPath,
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: t('settings.backupSync.localBackup.exportError'),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  // 导入本地备份
  async function handleImport() {
    try {
      setImporting(true);

      if (isMobile) {
        // 移动端 TODO: 需要实现文件选择
        toast({
          description: t('settings.backupSync.localBackup.importError'),
          variant: "destructive",
        });
        setImporting(false);
        return;
      }

      const filePath = await openDialog({
        title: t('settings.backupSync.localBackup.importDialog.title'),
        multiple: false,
        directory: false,
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip']
        }]
      });

      if (!filePath) {
        setImporting(false);
        return;
      }

      await invoke('import_app_data', { zipPath: filePath });

      const shouldRestart = await confirm(t('settings.backupSync.localBackup.restartConfirm'), {
        title: t('settings.backupSync.localBackup.importSuccess'),
        kind: 'info'
      });

      if (shouldRestart) {
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: t('settings.backupSync.localBackup.importError'),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  const syncButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      disabled={syncing || exporting || importing}
    >
      {syncing || exporting || importing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <CloudSync className="h-4 w-4" />
      )}
    </Button>
  )

  const syncPanel = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
        <span className="text-xs text-zinc-400">{t('settings.sync.cloudSync')}</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
      </div>

      <div>
        <Select value={primaryBackupMethod} onValueChange={handleProviderChange}>
          <SelectTrigger className="w-full">
            <span className="flex items-center gap-2">
              <span className="mr-2">
                {getStatusIcon(providers.find(p => p.platform === primaryBackupMethod)?.status || 'unconfigured')}
              </span>
              <SelectValue placeholder={t('settings.sync.selectPlatform')}>
                {getCurrentProviderDisplay()}
              </SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider.platform} value={provider.platform}>
                <span className="flex items-center gap-2">
                  <span>{provider.name}</span>
                  {provider.status === 'unconfigured' && (
                    <span className="text-zinc-400 text-xs ml-auto">
                      {t('settings.sync.status.unconfigured')}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={uploadAll}
          disabled={syncing}
        >
          <UploadCloud className="mr-2 h-4 w-4" />
          {t('settings.sync.uploadRecords')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadAll}
          disabled={syncing}
        >
          <DownloadCloud className="mr-2 h-4 w-4" />
          {t('settings.sync.downloadConfig')}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
        <span className="text-xs text-zinc-400">{t('settings.sync.localBackupAll')}</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          <Download className="mr-2 h-4 w-4" />
          {t('settings.backupSync.localBackup.export.button')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleImport}
          disabled={importing}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t('settings.backupSync.localBackup.import.button')}
        </Button>
      </div>
    </div>
  )

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {syncButton}
        </DrawerTrigger>
        <DrawerContent className="max-h-[82vh] rounded-t-[24px]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t('common.sync')}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {syncPanel}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {syncButton}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t('common.sync')}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        {syncPanel}
      </PopoverContent>
    </Popover>
  )
}
