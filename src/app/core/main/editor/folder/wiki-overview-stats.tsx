'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { KnowledgeSourceLink } from '@/components/chat-ui/knowledge-source-link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { useWikiNavigation } from '@/components/wiki/use-wiki-navigation'
import type { WikiSourceState } from '@/types/wiki'
import type { WikiPageListEntry } from '@/db/wiki'

type List = 'summaries' | 'topics' | 'sources'

export function WikiOverviewStats({ contextId, pages, sources }: { contextId: string; pages: WikiPageListEntry[]; sources: WikiSourceState[] }) {
  const t = useTranslations('wiki')
  const { openPage } = useWikiNavigation()
  const [list, setList] = useState<List | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(30)
  const summaries = pages.filter(page => page.kind === 'source' && page.status !== 'archived')
  const topics = pages.filter(page => page.kind === 'topic' && page.status !== 'archived')
  const ready = sources.filter(source => source.status === 'ready')
  const counts = { summaries: summaries.length, topics: topics.length, sources: ready.length }
  const term = query.trim().toLocaleLowerCase()
  const matches = (title: string, path?: string) => [title, path].some(value => value?.toLocaleLowerCase().includes(term))
  const pageRows = list === 'topics' ? topics : list === 'summaries' ? summaries : []
  const results = pageRows.filter(page => matches(page.title, page.filePath)).sort((a, b) => a.title.localeCompare(b.title))
  const originals = list === 'sources' ? ready.filter(({ source }) => matches(source.title, source.locator.filePath))
    .sort((a, b) => a.source.title.localeCompare(b.source.title)) : []

  return <>
    <div className="grid grid-cols-3 gap-2" aria-label={t('folder.overviewTitle')}>
      {(['summaries', 'topics', 'sources'] as const).map(key => <Button key={key} variant="outline"
        className="h-auto flex-col items-start gap-1 px-3 py-3" onClick={() => { setQuery(''); setLimit(30); setList(key) }}>
        <span className="whitespace-normal text-start text-xs text-muted-foreground">{t(`folder.${key}`)}</span>
        <span className="text-xl font-medium tabular-nums">{counts[key]}</span>
      </Button>)}
    </div>
    <Dialog open={list !== null} onOpenChange={open => { if (!open) setList(null) }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{list ? t(`folder.${list}`) : ''}</DialogTitle></DialogHeader>
        <Input aria-label={t('scopeSearch')} placeholder={t('scopeSearch')} value={query} onChange={event => { setQuery(event.target.value); setLimit(30) }} />
        <ItemGroup className="max-h-[50dvh] overflow-y-auto">
          {results.slice(0, limit).map(page => <Item size="sm" key={page.id} asChild>
            <button type="button" className="text-left hover:bg-muted" onClick={() => { setList(null); void openPage(page.id, contextId) }}>
              <ItemContent><ItemTitle>{page.title}</ItemTitle><ItemDescription className="break-all">{page.filePath}</ItemDescription></ItemContent>
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </Item>)}
          {originals.slice(0, limit).map(({ source }) => <Item size="sm" key={source.stableId}>
            <ItemContent><ItemTitle>{source.title}</ItemTitle>
              <ItemDescription>{source.locator.filePath || t(`scopeKinds.${source.sourceType}`)}</ItemDescription>
            </ItemContent>
            <ItemActions><KnowledgeSourceLink source={source} onOpened={() => setList(null)} /></ItemActions>
          </Item>)}
          {!results.length && !originals.length ? <p className="py-3 text-sm text-muted-foreground">{t('folder.emptyResults')}</p> : null}
          {results.length + originals.length > limit ? <Button variant="outline" size="sm" onClick={() => setLimit(value => value + 30)}>{t('folder.showMore')}</Button> : null}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  </>
}
