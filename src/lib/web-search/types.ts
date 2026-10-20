import type { WebSearchProvider } from '@/app/core/setting/config'

export interface WebSearchSource {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
}

export interface WebSearchResponse {
  query: string
  provider: 'native' | WebSearchProvider | 'bing' | 'duckduckgo' | 'sogou' | 'so' | 'baidu'
  answer?: string
  sources: WebSearchSource[]
}

export interface WebPageResponse {
  title: string
  url: string
  content: string
}
