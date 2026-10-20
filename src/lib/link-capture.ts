import { searchWeb } from '@/lib/web-search/service'
import { capturePublicWebPage } from '@/lib/web-capture/service'
import type { WebCaptureOptions, WebCaptureResult } from '@/lib/web-capture/types'

function normalizeComparableUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:utm_|spm$|from$|source$|share_)/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    return {
      hostname: url.hostname.replace(/^www\./, ''),
      pathname: decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/',
    }
  } catch {
    return null
  }
}

function isSamePage(left: string, right: string) {
  const leftUrl = normalizeComparableUrl(left)
  const rightUrl = normalizeComparableUrl(right)
  return Boolean(
    leftUrl
    && rightUrl
    && leftUrl.hostname === rightUrl.hostname
    && leftUrl.pathname === rightUrl.pathname
  )
}

async function searchLinkFallback(
  result: WebCaptureResult,
  signal?: AbortSignal
): Promise<WebCaptureResult | null> {
  try {
    const searchResult = await searchWeb(`"${result.finalUrl}"`, signal)
    const source = searchResult.sources.find(item => (
      isSamePage(item.url, result.finalUrl)
      || isSamePage(item.url, result.canonicalUrl || '')
    ))
    if (!source) return null

    return {
      ...result,
      finalUrl: source.url,
      title: source.title || result.title,
      excerpt: source.snippet || result.excerpt,
      contentMarkdown: '',
      plainText: '',
      imageUrl: undefined,
      imageUrls: [],
      publishedAt: source.publishedAt || result.publishedAt,
      method: 'search',
      status: 'metadata-only',
      errorMessage: result.errorMessage,
    }
  } catch {
    return null
  }
}

export async function captureLink(
  value: string,
  options: WebCaptureOptions = {}
): Promise<WebCaptureResult> {
  const result = await capturePublicWebPage(value, options)
  if (result.status === 'success' || result.status === 'partial') return result

  const fallback = await searchLinkFallback(result, options.signal)
  return fallback || result
}

export type {
  WebCaptureErrorCode,
  WebCaptureMethod,
  WebCaptureResult,
  WebCaptureStatus,
} from '@/lib/web-capture/types'
