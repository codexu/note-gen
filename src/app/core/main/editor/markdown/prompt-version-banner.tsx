'use client'

/**
 * 「直接編輯後確認為新版本」(#56)：提示詞筆記的內容跟最新一筆 prompt-version 不同時，
 * 在編輯器內容上方顯示提示列；按下後用 AI 摘要「改了什麼、為什麼」讓使用者確認／修改，
 * 再只 commit 這篇筆記成一筆新的提示詞版本。一般筆記、未啟用版本管理時不顯示（#51 行動版
 * 不會進到這個元件，因為行動版的編輯器是完全獨立的 MobileEditor，見 app/mobile/writing）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'

import emitter, { type Events } from '@/lib/emitter'
import useSettingStore from '@/stores/setting'
import useDailySettingsStore from '@/stores/daily-settings'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { parseFrontmatterData } from '@/lib/vault-index/index-note'
import { isPromptNote, promptTitle } from '@/lib/prompt-library/prompt-note'
import { getWorkspaceAbsolutePath } from '@/lib/workspace'
import {
  GIT_VERSION_SETTINGS_CHANGED_EVENT,
  getGitVersionWorkspaceSettings,
} from '@/lib/git-versions/workspace-settings'
import { commitGitVersion } from '@/lib/git-versions/commands'
import { getLatestPromptVersionBaseline } from '@/lib/git-versions/prompt-version-baseline'
import { hasUnconfirmedPromptVersionChange, type PromptVersionBaseline } from '@/lib/git-versions/prompt-version-diff'
import { summarizePromptVersionChange } from '@/lib/git-versions/prompt-version-summary'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface PromptVersionBannerProps {
  filePath: string
  content: string
}

export function PromptVersionBanner({ filePath, content }: PromptVersionBannerProps) {
  const t = useTranslations('editor.promptVersion')
  const workspacePath = useSettingStore(state => state.workspacePath)
  const promptFolder = useDailySettingsStore(state => state.promptFolder)

  const [frontmatter, setFrontmatter] = useState<Record<string, unknown> | null>(
    () => parseFrontmatterData(splitFrontmatter(content).block),
  )
  const [liveContent, setLiveContent] = useState(content)
  const [versionControlEnabled, setVersionControlEnabled] = useState(false)
  const [baseline, setBaseline] = useState<PromptVersionBaseline | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [generating, setGenerating] = useState(false)
  const [committing, setCommitting] = useState(false)

  const workspaceRootRef = useRef<string | null>(null)
  const isPrompt = isPromptNote({ path: filePath, frontmatter }, promptFolder)

  useEffect(() => {
    setFrontmatter(parseFrontmatterData(splitFrontmatter(content).block))
    setLiveContent(content)
    setBaseline(null)
  }, [filePath, content])

  const loadVersionControlState = useCallback(async () => {
    if (!filePath || !isPrompt) {
      setVersionControlEnabled(false)
      setBaseline(null)
      return
    }
    const root = await getWorkspaceAbsolutePath()
    workspaceRootRef.current = root
    const settings = await getGitVersionWorkspaceSettings(root)
    setVersionControlEnabled(settings.enabled)
    if (settings.enabled) {
      setBaseline(await getLatestPromptVersionBaseline(root, filePath))
    } else {
      setBaseline(null)
    }
  }, [filePath, isPrompt])

  useEffect(() => {
    void loadVersionControlState()
  }, [loadVersionControlState, workspacePath])

  useEffect(() => {
    window.addEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, loadVersionControlState)
    return () => window.removeEventListener(GIT_VERSION_SETTINGS_CHANGED_EVENT, loadVersionControlState)
  }, [loadVersionControlState])

  useEffect(() => {
    const handleArticleSaved = (event: Events['article-saved']) => {
      if (event.path !== filePath) return
      setLiveContent(event.content)
      setFrontmatter(parseFrontmatterData(splitFrontmatter(event.content).block))
    }
    emitter.on('article-saved', handleArticleSaved)
    return () => emitter.off('article-saved', handleArticleSaved)
  }, [filePath])

  const dirty = isPrompt && versionControlEnabled && baseline !== null
    && hasUnconfirmedPromptVersionChange(liveContent, baseline)

  const handleOpenDialog = useCallback(async () => {
    if (!baseline) return
    setDialogOpen(true)
    setGenerating(true)
    setSummary('')
    try {
      const generated = await summarizePromptVersionChange({
        title: promptTitle({ path: filePath, frontmatter }),
        oldContent: baseline.content,
        newContent: liveContent,
      })
      setSummary(generated)
    } finally {
      setGenerating(false)
    }
  }, [baseline, filePath, frontmatter, liveContent])

  const handleConfirm = useCallback(async () => {
    const root = workspaceRootRef.current ?? await getWorkspaceAbsolutePath()
    const message = summary.trim()
    if (!message) return
    setCommitting(true)
    try {
      // allowEmpty=true：自動快照可能已經把這次修改收進 HEAD 了，這裡仍要留下一筆
      // 標記用的 prompt-version commit（#56）。
      await commitGitVersion(root, message, 'prompt-version', [filePath], true)
      setBaseline({ hasPromptVersion: true, content: liveContent })
      setDialogOpen(false)
      toast({ description: t('committed') })
    } catch (error) {
      console.error('確認提示詞版本失敗:', error)
      toast({ description: t('commitFailed'), variant: 'destructive' })
    } finally {
      setCommitting(false)
    }
  }, [filePath, liveContent, summary, t])

  if (!dirty) return null

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line bg-hover px-3 py-1.5 text-xs text-ink">
        <span>{t('banner')}</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="font-medium underline-offset-2 hover:underline"
          onClick={() => void handleOpenDialog()}
        >
          {t('confirmButton')}
        </button>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          {/* Scott 的自訂 CSS 把 DialogDescription 設成 display:none，說明文字要用一般可見元素。 */}
          <p className="text-sm text-muted-foreground">{t('dialogDesc')}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="prompt-version-summary" className="text-sm font-medium">
              {t('summaryLabel')}
            </label>
            <Textarea
              id="prompt-version-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={generating ? t('generating') : t('summaryPlaceholder')}
              disabled={generating}
              rows={4}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={committing}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={generating || committing || !summary.trim()}>
              {committing ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
