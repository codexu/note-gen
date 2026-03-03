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
import { useState } from 'react'
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"
import { Store } from "@tauri-apps/plugin-store"
import { uint8ArrayToBase64, decodeBase64ToString } from "@/lib/sync/github"
import { getSyncRepoName } from "@/lib/sync/repo-utils"
import { filterSyncData, mergeSyncData } from "@/config/sync-exclusions"
import { confirm } from "@tauri-apps/plugin-dialog"

// ============ GitHub 上传/下载函数 ============
async function githubUpload({ file, path, filename, sha, repo, accessToken, githubUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, githubUsername: string
}) {
  // 构建完整的文件路径
  const fullPath = `/${path}/${filename}`.replace(/\s/g, '_')
  const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents${encodedPath}`

  const base64Content = Buffer.from(file, 'utf-8').toString('base64')

  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');
  headers.append('Content-Type', 'application/json');

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Upload ${filename}`,
      content: base64Content,
      sha
    })
  });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  const errorData = await response.json();
  throw { status: response.status, message: errorData.message || 'Upload failed' };
}

async function githubGetFile({ path, repo, accessToken, githubUsername }: {
  path: string, repo: string, accessToken: string, githubUsername: string
}) {
  const fullPath = `/${path}`.replace(/\s/g, '_')
  const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents${encodedPath}`

  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');

  const response = await fetch(url, { method: 'GET', headers });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  return null;
}

// ============ Gitee 上传/下载函数 ============
async function giteeUpload({ file, path, filename, sha, repo, accessToken, giteeUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, giteeUsername: string
}) {
  const fullPath = `/${path}/${filename}`.replace(/\s/g, '_')
  const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents${encodedPath}`

  const base64Content = Buffer.from(file, 'utf-8').toString('base64')

  const headers = new Headers();
  headers.append('Content-Type', 'application/json');

  const response = await fetch(url, {
    method: sha ? 'PUT' : 'POST',
    headers,
    body: JSON.stringify({
      access_token: accessToken,
      content: base64Content,
      message: `Upload ${filename}`,
      branch: 'master',
      sha
    })
  });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  const errorData = await response.json();
  throw { status: response.status, message: errorData.message || 'Upload failed' };
}

async function giteeGetFile({ path, repo, accessToken, giteeUsername }: {
  path: string, repo: string, accessToken: string, giteeUsername: string
}) {
  const fullPath = `/${path}`.replace(/\s/g, '_')
  const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents${encodedPath}?access_token=${accessToken}`

  const response = await fetch(url, { method: 'GET' });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  return null;
}

// ============ GitLab 上传/下载函数 ============
async function gitlabUpload({ file, path, filename, sha: _sha, accessToken, projectId }: {
  file: string, path: string, filename: string, sha?: string, accessToken: string, projectId: string
}) {
  const fullPath = `${path}/${filename}`.replace(/\s/g, '_')
  const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/')

  const baseUrl = 'https://gitlab.com/api/v4'
  const url = `${baseUrl}/projects/${projectId}/repository/files/${encodedPath}`

  const base64Content = Buffer.from(file, 'utf-8').toString('base64')

  const headers = new Headers();
  headers.append('PRIVATE-TOKEN', accessToken);
  headers.append('Content-Type', 'application/json');

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      branch: 'main',
      content: base64Content,
      commit_message: `Upload ${filename}`,
      encoding: 'base64'
    })
  });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  const errorData = await response.json();
  throw { status: response.status, message: errorData.message || 'Upload failed' };
}

async function gitlabGetFile({ path, accessToken, projectId }: {
  path: string, accessToken: string, projectId: string
}) {
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const baseUrl = 'https://gitlab.com/api/v4'
  const url = `${baseUrl}/projects/${projectId}/repository/files/${encodedPath}?ref=main`

  const headers = new Headers();
  headers.append('PRIVATE-TOKEN', accessToken);

  const response = await fetch(url, { method: 'GET', headers });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  return null;
}

// ============ Gitea 上传/下载函数 ============
async function giteaUpload({ file, path, filename, sha, repo, accessToken, giteaUsername }: {
  file: string, path: string, filename: string, sha?: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const fullPath = `${path}/${filename}`.replace(/\s/g, '_')
  const normalizedPath = fullPath.split('/').map((p, i) => {
    if (i === fullPath.split('/').length - 1) return p
    return encodeURIComponent(p.replace(/\s/g, '_'))
  }).join('/')

  const baseUrl = 'https://gitea.com/api/v1'
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents/${normalizedPath}`

  const base64Content = Buffer.from(file, 'utf-8').toString('base64')

  const headers = new Headers();
  headers.append('Content-Type', 'application/json');

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      content: base64Content,
      message: `Upload ${filename}`,
      branch: 'main',
      sha
    })
  });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  const errorData = await response.json();
  throw { status: response.status, message: errorData.message || 'Upload failed' };
}

async function giteaGetFile({ path, repo, accessToken, giteaUsername }: {
  path: string, repo: string, accessToken: string, giteaUsername: string
}) {
  const fullPath = `/${path}`.replace(/\s/g, '_')
  const normalizedPath = fullPath.split('/').map((p, i) => {
    if (i === fullPath.split('/').length - 1) return p
    return encodeURIComponent(p.replace(/\s/g, '_'))
  }).join('/')

  const baseUrl = 'https://gitea.com/api/v1'
  const url = `${baseUrl}/repos/${giteaUsername}/${repo}/contents${normalizedPath}?ref=main`

  const headers = new Headers();
  headers.append('Authorization', `token ${accessToken}`);

  const response = await fetch(url, { method: 'GET', headers });

  if (response.status >= 200 && response.status < 300) {
    return await response.json();
  }

  return null;
}

export function SyncToggle() {
  const t = useTranslations()
  const username = useUsername()
  const [syncing, setSyncing] = useState(false)

  const { primaryBackupMethod } = useSettingStore()
  const providerNames: Record<string, string> = {
    'github': 'Github',
    'gitee': 'Gitee',
    'gitlab': 'Gitlab',
    'gitea': 'Gitea'
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
      const chatRes = await uploadChats()
      
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
      }
      
      if (tagRes && markRes && chatRes && settingsRes) {
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
      const chatRes = await downloadChats()
      
      if (tagRes && markRes && chatRes) {
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
      }

      if (remoteFile) {
        const configJson = decodeBase64ToString(remoteFile.content)
        const remoteSettings = JSON.parse(configJson)
        
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

  if (!username) {
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
