import type { WebSearchProvider } from '@/app/core/setting/config'

export type WebSearchResultProvider = 'native' | WebSearchProvider | 'bing' | 'duckduckgo' | 'sogou' | 'so' | 'baidu'

export interface WebSearchSource {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  providers?: WebSearchResultProvider[]
}

export interface WebSearchResponse {
  query: string
  provider: WebSearchResultProvider
  providers?: WebSearchResultProvider[]
  answer?: string
  sources: WebSearchSource[]
}

export interface WebPageResponse {
  title: string
  url: string
  content: string
}
