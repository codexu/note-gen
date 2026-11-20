'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription,
  ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import { listWikiPages, listWikiSourceStates } from '@/db/wiki'
import { assertWikiContextCurrent, subscribeWikiWorkspaceChanges } from '@/lib/wiki/context'
import { refreshWikiFileCache } from '@/lib/wiki/files'
import { getWikiFolderSelection } from '@/lib/wiki/folders'
import { getWikiSettings } from '@/lib/wiki/settings'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import type { WikiPage, WikiScopeKind, WikiSourceReference } from '@/types/wiki'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { useWikiNavigation } from './use-wiki-navigation'

export interface WikiRelatedFilesRequest {
  key: string
  contextId: string
  route: string
  isCurrent: () => boolean
  kind: WikiScopeKind
  id: string | null
  label: string
  sourceKey?: string
  local: boolean
  organize: () => Promise<void>
}

function matchesSource(request: WikiRelatedFilesRequest, source: WikiSourceReference) {
  const { kind, id, sourceKey } = request
  if (id === null) return false
  if (kind === 'article-folder') {
    const folder = id.replaceAll('\\', '/').replace(/\/$/, '')
    return source.sourceType === 'article' && (!folder || source.locator.filePath?.startsWith(`${folder}/`))
  }
  if (kind === 'record-tag') {
    const tag = id.normalize('NFKC')
    return source.sourceType === 'record' && source.tagKeys?.some(key => key === tag || key.startsWith(`${tag}/`))
  }
  if (kind === 'source-type') return source.sourceType === id
  if (source.sourceType !== kind) return false
  if (kind === 'record') return source.stableId === `record:${id}` || source.stableId === id
  return source.sourceKey === sourceKey || source.stableId === `${kind}:${id}` || source.stableId === id
}

type EmptyReason = 'relatedFailed' | 'relatedPending' | 'errors.WIKI_DISABLED' | 'folder.paused' | 'folder.notStarted' | 'statuses.unavailable'
interface Result {
  pages: Pick<WikiPage, 'id' | 'title' | 'filePath' | 'kind'>[]
  reason?: EmptyReason
  organizeLabel?: 'includeAndOrganize' | 'updateSource' | 'start'
  hasOverrides?: boolean
}

export default function WikiRelatedFiles({ request, dismiss }: { request: WikiRelatedFilesRequest; dismiss: () => void }) {
  const t = useTranslations('wiki')
  const tFolder = useTranslations('article.file.folderView')
  const errorMessage = useWikiErrorMessage()
  const { openPage } = useWikiNavigation()
  const router = useRouter()
  const pathname = usePathname()
  const [result, setResult] = useState<Result | null>(null)
  const [refreshNumber, setRefreshNumber] = useState(0)
  const [busy, setBusy] = useState(false)
  const showingResults = result !== null
  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    if (showingResults) return
    const timer = setTimeout(() => setShowLoading(true), 250)
    return () => clearTimeout(timer)
  }, [showingResults])

  useEffect(() => {
    if (!showingResults) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (timeout !== undefined) return
      timeout = setTimeout(() => {
        timeout = undefined
        setRefreshNumber(value => value + 1)
      }, 500)
    }
    window.addEventListener('wiki-updated', refresh)
    refresh()
    return () => { clearTimeout(timeout); window.removeEventListener('wiki-updated', refresh) }
  }, [showingResults])

  useEffect(() => {
    let active = true
    const current = () => active && request.isCurrent() && window.location.pathname === request.route
    const unsubscribe = subscribeWikiWorkspaceChanges(dismiss)
    async function load() {
      if (!current()) { dismiss(); return }
      const context = await assertWikiContextCurrent(request.contextId)
      if (!current()) return
      if (refreshNumber === 0) await refreshWikiFileCache(context)
      if (!current()) return
      const pages = (await listWikiPages(context.id))
        .filter(page => page.status !== 'archived' && page.sourceRefs.some(source => matchesSource(request, source)))
        .map(({ id, title, filePath, kind }) => ({ id, title, filePath, kind }))
        .sort((left, right) => left.title.localeCompare(right.title))
      if (!current()) return
      if (pages.length === 1 && refreshNumber === 0) {
        let opened = false
        await openPage(pages[0].id, context.id, undefined, () => { opened = true; dismiss() })
        if (!opened && current()) setResult({ pages })
      } else if (pages.length) {
        setResult({ pages })
      } else {
        const [states, settings] = await Promise.all([listWikiSourceStates(context.id), getWikiSettings(context.id)])
        if (!current()) return
        const related = states.filter(state => matchesSource(request, state.source))
        const failed = related.some(state => state.status === 'failed')
        const pending = related.some(state => state.status === 'processing' || state.status === 'pending')
        const unavailable = !request.local || (related.length > 0 && related.every(state => state.status === 'unavailable'))
        let reason: EmptyReason | undefined
        if (!settings.enabled) reason = 'errors.WIKI_DISABLED'
        else if (failed) reason = 'relatedFailed'
        else if (settings.paused) reason = 'folder.paused'
        else if (unavailable) reason = 'statuses.unavailable'
        else if (!settings.started) reason = 'folder.notStarted'
        else if (pending) reason = 'relatedPending'
        const folder = request.kind === 'article-folder' && request.id !== null
          ? getWikiFolderSelection(request.id, settings) : null
        const canOrganize = settings.enabled && !settings.paused && !failed && !pending && !unavailable
        let organizeLabel: Result['organizeLabel']
        if (canOrganize) {
          organizeLabel = settings.started ? 'updateSource' : 'start'
          if (folder && !folder.included) organizeLabel = 'includeAndOrganize'
        }
        setResult({ pages, reason, organizeLabel,
          hasOverrides: Boolean(folder && !folder.included && folder.hasOverrides),
        })
      }
    }
    void load().catch(error => {
      if (current()) { toast.error(t('loadFailed'), { description: errorMessage(error) }); dismiss() }
    })
    return () => { active = false; unsubscribe() }
  }, [request, dismiss, pathname, refreshNumber, openPage, t, errorMessage])

  async function choose(action: () => Promise<unknown>, dismissAfter = true) {
    if (busy || !request.isCurrent()) return
    setBusy(true)
    try {
      if (await action() !== false && dismissAfter) dismiss()
    } catch (error) {
      if (request.isCurrent()) toast.error(t('failed'), { description: errorMessage(error) })
    } finally {
      if (request.isCurrent()) setBusy(false)
    }
  }

  function openSettings() {
    dismiss()
    if (pathname.startsWith('/mobile')) router.push('/mobile/setting/pages/rag')
    else useSettingsDialogStore.getState().openSettings('rag')
  }

  if ((!result && !showLoading) || !request.isCurrent() || pathname !== request.route) return null
  return <ResponsiveDialog open onOpenChange={open => { if (!open) dismiss() }}>
    <ResponsiveDialogContent>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('viewRelated')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="break-words">{request.label}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="flex max-h-[60vh] min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4 sm:px-0 sm:pb-0">
        {!result ? <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t('scopeLoading')}</div>
          : result.pages.length ? (['source', 'topic'] as const).map(kind => {
          const pages = result.pages.filter(page => page.kind === kind)
          return pages.length ? <section key={kind}>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t(kind === 'source' ? 'folder.summaries' : 'folder.topics')}</h3>
            {pages.map(page => <Button key={page.id} type="button" variant="ghost" disabled={busy}
              className="h-auto min-h-10 w-full justify-start py-2 text-left" onClick={() => void choose(() => openPage(page.id, request.contextId, undefined, dismiss), false)}>
              <FileText /><span className="flex min-w-0 flex-col items-start"><span className="whitespace-normal break-words">{page.title}</span>
                {page.filePath ? <span className="max-w-full truncate text-xs font-normal text-muted-foreground" title={page.filePath}>{page.filePath}</span> : null}
              </span>
            </Button>)}
          </section> : null
        }) : <>
          <div className="flex flex-col gap-1"><p>{t('relatedEmpty')}</p>
            {result.reason && <p className="text-sm text-muted-foreground">{t(result.reason)}</p>}
            {result.organizeLabel && result.hasOverrides && <p className="text-sm text-muted-foreground">{tFolder('wikiOverrides')}</p>}
          </div>
          {result.organizeLabel
            ? <Button disabled={busy} onClick={() => void choose(request.organize)}>{t(result.organizeLabel)}</Button>
            : <Button variant="outline" onClick={openSettings}>{tFolder('openKnowledgeSettings')}</Button>}
        </>}
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
