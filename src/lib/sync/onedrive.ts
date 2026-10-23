import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'

import type { CloudFolderObject } from './cloud-folder'
import { clearCloudFolderTreeCache } from './cloud-folder-tree-cache'
import { recordSyncTiming } from './sync-timing'
import type { CloudFolderConfig } from '@/types/sync'
import { assertConditionalResponse, conditionalHeaders, type RemoteWriteCondition } from './write-condition'
import type { PathMoveRemoteVersion } from './path-move-metadata'
import { withRemotePathWriteLock } from './remote-write-lock'
import { isRemoteConnectionError, recoverRemoteMutation, type RemoteMutationObservation } from './remote-mutation-recovery'

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const AUTHORITY_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
// Files.ReadWrite.AppFolder delegated access is limited to personal Microsoft
// accounts. Use Files.ReadWrite so work and school OneDrive accounts can also
// create and access the app root; all Graph paths remain scoped to approot.
const ONE_DRIVE_SCOPE = 'offline_access Files.ReadWrite'
const ONE_DRIVE_TOKEN_KEY = 'oneDriveAuthTokens'
const CONDITIONAL_SIMPLE_UPLOAD_LIMIT = 250_000_000
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024
const MAX_TRANSIENT_RETRIES = 4
const FOLDER_CACHE_TTL = 5 * 60 * 1000
const TRANSFER_ITEM_CACHE_TTL = 2 * 60 * 1000
const FOLDER_LIST_CONCURRENCY = 3
const MOBILE_REQUEST_CONCURRENCY = 3
const DESKTOP_REQUEST_CONCURRENCY = 5
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const folderCache = new Map<string, { item: OneDriveDriveItem; cachedAt: number }>()
const transferItemCache = new Map<string, { item: OneDriveDriveItem; cachedAt: number }>()
const rootRequestCache = new Map<string, Promise<OneDriveDriveItem>>()
const itemRequestCache = new Map<string, Promise<OneDriveDriveItem | null>>()
const networkQueue: Array<{
  run: () => Promise<Response>
  resolve: (response: Response) => void
  reject: (error: unknown) => void
  operation: string
  queuedAt: number
}> = []
let activeNetworkRequests = 0

type OneDriveTimingDetails = Record<string, string | number | boolean | null | undefined>

export function logOneDriveTiming(
  operation: string,
  startedAt: number,
  details: OneDriveTimingDetails = {},
): void {
  const currentPlatform = platform()
  if (currentPlatform !== 'android' && currentPlatform !== 'ios') return
  recordSyncTiming(operation, startedAt, details, 'OneDriveTiming')
}

function graphOperation(pathOrUrl: string, method: string): string {
  const path = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl).pathname
    : pathOrUrl.split('?')[0]
  if (path.includes('/createUploadSession')) return 'createUploadSession'
  if (path.endsWith('/content')) return method === 'GET' ? 'downloadContent' : 'uploadContent'
  if (path.endsWith('/children')) return method === 'POST' ? 'createFolder' : 'listChildren'
  if (method === 'DELETE') return 'deleteItem'
  if (path.includes('/special/approot:/')) return 'getItem'
  if (path.endsWith('/special/approot')) return 'getAppRoot'
  return 'graphRequest'
}

export const ONE_DRIVE_APP_ROOT_PATH = 'onedrive://approot'
export const ONE_DRIVE_APP_ROOT_LABEL = 'OneDrive / Apps / NoteGen'
export const ONE_DRIVE_CLIENT_ID = (
  process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID || '212aa08f-dd2e-417d-ae34-adae14af9b61'
).trim()

interface OneDriveAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}

let cachedTokens: OneDriveAuthTokens | null | undefined
let tokenReadPromise: Promise<OneDriveAuthTokens | null> | null = null
let tokenRefreshPromise: Promise<string> | null = null
let tokenCacheVersion = 0

interface OneDriveTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

interface OneDriveDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
  message?: string
}

interface OneDriveOAuthError {
  error?: string
  error_description?: string
}

interface NativeOAuthResponse {
  status: number
  body: string
  retryAfter?: string
}

interface OneDriveGraphError {
  error?: {
    code?: string
    message?: string
  }
}

interface OneDriveDriveItem {
  id: string
  name: string
  size?: number
  eTag?: string
  cTag?: string
  lastModifiedDateTime?: string
  webUrl?: string
  '@microsoft.graph.downloadUrl'?: string
  parentReference?: {
    id?: string
    driveId?: string
  }
  folder?: {
    childCount?: number
  }
  file?: {
    mimeType?: string
  }
  deleted?: Record<string, never>
}

interface OneDriveChildrenResponse {
  value: OneDriveDriveItem[]
  '@odata.nextLink'?: string
}

interface OneDriveUploadSession {
  uploadUrl: string
  expirationDateTime?: string
  nextExpectedRanges?: string[]
}

interface OneDriveContentResponse {
  response: Response
  downloadUrl?: string
}

class OneDriveWriteGuardError extends Error {
  constructor(readonly originalError: unknown) {
    // Keep guard failures outside transport classification, even when the
    // guard itself failed while reading configuration over the network.
    super('OneDrive write context check failed')
  }
}

async function assertQueuedOneDriveWrite(beforeWrite?: () => Promise<void>): Promise<void> {
  try { await beforeWrite?.() }
  catch (error) { throw new OneDriveWriteGuardError(error) }
}

function parseStoredTokens(value: string): OneDriveAuthTokens | null {
  try {
    const parsed = JSON.parse(value) as Partial<OneDriveAuthTokens>
    if (
      typeof parsed.accessToken !== 'string'
      || typeof parsed.refreshToken !== 'string'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.scope !== 'string'
    ) return null
    return parsed as OneDriveAuthTokens
  } catch {
    return null
  }
}

export interface OneDriveLoginCode {
  userCode: string
  verificationUrl: string
  message: string
  expiresAt: number
  copied?: boolean
}

function waitForNextPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('OneDrive sign-in cancelled', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after')?.trim()
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1000))
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp)) return Math.min(60_000, Math.max(0, timestamp - Date.now()))
  }
  const exponential = Math.min(30_000, 1000 * (2 ** attempt))
  return exponential + Math.floor(Math.random() * 500)
}

function oneDriveRequestConcurrency(): number {
  const currentPlatform = platform()
  return currentPlatform === 'android' || currentPlatform === 'ios'
    ? MOBILE_REQUEST_CONCURRENCY
    : DESKTOP_REQUEST_CONCURRENCY
}

function drainOneDriveNetworkQueue(): void {
  const concurrency = oneDriveRequestConcurrency()
  while (activeNetworkRequests < concurrency && networkQueue.length > 0) {
    const task = networkQueue.shift()
    if (!task) return
    activeNetworkRequests += 1
    logOneDriveTiming('networkQueueWait', task.queuedAt, {
      request: task.operation,
      activeRequests: activeNetworkRequests,
      queuedRequests: networkQueue.length,
    })
    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeNetworkRequests -= 1
        drainOneDriveNetworkQueue()
      })
  }
}

function scheduleOneDriveNetworkRequest(
  operation: string,
  request: () => Promise<Response>,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    networkQueue.push({
      run: request,
      resolve,
      reject,
      operation,
      queuedAt: Date.now(),
    })
    drainOneDriveNetworkQueue()
  })
}

async function fetchWithTransientRetry(
  request: () => Promise<Response>,
  operation = 'networkRequest',
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    let response: Response | null = null
    try {
      response = await request()
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_TRANSIENT_RETRIES) {
        return response
      }
    } catch (error) {
      lastError = error
      if (!isRemoteConnectionError(error) || attempt === MAX_TRANSIENT_RETRIES) throw error
    }
    const delayMs = retryDelayMs(response, attempt)
    logOneDriveTiming('retryScheduled', Date.now(), {
      request: operation,
      attempt: attempt + 1,
      status: response?.status,
      delayMs,
      networkError: response === null,
    })
    await waitForNextPoll(delayMs)
  }
  throw lastError instanceof Error ? lastError : new Error('OneDrive request failed')
}

function configuredClientId(config: CloudFolderConfig): string {
  return (config.oneDriveClientId || ONE_DRIVE_CLIENT_ID).trim()
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function normalizeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid OneDrive path')
  }
  return segments.join('/')
}

function itemEtag(item: OneDriveDriveItem): string {
  // Keep identity as well as the strong entity tag. A replacement at the same
  // path, or a rename/move, must not inherit another item's write permission.
  const etag = item.eTag?.trim()
  if (!etag || /^W\//i.test(etag)) return `W/${JSON.stringify(item.id)}`
  return `odv1:${encodeURIComponent(JSON.stringify([item.id, etag]))}`
}

function oneDriveConditionTag(condition: RemoteWriteCondition, item: OneDriveDriveItem | null): string | null {
  if (condition.version === null) {
    if (item) throw new Error('SYNC_SWITCH_STALE')
    return null
  }
  if (!item?.file) throw new Error('SYNC_SWITCH_STALE')
  const expected = condition.version.trim()
  if (expected.startsWith('odv1:')) {
    if (expected !== itemEtag(item)) throw new Error('SYNC_SWITCH_STALE')
  } else if (expected.replace(/^"(.*)"$/, '$1') !== item.eTag?.replace(/^"(.*)"$/, '$1')) {
    throw new Error('SYNC_SWITCH_STALE')
  }
  // Never use cTag, an item ID or a fabricated fallback as an If-Match token.
  const tag = item.eTag?.trim()
  if (!tag || /^W\//i.test(tag) || /[\r\n]/.test(tag)) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  return tag
}


function folderCacheKey(config: CloudFolderConfig, path: string): string {
  return `${configuredClientId(config)}\0${config.oneDriveRootId || ONE_DRIVE_APP_ROOT_PATH}\0${path}`
}

function getCachedTransferItem(config: CloudFolderConfig, path: string): OneDriveDriveItem | null {
  const key = folderCacheKey(config, path)
  const cached = transferItemCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > TRANSFER_ITEM_CACHE_TTL) {
    transferItemCache.delete(key)
    return null
  }
  return cached.item
}

function cacheTransferItem(config: CloudFolderConfig, path: string, item: OneDriveDriveItem): void {
  transferItemCache.set(folderCacheKey(config, path), { item, cachedAt: Date.now() })
}

function clearCachedTransferItem(config: CloudFolderConfig, path: string): void {
  transferItemCache.delete(folderCacheKey(config, path))
}

function getCachedFolder(config: CloudFolderConfig, path: string): OneDriveDriveItem | null {
  const key = folderCacheKey(config, path)
  const cached = folderCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > FOLDER_CACHE_TTL) {
    folderCache.delete(key)
    return null
  }
  return cached.item
}

function cacheFolder(config: CloudFolderConfig, path: string, item: OneDriveDriveItem): void {
  folderCache.set(folderCacheKey(config, path), { item, cachedAt: Date.now() })
}

function toCloudFolderObject(key: string, item: OneDriveDriveItem): CloudFolderObject {
  return {
    key,
    size: item.size || 0,
    modifiedAt: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : 0,
    etag: itemEtag(item),
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

async function oauthRequest<T>(path: string, body: URLSearchParams): Promise<{ response: Response; data: T }> {
  const startedAt = Date.now()
  const response = await fetchWithTransientRetry(async () => {
    if (platform() === 'android' || platform() === 'ios') {
      const result = await invoke<NativeOAuthResponse>('microsoft_oauth_request', {
        path,
        form: Object.fromEntries(body.entries()),
      })
      return new Response(result.body, {
        status: result.status,
        headers: result.retryAfter ? { 'retry-after': result.retryAfter } : undefined,
      })
    }
    return fetch(`${AUTHORITY_BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }, `oauth:${path}`)
  logOneDriveTiming('oauthRequest', startedAt, { request: path, status: response.status })
  return { response, data: await parseJson<T>(response) }
}

async function saveTokens(response: OneDriveTokenResponse, fallbackRefreshToken = ''): Promise<void> {
  const refreshToken = response.refresh_token || fallbackRefreshToken
  if (!refreshToken) throw new Error('Microsoft did not return a refresh token')
  const tokens = {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(0, response.expires_in - 60) * 1000,
    scope: response.scope || ONE_DRIVE_SCOPE,
  } satisfies OneDriveAuthTokens
  const store = await Store.load('store.json')
  const currentPlatform = platform()
  if (currentPlatform === 'android' || currentPlatform === 'ios') {
    await invoke(`set_${currentPlatform}_secure_value`, {
      key: ONE_DRIVE_TOKEN_KEY,
      value: JSON.stringify(tokens),
    })
    await store.delete(ONE_DRIVE_TOKEN_KEY)
  } else {
    await store.set(ONE_DRIVE_TOKEN_KEY, tokens)
  }
  await store.save()
  tokenCacheVersion += 1
  cachedTokens = tokens
}

async function readStoredTokens(): Promise<OneDriveAuthTokens | null> {
  const store = await Store.load('store.json')
  const legacyTokens = await store.get<OneDriveAuthTokens>(ONE_DRIVE_TOKEN_KEY) ?? null
  const currentPlatform = platform()
  if (currentPlatform !== 'android' && currentPlatform !== 'ios') return legacyTokens

  try {
    const startedAt = Date.now()
    const value = await invoke<string | null>(`get_${currentPlatform}_secure_value`, { key: ONE_DRIVE_TOKEN_KEY })
    logOneDriveTiming('secureTokenRead', startedAt, { found: Boolean(value) })
    if (value) {
      const tokens = parseStoredTokens(value)
      if (tokens) return tokens
      await invoke(`delete_${currentPlatform}_secure_value`, { key: ONE_DRIVE_TOKEN_KEY })
    }
  } catch (error) {
    console.warn(`Failed to read OneDrive tokens from ${currentPlatform} secure storage:`, error)
  }

  if (!legacyTokens) return null
  await invoke(`set_${currentPlatform}_secure_value`, {
    key: ONE_DRIVE_TOKEN_KEY,
    value: JSON.stringify(legacyTokens),
  })
  await store.delete(ONE_DRIVE_TOKEN_KEY)
  await store.save()
  return legacyTokens
}

async function getStoredTokens(): Promise<OneDriveAuthTokens | null> {
  if (cachedTokens !== undefined) return cachedTokens
  if (tokenReadPromise) return tokenReadPromise

  const readVersion = tokenCacheVersion
  tokenReadPromise = readStoredTokens()
    .then(tokens => {
      if (tokenCacheVersion === readVersion) cachedTokens = tokens
      return tokenCacheVersion === readVersion ? tokens : cachedTokens ?? null
    })
    .finally(() => {
      tokenReadPromise = null
    })
  return tokenReadPromise
}

async function refreshAccessToken(config: CloudFolderConfig, tokens: OneDriveAuthTokens): Promise<string> {
  const clientId = configuredClientId(config)
  if (!clientId) throw new Error('Microsoft Client ID is not configured')
  const { response, data } = await oauthRequest<OneDriveTokenResponse & OneDriveOAuthError>('token', new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    // Preserve the scope granted by the original connection. This keeps
    // existing AppFolder-only accounts working without expanding access.
    scope: tokens.scope || ONE_DRIVE_SCOPE,
  }))
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'OneDrive authorization expired')
  }
  await saveTokens(data, tokens.refreshToken)
  return data.access_token
}

async function refreshAccessTokenOnce(
  config: CloudFolderConfig,
  tokens: OneDriveAuthTokens,
): Promise<string> {
  if (tokenRefreshPromise) return tokenRefreshPromise
  tokenRefreshPromise = refreshAccessToken(config, tokens).finally(() => {
    tokenRefreshPromise = null
  })
  return tokenRefreshPromise
}

async function getAccessToken(config: CloudFolderConfig): Promise<string> {
  const tokens = await getStoredTokens()
  if (!tokens) throw new Error('OneDrive is not connected')
  if (tokens.expiresAt > Date.now()) return tokens.accessToken
  return refreshAccessTokenOnce(config, tokens)
}

async function graphRequest(
  config: CloudFolderConfig,
  pathOrUrl: string,
  init: RequestInit = {},
  allowNotFound = false,
  condition?: RemoteWriteCondition,
  recovery?: {
    reconcile: () => Promise<RemoteMutationObservation<Response>>
    beforeWrite?: () => Promise<void>
  },
  beforeWrite?: () => Promise<void>,
): Promise<Response | null> {
  const operation = graphOperation(pathOrUrl, init.method || 'GET')
  const request = async (accessToken: string) => {
    const send = () => fetch(pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE_URL}${pathOrUrl}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    })
    if (['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) {
      return scheduleOneDriveNetworkRequest(operation,
        () => fetchWithTransientRetry(send, `graph:${operation}`))
    }
    // A committed conditional write can lose its response. Replaying it in the
    // transport layer would turn success into a stale-version error.
    const scheduledSend = () => scheduleOneDriveNetworkRequest(operation, async () => {
      await assertQueuedOneDriveWrite(recovery?.beforeWrite || beforeWrite)
      const response = await send()
      // A received rejection already establishes that this attempt failed.
      // Losing its optional error body must never enter mutation recovery.
      if (!response.ok) return response
      // Graph mutations return only metadata. Read it while the transport is
      // still inside recovery, including a response interrupted after headers.
      const body = await response.arrayBuffer()
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      })
    })
    try {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        const response = recovery ? await recoverRemoteMutation({ ...recovery, send: scheduledSend }) : await scheduledSend()
        // A received 429 explicitly rejected the write. Keep its Retry-After
        // backoff; ambiguous connection failures and 5xx never use this loop.
        if (response.status !== 429 || attempt === MAX_TRANSIENT_RETRIES) return response
        const delayMs = retryDelayMs(response, attempt)
        logOneDriveTiming('retryScheduled', Date.now(), { request: operation, attempt: attempt + 1, status: 429, delayMs })
        await waitForNextPoll(delayMs)
      }
      throw new Error('OneDrive request retry limit reached')
    } catch (error) {
      if (error instanceof OneDriveWriteGuardError) throw error.originalError
      throw error
    }
  }

  const accessToken = await getAccessToken(config)
  let startedAt = Date.now()
  let response = await request(accessToken)
  logOneDriveTiming('graphRequest', startedAt, {
    request: operation,
    method: init.method || 'GET',
    status: response.status,
  })
  if (response.status === 401) {
    const tokens = await getStoredTokens()
    if (!tokens) throw new Error('OneDrive is not connected')
    const retryToken = tokens.accessToken !== accessToken && tokens.expiresAt > Date.now()
      ? tokens.accessToken
      : await refreshAccessTokenOnce(config, tokens)
    startedAt = Date.now()
    response = await request(retryToken)
    logOneDriveTiming('graphRequestAfterRefresh', startedAt, {
      request: operation,
      method: init.method || 'GET',
      status: response.status,
    })
  }
  if (condition && [400, 405, 501].includes(response.status)) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  assertConditionalResponse(response, condition)
  if (allowNotFound && response.status === 404) return null
  if (!response.ok) {
    const body = await parseJson<OneDriveGraphError>(response).catch((): OneDriveGraphError => ({}))
    throw new Error(body.error?.message || `OneDrive request failed (${response.status})`)
  }
  return response
}

async function oneDriveContentRequest(
  config: CloudFolderConfig,
  key: string,
  itemId?: string,
): Promise<OneDriveContentResponse | null | undefined> {
  const url = itemId ? `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(itemId)}/content`
    : `${GRAPH_BASE_URL}/me/drive/special/approot:/${encodePath(key)}:/content`
  const request = async (accessToken: string) => scheduleOneDriveNetworkRequest(
    'downloadContent',
    () => fetchWithTransientRetry(() => fetch(url, {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${accessToken}` },
    }), 'graph:downloadContent'),
  )

  const accessToken = await getAccessToken(config)
  let startedAt = Date.now()
  let response = await request(accessToken)
  logOneDriveTiming('graphRequest', startedAt, {
    request: 'downloadContent',
    method: 'GET',
    status: response.status,
  })

  if (response.status === 401) {
    const tokens = await getStoredTokens()
    if (!tokens) throw new Error('OneDrive is not connected')
    const retryToken = tokens.accessToken !== accessToken && tokens.expiresAt > Date.now()
      ? tokens.accessToken
      : await refreshAccessTokenOnce(config, tokens)
    startedAt = Date.now()
    response = await request(retryToken)
    logOneDriveTiming('graphRequestAfterRefresh', startedAt, {
      request: 'downloadContent',
      method: 'GET',
      status: response.status,
    })
  }

  if (response.status === 404) return null
  if (response.status >= 300 && response.status < 400) {
    const downloadUrl = response.headers.get('location')
    if (!downloadUrl) return undefined
    const downloadStartedAt = Date.now()
    const downloadResponse = await scheduleOneDriveNetworkRequest(
      'downloadRedirectContent',
      () => fetchWithTransientRetry(
        () => fetch(downloadUrl),
        'downloadRedirectContent',
      ),
    )
    logOneDriveTiming('downloadContent', downloadStartedAt, {
      mode: 'graphRedirect',
      status: downloadResponse.status,
    })
    return downloadResponse.ok ? { response: downloadResponse, downloadUrl } : undefined
  }

  // Some HTTP implementations follow the Graph redirect automatically. In
  // that case the response already contains the file body, matching Joplin's
  // direct `:/content` download path.
  if (response.ok) {
    const responseUrl = response.url
    const downloadUrl = responseUrl && !responseUrl.startsWith(GRAPH_BASE_URL)
      ? responseUrl
      : undefined
    return { response, downloadUrl }
  }
  return undefined
}

async function getAppRoot(config: CloudFolderConfig): Promise<OneDriveDriveItem> {
  const cached = getCachedFolder(config, '')
  if (cached) return cached
  const cacheKey = folderCacheKey(config, '')
  const pending = rootRequestCache.get(cacheKey)
  if (pending) return pending

  const request = (async () => {
    const response = await graphRequest(config, '/me/drive/special/approot')
    if (!response) throw new Error('OneDrive application folder is unavailable')
    const root = await parseJson<OneDriveDriveItem>(response)
    cacheFolder(config, '', root)
    return root
  })().finally(() => {
    rootRequestCache.delete(cacheKey)
  })
  rootRequestCache.set(cacheKey, request)
  return request
}

async function getItem(config: CloudFolderConfig, key: string, fresh = false): Promise<OneDriveDriveItem | null> {
  const normalized = normalizeKey(key)
  const cacheKey = folderCacheKey(config, normalized)
  const pending = itemRequestCache.get(cacheKey)
  if (pending && !fresh) return pending

  const request = (async () => {
    const response = await graphRequest(
      config,
      `/me/drive/special/approot:/${encodePath(normalized)}`,
      {},
      true,
    )
    const item = response ? await parseJson<OneDriveDriveItem>(response) : null
    if (item?.file) cacheTransferItem(config, normalized, item)
    return item
  })().finally(() => {
    if (itemRequestCache.get(cacheKey) === request) itemRequestCache.delete(cacheKey)
  })
  itemRequestCache.set(cacheKey, request)
  return request
}

async function getItemById(config: CloudFolderConfig, itemId: string): Promise<OneDriveDriveItem | null> {
  const response = await graphRequest(config, `/me/drive/items/${encodeURIComponent(itemId)}`, {}, true)
  return response ? parseJson<OneDriveDriveItem>(response) : null
}

async function ensureParentFolder(
  config: CloudFolderConfig, key: string, beforeWrite?: () => Promise<void>,
): Promise<OneDriveDriveItem> {
  const segments = normalizeKey(key).split('/').slice(0, -1)
  let current = getCachedFolder(config, '') || await getAppRoot(config)
  cacheFolder(config, '', current)
  let currentPath = ''

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    const cached = getCachedFolder(config, currentPath)
    if (cached) {
      current = cached
      continue
    }
    const existing = await getItem(config, currentPath)
    if (existing) {
      if (!existing.folder) throw new Error(`OneDrive path is not a folder: ${currentPath}`)
      current = existing
      cacheFolder(config, currentPath, current)
      continue
    }

    const parentId = current.id
    try {
      const response = await graphRequest(config, `/me/drive/items/${encodeURIComponent(parentId)}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      }, false, undefined, {
        beforeWrite,
        reconcile: async () => {
          const created = await getItem(config, currentPath, true)
          if (!created) return { state: 'unchanged' }
          if (!created.folder || created.name !== segment || created.parentReference?.id !== parentId) {
            throw new Error('SYNC_SWITCH_STALE')
          }
          return { state: 'applied', value: recoveredOneDriveItemResponse(created) }
        },
      })
      if (!response) throw new Error(`Failed to create OneDrive folder: ${currentPath}`)
      current = await parseJson<OneDriveDriveItem>(response)
      cacheFolder(config, currentPath, current)
    } catch (error) {
      const concurrentlyCreated = await getItem(config, currentPath, true)
      if (!concurrentlyCreated?.folder || concurrentlyCreated.name !== segment
        || concurrentlyCreated.parentReference?.id !== parentId) throw error
      current = concurrentlyCreated
      cacheFolder(config, currentPath, current)
    }
  }
  return current
}

function recoveredOneDriveItemResponse(item: OneDriveDriveItem): Response {
  return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function reconcileOneDriveUpload(
  config: CloudFolderConfig, key: string, content: Uint8Array, before: OneDriveDriveItem | null,
): Promise<RemoteMutationObservation<Response>> {
  const current = await getItem(config, key, true)
  if ((!before && !current) || (before && current && before.id === current.id && itemEtag(before) === itemEtag(current))) {
    return { state: 'unchanged' }
  }
  if (!current?.file || !current.eTag || /^W\//i.test(current.eTag) || /[\r\n]/.test(current.eTag)
    || (before && current.id !== before.id) || current.size !== content.byteLength) {
    throw new Error('SYNC_SWITCH_STALE')
  }
  // Matching size alone cannot prove that an interrupted PUT published our
  // bytes. Download against the observed identity and verify it stayed fixed.
  const downloaded = await oneDriveDownloadBytes(config, key)
  if (!downloaded || downloaded.etag !== itemEtag(current) || downloaded.content.byteLength !== content.byteLength
    || downloaded.content.some((byte, index) => byte !== content[index])) throw new Error('SYNC_SWITCH_STALE')
  return { state: 'applied', value: recoveredOneDriveItemResponse(current) }
}

async function listChildren(config: CloudFolderConfig, folderId: string): Promise<OneDriveDriveItem[]> {
  const items: OneDriveDriveItem[] = []
  let nextUrl: string | undefined = `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,size,eTag,cTag,lastModifiedDateTime,folder,file,deleted,parentReference,@microsoft.graph.downloadUrl`
  while (nextUrl) {
    const response = await graphRequest(config, nextUrl)
    if (!response) break
    const page = await parseJson<OneDriveChildrenResponse>(response)
    items.push(...page.value)
    nextUrl = page['@odata.nextLink']
  }
  return items
}

const UPLOAD_SESSION_STORE = 'onedrive_pending_uploads.json'
interface PendingOneDriveUpload { uploadUrl: string; createdAt: number }

async function withOneDriveWriteLock<T>(config: CloudFolderConfig, key: string, write: () => Promise<T>): Promise<T> {
  return withRemotePathWriteLock(oneDriveWriteIdentity(config), [normalizeKey(key).toLowerCase()], write)
}

function oneDriveWriteIdentity(config: CloudFolderConfig): string {
  return JSON.stringify(['oneDrive', configuredClientId(config), config.oneDriveRootId || ONE_DRIVE_APP_ROOT_PATH])
}

async function oneDriveSessionRequest(
  url: string, init: RequestInit, operation: string, retry = true, beforeWrite?: () => Promise<void>,
): Promise<Response> {
  try {
    const response = await scheduleOneDriveNetworkRequest(operation, async () => {
      await assertQueuedOneDriveWrite(beforeWrite)
      return retry ? fetchWithTransientRetry(() => fetch(url, init), operation) : fetch(url, init)
    })
    if (!response.ok) return response
    const body = await response.arrayBuffer()
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    })
  } catch (error) {
    if (error instanceof OneDriveWriteGuardError) throw error
    // Native HTTP errors can contain the preauthenticated URL. Keep it out of
    // logs, error toasts, and the persisted platform-switch error message.
    throw new Error(isRemoteConnectionError(error)
      ? 'OneDrive upload network error'
      : 'OneDrive upload request failed before receiving a response')
  }
}

async function closePendingOneDriveUpload(config: CloudFolderConfig, key: string) {
  const store = await Store.load(UPLOAD_SESSION_STORE)
  const identity = folderCacheKey(config, key)
  const pending = await store.get<PendingOneDriveUpload>(identity)
  if (!pending) return
  // Never start another write while a previous session could still publish.
  // Session URLs are preauthenticated: do not add a Graph bearer token or log them.
  const response = await oneDriveSessionRequest(pending.uploadUrl, { method: 'DELETE' }, 'cancelUploadSession')
  if (!response.ok && ![404, 410].includes(response.status)) {
    throw new Error('SYNC_ONEDRIVE_UPLOAD_PENDING')
  }
  await store.delete(identity)
  await store.save()
}

async function closeOverlappingOneDriveUploads(config: CloudFolderConfig, paths: string[]): Promise<void> {
  const store = await Store.load(UPLOAD_SESSION_STORE)
  const prefix = folderCacheKey(config, '')
  const roots = paths.map(path => path.toLowerCase())
  for (const storedKey of await store.keys()) {
    if (!storedKey.startsWith(prefix)) continue
    const path = storedKey.slice(prefix.length)
    const comparable = path.toLowerCase()
    if (!path || !roots.some(root => comparable === root || comparable.startsWith(`${root}/`) || root.startsWith(`${comparable}/`))) continue
    await closePendingOneDriveUpload(config, path)
  }
}

function nextUploadOffset(session: OneDriveUploadSession, size: number): number {
  const offsets = session.nextExpectedRanges?.map(range => /^([0-9]+)-(?:[0-9]+)?$/.exec(range))
  if (!offsets?.length || offsets.some(range => !range)) throw new Error('OneDrive returned invalid upload status')
  const offset = Math.min(...offsets.map(range => Number(range![1])))
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error('OneDrive returned invalid upload offset')
  return offset
}

async function uploadConditionalLargeFile(
  config: CloudFolderConfig, key: string, content: Uint8Array,
  condition: RemoteWriteCondition, before: OneDriveDriveItem | null, etag: string | null,
  beforeWrite?: () => Promise<void>,
): Promise<OneDriveDriveItem> {
  const parent = before ? null : await ensureParentFolder(config, key, beforeWrite)
  const name = key.split('/').pop()!
  const endpoint = before ? `/me/drive/items/${encodeURIComponent(before.id)}/createUploadSession`
    : `/me/drive/items/${encodeURIComponent(parent!.id)}:/${encodeURIComponent(name)}:/createUploadSession`
  await beforeWrite?.()
  const created = await graphRequest(config, endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...conditionalHeaders({ version: etag }) },
    // A new filename is create-only at publication. Existing files require an
    // explicit final commit, with the original If-Match still attached.
    body: JSON.stringify({ item: { name, '@microsoft.graph.conflictBehavior': before ? 'replace' : 'fail' }, deferCommit: Boolean(before) }),
  }, false, condition, undefined, beforeWrite)
  if (!created) throw new Error('OneDrive upload session was not created')
  const session = await parseJson<OneDriveUploadSession>(created)
  if (!session.uploadUrl || !session.uploadUrl.startsWith('https://')) throw new Error('OneDrive returned an invalid upload session')
  const store = await Store.load(UPLOAD_SESSION_STORE)
  const identity = folderCacheKey(config, key)
  let published = false
  try {
    await store.set(identity, { uploadUrl: session.uploadUrl, createdAt: Date.now() } satisfies PendingOneDriveUpload)
    await store.save()
    let start = 0, recoveryAttempts = 0
    let uploaded: OneDriveDriveItem | null = null
    while (start < content.byteLength) {
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, content.byteLength)
      const chunk = content.slice(start, end)
      let response: Response | null = null
      await beforeWrite?.()
      try {
        response = await oneDriveSessionRequest(session.uploadUrl, {
          method: 'PUT', headers: { 'Content-Length': String(chunk.byteLength), 'Content-Range': `bytes ${start}-${end - 1}/${content.byteLength}` }, body: chunk,
        }, 'uploadChunk', false, beforeWrite)
      } catch (error) {
        if (error instanceof OneDriveWriteGuardError) throw error.originalError
        if (!isRemoteConnectionError(error)) throw error
        // Query accepted ranges before resending an ambiguous fragment.
      }
      if (!response || response.status === 416 || RETRYABLE_STATUS_CODES.has(response.status)) {
        if (++recoveryAttempts > MAX_TRANSIENT_RETRIES) throw new Error('OneDrive upload retry limit reached')
        await waitForNextPoll(retryDelayMs(response, recoveryAttempts - 1))
        const status = await oneDriveSessionRequest(session.uploadUrl, {}, 'uploadStatus')
        if ([404, 410].includes(status.status) && !before) {
          // The final fragment can publish a new item and expire the session
          // before its response reaches us. Prove the bytes before accepting it.
          const recovered = await reconcileOneDriveUpload(config, key, content, before)
          if (recovered.state !== 'applied') throw new Error('OneDrive upload session disappeared before publication')
          uploaded = await parseJson<OneDriveDriveItem>(recovered.value)
          start = content.byteLength
          break
        }
        if (!status.ok) throw new Error(`OneDrive upload status failed (${status.status}); rescan before retrying`)
        start = nextUploadOffset(await parseJson<OneDriveUploadSession>(status), content.byteLength)
        continue
      }
      assertConditionalResponse(response, condition)
      if (response.status === 200 || response.status === 201) {
        if (before) throw new Error('OneDrive unexpectedly published a deferred upload')
        uploaded = await parseJson<OneDriveDriveItem>(response)
        start = content.byteLength
      } else if (response.status === 202) {
        const status = await parseJson<OneDriveUploadSession>(response)
        const next = status.nextExpectedRanges?.length ? nextUploadOffset(status, content.byteLength) : end
        if (next <= start && ++recoveryAttempts > MAX_TRANSIENT_RETRIES) throw new Error('OneDrive upload made no progress')
        if (next > start) recoveryAttempts = 0
        start = next
      } else {
        throw new Error(`OneDrive upload failed (${response.status})`)
      }
    }
    if (before) {
      // A second metadata read detects changes during upload. The final server
      // condition closes the remaining race; never refresh it from the new tag.
      oneDriveConditionTag(condition, await getItem(config, key, true))
      const result = await graphRequest(config, `/me/drive/items/${encodeURIComponent(before.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...conditionalHeaders({ version: etag }) },
        body: JSON.stringify({ name, file: {}, '@microsoft.graph.conflictBehavior': 'replace', '@microsoft.graph.sourceUrl': session.uploadUrl }),
      }, false, condition, {
        beforeWrite,
        reconcile: () => reconcileOneDriveUpload(config, key, content, before),
      })
      if (result) uploaded = await parseJson<OneDriveDriveItem>(result)
    }
    if (!uploaded?.id || !uploaded.file) throw new Error('OneDrive upload did not complete')
    published = true
    await store.delete(identity)
    await store.save()
    return uploaded
  } finally {
    if (!published) {
      // If cancellation cannot be confirmed, retain the durable session record.
      // The next write must close it before obtaining a new remote baseline.
      await closePendingOneDriveUpload(config, key).catch(() => console.warn('OneDrive upload cancellation pending; retained the session for recovery'))
    }
  }
}

export function isOneDriveConfig(config: CloudFolderConfig): boolean {
  return config.provider === 'oneDrive'
}

export async function connectOneDrive(
  clientId: string,
  onCode: (code: OneDriveLoginCode) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<CloudFolderConfig> {
  const normalizedClientId = clientId.trim()
  if (!normalizedClientId) throw new Error('Microsoft Client ID is required')
  const { response, data } = await oauthRequest<OneDriveDeviceCodeResponse & OneDriveOAuthError>('devicecode', new URLSearchParams({
    client_id: normalizedClientId,
    scope: ONE_DRIVE_SCOPE,
  }))
  if (!response.ok || !data.device_code) {
    throw new Error(data.error_description || data.error || 'Failed to start Microsoft sign-in')
  }

  const verificationUrl = data.verification_uri_complete || data.verification_uri
  await onCode({
    userCode: data.user_code,
    verificationUrl,
    message: data.message || '',
    expiresAt: Date.now() + data.expires_in * 1000,
  })
  let intervalMs = Math.max(5, data.interval || 5) * 1000
  const expiresAt = Date.now() + data.expires_in * 1000
  while (Date.now() < expiresAt) {
    if (signal?.aborted) throw new DOMException('OneDrive sign-in cancelled', 'AbortError')
    await waitForNextPoll(intervalMs, signal)

    const tokenResult = await oauthRequest<OneDriveTokenResponse & OneDriveOAuthError>('token', new URLSearchParams({
      client_id: normalizedClientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: data.device_code,
    }))
    if (tokenResult.response.ok && tokenResult.data.access_token) {
      await saveTokens(tokenResult.data)
      const draft: CloudFolderConfig = {
        path: ONE_DRIVE_APP_ROOT_PATH,
        provider: 'oneDrive',
        displayName: ONE_DRIVE_APP_ROOT_LABEL,
        oneDriveClientId: normalizedClientId,
      }
      const root = await getAppRoot(draft)
      const connectedConfig: CloudFolderConfig = {
        ...draft,
        oneDriveRootId: root.id,
        oneDriveRootWebUrl: root.webUrl,
      }
      cacheFolder(connectedConfig, '', root)
      return connectedConfig
    }

    switch (tokenResult.data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        intervalMs += 5000
        continue
      case 'authorization_declined':
      case 'access_denied':
        throw new Error('Microsoft sign-in was cancelled')
      case 'expired_token':
        throw new Error('Microsoft sign-in code expired')
      default:
        throw new Error(tokenResult.data.error_description || tokenResult.data.error || 'Microsoft sign-in failed')
    }
  }
  throw new Error('Microsoft sign-in code expired')
}

export async function disconnectOneDrive(): Promise<void> {
  folderCache.clear()
  transferItemCache.clear()
  rootRequestCache.clear()
  itemRequestCache.clear()
  tokenCacheVersion += 1
  cachedTokens = null
  tokenReadPromise = null
  tokenRefreshPromise = null
  await clearCloudFolderTreeCache()
  const store = await Store.load('store.json')
  const currentPlatform = platform()
  if (currentPlatform === 'android' || currentPlatform === 'ios') {
    await invoke(`delete_${currentPlatform}_secure_value`, { key: ONE_DRIVE_TOKEN_KEY })
  }
  await store.delete(ONE_DRIVE_TOKEN_KEY)
  await store.save()
}

export async function testOneDriveConnection(config: CloudFolderConfig): Promise<boolean> {
  const startedAt = Date.now()
  if (!configuredClientId(config) || !await getStoredTokens()) return false
  const connected = Boolean(await getAppRoot(config))
  logOneDriveTiming('connectionTest', startedAt, { connected })
  return connected
}

export async function oneDriveUpload(
  config: CloudFolderConfig, key: string, content: string | Uint8Array,
  condition?: RemoteWriteCondition, beforeWrite?: () => Promise<void>,
): Promise<CloudFolderObject> {
  return withOneDriveWriteLock(config, key, async () => {
    await beforeWrite?.()
    await closePendingOneDriveUpload(config, normalizeKey(key))
    return uploadOneDriveConditionally(config, key, content, condition, beforeWrite)
  })
}

async function uploadOneDriveConditionally(
  config: CloudFolderConfig,
  key: string,
  content: string | Uint8Array,
  condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<CloudFolderObject> {
  const startedAt = Date.now()
  const normalized = normalizeKey(key)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content)
  const before = await getItem(config, normalized, true)
  const frozen = condition || { version: before ? itemEtag(before) : null }
  const etag = oneDriveConditionTag(frozen, before)
  const headers = { 'Content-Type': 'application/octet-stream', ...conditionalHeaders({ version: etag }) }
  let item: OneDriveDriveItem | null = null
  try {
    if (bytes.byteLength <= CONDITIONAL_SIMPLE_UPLOAD_LIMIT) {
      // Existing objects are addressed by immutable ID; new names use fail,
      // never replace/rename. Freeze this condition across transport retries.
      const parent = before ? null : await ensureParentFolder(config, normalized, beforeWrite)
      const endpoint = before
        ? `/me/drive/items/${encodeURIComponent(before.id)}/content`
        : `/me/drive/items/${encodeURIComponent(parent!.id)}:/${encodeURIComponent(normalized.split('/').pop()!)}:/content?@microsoft.graph.conflictBehavior=fail`
      const response = await graphRequest(config, endpoint, { method: 'PUT', headers, body: bytes }, false, frozen, {
        beforeWrite,
        reconcile: () => reconcileOneDriveUpload(config, normalized, bytes, before),
      })
      if (response) item = await parseJson<OneDriveDriveItem>(response)
    } else {
      item = await uploadConditionalLargeFile(config, normalized, bytes, frozen, before, etag, beforeWrite)
    }
    if (!item?.file || !item.id || !item.eTag) throw new Error('OneDrive upload returned invalid metadata')
    const latest = await getItem(config, normalized, true)
    if (!latest?.file || itemEtag(latest) !== itemEtag(item) || latest.size !== bytes.byteLength) throw new Error('SYNC_SWITCH_STALE')
    cacheTransferItem(config, normalized, latest)
    logOneDriveTiming('uploadFile', startedAt, { bytes: bytes.byteLength })
    return toCloudFolderObject(normalized, latest)
  } catch (error) {
    clearCachedTransferItem(config, normalized)
    folderCache.clear()
    throw error
  }
}

export async function oneDriveDownloadBytes(
  config: CloudFolderConfig,
  key: string,
): Promise<{ content: Uint8Array; etag: string; size: number; lastModified: string } | null> {
  const startedAt = Date.now()
  const normalized = normalizeKey(key)
  const cached = getCachedTransferItem(config, normalized)
  const item = await getItem(config, normalized, true)
  if (!item?.file) { clearCachedTransferItem(config, normalized); return null }
  let response: Response | undefined
  const downloadUrl = item['@microsoft.graph.downloadUrl'] || (cached && itemEtag(cached) === itemEtag(item) ? cached['@microsoft.graph.downloadUrl'] : undefined)
  if (downloadUrl) {
    response = await scheduleOneDriveNetworkRequest('downloadContent',
      () => fetchWithTransientRetry(() => fetch(downloadUrl), 'downloadContent'))
  }
  if (!response?.ok) {
    const result = await oneDriveContentRequest(config, normalized, item.id)
    if (!result) throw new Error('OneDrive download URL is unavailable')
    response = result.response
  }
  const content = new Uint8Array(await response.arrayBuffer())
  const latest = await getItem(config, normalized, true)
  if (!latest?.file || itemEtag(latest) !== itemEtag(item) || latest.size !== content.byteLength) {
    clearCachedTransferItem(config, normalized)
    throw new Error('SYNC_SWITCH_STALE')
  }
  logOneDriveTiming('downloadFile', startedAt, { bytes: content.byteLength })
  return { content, etag: itemEtag(latest), size: content.byteLength, lastModified: latest.lastModifiedDateTime || new Date(0).toISOString() }
}

interface OneDriveMoveSnapshot {
  version: 1
  id: string
  etag: string
  kind: 'file' | 'folder'
  files: Array<{ path: string; id: string; version: string; hash: string }>
}

export interface OneDrivePathMoveOptions {
  expected?: string
  /** Only accepted paths need content verification for baseline rebinding.
   * The native root move preserves every other remote child unchanged. */
  acceptedVersions?: Record<string, string>
  rememberSource: (snapshot: string) => Promise<void>
  assertCurrent: () => Promise<boolean>
}

async function pathMoveHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

function readMoveSnapshot(value: string): OneDriveMoveSnapshot {
  const parsed = JSON.parse(value) as OneDriveMoveSnapshot
  if (!parsed || parsed.version !== 1 || typeof parsed.id !== 'string' || !parsed.id
    || typeof parsed.etag !== 'string' || !parsed.etag || /[\r\n]/.test(parsed.etag)
    || /^W\//i.test(parsed.etag) || !['file', 'folder'].includes(parsed.kind) || !Array.isArray(parsed.files)
    || parsed.files.some(file => !file || typeof file.id !== 'string' || !file.id
      || typeof file.version !== 'string' || !file.version || typeof file.hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.hash) || typeof file.path !== 'string'
      || normalizeKey(file.path) !== file.path)) throw new Error('Invalid OneDrive rename snapshot')
  return parsed
}

/** Move the existing driveItem, preserving its contents, children and history.
 * Local bytes are deliberately never uploaded by this operation. */
export async function oneDriveMovePath(
  config: CloudFolderConfig, source: string, target: string, options: OneDrivePathMoveOptions,
): Promise<{ status: 'moved' | 'missing'; files?: PathMoveRemoteVersion[] }> {
  const from = normalizeKey(source)
  const to = normalizeKey(target)
  if (from === to || from.startsWith(`${to}/`) || to.startsWith(`${from}/`)) throw new Error('Invalid OneDrive rename paths')
  if (options.expected && readMoveSnapshot(options.expected).files.some(file => file.path !== from && !file.path.startsWith(`${from}/`))) {
    throw new Error('Invalid OneDrive rename snapshot path')
  }
  return withRemotePathWriteLock(oneDriveWriteIdentity(config), [from.toLowerCase(), to.toLowerCase()], async () => {
    if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    await closeOverlappingOneDriveUploads(config, [from, to])
    return moveOneDrivePathUnlocked(config, from, to, options)
  })
}

async function moveOneDrivePathUnlocked(
  config: CloudFolderConfig, source: string, target: string, options: OneDrivePathMoveOptions,
): Promise<{ status: 'moved' | 'missing'; files?: PathMoveRemoteVersion[] }> {
  const from = normalizeKey(source)
  const to = normalizeKey(target)
  if (from === to || from.startsWith(`${to}/`) || to.startsWith(`${from}/`)) throw new Error('Invalid OneDrive rename paths')
  if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
  let snapshot = options.expected ? readMoveSnapshot(options.expected) : undefined
  if (snapshot?.files.some(file => file.path !== from && !file.path.startsWith(`${from}/`))) {
    throw new Error('Invalid OneDrive rename snapshot path')
  }
  let sourceItem = await getItem(config, from, true)
  const targetItem = await getItem(config, to, true)
  if (snapshot && targetItem?.id === snapshot.id && targetItem.name === to.split('/').pop()
    && from.toLocaleLowerCase() === to.toLocaleLowerCase()) sourceItem = null
  if (!sourceItem) {
    if (!snapshot) return { status: 'missing' }
    if (!targetItem || targetItem.id !== snapshot.id) throw new Error('OneDrive rename source disappeared')
  } else {
    if (targetItem && targetItem.id !== sourceItem.id) throw new Error('OneDrive rename destination already exists')
    if (snapshot && (sourceItem.id !== snapshot.id || sourceItem.eTag !== snapshot.etag)) {
      throw new Error('OneDrive rename source changed; the original snapshot is preserved')
    }
    if (!snapshot) {
      if (!(sourceItem.file || sourceItem.folder) || !sourceItem.id || !sourceItem.eTag
        || /^W\//i.test(sourceItem.eTag) || /[\r\n]/.test(sourceItem.eTag)) throw new Error('OneDrive rename requires a strong entity tag')
      const files: OneDriveMoveSnapshot['files'] = []
      const candidates = options.acceptedVersions
        ? Object.entries(options.acceptedVersions).filter(([path, version]) => version
          && (path === from || path.startsWith(`${from}/`))).map(([key]) => ({ key }))
        : await oneDriveListObjects(config, from)
      for (const file of candidates) {
        if (file.key.split('/').some(segment => segment.startsWith('.'))) continue
        const item = await getItem(config, file.key, true)
        if (options.acceptedVersions && !item?.file) continue
        const content = await oneDriveDownloadBytes(config, file.key)
        if (!item?.file || !content || itemEtag(item) !== content.etag) throw new Error('OneDrive rename source changed')
        files.push({ path: file.key, id: item.id, version: content.etag, hash: await pathMoveHash(content.content) })
      }
      // Freeze after enumeration so a replaced/modified root cannot be moved
      // under authority from the earlier lookup.
      const latest = await getItem(config, from, true)
      if (!latest || latest.id !== sourceItem.id || latest.eTag !== sourceItem.eTag) throw new Error('OneDrive rename source changed')
      snapshot = { version: 1, id: sourceItem.id, etag: sourceItem.eTag, kind: sourceItem.folder ? 'folder' : 'file', files }
      await options.rememberSource(JSON.stringify(snapshot))
    }
    const preparedParent = await ensureParentFolder(config, to, async () => {
      if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    })
    const parentPath = to.split('/').slice(0, -1).join('/')
    const parent = parentPath ? await getItem(config, parentPath, true) : preparedParent
    if (!parent?.folder || parent.id !== preparedParent.id) throw new Error('OneDrive rename parent changed')
    const name = to.split('/').pop()!
    // ID addressing plus If-Match guards replacement at the source path. The
    // fail policy also protects a destination created after our lookup.
    if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
    const frozenSnapshot = snapshot
    try {
      const response = await graphRequest(config, `/me/drive/items/${encodeURIComponent(frozenSnapshot.id)}?@microsoft.graph.conflictBehavior=fail`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': frozenSnapshot.etag },
        body: JSON.stringify({ name, parentReference: { id: parent.id }, '@microsoft.graph.conflictBehavior': 'fail' }),
      }, false, { version: frozenSnapshot.etag }, {
        beforeWrite: async () => { if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE') },
        reconcile: async () => {
          const recovered = await getItem(config, to, true)
          const old = await getItem(config, from, true)
          const samePath = from.toLocaleLowerCase() === to.toLocaleLowerCase()
          if (recovered?.id === frozenSnapshot.id && recovered.name === name && recovered.parentReference?.id === parent.id
            && (!old || (samePath && old.id === recovered.id))) {
            return { state: 'applied', value: recoveredOneDriveItemResponse(recovered) }
          }
          if (old?.id === frozenSnapshot.id && old.eTag === frozenSnapshot.etag
            && (!recovered || (samePath && recovered.id === old.id))) return { state: 'unchanged' }
          throw new Error('SYNC_SWITCH_STALE')
        },
      })
      const moved = response ? await parseJson<OneDriveDriveItem>(response) : null
      if (!moved || moved.id !== snapshot.id || moved.name !== name) throw new Error('OneDrive rename returned an unexpected item')
    } finally {
      // Descendant paths and parent child counts have all changed.
      folderCache.clear()
      transferItemCache.clear()
      itemRequestCache.clear()
      await clearCloudFolderTreeCache()
    }
    sourceItem = null
  }
  if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
  const movedRoot = await getItem(config, to, true)
  if (!snapshot || !movedRoot || movedRoot.id !== snapshot.id || movedRoot.name !== to.split('/').pop()) {
    throw new Error('OneDrive rename could not be verified')
  }
  const files: PathMoveRemoteVersion[] = []
  for (const file of snapshot.files) {
    if (file.path !== from && !file.path.startsWith(`${from}/`)) throw new Error('Invalid OneDrive rename snapshot path')
    const newPath = `${to}${file.path.slice(from.length)}`
    const item = await getItem(config, newPath, true)
    if (!item?.file || item.id !== file.id) continue
    const content = await oneDriveDownloadBytes(config, newPath)
    if (!content || itemEtag(item) !== content.etag) continue
    const targetHash = await pathMoveHash(content.content)
    if (targetHash !== file.hash) continue
    files.push({ source: file.path, target: newPath, sourceVersion: file.version,
      targetVersion: content.etag, sourceHash: file.hash, targetHash })
  }
  if (!await options.assertCurrent()) throw new Error('SYNC_SWITCH_STALE')
  return { status: 'moved', files }
}

export async function oneDriveHeadObject(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderObject | null> {
  const normalized = normalizeKey(key)
  // HEAD is a freshness check, including changes made by another device.
  const item = await getItem(config, normalized, true)
  if (!item?.file) clearCachedTransferItem(config, normalized)
  return item?.file ? toCloudFolderObject(normalized, item) : null
}

export async function oneDriveDelete(
  config: CloudFolderConfig, key: string, condition?: RemoteWriteCondition, beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  return withOneDriveWriteLock(config, key, async () => {
    await beforeWrite?.()
    await closePendingOneDriveUpload(config, normalizeKey(key))
    return deleteOneDriveConditionally(config, key, condition, beforeWrite)
  })
}

async function deleteOneDriveConditionally(
  config: CloudFolderConfig, key: string, condition?: RemoteWriteCondition, beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  const normalized = normalizeKey(key)
  const item = await getItem(config, normalized, true)
  if (!item && !condition) return true
  const frozen = condition || { version: item ? itemEtag(item) : null }
  const etag = oneDriveConditionTag(frozen, item)
  if (!item) return true
  try {
    await graphRequest(config, `/me/drive/items/${encodeURIComponent(item.id)}`,
      { method: 'DELETE', headers: conditionalHeaders({ version: etag }) }, false, frozen, {
        beforeWrite,
        reconcile: async () => {
          const current = await getItem(config, normalized, true)
          if (!current) {
            if (await getItemById(config, item.id)) throw new Error('SYNC_SWITCH_STALE')
            return { state: 'applied', value: new Response(null, { status: 204 }) }
          }
          if (current.id === item.id && itemEtag(current) === itemEtag(item)) return { state: 'unchanged' }
          throw new Error('SYNC_SWITCH_STALE')
        },
      })
    // Another writer may already have created a replacement at the original path.
    if (await getItem(config, normalized, true)) throw new Error('SYNC_SWITCH_STALE')
    return true
  } finally { clearCachedTransferItem(config, normalized) }
}

export async function oneDriveListObjects(
  config: CloudFolderConfig,
  prefix = '',
): Promise<CloudFolderObject[]> {
  const startedAt = Date.now()
  const normalizedPrefix = prefix ? normalizeKey(prefix) : ''
  const start = normalizedPrefix ? await getItem(config, normalizedPrefix) : await getAppRoot(config)
  if (!start) return []
  if (start.file) return [toCloudFolderObject(normalizedPrefix, start)]
  if (!start.folder) return []

  const files: CloudFolderObject[] = []
  const queue: Array<{ item: OneDriveDriveItem; path: string }> = [{ item: start, path: normalizedPrefix }]
  while (queue.length) {
    const batch = queue.splice(0, FOLDER_LIST_CONCURRENCY)
    const childrenByFolder = await Promise.all(batch.map(async current => ({
      current,
      children: await listChildren(config, current.item.id),
    })))
    for (const { current, children } of childrenByFolder) {
      for (const item of children) {
        if (item.deleted) continue
        const key = current.path ? `${current.path}/${item.name}` : item.name
        if (item.folder) queue.push({ item, path: key })
        else if (item.file) {
          cacheTransferItem(config, key, item)
          files.push(toCloudFolderObject(key, item))
        }
      }
    }
  }
  const sortedFiles = files.sort((left, right) => left.key.localeCompare(right.key))
  logOneDriveTiming('listObjects', startedAt, { files: sortedFiles.length })
  return sortedFiles
}
