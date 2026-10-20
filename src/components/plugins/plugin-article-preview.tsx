'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { usePluginDocuments } from '@/lib/plugins/documents'
import type { PluginExtendedUiBlock } from '@notegen/plugin-api'

export function PluginArticlePreview({ block, scope }: { block: Extract<PluginExtendedUiBlock, { type: 'document-preview' }>; scope: string }) {
  const t = useTranslations('settings.plugins.ui')
  const entry = usePluginDocuments(state => state.entries[block.documentId])
  const pluginId = scope.split(':')[0]
  const html = entry?.pluginId === pluginId && !entry.owner.aborted ? entry.value.html : undefined
  const source = useMemo(() => {
    if (html === undefined) return ''
    const template = document.createElement('template')
    template.innerHTML = html
    // Preview links are inert; exported HTML keeps its safe links.
    for (const link of template.content.querySelectorAll('a')) link.removeAttribute('href')
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body style="margin:0;padding:16px;background:white">${template.innerHTML}</body></html>`
  }, [html])
  if (html === undefined) return <p role="status">{t('documentExpired')}</p>
  const preview = <iframe title={block.title} sandbox="" referrerPolicy="no-referrer" srcDoc={source} className="block min-h-0 w-full flex-1 border-0 bg-white" />
  if (block.width === 'mobile') return <div className="h-full min-h-0 min-w-0 overflow-hidden py-2">
    <div className="mx-auto flex h-full min-h-0 w-[390px] max-w-full flex-col rounded-[2.25rem] border-[7px] border-zinc-800 bg-zinc-800 p-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-600">
      <div aria-hidden="true" className="flex h-7 shrink-0 items-center justify-center rounded-t-[1.6rem] bg-white">
        <span className="h-2 w-20 rounded-full bg-zinc-800" />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-[1.6rem] bg-white">{preview}</div>
      <div aria-hidden="true" className="flex h-5 shrink-0 items-center justify-center"><span className="h-1 w-24 rounded-full bg-zinc-500" /></div>
    </div>
  </div>
  return <div className="h-full min-h-0 min-w-0 overflow-hidden py-2">
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div aria-hidden="true" className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-muted/60 px-3">
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-green-400" />
        <span className="mx-auto h-4 w-2/5 rounded-full bg-background" />
      </div>
      {preview}
    </div>
  </div>
}
