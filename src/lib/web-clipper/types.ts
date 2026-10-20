export type WebClipperMode = 'article' | 'selection' | 'link'

export interface WebClipperTag {
  id: number
  name: string
}

export interface WebClipperConnection {
  id: string
  installId: string
  origin: string
  browser: string
  extensionVersion: string
  createdAt: number
  lastUsedAt: number
}

export interface WebClipperPairingRequest {
  id: string
  installId: string
  origin: string
  browser: string
  extensionVersion: string
  expiresAt: number
}

export interface WebClipperClip {
  protocolVersion: number
  clipId: string
  mode: WebClipperMode
  tagId: number
  url: string
  canonicalUrl?: string
  title: string
  contentMarkdown: string
  plainText?: string
  imageUrls?: string[]
  byline?: string
  siteName?: string
  publishedAt?: string
  capturedAt: number
}

export interface WebClipperBridgeRequest {
  requestId: string
  kind: 'context' | 'createClip' | 'createTag'
  payload: unknown
}

export interface WebClipperStatus {
  enabled: boolean
  ready: boolean
  port: number
  serverError?: string | null
}
