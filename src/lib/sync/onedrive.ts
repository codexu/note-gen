import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'

import type { CloudFolderObject } from './cloud-folder'
import { clearCloudFolderTreeCache } from './cloud-folder-tree-cache'
import { recordSyncTiming } from './sync-timing'
import type { CloudFolderConfig } from '@/types/sync'

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const AUTHORITY_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
// Files.ReadWrite.AppFolder delegated access is limited to personal Microsoft
// accounts. Use Files.ReadWrite so work and school OneDrive accounts can also
// create and access the app root; all Graph paths remain scoped to approot.
const ONE_DRIVE_SCOPE = 'offline_access Files.ReadWrite'
const ONE_DRIVE_TOKEN_KEY = 'oneDriveAuthTokens'
const SIMPLE_UPLOAD_LIMIT = 10 * 1024 * 1024
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
}

interface OneDriveContentResponse {
  response: Response
  downloadUrl?: string
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
      if (attempt === MAX_TRANSIENT_RETRIES) throw error
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
  return item.eTag || item.cTag || item.id
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
): Promise<Response | null> {
  const operation = graphOperation(pathOrUrl, init.method || 'GET')
  const request = async (accessToken: string) => scheduleOneDriveNetworkRequest(
    operation,
    () => fetchWithTransientRetry(() => fetch(
      pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE_URL}${pathOrUrl}`,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    ), `graph:${operation}`),
  )

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
): Promise<OneDriveContentResponse | null | undefined> {
  const url = `${GRAPH_BASE_URL}/me/drive/special/approot:/${encodePath(key)}:/content`
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

async function getItem(config: CloudFolderConfig, key: string): Promise<OneDriveDriveItem | null> {
  const normalized = normalizeKey(key)
  const cacheKey = folderCacheKey(config, normalized)
  const pending = itemRequestCache.get(cacheKey)
  if (pending) return pending

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
    itemRequestCache.delete(cacheKey)
  })
  itemRequestCache.set(cacheKey, request)
  return request
}

async function ensureParentFolder(config: CloudFolderConfig, key: string): Promise<OneDriveDriveItem> {
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

    try {
      const response = await graphRequest(config, `/me/drive/items/${encodeURIComponent(current.id)}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      })
      if (!response) throw new Error(`Failed to create OneDrive folder: ${currentPath}`)
      current = await parseJson<OneDriveDriveItem>(response)
      cacheFolder(config, currentPath, current)
    } catch (error) {
      const concurrentlyCreated = await getItem(config, currentPath).catch(() => null)
      if (!concurrentlyCreated?.folder) throw error
      current = concurrentlyCreated
      cacheFolder(config, currentPath, current)
    }
  }
  return current
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

async function uploadLargeFile(
  config: CloudFolderConfig,
  key: string,
  content: Uint8Array,
  allowMissingParent = false,
): Promise<OneDriveDriveItem | null> {
  const encoded = encodePath(key)
  const sessionResponse = await graphRequest(
    config,
    `/me/drive/special/approot:/${encoded}:/createUploadSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    },
    allowMissingParent,
  )
  if (!sessionResponse) return null
  const session = await parseJson<OneDriveUploadSession>(sessionResponse)

  let uploaded: OneDriveDriveItem | null = null
  for (let start = 0; start < content.byteLength; start += UPLOAD_CHUNK_SIZE) {
    const endExclusive = Math.min(start + UPLOAD_CHUNK_SIZE, content.byteLength)
    const chunk = content.slice(start, endExclusive)
    const response = await scheduleOneDriveNetworkRequest(
      'uploadChunk',
      () => fetchWithTransientRetry(() => fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${start}-${endExclusive - 1}/${content.byteLength}`,
        },
        body: chunk,
      }), 'uploadChunk'),
    )
    if (!response.ok) {
      const body = await parseJson<OneDriveGraphError>(response).catch((): OneDriveGraphError => ({}))
      throw new Error(body.error?.message || `OneDrive upload failed (${response.status})`)
    }
    if (response.status === 200 || response.status === 201) {
      uploaded = await parseJson<OneDriveDriveItem>(response)
    }
  }
  if (!uploaded) throw new Error('OneDrive upload did not complete')
  return uploaded
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
  config: CloudFolderConfig,
  key: string,
  content: string | Uint8Array,
): Promise<CloudFolderObject> {
  const startedAt = Date.now()
  const normalized = normalizeKey(key)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  let item: OneDriveDriveItem | null
  if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
    let response = await graphRequest(
      config,
      `/me/drive/special/approot:/${encodePath(normalized)}:/content`,
      { method: 'PUT', body: bytes },
      true,
    )
    if (!response) {
      const folderStartedAt = Date.now()
      await ensureParentFolder(config, normalized)
      logOneDriveTiming('uploadParentFallback', folderStartedAt, { mode: 'simple' })
      response = await graphRequest(
        config,
        `/me/drive/special/approot:/${encodePath(normalized)}:/content`,
        { method: 'PUT', body: bytes },
      )
    }
    if (!response) throw new Error('OneDrive upload failed')
    item = await parseJson<OneDriveDriveItem>(response)
  } else {
    item = await uploadLargeFile(config, normalized, bytes, true)
    if (!item) {
      const folderStartedAt = Date.now()
      await ensureParentFolder(config, normalized)
      logOneDriveTiming('uploadParentFallback', folderStartedAt, { mode: 'large' })
      item = await uploadLargeFile(config, normalized, bytes)
    }
  }
  if (!item) throw new Error('OneDrive upload failed')
  cacheTransferItem(config, normalized, item)
  logOneDriveTiming('uploadFile', startedAt, { bytes: bytes.byteLength })
  return toCloudFolderObject(normalized, item)
}

export async function oneDriveDownloadBytes(
  config: CloudFolderConfig,
  key: string,
): Promise<{ content: Uint8Array; etag: string; size: number; lastModified: string } | null> {
  const startedAt = Date.now()
  const normalized = normalizeKey(key)
  let cachedItem = getCachedTransferItem(config, normalized)
  // Folder listings do not consistently include the short-lived
  // @microsoft.graph.downloadUrl annotation. Treat that cache entry as
  // metadata-only and use Graph's canonical :/content endpoint instead of
  // failing every file in a workspace pull without issuing a download.
  if (!cachedItem?.['@microsoft.graph.downloadUrl']) {
    if (cachedItem) {
      clearCachedTransferItem(config, normalized)
      cachedItem = null
    }
    const directResult = await oneDriveContentRequest(config, normalized)
    if (directResult === null) return null
    if (directResult) {
      const { response: directResponse, downloadUrl } = directResult
      const content = new Uint8Array(await directResponse.arrayBuffer())
      const result = {
        content,
        etag: directResponse.headers.get('etag') || normalized,
        size: Number(directResponse.headers.get('content-length')) || content.byteLength,
        lastModified: directResponse.headers.get('last-modified') || new Date(0).toISOString(),
      }
      if (downloadUrl) {
        cacheTransferItem(config, normalized, {
          id: normalized,
          name: normalized.split('/').pop() || normalized,
          size: result.size,
          eTag: result.etag,
          lastModifiedDateTime: result.lastModified,
          file: {},
          '@microsoft.graph.downloadUrl': downloadUrl,
        })
      }
      logOneDriveTiming('downloadFile', startedAt, {
        bytes: result.content.byteLength,
        metadataCacheHit: false,
        mode: 'graphContent',
        downloadUrlCached: Boolean(downloadUrl),
      })
      return result
    }
    logOneDriveTiming('downloadContentFallback', startedAt, { reason: 'redirectUnsupported' })
  }

  let item = cachedItem || await getItem(config, normalized)
  if (!item?.file) return null
  let downloadUrl = item['@microsoft.graph.downloadUrl']
  if (!downloadUrl) throw new Error('OneDrive download URL is unavailable')
  // Graph's /content endpoint redirects to a pre-authenticated Microsoft
  // download URL. Forwarding the Graph bearer token to that host makes
  // personal OneDrive reject the request with 401, so download it directly.
  const initialDownloadUrl = downloadUrl
  let response = await scheduleOneDriveNetworkRequest(
    'downloadContent',
    () => fetchWithTransientRetry(() => fetch(initialDownloadUrl), 'downloadContent'),
  )
  if (!response.ok && cachedItem) {
    clearCachedTransferItem(config, normalized)
    const refreshedItem = await getItem(config, normalized)
    if (!refreshedItem?.file) return null
    item = refreshedItem
    downloadUrl = refreshedItem['@microsoft.graph.downloadUrl']
    if (!downloadUrl) throw new Error('OneDrive download URL is unavailable')
    const refreshedDownloadUrl = downloadUrl
    response = await scheduleOneDriveNetworkRequest(
      'downloadContentAfterRefresh',
      () => fetchWithTransientRetry(
        () => fetch(refreshedDownloadUrl),
        'downloadContentAfterRefresh',
      ),
    )
  }
  if (!response.ok) {
    throw new Error(`OneDrive download failed (${response.status})`)
  }
  const result = {
    content: new Uint8Array(await response.arrayBuffer()),
    etag: itemEtag(item),
    size: item.size || 0,
    lastModified: item.lastModifiedDateTime || new Date(0).toISOString(),
  }
  logOneDriveTiming('downloadFile', startedAt, {
    bytes: result.content.byteLength,
    metadataCacheHit: Boolean(cachedItem),
    mode: cachedItem ? 'cachedDownloadUrl' : 'metadataFallback',
  })
  return result
}

export async function oneDriveHeadObject(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderObject | null> {
  const normalized = normalizeKey(key)
  const item = getCachedTransferItem(config, normalized) || await getItem(config, normalized)
  return item?.file ? toCloudFolderObject(normalized, item) : null
}

export async function oneDriveDelete(config: CloudFolderConfig, key: string): Promise<boolean> {
  const normalized = normalizeKey(key)
  await graphRequest(
    config,
    `/me/drive/special/approot:/${encodePath(normalized)}`,
    { method: 'DELETE' },
    true,
  )
  clearCachedTransferItem(config, normalized)
  return true
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
