'use client'

import { useEffect, useState } from 'react'
import { getWikiPage } from '@/db/wiki'
import { captureWikiWorkspaceGuard, getWikiContext } from '@/lib/wiki/context'
import useSettingStore from '@/stores/setting'
import { wikiPageVersion } from '@/types/wiki'
import { useFormatter, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { useWikiNavigation } from '@/components/wiki/use-wiki-navigation'
import type { RagSourceDetail, WikiPageEvidence } from '@/types/knowledge'

function WikiEvidenceTitle({ page }: { page: WikiPageEvidence }) {
  const { openPage } = useWikiNavigation()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const [target, setTarget] = useState<{ workspacePath: typeof workspacePath; contextId: string; version: string; pageId: string } | null>(null)
  const { pageId, pageVersion } = page
  useEffect(() => {
    if (!pageVersion || !pageId) return
    const isCurrent = captureWikiWorkspaceGuard()
    let active = true
    void (async () => {
      const context = await getWikiContext()
      const cached = await getWikiPage(context.id, pageId)
      if (active && isCurrent() && cached && wikiPageVersion(cached) === pageVersion) {
        setTarget({ workspacePath, contextId: context.id, version: pageVersion, pageId })
      }
    })().catch(() => {})
    return () => { active = false }
  }, [workspacePath, pageId, pageVersion])
  return target && target.workspacePath === workspacePath && target.pageId === pageId && target.version === pageVersion
    ? <button type="button" className="text-primary hover:underline" onClick={() => void openPage(pageId, target.contextId, pageVersion)}>{page.title}</button>
    : <span>{page.title}</span>
}

export function KnowledgeSourceEvidence({ detail }: { detail: RagSourceDetail }) {
  const t = useTranslations('wiki')
  const format = useFormatter()
  const legacyWiki = detail.evidenceKind === 'wiki'
  const pages: WikiPageEvidence[] = detail.wikiEvidence ?? (legacyWiki
    ? [{ pageId: detail.wikiPageId ?? '', title: '', content: detail.content }] : [])

  return (
    <div className="grid min-w-0 gap-2 text-xs text-muted-foreground">
      {detail.content && !legacyWiki && <div>
        {detail.evidenceKind === 'source' && <Badge variant="secondary">{t('originalEvidence')}</Badge>}
        {typeof detail.updatedAt === 'number' && detail.updatedAt > 0 && <span className="ml-1">{t('sourceUpdatedAt', { date: format.dateTime(detail.updatedAt, { dateStyle: 'medium' }) })}</span>}
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{detail.content}</p>
      </div>}
      {pages.map((page, index) => <div key={`${page.pageId}:${page.viewHash ?? index}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t('evidence')}</Badge>
          <WikiEvidenceTitle page={page} />
          {typeof page.updatedAt === 'number' && page.updatedAt > 0 && <span>{t('compiledAt', { date: format.dateTime(page.updatedAt, { dateStyle: 'medium' }) })}</span>}
        </div>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{page.content}</p>
      </div>)}
    </div>
  )
}
