'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { KnowledgeSourceLink } from '@/components/chat-ui/knowledge-source-link'
import { openEditorWindow } from '@/lib/editor-windows'
import { assertWikiContextCurrent } from '@/lib/wiki/context'
import { getWikiPageFilePath, readWikiTopicCitation } from '@/lib/wiki/files'
import type { WikiTopicCitation } from '@/types/wiki'
import { useWikiNavigation } from './use-wiki-navigation'
import { useWikiActionScope } from './use-wiki-action-scope'
import { resolveWikiCitationWindowNote } from './wiki-citation-window'

export function WikiCitationDialog({ citation, filePath, trigger, standalone, onClose }: {
  citation: WikiTopicCitation
  filePath: string
  trigger: HTMLElement
  standalone: boolean
  onClose: () => void
}) {
  const t = useTranslations('wiki')
  const sourceText = useTranslations('record.chat.ragSources')
  const { openPage } = useWikiNavigation()
  const { busy, beginAction } = useWikiActionScope(JSON.stringify([filePath, citation.pageId, citation.number]))
  const openedFile = useRef(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof readWikiTopicCitation>>>()
  const [originalAvailable, setOriginalAvailable] = useState<boolean>()

  useEffect(() => {
    let active = true
    setResult(undefined)
    setOriginalAvailable(undefined)
    const load = async () => {
      const path = standalone ? (await resolveWikiCitationWindowNote(filePath)).relative : filePath
      const value = await readWikiTopicCitation(path, citation)
      if (!active) return
      setResult(value)
      if (standalone && value?.source.sourceType === 'article') {
        const original = await resolveWikiCitationWindowNote(value.source.stableId.slice('article:'.length)).catch(() => null)
        if (active) setOriginalAvailable(Boolean(original))
      }
    }
    void load().catch(() => { if (active) setResult(null) })
    return () => { active = false }
  }, [citation, filePath, standalone])

  const closeAfterNavigation = () => {
    openedFile.current = true
    onClose()
  }
  async function openInWindow(target: 'original' | 'summary') {
    if (!result || busy) return
    const action = beginAction()
    try {
      await assertWikiContextCurrent(result.contextId)
      const path = target === 'original' && result.source.sourceType === 'article' ? result.source.stableId.slice('article:'.length)
        : target === 'summary' && result.summary ? await getWikiPageFilePath(result.contextId, result.summary.pageId, result.summary.version) : null
      if (!path) throw new Error('WIKI_SOURCE_NOT_FOUND')
      const note = await resolveWikiCitationWindowNote(path)
      await assertWikiContextCurrent(result.contextId)
      if (!action.isCurrent()) return
      if (!await openEditorWindow({ id: crypto.randomUUID(), path: note.absolute, name: note.name, isFolder: false })) throw new Error('WIKI_SOURCE_NOT_FOUND')
      if (action.isCurrent()) closeAfterNavigation()
    } catch {
      if (action.isCurrent()) toast.error(t('loadFailed'))
    } finally { action.finish() }
  }
  return (
    <ResponsiveDialog open onOpenChange={open => { if (!open) onClose() }}>
      <ResponsiveDialogContent className="max-h-[85dvh] overflow-hidden" onCloseAutoFocus={event => {
        event.preventDefault()
        if (!openedFile.current && trigger.isConnected) trigger.focus({ preventScroll: true })
      }}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="break-words sm:pr-6">
            {t('citation.title', { number: citation.number })} {citation.source.title || t(`scopeKinds.${citation.source.sourceType}`)}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('citation.excerpts')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div aria-live="polite" aria-busy={result === undefined} className="grid min-h-0 gap-3 overflow-y-auto px-4 pb-3 sm:px-0 sm:pb-0">
          {result === undefined ? (
            <Skeleton className="h-10 w-full" role="status" aria-label={t('scopeLoading')} />
          ) : result?.quotes.length ? result.quotes.map(quote => (
            <blockquote key={quote} className="whitespace-pre-wrap break-words border-l-2 pl-3">{quote}</blockquote>
          )) : <p className="text-sm text-muted-foreground">{t('citation.unavailable')}</p>}
        </div>
        {result && (!standalone || result.summary || result.source.sourceType === 'article') && (
          <ResponsiveDialogFooter className="items-center">
            {standalone ? result.source.sourceType === 'article' && originalAvailable !== undefined && (originalAvailable
              ? <Button type="button" size="sm" variant="link" disabled={busy} onClick={() => void openInWindow('original')}>{sourceText('openArticle')}</Button>
              : <span className="text-xs text-muted-foreground">{sourceText('sourceUnavailable')}</span>)
              : <KnowledgeSourceLink source={result.source} onOpened={closeAfterNavigation} />}
            {result.summary && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                const summary = result.summary
                if (!summary) return
                if (standalone) void openInWindow('summary')
                else void openPage(summary.pageId, result.contextId, summary.version, closeAfterNavigation)
              }}>{t('citation.openSummary')}</Button>
            )}
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
