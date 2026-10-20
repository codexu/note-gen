import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type { AiConfig, WebSearchProvider } from '@/app/core/setting/config'
import { getAISettings } from '@/lib/ai/utils'
import { invokeAiJson, resolveAiRequestConfig } from '@/lib/ai/tauri-client'
import { capturePublicWebPage } from '@/lib/web-capture/service'
import type { WebPageResponse, WebSearchResponse, WebSearchSource } from './types'
import { normalizeWebSearchProviderOrder } from './settings'

const SEARCH_TIMEOUT_MS = 7_000
const TOTAL_SEARCH_TIMEOUT_MS = 20_000
const MAX_PAGE_CHARACTERS = 18_000
const MAX_SEARCH_RESULTS = 8
const unsupportedNativeSearch = new Set<string>()

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function firstString(record: UnknownRecord | undefined, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = asString(record[key]).trim()
    if (value) return value
  }
  return ''
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed, 'https://www.bing.com')
    if (url.hostname.endsWith('duckduckgo.com')) {
      const redirected = url.searchParams.get('uddg')
      if (redirected) return redirected
    }
    return url.href
  } catch {
    return ''
  }
}

function getHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function normalizeSources(sources: WebSearchSource[], limit = MAX_SEARCH_RESULTS): WebSearchSource[] {
  const seen = new Set<string>()
  const normalized: WebSearchSource[] = []

  for (const source of sources) {
    const url = normalizeUrl(source.url)
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    normalized.push({
      title: source.title.trim() || new URL(url).hostname,
      url,
      snippet: source.snippet?.replace(/\s+/g, ' ').trim() || undefined,
      publishedAt: source.publishedAt?.trim() || undefined,
    })
    if (normalized.length >= limit) break
  }

  return normalized
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  parent?.addEventListener('abort', abort, { once: true })

  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    },
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs = SEARCH_TIMEOUT_MS
): Promise<unknown> {
  const timeout = createTimeoutSignal(signal, timeoutMs)
  try {
    const response = await httpFetch(url, {
      ...init,
      signal: timeout.signal,
    })
    if (!response.ok) {
      throw new Error(`Search request failed with HTTP ${response.status}`)
    }
    return response.json()
  } finally {
    timeout.dispose()
  }
}

function nativeSearchKey(config: AiConfig) {
  return `${config.baseURL || ''}::${config.model || ''}`
}

function parseNativeSearchResponse(payload: unknown, query: string): WebSearchResponse | null {
  const root = asRecord(payload)
  if (!root) return null

  const sources: WebSearchSource[] = []
  const textParts: string[] = []

  for (const outputItem of asArray(root.output)) {
    const output = asRecord(outputItem)
    if (!output) continue

    const action = asRecord(output.action)
    for (const rawSource of asArray(action?.sources)) {
      const source = asRecord(rawSource)
      const url = firstString(source, ['url'])
      if (url) {
        sources.push({
          title: firstString(source, ['title', 'name']) || getHostname(url),
          url,
        })
      }
    }

    for (const rawContent of asArray(output.content)) {
      const content = asRecord(rawContent)
      if (!content) continue
      const text = firstString(content, ['text'])
      if (text) textParts.push(text)

      for (const rawAnnotation of asArray(content.annotations)) {
        const annotation = asRecord(rawAnnotation)
        const citation = asRecord(annotation?.url_citation) || annotation
        const url = firstString(citation, ['url'])
        if (url) {
          sources.push({
            title: firstString(citation, ['title']) || getHostname(url),
            url,
          })
        }
      }
    }
  }

  const answer = firstString(root, ['output_text']) || textParts.join('\n').trim()
  const normalizedSources = normalizeSources(sources)
  if (!answer && normalizedSources.length === 0) return null

  return {
    query,
    provider: 'native',
    answer: answer || undefined,
    sources: normalizedSources,
  }
}

async function searchWithNativeModel(
  config: AiConfig,
  query: string,
  signal?: AbortSignal
): Promise<WebSearchResponse | null> {
  const cacheKey = nativeSearchKey(config)
  if (!config.baseURL || !config.model || unsupportedNativeSearch.has(cacheKey)) return null

  const timeout = createTimeoutSignal(signal, SEARCH_TIMEOUT_MS)
  try {
    const requestConfig = await resolveAiRequestConfig(config)
    const payload = await invokeAiJson<unknown>({
      config: requestConfig,
      path: '/responses',
      method: 'POST',
      body: {
        model: config.model,
        input: query,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
      },
    }, timeout.signal)
    const parsed = parseNativeSearchResponse(payload, query)
    if (parsed) return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/404|not found|unsupported|not support|unknown (?:endpoint|tool|parameter)|不支持|不存在/i.test(message)) {
      unsupportedNativeSearch.add(cacheKey)
      return null
    }
    throw error
  } finally {
    timeout.dispose()
  }

  unsupportedNativeSearch.add(cacheKey)
  return null
}

function sourceFromRecord(
  value: unknown,
  keys: {
    title: string[]
    url: string[]
    snippet: string[]
    publishedAt?: string[]
  }
): WebSearchSource | null {
  const record = asRecord(value)
  if (!record) return null
  const url = firstString(record, keys.url)
  if (!url) return null

  return {
    title: firstString(record, keys.title),
    url,
    snippet: firstString(record, keys.snippet) || undefined,
    publishedAt: keys.publishedAt ? firstString(record, keys.publishedAt) || undefined : undefined,
  }
}

async function searchWithConfiguredProvider(
  provider: Exclude<WebSearchProvider, 'auto'>,
  apiKey: string,
  query: string,
  signal?: AbortSignal
): Promise<WebSearchResponse> {
  let payload: unknown
  let rawSources: unknown[] = []

  if (provider === 'zhipu') {
    payload = await fetchJson('https://open.bigmodel.cn/api/paas/v4/web_search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search_engine: 'search_std',
        search_query: query,
      }),
    }, signal)
    rawSources = asArray(asRecord(payload)?.search_result)
  } else if (provider === 'tavily') {
    payload = await fetchJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: MAX_SEARCH_RESULTS,
        include_answer: false,
        include_raw_content: false,
      }),
    }, signal)
    rawSources = asArray(asRecord(payload)?.results)
  } else if (provider === 'brave') {
    payload = await fetchJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}&search_lang=zh-hans`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      },
      signal
    )
    rawSources = asArray(asRecord(asRecord(payload)?.web)?.results)
  } else {
    payload = await fetchJson('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: MAX_SEARCH_RESULTS,
        contents: { highlights: { maxCharacters: 1_200 } },
      }),
    }, signal)
    rawSources = asArray(asRecord(payload)?.results)
  }

  const sources = normalizeSources(rawSources.flatMap((item) => {
    const source = sourceFromRecord(item, {
      title: ['title', 'name'],
      url: ['url', 'link'],
      snippet: ['content', 'description', 'snippet', 'text'],
      publishedAt: ['published_date', 'publishedDate', 'age'],
    })
    if (!source) return []

    const highlights = asArray(asRecord(item)?.highlights)
      .map(asString)
      .filter(Boolean)
      .join(' ')
    return [{ ...source, snippet: source.snippet || highlights || undefined }]
  }))

  if (sources.length === 0) {
    throw new Error(`${provider} returned no usable search results`)
  }

  return { query, provider, sources }
}

export async function checkWebSearchProvider(
  provider: Exclude<WebSearchProvider, 'auto'>,
  apiKey: string,
  signal?: AbortSignal
) {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) throw new Error('API Key is required')

  return searchWithConfiguredProvider(
    provider,
    normalizedApiKey,
    'NoteGen official website',
    signal
  )
}

interface HtmlSearchEngine {
  provider: WebSearchResponse['provider']
  url: (query: string) => string
  selectors: {
    result: string
    link: string
    snippet: string
  }
}

const HTML_SEARCH_ENGINES: HtmlSearchEngine[] = [
  {
    provider: 'bing',
    url: query => `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`,
    selectors: {
      result: 'li.b_algo',
      link: 'h2 a',
      snippet: '.b_caption p, .b_snippet',
    },
  },
  {
    provider: 'bing',
    url: query => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    selectors: {
      result: 'li.b_algo',
      link: 'h2 a',
      snippet: '.b_caption p, .b_snippet',
    },
  },
  {
    provider: 'duckduckgo',
    url: query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    selectors: {
      result: '.result',
      link: '.result__a',
      snippet: '.result__snippet',
    },
  },
  {
    provider: 'sogou',
    url: query => `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
    selectors: {
      result: '.vrwrap, .rb',
      link: 'h3 a, h4 a',
      snippet: '.str_info, .space-txt, .text-layout',
    },
  },
  {
    provider: 'so',
    url: query => `https://www.so.com/s?q=${encodeURIComponent(query)}`,
    selectors: {
      result: '.res-list',
      link: '.res-title a, h3 a',
      snippet: '.res-desc, .summary',
    },
  },
  {
    provider: 'baidu',
    url: query => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    selectors: {
      result: '.result, .c-container',
      link: 'h3 a',
      snippet: '.c-abstract, .content-right_8Zs40, .c-span-last',
    },
  },
]

async function searchHtmlEngine(
  engine: HtmlSearchEngine,
  query: string,
  signal?: AbortSignal
): Promise<WebSearchResponse> {
  const timeout = createTimeoutSignal(signal, SEARCH_TIMEOUT_MS)
  try {
    const response = await httpFetch(engine.url(query), {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/131 Safari/537.36',
      },
      signal: timeout.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const html = await response.text()
    if (/请输入验证码|安全验证|unusual traffic|captcha/i.test(html)) {
      throw new Error('Search engine requested verification')
    }

    const document = new DOMParser().parseFromString(html, 'text/html')
    const sources = normalizeSources(
      Array.from(document.querySelectorAll(engine.selectors.result)).flatMap((element) => {
        const link = element.querySelector<HTMLAnchorElement>(engine.selectors.link)
        const href = link?.getAttribute('href') || link?.href || ''
        if (!href) return []
        const url = new URL(href, engine.url(query)).href
        return [{
          title: link?.textContent?.trim() || '',
          url,
          snippet: element.querySelector(engine.selectors.snippet)?.textContent?.trim(),
        }]
      })
    )

    if (sources.length === 0) throw new Error('Search result page could not be parsed')
    return { query, provider: engine.provider, sources }
  } finally {
    timeout.dispose()
  }
}

async function searchBasicWeb(query: string, signal?: AbortSignal): Promise<WebSearchResponse> {
  const errors: string[] = []
  for (const engine of HTML_SEARCH_ENGINES) {
    try {
      return await searchHtmlEngine(engine, query, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      errors.push(`${engine.provider}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Basic web search failed. ${errors.join('; ')}`)
}

export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResponse> {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim()
  if (!normalizedQuery) throw new Error('Search query is required')
  if (normalizedQuery.length > 500) throw new Error('Search query is too long')

  const totalTimeout = createTimeoutSignal(signal, TOTAL_SEARCH_TIMEOUT_MS)
  try {
    const config = await getAISettings()
    if (!config?.enableWebSearch) {
      throw new Error('Web search is not enabled for the current model')
    }

    if (config.enableNativeWebSearch !== false) {
      try {
        const nativeResult = await searchWithNativeModel(config, normalizedQuery, totalTimeout.signal)
        if (nativeResult) return nativeResult
      } catch {
        // A reachable but temporarily failing native search must not prevent the
        // user-configured or local fallback providers from running.
      }
    }

    if (config.enableThirdPartyWebSearch !== false) {
      const providerOrder = normalizeWebSearchProviderOrder(config.webSearchProviderOrder)
      const configuredProviders = providerOrder.flatMap((provider) => {
        const apiKey = config.webSearchApiKeys?.[provider]?.trim()
          || (provider === config.webSearchProvider ? config.webSearchApiKey?.trim() : '')
        return apiKey ? [{ provider, apiKey }] : []
      })

      for (const { provider, apiKey } of configuredProviders) {
        try {
          return await searchWithConfiguredProvider(provider, apiKey, normalizedQuery, totalTimeout.signal)
        } catch {
          // Try the next configured provider before the no-key search layer.
        }
      }
    }

    if (config.enableBasicWebSearch !== false) {
      return searchBasicWeb(normalizedQuery, totalTimeout.signal)
    }

    throw new Error('All enabled web search layers are unavailable')
  } finally {
    totalTimeout.dispose()
  }
}

export async function readWebPage(value: string, signal?: AbortSignal): Promise<WebPageResponse> {
  const result = await capturePublicWebPage(value, { signal })
  if (result.status === 'failed' || result.status === 'blocked') {
    throw new Error(result.errorMessage || 'The web page could not be read')
  }

  const content = (result.plainText || result.excerpt || '').slice(0, MAX_PAGE_CHARACTERS)
  if (!content) throw new Error('The web page did not contain readable text')

  return {
    title: result.title,
    url: result.canonicalUrl || result.finalUrl,
    content,
  }
}
