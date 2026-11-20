import { getActiveWikiRevisions, getWikiMeta, listWikiPages } from '@/db/wiki'
import { BM25Index } from '@/lib/bm25'
import { tokenizeLexicalText } from '@/lib/lexical-tokenizer'
import type { WikiPage, WikiSourceRevision } from '@/types/wiki'
import { getWikiFileCacheRevision } from './files'

interface CatalogPage {
  page: WikiPage
  revisions: WikiSourceRevision[]
  fingerprint: string
  terms: Set<string>
}

interface SearchCatalog {
  contextId: string
  version: string
  index: BM25Index
  pages: Map<string, CatalogPage>
}

export function wikiSearchText(page: WikiPage) {
  return [page.title, page.title, ...page.aliases, page.body].join('\n')
}

let cached: SearchCatalog | undefined

/** Internal candidate vocabulary. Only verified, scope-filtered page views can be returned or scored. */
export async function getWikiSearchCatalog(contextId: string): Promise<SearchCatalog> {
  const dirtyVersion = await getWikiMeta<number>(contextId, 'dirty-version')
  const version = `${dirtyVersion}:${getWikiFileCacheRevision(contextId)}`
  if (cached?.contextId === contextId && cached.version === version) return cached
  const previous = cached?.contextId === contextId ? cached.pages : undefined
  const [allPages, revisions] = await Promise.all([listWikiPages(contextId), getActiveWikiRevisions(contextId)])
  const bySource = new Map(revisions.map(revision => [revision.source.stableId, revision]))
  const byTopic = new Map<string, WikiSourceRevision[]>()
  for (const revision of revisions) {
    for (const key of new Set(revision.contributions.map(contribution => contribution.topicKey))) {
      const items = byTopic.get(key)
      if (items) items.push(revision)
      else byTopic.set(key, [revision])
    }
  }

  const pages = new Map<string, CatalogPage>()
  for (const page of allPages) {
    if (page.status === 'archived') continue
    const dependencies = page.kind === 'topic' ? byTopic.get(page.topicKey ?? '') ?? []
      : page.sourceRefs.flatMap(source => bySource.get(source.stableId) ?? [])
    if (!dependencies.length) continue
    const fingerprint = JSON.stringify([page.outputHash, page.title, page.aliases,
      dependencies.map(item => [item.id, item.source.title])])
    const old = previous?.get(page.id)
    let terms = old?.fingerprint === fingerprint ? old.terms : undefined
    if (!terms) {
      const text = [page.title, ...page.aliases, page.body]
      // Partial or stale topics are rendered from their remaining contributions.
      // They can match terms which are absent from the synthesized Markdown.
      if (page.kind === 'topic') for (const revision of dependencies) {
        text.push(revision.source.title)
        for (const item of revision.contributions) if (item.topicKey === page.topicKey) {
          text.push(item.title, item.content, ...item.evidence.map(evidence => evidence.quote))
        }
      }
      terms = new Set(tokenizeLexicalText(text.join('\n')))
    }
    pages.set(page.id, { page, revisions: dependencies, fingerprint, terms })
  }
  const index = new BM25Index()
  index.index(Array.from(pages.values(), ({ page }) => ({ id: page.id, content: wikiSearchText(page) })),
    cached?.contextId === contextId ? cached.index : undefined)
  cached = { contextId, version, index, pages }
  return cached
}
