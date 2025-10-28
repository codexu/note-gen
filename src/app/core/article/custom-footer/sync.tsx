import { toast } from "@/hooks/use-toast";
import { fetchAi } from "@/lib/ai";
import { decodeBase64ToString, getFileCommits as getGithubFileCommits, getFiles as getGithubFiles, uint8ArrayToBase64, uploadFile as uploadGithubFile } from "@/lib/sync/github";
import { getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles, uploadFile as uploadGiteeFile } from "@/lib/sync/gitee";
import { getFileContent as getGitlabFileContent, uploadFile as uploadGitlabFile, getFileCommits as getGitlabFileCommits } from "@/lib/sync/gitlab";
import { uploadFile as uploadGiteaFile, getFiles as getGiteaFiles } from "@/lib/sync/gitea";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import useArticleStore from "@/stores/article";
import { readFile } from "@tauri-apps/plugin-fs";
import { diffWordsWithSpace } from 'diff';
import Vditor from "vditor";
import { Store } from "@tauri-apps/plugin-store";
import { Button } from "@/components/ui/button";
import useSettingStore from "@/stores/setting";
import { useEffect, useState, useRef } from "react";
import { Loader2, Upload } from "lucide-react";
import emitter from "@/lib/emitter";
import { getFilePathOptions } from "@/lib/workspace";
import { useTranslations } from "next-intl";
import useUsername from "@/hooks/use-username";

export default function Sync({editor}: {editor?: Vditor}) {
  const { currentArticle } = useArticleStore()
  const { accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, autoSync, giteeAutoSync, gitlabAutoSync, giteaAutoSync, primaryBackupMethod} = useSettingStore()
  const [isLoading, setIsLoading] = useState(false)
  const syncTimeoutRef = useRef<number | null>(null)
  const t = useTranslations('article.footer.sync')
  const [syncText, setSyncText] = useState(t('sync'))
  const [progressPercentage, setProgressPercentage] = useState(0)
  const progressIntervalRef = useRef<number | null>(null)
  const username = useUsername()

  async function handleSync() {
    try {
      // 获取主要备份方式设置
      const store = await Store.load('store.json');
      const backupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      
      // 检查是否有对应的访问令牌
      if (isLoading || 
          (backupMethod === 'github' && !accessToken) || 
          (backupMethod === 'gitee' && !giteeAccessToken)) return;
      
      setIsLoading(true);
      editor?.focus();
      
      const activeFilePath = await store.get<string>('activeFilePath') || '';
      
      // 获取上一次提交的记录内容
      let message = `Upload ${activeFilePath}`;
      
      // 如果有AI API Key，使用AI生成提交信息
      const primaryModel = await store.get<string>('primaryModel');
      if (primaryModel) {
        let contentText = '';
        
        // 根据备份方式获取提交历史和内容
        switch (backupMethod) {
          case 'github':
            // 获取GitHub提交历史
            const githubRepo = await getSyncRepoName('github');
            const githubCommits = await getGithubFileCommits({ path: activeFilePath, repo: githubRepo });
            if (githubCommits?.length > 0) {
              const lastCommit = githubCommits[0];
              const githubContent = await getGithubFiles({path: `${activeFilePath}?ref=${lastCommit.sha}`, repo: githubRepo});
              if (githubContent?.content) {
                contentText = decodeBase64ToString(githubContent.content);
              }
            }
            break;
          case 'gitee':
            // 获取Gitee提交历史
            const giteeRepo = await getSyncRepoName('gitee');
            const giteeCommits = await getGiteeFileCommits({ path: activeFilePath, repo: giteeRepo });
            if (Array.isArray(giteeCommits) && giteeCommits.length > 0) {
              const lastCommit = giteeCommits[0];
              const giteeContent = await getGiteeFiles({path: `${activeFilePath}?ref=${lastCommit.sha}`, repo: giteeRepo});
              if (giteeContent?.content) {
                contentText = decodeBase64ToString(giteeContent.content);
              }
            }
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab');
            const { content } = await getGitlabFileContent({path: activeFilePath, ref: 'main', repo: gitlabRepo});
            contentText = decodeBase64ToString(content);
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea');
            try {
              // 尝试获取当前分支的文件内容
              const giteaFileInfo = await getGiteaFiles({path: activeFilePath, repo: giteaRepo});
              // getFiles 对单个文件返回对象，对目录返回数组
              if (giteaFileInfo && !Array.isArray(giteaFileInfo) && giteaFileInfo.content) {
                contentText = decodeBase64ToString(giteaFileInfo.content);
              }
            } catch {
              // 如果文件不存在（首次上传），跳过
              console.log('Gitea file not found, this might be first upload');
            }
            break;
        } 
        // 如果有历史内容，使用AI分析差异并生成提交信息
        if (contentText) {
          const diff = diffWordsWithSpace(contentText, currentArticle);
          const addDiff = diff.filter(item => item.added).map(item => item.value).join('');
          const removeDiff = diff.filter(item => item.removed).map(item => item.value).join('');
          const text = `
            根据两篇内容的diff：
            增加了内容：${addDiff}
            删除了内容：${removeDiff}
            对比后对本次修改返回一条标准的提交描述，仅返回描述内容，字数不能超过50个字。
          `;
          const aiMessage = await fetchAi(text);
          if (!aiMessage.includes('请求失败')) {
            message = aiMessage;
          }
        }
      }
      
      // 获取文件的SHA值，用于更新而非创建新文件
      let res;
      let sha = undefined;
      
      if (backupMethod === 'github') {
        const githubRepo2 = await getSyncRepoName('github');
        res = await getGithubFiles({path: activeFilePath, repo: githubRepo2});
      } else if (backupMethod === 'gitee') {
        const giteeRepo2 = await getSyncRepoName('gitee');
        res = await getGiteeFiles({path: activeFilePath, repo: giteeRepo2});
      } else if (backupMethod === 'gitlab') {
        const gitlabRepo2 = await getSyncRepoName('gitlab');
        const gitlabRes = await getGitlabFileCommits({path: activeFilePath, repo: gitlabRepo2});
        if (gitlabRes && gitlabRes.data) {
          res = { sha: gitlabRes.data[0]?.id };
        }
      } else if (backupMethod === 'gitea') {
        const giteaRepo2 = await getSyncRepoName('gitea');
        // Gitea 使用 getFiles API 获取文件 SHA，类似 GitHub/Gitee
        const giteaRes = await getGiteaFiles({path: activeFilePath, repo: giteaRepo2});
        // getFiles 对单个文件返回对象
        if (giteaRes && !Array.isArray(giteaRes)) {
          res = giteaRes;
        }
      }
      
      if (res) {
        sha = res.sha;
      }
      // 解析文件路径
      const filename = activeFilePath?.split('/').pop();
      const _path = activeFilePath?.split('/').slice(0, -1).join('/');
      // 获取文件路径选项，根据是否有自定义工作区决定使用哪种路径方式
      const filePathOptions = await getFilePathOptions(activeFilePath);
      const file = await readFile(filePathOptions.path, filePathOptions.baseDir ? { baseDir: filePathOptions.baseDir } : undefined);
      
      // 根据备份方式上传文件
      let uploadRes;
      switch (backupMethod) {
        case 'github':
          const githubRepo3 = await getSyncRepoName('github');
          uploadRes = await uploadGithubFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: githubRepo3
          });
          break;
        case 'gitee':
          const giteeRepo3 = await getSyncRepoName('gitee');
          uploadRes = await uploadGiteeFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: giteeRepo3
          });
          break;
        case 'gitlab':
          const gitlabRepo3 = await getSyncRepoName('gitlab');
          uploadRes = await uploadGitlabFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: gitlabRepo3
          });
          break;
        case 'gitea':
          const giteaRepo3 = await getSyncRepoName('gitea');
          uploadRes = await uploadGiteaFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: giteaRepo3
          });
          break;
        default:
          break;
      }
      // 检查上传结果并更新状态
      if (uploadRes?.data?.commit?.message || uploadRes?.data?.file_path) {
        setSyncText(t('synced'));
        emitter.emit('sync-success');
        setTimeout(() => {
          setSyncText(t('sync'));
        }, 3000);
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: t('syncFailed'),
        description: t('checkNetworkOrToken'),
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }

  // 自动同步功能 - 编辑器停止输入后触发
  async function handleAutoSync() {
    try {
      // 获取主要备份方式设置
      const store = await Store.load('store.json');
      const backupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      
      // 检查是否有对应的访问令牌
      if (isLoading || 
          (backupMethod === 'github' && !accessToken) || 
          (backupMethod === 'gitee' && !giteeAccessToken)) return;
      
      setIsLoading(true);
      editor?.focus();
      
      const activeFilePath = await store.get<string>('activeFilePath') || '';
      
      // 快速同步的提交信息
      const message = `Upload ${activeFilePath}（${t('quickSync')}）`;
      
      // 获取文件的SHA值，用于更新而非创建新文件
      let res;
      let sha = undefined;
      
      switch (backupMethod) {
        case 'github':
          const githubRepo2 = await getSyncRepoName('github');
          res = await getGithubFiles({path: activeFilePath, repo: githubRepo2});
          break;
        case 'gitee':
          const giteeRepo2 = await getSyncRepoName('gitee');
          res = await getGiteeFiles({path: activeFilePath, repo: giteeRepo2});
          break;
        case 'gitlab':
          const gitlabRepo2 = await getSyncRepoName('gitlab');
          const gitlabRes2 = await getGitlabFileCommits({path: activeFilePath, repo: gitlabRepo2});
          if (gitlabRes2 && gitlabRes2.data && gitlabRes2.data[0]) {
            res = { sha: gitlabRes2.data[0].id };
          }
          break;
        case 'gitea':
          const giteaRepo2 = await getSyncRepoName('gitea');
          // Gitea 使用 getFiles API 获取文件 SHA
          const giteaRes2 = await getGiteaFiles({path: activeFilePath, repo: giteaRepo2});
          // getFiles 对单个文件返回对象
          if (giteaRes2 && !Array.isArray(giteaRes2)) {
            res = giteaRes2;
          }
          break;
      }
      
      if (res) {
        sha = res.sha;
      }
      // 解析文件路径
      const filename = activeFilePath?.split('/').pop();
      const _path = activeFilePath?.split('/').slice(0, -1).join('/');
      // 获取文件路径选项，根据是否有自定义工作区决定使用哪种路径方式
      const filePathOptions = await getFilePathOptions(activeFilePath);
      const file = await readFile(filePathOptions.path, filePathOptions.baseDir ? { baseDir: filePathOptions.baseDir } : undefined);
      
      // 根据备份方式上传文件
      let uploadRes;
      switch (backupMethod) {
        case 'github':
          const githubRepo4 = await getSyncRepoName('github');
          uploadRes = await uploadGithubFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: githubRepo4
          });
          break;
        case 'gitee':
          const giteeRepo4 = await getSyncRepoName('gitee');
          uploadRes = await uploadGiteeFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: giteeRepo4
          });
          break;
        case 'gitlab':
          const gitlabRepo4 = await getSyncRepoName('gitlab');
          uploadRes = await uploadGitlabFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: gitlabRepo4
          }); 
          break;
        case 'gitea':
          const giteaRepo4 = await getSyncRepoName('gitea');
          uploadRes = await uploadGiteaFile({
            ext: 'md',
            file: uint8ArrayToBase64(file),
            filename: `${_path && _path + '/'}${filename}`,
            sha,
            message,
            repo: giteaRepo4
          });
          break;
        default:
          break;
      }
      
      // 检查上传结果并更新状态
      if (uploadRes?.data?.commit?.message) {
        setSyncText(t('synced'));
        setProgressPercentage(0);
        emitter.emit('sync-success');
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: t('syncFailed'),
        description: t('checkNetworkOrToken'),
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }

  // 设置编辑器自动同步功能
  useEffect(() => {
    const checkAutoSyncEligibility = async () => {
      const store = await Store.load('store.json');
      const backupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      
      // 检查自动同步条件
      if (!editor) return false;
      if (backupMethod === 'github' && (autoSync === 'disabled' || !accessToken)) return false;
      if (backupMethod === 'gitee' && (giteeAutoSync === 'disabled' || !giteeAccessToken)) return false;
      if (backupMethod === 'gitlab' && (gitlabAutoSync === 'disabled' || !gitlabAccessToken)) return false;
      if (backupMethod === 'gitea' && (giteaAutoSync === 'disabled' || !giteaAccessToken)) return false;
      return true;
    };
    
    // 获取自动同步的时间间隔（毫秒）
    const getSyncInterval = () => {
      // 如果是GitHub备份方式，使用autoSync设置的时间
      if (primaryBackupMethod === 'github') {
        if (autoSync === 'disabled') return 0;
        // autoSync存储的是秒数，转换为毫秒
        return parseInt(autoSync) * 1000;
      }
      // 如果是Gitee备份方式，使用giteeAutoSync设置的时间
      if (primaryBackupMethod === 'gitee') {
        if (giteeAutoSync === 'disabled') return 0;
        // giteeAutoSync存储的是秒数，转换为毫秒
        return parseInt(giteeAutoSync) * 1000;
      }
      // 如果是Gitlab备份方式，使用gitlabAutoSync设置的时间
      if (primaryBackupMethod === 'gitlab') {
        if (gitlabAutoSync === 'disabled') return 0;
        return parseInt(gitlabAutoSync) * 1000;
      }
      // 如果是Gitea备份方式，使用giteaAutoSync设置的时间
      if (giteaAutoSync === 'disabled') return 0;
      return parseInt(giteaAutoSync) * 1000;
    };
    
    // 处理编辑器输入事件
    const handleInput = () => {
      // 更改同步状态文本
      if (syncText !== t('sync')) {
        setSyncText(t('sync'));
      }
      
      // 清除现有的定时器
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      // 清除进度条定时器
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
        setProgressPercentage(0);
      }
      
      // 获取配置的同步时间间隔
      const syncInterval = getSyncInterval();
      
      // 如果时间间隔大于0，设置定时器
      if (syncInterval > 0) {
        // 重置进度
        setProgressPercentage(0);
        
        // 设置进度条更新间隔 (每100ms更新一次)
        const updateInterval = 100;
        const steps = syncInterval / updateInterval;
        const increment = 100 / steps;
        
        // 开始更新进度
        progressIntervalRef.current = window.setInterval(() => {
          setProgressPercentage(prev => {
            const newValue = prev + increment;
            return newValue > 100 ? 100 : newValue;
          });
        }, updateInterval);
        
        // 设置自动同步定时器
        syncTimeoutRef.current = window.setTimeout(() => {
          if (progressIntervalRef.current) {
            window.clearInterval(progressIntervalRef.current);
          }
          setProgressPercentage(0);
          handleAutoSync();
        }, syncInterval);
      }
    };
    
    // 注册事件监听
    const setupListener = async () => {
      if (await checkAutoSyncEligibility()) {
        emitter.on('editor-input', handleInput);
      }
    };
    
    setupListener();
    
    // 清理函数
    return () => {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
      }
      emitter.off('editor-input', handleInput);
    };
  }, [autoSync, giteeAutoSync, gitlabAutoSync, giteaAutoSync, accessToken, giteeAccessToken, gitlabAccessToken, giteaAccessToken, syncText, editor, t, primaryBackupMethod]);

  return (
    username ?
      <Button 
        onClick={handleSync}
        variant="ghost"
        size="sm"
        disabled={(primaryBackupMethod === 'github' && !accessToken) || (primaryBackupMethod === 'gitee' && !giteeAccessToken) || (primaryBackupMethod === 'gitlab' && !gitlabAccessToken) || (primaryBackupMethod === 'gitea' && !giteaAccessToken) || isLoading}
        className="relative outline-none overflow-hidden"
      >
        {/* 进度条背景 */}
        {progressPercentage > 0 && (
          <div 
            className="absolute inset-0 bg-zinc-200 dark:bg-zinc-800 transition-all duration-100 z-0" 
            style={{ width: `${progressPercentage}%` }}
          />
        )}
        {isLoading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin mr-1 relative z-10" />
            <span className="text-xs relative z-10">{t('syncing')}</span>
          </>
        ) : (
          <>
            <Upload className="!size-3 relative z-10" />
            <span className="text-xs relative z-10">{syncText}</span>
          </>
        )}
      </Button> 
      : null  
  )
}