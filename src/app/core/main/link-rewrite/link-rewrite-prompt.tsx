'use client'

/**
 * Phase 2-2 L7：改名／搬動後詢問「要一併改寫連入的連結嗎？」的全域對話框。
 * 掛在 fork-services.tsx，只掛一個；請求來自 link-rewrite-store.ts。
 * 每次都問，本階段不做「記住選擇」；Obsidian 同時開著時它也可能改同一批檔案，說明文字會提醒。
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { applyLinkRewrite } from '@/lib/wikilink-rename'
import { useLinkRewriteStore } from './link-rewrite-store'

export function LinkRewritePrompt() {
  const t = useTranslations('linkRewrite')
  const request = useLinkRewriteStore(state => state.request)
  const setPromptMounted = useLinkRewriteStore(state => state.setPromptMounted)
  const finish = useLinkRewriteStore(state => state.finish)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPromptMounted(true)
    return () => setPromptMounted(false)
  }, [setPromptMounted])

  async function confirm() {
    if (!request || busy) return
    setBusy(true)
    try {
      const written = await applyLinkRewrite(request.plan)
      toast({ title: t('done', { files: written.length }) })
    } catch (error) {
      console.error('[link-rewrite] 改寫失敗，檔案已還原：', error)
      toast({ title: t('failed'), variant: 'destructive' })
    } finally {
      setBusy(false)
      finish()
    }
  }

  const plan = request?.plan
  const files = plan?.files.length ?? 0
  const links = plan?.totalLinks ?? 0

  // 取消、Esc、點遮罩都走 onOpenChange(false)；改寫成功或失敗由 confirm() 自己 finish()
  return (
    <AlertDialog open={request !== null} onOpenChange={open => { if (!open && !busy) finish() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><Link2 className="text-ink" /></AlertDialogMedia>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('description', { files, links })}
            <br />
            <span className="text-muted-foreground">{t('obsidianHint')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {plan && plan.files.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md bg-hover px-3 py-2 text-xs [overflow-wrap:anywhere]">
            {plan.files.map(file => (
              <li key={file.path} className="flex justify-between gap-3 py-0.5">
                <span>{file.path}</span>
                <span className="shrink-0 text-ink font-medium">{file.count}</span>
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('skip')}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void confirm() }}>
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
