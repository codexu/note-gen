import { GitPullRequestArrow, HistoryIcon, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { decodeBase64ToString, getFileCommits as getGithubFileCommits, getFiles as getGithubFiles } from "@/lib/sync/github";
import { getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles } from "@/lib/sync/gitee";
import { getFileCommits as getGitlabFileCommits, getFileContent } from "@/lib/sync/gitlab";
import { getFileCommits as getGiteaFileCommits, getFileContent as getGiteaFileContent } from "@/lib/sync/gitea";
import { useTranslations } from "next-intl";
import useArticleStore from "@/stores/article";
import { ResCommit } from "@/lib/sync/github.types";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TooltipButton } from "@/components/tooltip-button";
import { open } from "@tauri-apps/plugin-shell";
import Vditor from "vditor";
import emitter from "@/lib/emitter";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import useUsername from "@/hooks/use-username";
import { Store } from "@tauri-apps/plugin-store";

dayjs.extend(relativeTime)

export default function History({editor}: {editor?: Vditor}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { activeFilePath, setCurrentArticle, currentArticle, loadFileTree, saveCurrentArticle } = useArticleStore()
  const [commits, setCommits] = useState<ResCommit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [filterQuick, setFilterQuick] = useState(false)
  const t = useTranslations('article.footer.history')

  const username = useUsername()

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
      const githubRepo = await getSyncRepoName('github');
      res = await getGithubFileCommits({ path: activeFilePath, repo: githubRepo });
    } else if (backupMethod === 'gitee') {
      const giteeRepo = await getSyncRepoName('gitee');
      res = await getGiteeFileCommits({ path: activeFilePath, repo: giteeRepo });
    } else if (backupMethod === 'gitlab') {
      const gitlabRepo = await getSyncRepoName('gitlab');
      const gitlabRes = await getGitlabFileCommits({ path: activeFilePath, repo: gitlabRepo });
      if (gitlabRes && gitlabRes.data) {
        // 转换 Gitlab 提交格式为通用格式
        res = gitlabRes.data.map(commit => ({
          sha: commit.id,
          commit: {
            message: commit.message,
            author: {
              name: commit.author_name,
              email: commit.author_email,
              date: commit.authored_date
            },
            committer: {
              name: commit.committer_name,
              email: commit.committer_email,
              date: commit.committed_date
            }
          },
          html_url: commit.web_url,
          author: {
            login: commit.author_name,
            avatar_url: '', // Gitlab API 不直接提供头像
            html_url: commit.web_url
          }
        }));
      }
    } else if (backupMethod === 'gitea') {
      const giteaRepo = await getSyncRepoName('gitea');
      const giteaRes = await getGiteaFileCommits({ path: activeFilePath, repo: giteaRepo });
      if (giteaRes && giteaRes.data) {
        // 转换 Gitea 提交格式为通用格式
        res = giteaRes.data.map(commit => ({
          sha: commit.sha,
          commit: {
            message: commit.commit.message,
            author: {
              name: commit.commit.author.name,
              email: commit.commit.author.email,
              date: commit.commit.author.date
            },
            committer: {
              name: commit.commit.committer.name,
              email: commit.commit.committer.email,
              date: commit.commit.committer.date
            }
          },
          html_url: commit.html_url,
          author: {
            login: commit.author?.login || commit.commit.author.name,
            avatar_url: commit.author?.avatar_url || '',
            html_url: commit.html_url
          }
        }));
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
    switch (backupMethod) {
      case 'github':
        try {
          const githubRepo2 = await getSyncRepoName('github');
          res = await getGithubFiles({path: `${activeFilePath}?ref=${sha}`, repo: githubRepo2});
          if (res && res.content) {
            const content = decodeBase64ToString(res.content)
            setCurrentArticle(content);
            await saveCurrentArticle(content)
          } else {
            setCurrentArticle(cacheArticle);
          }
        } catch (error) {
          console.error('GitHub 获取文件历史内容失败:', error);
          setCurrentArticle(cacheArticle);
        }
        break;
      case 'gitee':
        try {
          const giteeRepo2 = await getSyncRepoName('gitee');
          res = await getGiteeFiles({path: `${activeFilePath}?ref=${sha}`, repo: giteeRepo2});
          if (res && res.content) {
            const content = decodeBase64ToString(res.content)
            setCurrentArticle(content);
            await saveCurrentArticle(content)
          } else {
            setCurrentArticle(cacheArticle);
          }
        } catch (error) {
          console.error('Gitee 获取文件历史内容失败:', error);
          setCurrentArticle(cacheArticle);
        }
        break;
      case 'gitlab':
        try {
          // 使用新的 getFileContent 方法获取特定 commit 的文件内容
          const gitlabRepo2 = await getSyncRepoName('gitlab');
          const fileContent = await getFileContent({path: activeFilePath, ref: sha, repo: gitlabRepo2});
          if (fileContent && fileContent.content) {
            const content = decodeBase64ToString(fileContent.content)
            setCurrentArticle(content);
            await saveCurrentArticle(content)
          } else {
            setCurrentArticle(cacheArticle);
          }
        } catch (error) {
          console.error('Gitlab 获取文件历史内容失败:', error);
          setCurrentArticle(cacheArticle);
        }
        break;
      case 'gitea':
        try {
          // 使用 getFileContent 方法获取特定 commit 的文件内容
          const giteaRepo2 = await getSyncRepoName('gitea');
          const giteaFileContent = await getGiteaFileContent({path: activeFilePath, ref: sha, repo: giteaRepo2});
          if (giteaFileContent && giteaFileContent.content) {
            const content = decodeBase64ToString(giteaFileContent.content)
            setCurrentArticle(content);
            await saveCurrentArticle(content)
          } else {
            setCurrentArticle(cacheArticle);
          }
        } catch (error) {
          console.error('Gitea 获取文件历史内容失败:', error);
          setCurrentArticle(cacheArticle);
        }
        break;
      default:
        break;
    }
    
    setCommitsLoading(false);
  }

  function openHandler(url: string) {
    open(url)
  }

  useEffect(() => {
    if (activeFilePath) {
      fetchCommits()
    }
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
        {
          username ?
            <Button 
              variant="ghost" 
              size="sm" 
              disabled={commitsLoading} 
              className="outline-none">
              {
                commitsLoading && <LoaderCircle className="animate-spin !size-3" />
              }
              <span className="text-xs">
                {commitsLoading ? t('loadingHistory') : commits.length ? 
                  `${t('historyRecords')} (${dayjs(commits[0].commit.committer.date).fromNow()})` : t('noHistory')}
              </span>
            </Button> :
            null
        }
      </SheetTrigger>
      <SheetContent className="p-0 w-full md:min-w-[500px]">
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
            commits.filter(commit => !filterQuick || !commit?.commit?.message.includes(t('quickSync'))).map((commit) => (
              <div className="flex justify-between items-center gap-4 border-b px-4 py-2" key={commit?.sha}>
                <div className="flex-1 flex flex-col">
                  <span
                    className="text-sm line-clamp-1 hover:underline cursor-pointer"
                    onClick={() => openHandler(commit?.html_url)}
                  >{commit?.commit?.message}</span>
                  <div className="flex gap-1 items-center mt-2">
                    <Avatar className="size-5">
                      <AvatarImage src={commit?.author?.avatar_url} alt={commit?.author?.login} />
                      <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-zinc-500">
                      {commit?.author?.login} {t('committedAt')} {dayjs(commit?.commit?.committer?.date).fromNow()}
                    </span>
                  </div>
                </div>
                <div className="w-8">
                  <TooltipButton icon={<GitPullRequestArrow />} tooltipText={t('pull')} onClick={() => handleCommit(commit?.sha)} />
                </div>
              </div>
            ))
          }
        </div>
      </SheetContent>
    </Sheet>
  )
}