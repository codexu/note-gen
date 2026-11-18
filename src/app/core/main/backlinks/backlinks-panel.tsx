'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { findWikilinks, noteKeyOf, wikilinkTargetFor } from '@/lib/markdown/wikilink'
import { findUnlinkedMentions, linkMentions, type Mention } from '@/lib/markdown/unlinked-mentions'
import { readNote, revealInFileTree } from '@/lib/daily/note-io'
import { rewriteNote } from '@/lib/note-rewrite'
import type { IndexedLink } from '@/lib/vault-index/index-note'
import type { BacklinkRef } from '@/lib/vault-index/links'
import { isAbortError, mentionNamesFor, scanUnlinkedMentions, type UnlinkedMentionGroup } from '@/lib/vault-index/unlinked-mentions-scan'
import useArticleStore from '@/stores/article'
import useVaultIndexStore, { selectBacklinks, selectOutgoingLinks } from '@/stores/vault-index'

/** 索引保留上下文；從中找回原始連結，避免重組時遺失表格轉義或 block ref。 */
function HighlightedContext({ link }: { link: IndexedLink }) {
  const occurrence = link.kind === 'wikilink'
    ? findWikilinks(link.context).find(item => item.target === link.target && item.alias === link.alias && item.heading === link.heading && item.embed === link.embed)
    : null
  const text = occurrence?.raw ?? (link.alias || link.target)
  const markdownStart = link.context.indexOf(`[${link.alias}](`)
  const start = occurrence?.column ?? (link.kind === 'markdown' && markdownStart >= 0 ? markdownStart + 1 : link.context.indexOf(text))
  if (start < 0 || !text) return <>{link.context}</>
  return <>{link.context.slice(0, start)}<mark className="rounded bg-brand/10 text-brand">{text}</mark>{link.context.slice(start + text.length)}</>
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

async function openNote(sourcePath: string) {
  await revealInFileTree(sourcePath)
  await useArticleStore.getState().setActiveFilePath(sourcePath)
}

interface ScanState {
  path: string
  revision: number
  groups: UnlinkedMentionGroup[]
}

/**
 * Phase 2-2 L4：第三區「未連結提及」。預設收合、展開時才掃描；
 * 索引 revision 變了不會自動重掃（避免每連結一筆就重讀全 vault），下次展開或按「掃描」再掃。
 */
function UnlinkedMentions({ path }: { path: string }) {
  const t = useTranslations('backlinks')
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<ScanState | null>(null)
  const [scanRequest, setScanRequest] = useState(0)
  const current = scan?.path === path ? scan : null
  const stale = current === null || current.revision !== revision

  useEffect(() => {
    if (!open) return
    // 同一篇、同一個 revision 的結果有模組層快取，重複展開不會重讀檔案
    const state = useVaultIndexStore.getState()
    const controller = new AbortController()
    setScanning(true)
    scanUnlinkedMentions(path, { notes: state.notes, revision: state.revision, readNote, signal: controller.signal })
      .then(groups => { if (!controller.signal.aborted) setScan({ path, revision: state.revision, groups }) })
      .catch(error => { if (!isAbortError(error)) console.error('[unlinked-mentions] 掃描失敗：', error) })
      .finally(() => { if (!controller.signal.aborted) setScanning(false) })
    return () => controller.abort()
  }, [open, path, scanRequest])

  async function link(sourcePath: string, mentions: Mention[]) {
    const target = wikilinkTargetFor(path, notes.keys())
    try {
      const written = await rewriteNote(sourcePath, content => linkMentions(content, mentions, target))
      // 同一行有多筆提及時，連結其中一筆會讓其餘的 column 位移；用寫回後的內容重算這篇的提及，不用舊位置過濾
      const remaining = written
        ? findUnlinkedMentions(written.content, mentionNamesFor(path, notes))
        : null
      setScan(previous => previous && {
        ...previous,
        groups: previous.groups
          .map(group => group.sourcePath === sourcePath
            ? { ...group, mentions: remaining ?? group.mentions.filter(mention => !mentions.includes(mention)) }
            : group)
          .filter(group => group.mentions.length > 0),
      })
      toast({ title: t('linkDone') })
    } catch (error) {
      console.error('[unlinked-mentions] 轉成連結失敗：', error)
      toast({ title: t('linkFailed'), variant: 'destructive' })
    }
  }

  const total = current?.groups.reduce((sum, group) => sum + group.mentions.length, 0) ?? 0
  const linkButton = 'shrink-0 cursor-pointer rounded px-2 py-1 text-xs text-brand hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink'

  return (
    <details className="mt-4 border-t pt-3" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">
        {t('unlinked')} {current && <span className="text-ink font-medium">{total}</span>}
      </summary>
      {open && (
        <div className="mt-2">
          {scanning && <p role="status" className="py-2 text-muted-foreground">{t('scanning')}</p>}
          {!scanning && current && stale && (
            <button type="button" onClick={() => setScanRequest(n => n + 1)} className={`mb-2 ${linkButton}`}>{t('scan')}</button>
          )}
          {!scanning && current && current.groups.length === 0 && <p className="py-2 text-muted-foreground">{t('unlinkedEmpty')}</p>}
          {current?.groups.map(group => {
            const folder = folderOf(group.sourcePath)
            return (
              <div key={group.sourcePath} className="mb-3 rounded-lg border p-2">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium [overflow-wrap:anywhere]">{noteKeyOf(group.sourcePath)}</h3>
                    {folder && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{folder}</p>}
                  </div>
                  <button type="button" onClick={() => void link(group.sourcePath, group.mentions)} className={linkButton}>{t('linkAll')}</button>
                </div>
                <ul className="grid gap-1">
                  {group.mentions.map(mention => (
                    <li key={`${mention.line}:${mention.column}`} className="flex items-start gap-1">
                      <button type="button" onClick={() => void openNote(group.sourcePath)} className="min-w-0 flex-1 cursor-pointer rounded p-2 text-left [overflow-wrap:anywhere] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink">
                        {mention.context.slice(0, mention.contextOffset)}
                        <mark className="rounded bg-brand/10 text-brand">{mention.context.slice(mention.contextOffset, mention.contextOffset + mention.length)}</mark>
                        {mention.context.slice(mention.contextOffset + mention.length)}
                      </button>
                      <button type="button" onClick={() => void link(group.sourcePath, [mention])} className={`mt-1 ${linkButton}`}>{t('linkOne')}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </details>
  )
}

export default function BacklinksPanel() {
  const t = useTranslations('backlinks')
  const path = useArticleStore(state => state.activeFilePath) ?? ''
  const status = useVaultIndexStore(state => state.status)
  const backlinks = useVaultIndexStore(state => selectBacklinks(state, path))
  const outgoing = useVaultIndexStore(state => selectOutgoingLinks(state, path))
  const groups = new Map<string, BacklinkRef[]>()
  for (const link of backlinks) {
    const group = groups.get(link.sourcePath) ?? []
    group.push(link)
    groups.set(link.sourcePath, group)
  }

  return (
    <aside aria-label={t('title')} className="h-full overflow-y-auto p-3 text-sm">
      {!/\.md$/i.test(path) ? <p className="py-4 text-muted-foreground">{t('notMarkdown')}</p>
        : status !== 'ready' ? <p role="status" className="py-4 text-muted-foreground">{t('indexing')}</p>
          : <>
            <section aria-label={t('linked')}>
              <h2 className="mb-3 font-semibold">{t('linked')} <span className="text-ink font-medium">{backlinks.length}</span></h2>
              {backlinks.length === 0 && <p className="py-4 text-muted-foreground">{t('empty')}</p>}
              {[...groups].map(([sourcePath, links]) => {
                const folder = folderOf(sourcePath)
                return (
                  <div key={sourcePath} className="mb-3 rounded-lg border p-2">
                    <h3 className="mb-1 font-medium [overflow-wrap:anywhere]">{noteKeyOf(sourcePath)}</h3>
                    {folder && <p className="mb-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{folder}</p>}
                    <ul className="grid gap-1">
                      {links.map((link, index) => (
                        <li key={`${link.line}:${index}`}>
                          <button type="button" onClick={() => void openNote(sourcePath)} className="w-full cursor-pointer rounded p-2 text-left [overflow-wrap:anywhere] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink">
                            <HighlightedContext link={link} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </section>
            <details open className="mt-4 border-t pt-3">
              <summary className="cursor-pointer font-semibold">{t('outgoing')} <span className="text-ink font-medium">{outgoing.length}</span></summary>
              <ul className="mt-2 grid gap-1">
                {outgoing.map((link, index) => (
                  <li key={`${link.line}:${index}`} className="rounded px-2 py-1 [overflow-wrap:anywhere]">
                    {link.target || noteKeyOf(path)}
                    {!link.target && link.heading && `#${link.heading}`}
                    {link.resolved === null && <span className="ml-2 text-xs text-muted-foreground">{t('unresolved')}</span>}
                  </li>
                ))}
              </ul>
            </details>
            <UnlinkedMentions path={path} />
          </>}
    </aside>
  )
}
