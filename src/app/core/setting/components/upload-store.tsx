import { Button } from "@/components/ui/button";
import { DownloadCloud, Loader2, UploadCloud } from "lucide-react";
import { Store } from "@tauri-apps/plugin-store";
import { uint8ArrayToBase64, uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from "@/lib/sync/github";
import { getFiles as giteeGetFiles, uploadFile as uploadGiteeFile } from "@/lib/sync/gitee";
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from "@/lib/sync/gitlab";
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from "@/lib/sync/gitea";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import { isMobileDevice } from "@/lib/check";
import { relaunch } from "@tauri-apps/plugin-process";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useTranslations } from "next-intl";
import useUsername from "@/hooks/use-username";
import { filterSyncData, mergeSyncData } from "@/config/sync-exclusions";

export default function UploadStore() {
  const [upLoading, setUploading] = useState(false)
  const [downLoading, setDownLoading] = useState(false)
  const t = useTranslations('settings.uploadStore')
  const username = useUsername()

  async function upload() {
    const confirmRef = await confirm(t('uploadConfirm'))
    if (!confirmRef) return
    setUploading(true)
    const path = '.settings'
    const filename = 'store.json'
    
    // 读取并过滤配置
    const store = await Store.load('store.json');
    const allSettings: Record<string, any> = {}
    const entries = await store.entries()
    for (const [key, value] of entries) {
      allSettings[key] = value
    }
    
    // 过滤掉不应同步的字段（如工作区路径等）
    const syncableSettings = filterSyncData(allSettings)
    const filteredContent = JSON.stringify(syncableSettings, null, 2)
    const file = new TextEncoder().encode(filteredContent)
    
    const primaryBackupMethod = await store.get('primaryBackupMethod')
    let files: any;
    let res;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo })
        res = await uploadGithubFile({
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
        res = await uploadGiteeFile({
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
        res = await uploadGitlabFile({
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
        res = await uploadGiteaFile({
          ext: 'json',
          file: uint8ArrayToBase64(file),
          repo: giteaRepo,
          path,
          filename,
          sha: giteaStoreFile?.sha || '',
        })
        break;
    }
    if (res) {
      toast({
        description: t('uploadSuccess'),
      })
    }
    setUploading(false)
  }

  async function download() {
    const res = await confirm(t('downloadConfirm'))
    if (!res) return
    setDownLoading(true)
    const path = '.settings'
    const filename = 'store.json'
    const store = await Store.load('store.json');
    
    // 获取本地配置（用于保留排除字段）
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
      
      // 合并配置：使用远程配置，但保留本地的排除字段（如工作区路径等）
      const mergedSettings = mergeSyncData(localSettings, remoteSettings)
      
      // 保存合并后的配置
      const keys = Object.keys(mergedSettings)
      await Promise.allSettled(keys.map(async key => await store.set(key, mergedSettings[key])))
      await store.save()
      
      if (isMobileDevice()) {
        toast({
          description: t('downloadSuccess'),
        })
      } else {
        relaunch()
      }
    }
    setDownLoading(false)
  }

  return (
    username ? (
    <div className="flex gap-1 flex-col md:border-t justify-center items-center">
      <div className="flex gap-2">
        <Button variant={'ghost'} size={'sm'} onClick={upload} disabled={upLoading}>
          {upLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud />}
          <span className="hidden md:inline">{t('upload')}</span>
        </Button>
        <Button variant={'ghost'} size={'sm'} onClick={download} disabled={downLoading}>
          {downLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud />}
          <span className="hidden md:inline">{t('download')}</span>
        </Button>
      </div>
    </div>
    ) : null
  )
}