import { getActiveWikiRevisions, listWikiPages } from '@/db/wiki'
import { BM25Index } from '@/lib/bm25'
import type { WikiContribution, WikiSettings, WikiSourceRevision, WikiSyncDomain } from '@/types/wiki'
import { compareWikiKeys, getWikiSourcePolicy, normalizeWikiTopicName, resolveEligibleWikiRevision } from './sources'

type Topic = Pick<WikiContribution, 'topicKey' | 'title' | 'aliases'>

/** Include committed source contributions before their topic Markdown pages have been generated. */
export async function createWikiTopicCatalog(contextId: string, settings: WikiSettings, domain: WikiSyncDomain) {
  const policy = await getWikiSourcePolicy(contextId, settings)
  const [active, pages] = await Promise.all([getActiveWikiRevisions(contextId), listWikiPages(contextId)])
  const revisions = active.filter(revision =>
    revision.source.sourceType === 'article' && revision.source.syncDomain === domain && policy.allows(revision.source))
  const published = new Map(pages.filter(page => page.kind === 'topic' && page.status !== 'archived' && page.topicKey
    && page.sourceRefs.every(ref => ref.sourceType === 'article' && ref.syncDomain === domain && policy.allows(ref))).map(page => [page.topicKey!, page]))
  const entries = new Map<string, Array<{ contribution: WikiContribution; revision: WikiSourceRevision }>>()
  const byName = new Map<string, Set<string>>()
  const rememberName = (alias: string, key: string) => {
    const name = normalizeWikiTopicName(alias)
    if (!byName.has(name)) byName.set(name, new Set())
    byName.get(name)!.add(key)
  }
  for (const revision of revisions.sort((a, b) => compareWikiKeys(a.source.stableId, b.source.stableId))) {
    for (const contribution of revision.contributions) {
      const key = contribution.topicKey
      if (!entries.has(key)) entries.set(key, [])
      entries.get(key)!.push({ contribution, revision })
      for (const alias of [contribution.title, ...contribution.aliases]) rememberName(alias, key)
    }
  }
  const index = new BM25Index()
  index.index([...entries].map(([id, items]) => {
    const names = new Set(items.flatMap(({ contribution }) => [contribution.title, ...contribution.aliases]))
    const page = published.get(id)
    if (page) for (const alias of [page.title, ...page.aliases]) { names.add(alias); rememberName(alias, id) }
    return { id, content: [...names].join('\n') }
  }))

  // Local names only identify candidates. Only eligible, current sources supply titles sent to the model.
  const checked = new Map<string, Promise<WikiSourceRevision | null>>()
  const verified = new Map<string, Topic | null>()
  const lookup = async (key: string) => {
    if (verified.has(key)) return verified.get(key) ?? null
    let topic: Topic | null = null
    const names = new Set<string>()
    const sources = new Map<string, string>()
    for (const { contribution, revision } of entries.get(key) ?? []) {
      if (!checked.has(revision.id)) checked.set(revision.id, resolveEligibleWikiRevision(revision, policy))
      if (!await checked.get(revision.id)) continue
      sources.set(revision.source.stableId, revision.source.contentHash)
      topic ??= { topicKey: key, title: contribution.title, aliases: [] }
      for (const alias of [contribution.title, ...contribution.aliases]) names.add(alias)
    }
    if (topic) {
      const page = published.get(key)
      if (page?.sourceRefs.length && page.sourceRefs.every(ref => sources.get(ref.stableId) === ref.contentHash)) {
        topic.title = page.title
        for (const alias of page.aliases) names.add(alias)
      }
      names.delete(topic.title)
      topic.aliases = [...names]
    }
    verified.set(key, topic)
    return topic
  }

  return {
    async search(text: string) {
      const keys = entries.size <= 5 ? [...entries.keys()] : index.search(text, 10).map(hit => hit.id)
      const topics: Topic[] = []
      for (const key of keys) {
        const topic = await lookup(key)
        if (topic) topics.push(topic)
        if (topics.length === 5) break
      }
      return topics
    },
    async match(item: Topic) {
      const existing = await lookup(item.topicKey)
      if (existing) return existing
      const names = new Set([item.title, ...item.aliases].map(normalizeWikiTopicName))
      const keys = new Set([...names].flatMap(name => [...(byName.get(name) ?? [])]))
      const matches: Topic[] = []
      for (const key of keys) {
        const topic = await lookup(key)
        if (topic && [topic.title, ...topic.aliases].some(alias => names.has(normalizeWikiTopicName(alias)))) matches.push(topic)
      }
      return matches.length === 1 ? matches[0] : null
    },
  }
}
