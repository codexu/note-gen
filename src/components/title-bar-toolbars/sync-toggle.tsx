"use client"

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import * as React from "react"
import { DownloadCloud, Loader2, UploadCloud, CloudSync } from "lucide-react"
import { useTranslations } from 'next-intl'
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from '@/hooks/use-toast'
import useUsername from '@/hooks/use-username'
import { useState, useEffect } from 'react'
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"
import { Store } from "@tauri-apps/plugin-store"
import { uint8ArrayToBase64, decodeBase64ToString } from "@/lib/sync/github"
import { getSyncRepoName } from "@/lib/sync/repo-utils"
import { getGiteaApiBaseUrl } from "@/lib/sync/gitea"
import { s3Upload, s3Download, s3HeadObject, s3Delete } from "@/lib/sync/s3"
import { S3Config } from "@/types/sync"
import { filterSyncData, mergeSyncData } from "@/config/sync-exclusions"
import { confirm } from "@tauri-apps/plugin-dialog"

// ============ 通用辅助函数 ============
function encodePath(path: string, filename?: string): string {
  const fullPath = filename ? `${path}/${filename}` : path
  return fullPath.replace(/\s/g, '_').split('/').map(segment => encodeURIComponent(segment)).join('/')
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
  const accessToken = await store.get<string>('accessToken')

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
  const accessToken = await store.get<string>('accessToken')

  const headers = new Headers()
  headers.append('PRIVATE-TOKEN', accessToken as string)
  headers.append('Content-Type', 'application/json')

  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })

  if (response.status >= 200 && response.status < 300) {
    return method === 'GET' ? await response.json() : await response.json()
  }
  if (method === 'GET') return null

  const errorData = await response.json()
  throw { status: response.status, message: errorData.message || 'Request failed' }
}

async function requestGitea(method: string, url: string, body?: object) {
  const store = await Store.load('store.json')
  const accessToken = await store.get<string>('accessToken')

  const headers = new Headers()
  headers.append('Authorization', `token ${accessToken}`)
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
async function gitlabUpload({ file, path, filename, sha: _sha, accessToken, projectId }: {
  file: string, path: string, filename: string, sha?: string, accessToken: string, projectId: string
}) {
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodePath(path, filename)}`
  return requestGitLab('PUT', url, { branch: 'main', content: file, commit_message: `Upload ${filename}`, encoding: 'base64' })
}

async function gitlabGetFile({ path, accessToken, projectId }: {
  path: string, accessToken: string, projectId: string
}) {
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodePath(path)}?ref=main`
  return requestGitLab('GET', url)
}

// ============ Gitea 上传/下载函数 ============
async function giteaUpload({ file, path, filename, sha, repo, accessToken, giteaUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const baseUrl = await getGiteaApiBaseUrl()
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodePath(path, filename)}`
  return requestGitea('PUT', url, { content: file, message: `Upload ${filename}`, branch: 'main', sha })
}

async function giteaGetFile({ path, repo, accessToken, giteaUsername }: {
  path: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const baseUrl = await getGiteaApiBaseUrl()
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${encodePath(path)}?ref=main`
  return requestGitea('GET', url)
}

export function SyncToggle() {
  const t = useTranslations()
  const username = useUsername()
  const [syncing, setSyncing] = useState(false)
  const [s3Configured, setS3Configured] = useState(false)

  const { primaryBackupMethod } = useSettingStore()

  // 检测 S3 是否配置
  useEffect(() => {
    async function checkS3() {
      if (primaryBackupMethod === 's3') {
        const store = await Store.load('store.json')
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        setS3Configured(!!s3Config?.bucket)
      }
    }
    checkS3()
  }, [primaryBackupMethod])
  const providerNames: Record<string, string> = {
    'github': 'Github',
    'gitee': 'Gitee',
    'gitlab': 'Gitlab',
    'gitea': 'Gitea',
    's3': 'S3'
  }
  const syncProvider = primaryBackupMethod ? providerNames[primaryBackupMethod] || primaryBackupMethod : ''

  const { uploadMarks, downloadMarks, fetchMarks } = useMarkStore()
  const { uploadTags, downloadTags, fetchTags, currentTagId } = useTagStore()
  const { uploadChats, downloadChats, init } = useChatStore()

  async function uploadAll() {
    const confirmRef = await confirm(t('settings.uploadStore.uploadConfirm'))
    if (!confirmRef) return
    setSyncing(true)
    
    try {
      // 上传数据（tags, marks, chats）
      const tagRes = await uploadTags()
      const markRes = await uploadMarks()
      
      // 上传配置
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
      const githubUsername = await store.get<string>('githubUsername')
      const giteeUsername = await store.get<string>('giteeUsername')
      const gitlabProjectId = await store.get<string>(`gitlab_${await getSyncRepoName('gitlab')}_project_id`)
      const giteaUsername = await store.get<string>('giteaUsername')
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
          const existingFile = await giteeGetFile({ path: `${path}/${filename}`, repo: giteeRepo, accessToken: accessToken!, giteeUsername: giteeUsername! })
          settingsRes = await giteeUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            repo: giteeRepo,
            accessToken: accessToken!,
            giteeUsername: giteeUsername!,
          })
          break;
        }
        case 'gitlab': {
          const existingFile = await gitlabGetFile({ path: `${path}/${filename}`, accessToken: accessToken!, projectId: gitlabProjectId! })
          settingsRes = await gitlabUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            accessToken: accessToken!,
            projectId: gitlabProjectId!,
          })
          break;
        }
        case 'gitea': {
          const giteaRepo = await getSyncRepoName('gitea')
          const existingFile = await giteaGetFile({ path: `${path}/${filename}`, repo: giteaRepo, accessToken: accessToken!, giteaUsername: giteaUsername! })
          settingsRes = await giteaUpload({
            file: uint8ArrayToBase64(file),
            path,
            filename,
            sha: existingFile?.sha,
            repo: giteaRepo,
            accessToken: accessToken!,
            giteaUsername: giteaUsername!,
          })
          break;
        }
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            const s3Key = `${path}/${filename}`
            // 检查文件是否存在
            const existingFile = await s3HeadObject(s3Config, s3Key)
            if (existingFile) {
              // 存在则先删除再上传（S3 不支持更新文件）
              await s3Delete(s3Config, s3Key)
            }
            const result = await s3Upload(s3Config, s3Key, filteredContent)
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

  async function downloadAll() {
    const res = await confirm(t('settings.uploadStore.downloadConfirm'))
    if (!res) return
    setSyncing(true)
    
    try {
      // 下载数据（tags, marks, chats）
      const tagRes = await downloadTags()
      const markRes = await downloadMarks()
      
      if (tagRes && markRes) {
        await fetchTags()
        await fetchMarks()
        init(currentTagId)
      }
      
      // 下载配置
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
      const githubUsername = await store.get<string>('githubUsername')
      const giteeUsername = await store.get<string>('giteeUsername')
      const gitlabProjectId = await store.get<string>(`gitlab_${await getSyncRepoName('gitlab')}_project_id`)
      const giteaUsername = await store.get<string>('giteaUsername')
      let remoteFile;

      switch (primaryBackupMethod) {
        case 'github': {
          const githubRepo = await getSyncRepoName('github')
          remoteFile = await githubGetFile({ path: `${path}/${filename}`, repo: githubRepo, accessToken: accessToken!, githubUsername: githubUsername! })
          break;
        }
        case 'gitee': {
          const giteeRepo = await getSyncRepoName('gitee')
          remoteFile = await giteeGetFile({ path: `${path}/${filename}`, repo: giteeRepo, accessToken: accessToken!, giteeUsername: giteeUsername! })
          break;
        }
        case 'gitlab': {
          remoteFile = await gitlabGetFile({ path: `${path}/${filename}`, accessToken: accessToken!, projectId: gitlabProjectId! })
          break;
        }
        case 'gitea': {
          const giteaRepo = await getSyncRepoName('gitea')
          remoteFile = await giteaGetFile({ path: `${path}/${filename}`, repo: giteaRepo, accessToken: accessToken!, giteaUsername: giteaUsername! })
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
      }

      if (remoteFile) {
        // S3 返回的 content 是字符串，Git 平台需要 base64 解码
        let remoteSettings: Record<string, any>
        if (primaryBackupMethod === 's3') {
          // s3Download 返回 { content: string; etag: string; lastModified: string }
          // remoteFile.content 是整个对象，需要取 .content 属性
          const s3Content = (remoteFile as any).content?.content
          remoteSettings = JSON.parse(s3Content)
        } else {
          const configJson = decodeBase64ToString(remoteFile.content)
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

  // Git 平台需要用户名，S3 需要配置
  const isConfigured = username || (primaryBackupMethod === 's3' && s3Configured)
  if (!isConfigured) {
    return null
  }

  return (
    <DropdownMenu onOpenChange={(open) => {
        if (!open) {
          setTimeout(() => {
            (document.activeElement as HTMLElement)?.blur()
          }, 0)
        }
      }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudSync className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('common.sync')}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={uploadAll}>
            <UploadCloud className="mr-2 h-4 w-4" />
            {syncProvider ? t('record.mark.type.uploadTo', { provider: syncProvider }) : t('record.mark.type.upload')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={downloadAll}>
            <DownloadCloud className="mr-2 h-4 w-4" />
            {syncProvider ? t('record.mark.type.downloadFrom', { provider: syncProvider }) : t('record.mark.type.download')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
  )
}
