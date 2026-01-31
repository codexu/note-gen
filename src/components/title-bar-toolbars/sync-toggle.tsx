"use client"

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
import { Store } from "@tauri-apps/plugin-store"
import { uint8ArrayToBase64, uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from "@/lib/sync/github"
import { getFiles as giteeGetFiles, uploadFile as uploadGiteeFile } from "@/lib/sync/gitee"
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from "@/lib/sync/gitlab"
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from "@/lib/sync/gitea"
import { getSyncRepoName } from "@/lib/sync/repo-utils"
import { filterSyncData, mergeSyncData } from "@/config/sync-exclusions"
import { confirm } from "@tauri-apps/plugin-dialog"

export function SyncToggle() {
  const t = useTranslations()
  const username = useUsername()
  const [syncing, setSyncing] = useState(false)
  const [syncProvider, setSyncProvider] = useState<string>('')
  
  const { uploadMarks, downloadMarks, fetchMarks } = useMarkStore()
  const { uploadTags, downloadTags, fetchTags, currentTagId } = useTagStore()
  const { uploadChats, downloadChats, init } = useChatStore()

  React.useEffect(() => {
    const loadSyncProvider = async () => {
      const store = await Store.load('store.json')
      const primaryBackupMethod = await store.get('primaryBackupMethod') as string
      if (primaryBackupMethod) {
        const providerNames: Record<string, string> = {
          'github': 'Github',
          'gitee': 'Gitee',
          'gitlab': 'Gitlab',
          'gitea': 'Gitea'
        }
        setSyncProvider(providerNames[primaryBackupMethod] || primaryBackupMethod)
      }
    }
    loadSyncProvider()
  }, [])

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
      
      const primaryBackupMethod = await store.get('primaryBackupMethod')
      let files: any;
      let settingsRes;
      
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo = await getSyncRepoName('github')
          files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo })
          settingsRes = await uploadGithubFile({
            ext: 'json',
            file: uint8ArrayToBase64(file),
            repo: githubRepo,
            path,
            filename,
            sha: files?.sha,
          })
          break;
        case 'gitee':
          const giteeRepo = await getSyncRepoName('gitee')
          files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo })
          settingsRes = await uploadGiteeFile({
            ext: 'json',
            file: uint8ArrayToBase64(file),
            repo: giteeRepo,
            path,
            filename,
            sha: files?.sha,
          })
          break;
        case 'gitlab':
          const gitlabRepo = await getSyncRepoName('gitlab')
          files = await gitlabGetFiles({ path, repo: gitlabRepo })
          const storeFile = Array.isArray(files)
            ? files.find(file => file.name === filename)
            : (files?.name === filename ? files : undefined)
          settingsRes = await uploadGitlabFile({
            ext: 'json',
            file: uint8ArrayToBase64(file),
            repo: gitlabRepo,
            path,
            filename,
            sha: storeFile?.sha || '',
          })
          break;
        case 'gitea':
          const giteaRepo = await getSyncRepoName('gitea')
          files = await giteaGetFiles({ path, repo: giteaRepo })
          const giteaStoreFile = Array.isArray(files) 
            ? files.find(file => file.name === filename)
            : (files?.name === filename ? files : undefined)
          settingsRes = await uploadGiteaFile({
            ext: 'json',
            file: uint8ArrayToBase64(file),
            repo: giteaRepo,
            path,
            filename,
            sha: giteaStoreFile?.sha || '',
          })
          break;
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
      
      const primaryBackupMethod = await store.get('primaryBackupMethod')
      let file;
      
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo2 = await getSyncRepoName('github')
          file = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo2 })
          break;
        case 'gitee':
          const giteeRepo2 = await getSyncRepoName('gitee')
          file = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo2 })
          break;
        case 'gitlab':
          const gitlabRepo2 = await getSyncRepoName('gitlab')
          file = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepo2 })
          break;
        case 'gitea':
          const giteaRepo2 = await getSyncRepoName('gitea')
          file = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepo2 })
          break;
      }
      
      if (file) {
        const configJson = decodeBase64ToString(file.content)
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
