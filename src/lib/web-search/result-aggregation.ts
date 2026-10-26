import { normalizeWebSearchSourceUrl } from './source-url'
import type { WebSearchResponse, WebSearchResultProvider, WebSearchSource } from './types'

export const MAX_BASIC_SEARCH_RESULTS = 16
const MAX_RESPONSE_CHARACTERS = 9_000
const MAX_TITLE_CHARACTERS = 160
const MAX_SNIPPET_CHARACTERS = 400

function compactText(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function limitText(value: string, limit: number) {
  if (limit <= 0) return ''
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function sourceProviders(source: WebSearchSource, result: WebSearchResponse) {
  return source.providers?.length ? source.providers : [result.provider]
}

/** Interleave engine rankings so the first successful engine cannot fill the batch. */
export function aggregateBasicSearchResults(
  query: string,
  results: WebSearchResponse[]
): WebSearchResponse {
  if (results.length === 0) throw new Error('No basic web search results to aggregate')

  const providers = [...new Set(results.flatMap(result =>
    result.providers?.length ? result.providers : [result.provider]
  ))]
  const sources: WebSearchSource[] = []
  const byUrl = new Map<string, WebSearchSource>()
  const maxRank = Math.max(...results.map(result => result.sources.length))

  for (let rank = 0; rank < maxRank; rank += 1) {
    for (const result of results) {
      const source = result.sources[rank]
      if (!source) continue
      const url = normalizeWebSearchSourceUrl(source.url)
      if (!url) continue

      const snippet = limitText(compactText(source.snippet), MAX_SNIPPET_CHARACTERS)
      const existing = byUrl.get(url)
      if (existing) {
        existing.providers = [...new Set<WebSearchResultProvider>([
          ...(existing.providers || []),
          ...sourceProviders(source, result),
        ])]
        if (snippet.length > (existing.snippet?.length || 0)) existing.snippet = snippet
        if (!existing.publishedAt && source.publishedAt) {
          existing.publishedAt = limitText(compactText(source.publishedAt), 80)
        }
        continue
      }

      // Keep scanning duplicates after reaching the cap to retain their provenance.
      if (sources.length >= MAX_BASIC_SEARCH_RESULTS) continue
      const normalized: WebSearchSource = {
        title: limitText(compactText(source.title) || new URL(url).hostname, MAX_TITLE_CHARACTERS),
        url,
        snippet: snippet || undefined,
        publishedAt: limitText(compactText(source.publishedAt), 80) || undefined,
        providers: [...new Set(sourceProviders(source, result))],
      }
      byUrl.set(url, normalized)
      sources.push(normalized)
    }
  }

  if (sources.length === 0) throw new Error('Basic web search returned no usable sources')

  const response: WebSearchResponse = {
    query,
    provider: results[0].provider,
    providers,
    sources,
  }

  // Shrink every snippet fairly while retaining complete source URLs and valid JSON.
  // Leave room for tool guidance below the context manager's 12,000-character cap.
  let snippetLimit = MAX_SNIPPET_CHARACTERS
  while (JSON.stringify(response).length > MAX_RESPONSE_CHARACTERS && snippetLimit > 0) {
    snippetLimit = Math.floor(snippetLimit * 0.75)
    response.sources = sources.map(source => ({
      ...source,
      snippet: limitText(source.snippet || '', snippetLimit) || undefined,
    }))
  }

  // Exceptionally long URLs can exceed the budget even without snippets. Do not cut URLs.
  // Discard an oversized entry itself instead of letting it crowd out every normal source.
  response.sources = response.sources.filter(source =>
    JSON.stringify({ ...response, sources: [source] }).length <= MAX_RESPONSE_CHARACTERS
  )
  while (JSON.stringify(response).length > MAX_RESPONSE_CHARACTERS && response.sources.length > 0) {
    response.sources.pop()
  }
  if (response.sources.length === 0) {
    throw new Error('Basic web search source metadata exceeds the response size limit')
  }

  return response
}
