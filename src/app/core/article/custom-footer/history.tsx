import { GitPullRequestArrow, HistoryIcon, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { decodeBase64ToString, getFileCommits as getGithubFileCommits, getFiles as getGithubFiles } from "@/lib/github";
import { decodeBase64ToString as giteeDecodeBase64ToString, getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles } from "@/lib/gitee";
import { useTranslations } from "next-intl";
import useArticleStore from "@/stores/article";
import { RepoNames, ResCommit } from "@/lib/github.types";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TooltipButton } from "@/components/tooltip-button";
import { open } from "@tauri-apps/plugin-shell";
import useSettingStore from "@/stores/setting";
import Vditor from "vditor";
import { Store } from "@tauri-apps/plugin-store";
import emitter from "@/lib/emitter";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

dayjs.extend(relativeTime)

export default function History({editor}: {editor?: Vditor}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { activeFilePath, setCurrentArticle, currentArticle, loadFileTree } = useArticleStore()
  const { accessToken, giteeAccessToken, primaryBackupMethod } = useSettingStore()
  const [commits, setCommits] = useState<ResCommit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [filterQuick, setFilterQuick] = useState(false)
  const t = useTranslations('article.footer.history')

  async function onOpenChange(e: boolean) {
    setSheetOpen(e)
  }

  async function fetchCommits() {
    setCommitsLoading(true)
    setCommits([])
    editor?.focus()
    
    // 根据主要备份方式获取提交历史
    let res;
    const store = await Store.load('store.json');
    const backupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    if (backupMethod === 'github') {
      res = await getGithubFileCommits({ path: activeFilePath, repo: RepoNames.sync });
    } else {
      res = (await getGiteeFileCommits({ path: activeFilePath, repo: RepoNames.sync }))?.data;
      // 确保返回结果是数组
      if (res && !Array.isArray(res)) {
        res = [];
      }
    }

    setCommits(res || [])
    setCommitsLoading(false)
  }

  async function handleCommit(sha: string) {
    setCommitsLoading(true)
    setSheetOpen(false)
    const cacheArticle = currentArticle;
    setCurrentArticle(t('loadingHistory'))
    
    // 根据主要备份方式获取历史内容
    const store = await Store.load('store.json');
    const backupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    let res;
    if (backupMethod === 'github') {
      res = await getGithubFiles({path: `${activeFilePath}?ref=${sha}`, repo: RepoNames.sync});
      if (res && res.content) {
        setCurrentArticle(decodeBase64ToString(res.content));
      } else {
        setCurrentArticle(cacheArticle);
      }
    } else {
      res = await getGiteeFiles({path: `${activeFilePath}?ref=${sha}`, repo: RepoNames.sync});
      if (res && res.content) {
        setCurrentArticle(giteeDecodeBase64ToString(res.content));
      } else {
        setCurrentArticle(cacheArticle);
      }
    }
    
    setCommitsLoading(false);
  }

  function openHandler(url: string) {
    open(url)
  }

  useEffect(() => {
    fetchCommits()
  }, [activeFilePath])

  useEffect(() => {
    emitter.on('sync-success', async () => {
      await loadFileTree()
      await fetchCommits()
    })
    return () => {
      emitter.off('sync-success')
    }
  }, [activeFilePath])

  return (
    <Sheet open={sheetOpen} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          disabled={(primaryBackupMethod === 'github' && !accessToken) || 
                  (primaryBackupMethod === 'gitee' && !giteeAccessToken) || 
                  commitsLoading} 
          className="outline-none">
          {
            commitsLoading && <LoaderCircle className="animate-spin !size-3" />
          }
          <span className="text-xs">
            {commitsLoading ? t('loadingHistory') : commits.length ? 
              `${t('historyRecords')} (${dayjs(commits[0].commit.committer.date).fromNow()})` : t('noHistory')}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent className="p-0 min-w-[500px]">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{t('historyRecords')}</SheetTitle>
          <SheetDescription className="flex items-center justify-between">
            {
              commitsLoading ? 
              <span className="flex items-center gap-1"><LoaderCircle className="size-4 animate-spin" />{t('loading')}</span> : 
              <span className="flex items-center gap-1"><HistoryIcon className="size-4" />{commits.length} {t('recordsCount')}</span>
            }
            <span className="flex items-center space-x-2">
              <Label htmlFor="filter-quick">{t('filterQuickSync')}</Label>
              <Switch id="filter-quick" checked={filterQuick} onCheckedChange={setFilterQuick} />
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="max-h-[calc(100vh-90px)] overflow-y-auto">
          {
            commits.filter(commit => !filterQuick || !commit.commit.message.includes(t('quickSync'))).map((commit) => (
              <div className="flex justify-between items-center gap-4 border-b px-4 py-2" key={commit.sha}>
                <div className="flex-1 flex flex-col">
                  <span
                    className="text-sm line-clamp-1 hover:underline cursor-pointer"
                    onClick={() => openHandler(commit.html_url)}
                  >{commit.commit.message}</span>
                  <div className="flex gap-1 items-center mt-2">
                    <Avatar className="size-5">
                      <AvatarImage src={commit.author?.avatar_url} alt={commit.author.login} />
                      <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-zinc-500">
                      {commit.author.login} {t('committedAt')} {dayjs(commit.commit.committer.date).fromNow()}
                    </span>
                  </div>
                </div>
                <div className="w-8">
                  <TooltipButton icon={<GitPullRequestArrow />} tooltipText={t('pull')} onClick={() => handleCommit(commit.sha)} />
                </div>
              </div>
            ))
          }
        </div>
      </SheetContent>
    </Sheet>
  )
}