import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { extractWebPage } from './extract'
import type {
  WebCaptureErrorCode,
  WebCaptureOptions,
  WebCaptureResult,
} from './types'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true

  const ipv4MappedMatch = normalized.match(
    /^\[?::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/
  )
  if (ipv4MappedMatch) {
    const high = Number.parseInt(ipv4MappedMatch[1], 16)
    const low = Number.parseInt(ipv4MappedMatch[2], 16)
    const mappedIpv4 = [
      high >> 8,
      high & 0xff,
      low >> 8,
      low & 0xff,
    ].join('.')
    return isPrivateHostname(mappedIpv4)
  }

  if (
    normalized === '::'
    || normalized === '[::]'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized.startsWith('[fc')
    || normalized.startsWith('[fd')
    || normalized.startsWith('[fe8')
    || normalized.startsWith('[fe9')
    || normalized.startsWith('[fea')
    || normalized.startsWith('[feb')
  ) return true
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized)) return true
  if (/^192\.168\./.test(normalized)) return true

  const match = normalized.match(/^172\.(\d{1,3})\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

export function assertPublicWebUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid web page URL')
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || isPrivateHostname(url.hostname)
    || url.username
    || url.password
  ) {
    throw new Error('Only public HTTP(S) URLs can be read')
  }
  return url
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

async function readResponseBytes(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxBytes) {
    throw new WebCaptureRequestError('content-too-large', 'Web page content is too large')
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new WebCaptureRequestError('content-too-large', 'Web page content is too large')
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      throw new WebCaptureRequestError('content-too-large', 'Web page content is too large')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decodeHtml(bytes: Uint8Array, contentType: string) {
  const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  const headerSample = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 8_192)))
  const documentCharset = headerSample.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>]+)/i)?.[1]
    || headerSample.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'\s;]+)/i)?.[1]
  const charset = headerCharset || documentCharset || 'utf-8'

  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

class WebCaptureRequestError extends Error {
  constructor(
    readonly code: WebCaptureErrorCode,
    message: string
  ) {
    super(message)
  }
}

function createFailedResult(
  requestedUrl: string,
  finalUrl: string,
  code: WebCaptureErrorCode,
  message: string
): WebCaptureResult {
  let hostname = requestedUrl
  try {
    hostname = new URL(finalUrl || requestedUrl).hostname
  } catch {
    // Keep the original value as the last-resort title.
  }

  return {
    requestedUrl,
    finalUrl: finalUrl || requestedUrl,
    title: hostname,
    contentMarkdown: '',
    plainText: '',
    method: 'http',
    status: code === 'access-denied' || code === 'captcha' || code === 'login-required'
      ? 'blocked'
      : 'failed',
    qualityScore: 0,
    capturedAt: Date.now(),
    errorCode: code,
    errorMessage: message,
  }
}

export async function capturePublicWebPage(
  value: string,
  options: WebCaptureOptions = {}
): Promise<WebCaptureResult> {
  const requestedUrl = value
  let url: URL
  try {
    url = assertPublicWebUrl(value)
  } catch (error) {
    return createFailedResult(
      requestedUrl,
      requestedUrl,
      'invalid-url',
      error instanceof Error ? error.message : String(error)
    )
  }

  const timeout = createTimeoutSignal(options.signal, options.timeoutMs || DEFAULT_TIMEOUT_MS)
  let finalUrl = url.href

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      finalUrl = url.href
      const response = await httpFetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/131 Safari/537.36 NoteGen/1',
        },
        signal: timeout.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new WebCaptureRequestError('http-error', 'Web page redirected without a location')
        }
        url = assertPublicWebUrl(new URL(location, url).href)
        continue
      }

      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? 'access-denied'
          : 'http-error'
        throw new WebCaptureRequestError(code, `Web page request failed with HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') || ''
      if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
        throw new WebCaptureRequestError(
          'unsupported-content',
          `Unsupported web page content type: ${contentType || 'unknown'}`
        )
      }

      const bytes = await readResponseBytes(response, options.maxBytes || DEFAULT_MAX_BYTES)
      const text = decodeHtml(bytes, contentType)
      if (/text\/plain/i.test(contentType)) {
        const plainText = text.trim()
        return {
          requestedUrl,
          finalUrl,
          title: url.hostname,
          contentMarkdown: plainText,
          plainText,
          method: 'http',
          status: plainText.length >= 80 ? 'success' : 'partial',
          qualityScore: Math.min(100, Math.round(plainText.length / 20)),
          capturedAt: Date.now(),
        }
      }

      return extractWebPage(text, requestedUrl, finalUrl)
    }

    throw new WebCaptureRequestError('redirect-limit', 'Web page exceeded the redirect limit')
  } catch (error) {
    if (error instanceof WebCaptureRequestError) {
      return createFailedResult(requestedUrl, finalUrl, error.code, error.message)
    }
    if (timeout.signal.aborted) {
      return createFailedResult(requestedUrl, finalUrl, 'timeout', 'Web page request timed out')
    }
    return createFailedResult(
      requestedUrl,
      finalUrl,
      'network',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    timeout.dispose()
  }
}
