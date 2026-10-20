export type WebCaptureMethod = 'http' | 'site-adapter' | 'search'

export type WebCaptureStatus = 'success' | 'partial' | 'metadata-only' | 'blocked' | 'failed'

export type WebCaptureErrorCode =
  | 'access-denied'
  | 'captcha'
  | 'content-too-large'
  | 'dynamic-content'
  | 'empty-content'
  | 'http-error'
  | 'invalid-url'
  | 'login-required'
  | 'network'
  | 'redirect-limit'
  | 'timeout'
  | 'unsupported-content'

export interface WebCaptureResult {
  requestedUrl: string
  finalUrl: string
  canonicalUrl?: string
  title: string
  excerpt?: string
  contentMarkdown: string
  plainText: string
  byline?: string
  siteName?: string
  publishedAt?: string
  imageUrl?: string
  imageUrls?: string[]
  language?: string
  method: WebCaptureMethod
  status: WebCaptureStatus
  qualityScore: number
  capturedAt: number
  errorCode?: WebCaptureErrorCode
  errorMessage?: string
}

export interface WebCaptureOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}
