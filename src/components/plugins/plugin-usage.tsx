'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import MarkdownIt from 'markdown-it'
import { readPluginUsage } from '@/lib/plugins/backend'
import type { InstalledPlugin } from '@/lib/plugins/types'

const markdown = new MarkdownIt({ html: false, linkify: false })
// Guides are offline content, not a browser surface. Never fetch images or
// navigate arbitrary URLs (including local/custom-protocol URLs) from a package.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content)
markdown.renderer.rules.link_open = () => ''
markdown.renderer.rules.link_close = () => ''

export function PluginUsage({ plugin }: { plugin: InstalledPlugin }) {
  const locale = useLocale()
  const t = useTranslations('settings.plugins')
  const [document, setDocument] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDocument(null)
    void readPluginUsage(plugin.manifest.id, locale, { version: plugin.activeVersion, contentHash: plugin.contentHash })
      .then(value => { if (!cancelled) setDocument(value) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [plugin.manifest.id, plugin.activeVersion, plugin.contentHash, locale])
  const html = useMemo(() => document ? markdown.render(document) : '', [document])
  return <section className="flex flex-col gap-3">
    <h4 className="font-medium">{t('usage.title')}</h4>
    {loading ? <p role="status">{t('loading')}</p> : html ? (
      <div className="max-h-80 overflow-auto break-words text-sm [&_h1]:mb-3 [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto"
        dangerouslySetInnerHTML={{ __html: html }} />
    ) : <p className="text-sm text-muted-foreground">{t(error ? 'usage.failed' : 'usage.missing')}</p>}
  </section>
}
