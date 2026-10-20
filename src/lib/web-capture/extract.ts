import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type {
  WebCaptureErrorCode,
  WebCaptureMethod,
  WebCaptureResult,
  WebCaptureStatus,
} from './types'

const BLOCKED_PAGE_PATTERNS: Array<{
  code: WebCaptureErrorCode
  pattern: RegExp
}> = [
  {
    code: 'captcha',
    pattern: /captcha|请输入验证码|安全验证|环境异常|完成验证|去验证|验证你是真人|unusual traffic|verify you are human/i,
  },
  {
    code: 'login-required',
    pattern: /登录后(?:查看|继续|阅读)|请先登录|sign in to continue|login required/i,
  },
  {
    code: 'access-denied',
    pattern: /access denied|访问被拒绝|拒绝访问|temporarily blocked|请求过于频繁|just a moment/i,
  },
]

const HIGH_CONFIDENCE_BLOCKED_PAGE_PATTERNS: Array<{
  code: WebCaptureErrorCode
  pattern: RegExp
}> = [
  {
    code: 'captcha',
    pattern: /mmbizwap:secitptpage\/verify\.html|wappoc_appmsgcaptcha|当前环境异常[\s\S]{0,80}完成验证后即可继续访问/i,
  },
  {
    code: 'access-denied',
    pattern: /<div[^>]+class=["'][^"']*weui-msg__title[^"']*warn[^"']*["'][^>]*>\s*参数错误\s*<\/div>/i,
  },
]

const DYNAMIC_PAGE_PATTERNS = [
  /please enable javascript/i,
  /请启用JavaScript/i,
  /请开启JavaScript/i,
  /you need to enable javascript/i,
]

const TRACKING_QUERY_PARAMS = [
  /^utm_/i,
  /^spm$/i,
  /^from$/i,
  /^source$/i,
  /^share_/i,
]

function compactText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function firstAttribute(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute('content')
      || document.querySelector(selector)?.getAttribute('href')
    if (value?.trim()) return value.trim()
  }
  return ''
}

function firstText(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = compactText(document.querySelector(selector)?.textContent)
    if (value) return value
  }
  return ''
}

function toAbsoluteUrl(value: string, baseUrl: string) {
  const trimmed = value.trim()
  if (!trimmed || /^(?:data|javascript|blob):/i.test(trimmed)) return ''

  try {
    return new URL(trimmed, baseUrl).href
  } catch {
    return ''
  }
}

function normalizeCanonicalUrl(value: string, finalUrl: string) {
  const absoluteUrl = toAbsoluteUrl(value, finalUrl)
  if (!absoluteUrl) return undefined

  try {
    const canonical = new URL(absoluteUrl)
    const current = new URL(finalUrl)
    if (canonical.hostname !== current.hostname) return undefined
    canonical.hash = ''
    for (const key of Array.from(canonical.searchParams.keys())) {
      if (TRACKING_QUERY_PARAMS.some(pattern => pattern.test(key))) {
        canonical.searchParams.delete(key)
      }
    }
    return canonical.href
  } catch {
    return undefined
  }
}

function prepareDocument(document: Document, baseUrl: string) {
  document.querySelectorAll(
    'script, style, noscript, template, iframe, object, embed, form, dialog, nav, footer, aside, svg'
  ).forEach(element => element.remove())

  document.querySelectorAll<HTMLElement>('[hidden], [aria-hidden="true"]').forEach(element => element.remove())
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = toAbsoluteUrl(anchor.getAttribute('href') || '', baseUrl)
    if (href) {
      anchor.href = href
    } else {
      anchor.removeAttribute('href')
    }
  })

  document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const lazySource = image.getAttribute('data-src')
      || image.getAttribute('data-original')
      || image.getAttribute('data-lazy-src')
      || image.getAttribute('data-actualsrc')
      || image.getAttribute('src')
      || ''
    const source = toAbsoluteUrl(lazySource, baseUrl)
    const width = Number(image.getAttribute('width') || 0)
    const height = Number(image.getAttribute('height') || 0)

    if (!source || (width > 0 && height > 0 && width <= 2 && height <= 2)) {
      image.remove()
      return
    }

    image.src = source
    for (const attribute of [
      'data-src',
      'data-original',
      'data-lazy-src',
      'data-actualsrc',
      'srcset',
    ]) {
      image.removeAttribute(attribute)
    }
  })
}

function extractJsonLd(document: Document) {
  const values: Record<string, string> = {}

  for (const element of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed = JSON.parse(element.textContent || '')
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed]

      while (queue.length > 0) {
        const current = queue.shift()
        if (!current || typeof current !== 'object') continue
        if (Array.isArray(current)) {
          queue.push(...current)
          continue
        }

        const record = current as Record<string, unknown>
        if (Array.isArray(record['@graph'])) queue.push(...record['@graph'])

        const author = record.author
        const authorName = typeof author === 'string'
          ? author
          : author && typeof author === 'object'
            ? String((author as Record<string, unknown>).name || '')
            : ''

        if (!values.title && typeof record.headline === 'string') values.title = record.headline
        if (!values.description && typeof record.description === 'string') values.description = record.description
        if (!values.author && authorName) values.author = authorName
        if (!values.publishedAt && typeof record.datePublished === 'string') values.publishedAt = record.datePublished
        if (!values.image && typeof record.image === 'string') values.image = record.image
      }
    } catch {
      // Ignore malformed JSON-LD blocks from the page.
    }
  }

  return values
}

function getWechatContent(document: Document, baseUrl: string) {
  let hostname = ''
  try {
    hostname = new URL(baseUrl).hostname
  } catch {
    return null
  }
  if (hostname !== 'mp.weixin.qq.com') return null

  const content = document.querySelector<HTMLElement>('#js_content')
  if (!content) return null

  return {
    content,
    title: firstText(document, ['#activity-name', 'h1']),
    byline: firstText(document, ['#js_name', '.rich_media_meta_text']),
  }
}

function htmlToMarkdown(html: string, baseUrl: string) {
  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  })

  turndown.addRule('safeLinks', {
    filter: node => node.nodeName === 'A',
    replacement: (content, node) => {
      const href = toAbsoluteUrl((node as HTMLAnchorElement).getAttribute('href') || '', baseUrl)
      return href ? `[${content || href}](${href})` : content
    },
  })

  turndown.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const image = node as HTMLImageElement
      const source = toAbsoluteUrl(image.getAttribute('src') || '', baseUrl)
      if (!source) return ''
      const alternative = compactText(image.getAttribute('alt')) || 'image'
      return `![${alternative}](${source})`
    },
  })

  return turndown.turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getBlockReason(title: string, text: string) {
  const sample = `${title}\n${text.slice(0, 4_000)}`
  return BLOCKED_PAGE_PATTERNS.find(item => item.pattern.test(sample))?.code
}

function getHighConfidenceBlockReason(html: string) {
  return HIGH_CONFIDENCE_BLOCKED_PAGE_PATTERNS.find(item => item.pattern.test(html))?.code
}

function getQualityScore(text: string, document: Document) {
  if (!text) return 0

  const lengthScore = Math.min(55, Math.round(text.length / 40))
  const paragraphCount = Array.from(document.querySelectorAll('p'))
    .filter(paragraph => compactText(paragraph.textContent).length >= 40)
    .length
  const paragraphScore = Math.min(25, paragraphCount * 3)
  const punctuationCount = (text.match(/[。！？.!?；;]/g) || []).length
  const punctuationScore = Math.min(10, punctuationCount)
  const linksTextLength = Array.from(document.querySelectorAll('a'))
    .reduce((total, link) => total + compactText(link.textContent).length, 0)
  const linkDensityPenalty = text.length > 0 && linksTextLength / text.length > 0.45 ? 20 : 0
  const titleScore = compactText(document.title).length > 3 ? 10 : 0

  return Math.max(0, Math.min(100, lengthScore + paragraphScore + punctuationScore + titleScore - linkDensityPenalty))
}

function getStatus(
  text: string,
  qualityScore: number,
  blockedReason?: WebCaptureErrorCode
): {
  status: WebCaptureStatus
  errorCode?: WebCaptureErrorCode
} {
  if (blockedReason) {
    return { status: 'blocked', errorCode: blockedReason }
  }
  if (text.length >= 300 && qualityScore >= 45) {
    return { status: 'success' }
  }
  if (text.length >= 80) {
    return { status: 'partial' }
  }
  return {
    status: 'metadata-only',
    errorCode: text.length > 0 ? 'dynamic-content' : 'empty-content',
  }
}

export function extractWebPage(
  html: string,
  requestedUrl: string,
  finalUrl: string
): WebCaptureResult {
  const parser = new DOMParser()
  const sourceDocument = parser.parseFromString(html, 'text/html')
  const jsonLd = extractJsonLd(sourceDocument)
  const metadataTitle = firstAttribute(sourceDocument, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ])
  const metadataDescription = firstAttribute(sourceDocument, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ])
  const canonicalUrl = normalizeCanonicalUrl(
    firstAttribute(sourceDocument, ['link[rel="canonical"]']),
    finalUrl
  )
  const siteName = firstAttribute(sourceDocument, ['meta[property="og:site_name"]'])
  const publishedAt = firstAttribute(sourceDocument, [
    'meta[property="article:published_time"]',
    'meta[name="publishdate"]',
    'meta[name="pubdate"]',
  ]) || jsonLd.publishedAt
  const imageUrl = toAbsoluteUrl(
    firstAttribute(sourceDocument, [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) || jsonLd.image || '',
    finalUrl
  ) || undefined
  const language = sourceDocument.documentElement.getAttribute('lang')?.trim() || undefined

  const preparedDocument = parser.parseFromString(html, 'text/html')
  prepareDocument(preparedDocument, finalUrl)
  const wechat = getWechatContent(preparedDocument, finalUrl)

  let contentHtml = ''
  let extractedTitle = ''
  let excerpt = ''
  let byline = ''
  let method: WebCaptureMethod = 'http'

  if (wechat) {
    contentHtml = wechat.content.innerHTML
    extractedTitle = wechat.title
    byline = wechat.byline
    method = 'site-adapter'
  } else {
    const article = new Readability(preparedDocument.cloneNode(true) as Document, {
      charThreshold: 80,
    }).parse()
    contentHtml = article?.content || ''
    extractedTitle = article?.title || ''
    excerpt = article?.excerpt || ''
    byline = article?.byline || ''
  }

  const contentDocument = parser.parseFromString(contentHtml, 'text/html')
  prepareDocument(contentDocument, finalUrl)
  const imageUrls = Array.from(contentDocument.querySelectorAll<HTMLImageElement>('img[src]'))
    .map(image => image.getAttribute('src')?.trim() || '')
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
  const plainText = compactText(contentDocument.body.textContent)
  const contentMarkdown = htmlToMarkdown(contentDocument.body.innerHTML, finalUrl)
  const fallbackTitle = new URL(finalUrl).hostname
  const title = compactText(
    metadataTitle
      || extractedTitle
      || jsonLd.title
      || sourceDocument.title
      || fallbackTitle
  )
  const finalExcerpt = compactText(metadataDescription || excerpt || jsonLd.description)
  const sourceText = compactText(sourceDocument.body?.textContent)
  const highConfidenceBlockReason = getHighConfidenceBlockReason(html)
  const blockReason = highConfidenceBlockReason || (
    sourceText.length < 3_000 || plainText.length < 300
      ? getBlockReason(title, sourceText)
      : undefined
  )
  const isDynamicShell = plainText.length < 80 && (
    DYNAMIC_PAGE_PATTERNS.some(pattern => pattern.test(sourceText))
    || Boolean(sourceDocument.querySelector('#root, #app, #__next'))
  )
  const onlyHasFallbackTitle = title === fallbackTitle
    && !metadataTitle
    && !extractedTitle
    && !jsonLd.title
    && !compactText(sourceDocument.title)
  const qualityScore = onlyHasFallbackTitle
    ? Math.min(20, getQualityScore(plainText, contentDocument))
    : getQualityScore(plainText, contentDocument)
  const status = onlyHasFallbackTitle && !blockReason
    ? {
        status: 'metadata-only' as const,
        errorCode: 'dynamic-content' as const,
      }
    : getStatus(plainText, qualityScore, blockReason)
  const isBlocked = status.status === 'blocked'
  const safeTitle = isBlocked && BLOCKED_PAGE_PATTERNS.some(item => item.pattern.test(title))
    ? fallbackTitle
    : title

  return {
    requestedUrl,
    finalUrl,
    canonicalUrl,
    title: safeTitle,
    excerpt: isBlocked ? undefined : finalExcerpt || undefined,
    contentMarkdown: isBlocked ? '' : contentMarkdown,
    plainText: isBlocked ? '' : plainText,
    byline: compactText(byline || jsonLd.author) || undefined,
    siteName: compactText(siteName) || undefined,
    publishedAt: compactText(publishedAt) || undefined,
    imageUrl: isBlocked ? undefined : imageUrl,
    imageUrls: isBlocked ? [] : imageUrls,
    language,
    method,
    status: status.status,
    qualityScore,
    capturedAt: Date.now(),
    errorCode: isDynamicShell && !blockReason ? 'dynamic-content' : status.errorCode,
  }
}
