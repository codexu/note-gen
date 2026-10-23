import { conditionalHeaders, assertConditionalResponse, type RemoteWriteCondition } from './write-condition'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { WebDAVConfig } from '@/types/sync'
import { buildRepoContentPath, debugSyncPath, debugSyncPerf } from './remote-file'
import { withRemotePathWriteLock } from './remote-write-lock'
import {
  isRemoteConnectionError, recoverRemoteMutation, recoverRemoteRead, RemoteMutationTransportError,
  type RemoteMutationObservation,
} from './remote-mutation-recovery'

/**
 * WebDAV 同步核心模块
 * 支持群晖、QNAP、Nextcloud 等 WebDAV 协议存储
 */

const DEFAULT_TEMPORARY_BLOCK_COOLDOWN_MS = 60_000
const webDAVTemporaryBlockUntil = new Map<string, number>()

/**
 * 构建 Basic Auth 头
 */
function buildAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

function hasStrongWebDAVEtag(value: string): boolean {
  return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
}

function sameWebDAVBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function getTemporaryBlockKey(config: WebDAVConfig) {
  try {
    const url = new URL(buildWebDAVBaseUrl(config))
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return config.url.trim().replace(/\/+$/, '')
  }
}

function getRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get('Retry-After')
  if (!retryAfter) {
    return DEFAULT_TEMPORARY_BLOCK_COOLDOWN_MS
  }

  const retryAfterSeconds = Number(retryAfter)
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(retryAfterSeconds * 1000, DEFAULT_TEMPORARY_BLOCK_COOLDOWN_MS)
  }

  const retryAt = new Date(retryAfter).getTime()
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), DEFAULT_TEMPORARY_BLOCK_COOLDOWN_MS)
  }

  return DEFAULT_TEMPORARY_BLOCK_COOLDOWN_MS
}

function isTemporaryBlockStatus(status: number) {
  return status === 429 || status === 503
}

function markTemporaryBlocked(config: WebDAVConfig, response: Response, scope: string) {
  if (!isTemporaryBlockStatus(response.status)) {
    return
  }

  const cooldownMs = getRetryAfterMs(response)
  const blockedUntil = Date.now() + cooldownMs
  const key = getTemporaryBlockKey(config)
  webDAVTemporaryBlockUntil.set(key, blockedUntil)
  debugSyncPerf(`webdav.${scope}.temporaryBlock`, {
    status: response.status,
    cooldownMs,
    blockedUntil,
  })
}

function getTemporaryBlockRemainingMs(config: WebDAVConfig) {
  const blockedUntil = webDAVTemporaryBlockUntil.get(getTemporaryBlockKey(config))
  if (!blockedUntil) {
    return 0
  }

  const remainingMs = blockedUntil - Date.now()
  if (remainingMs <= 0) {
    webDAVTemporaryBlockUntil.delete(getTemporaryBlockKey(config))
    return 0
  }

  return remainingMs
}

function shouldSkipForTemporaryBlock(config: WebDAVConfig, scope: string, payload: Record<string, unknown> = {}) {
  const remainingMs = getTemporaryBlockRemainingMs(config)
  if (remainingMs <= 0) {
    return false
  }

  debugSyncPerf(`webdav.${scope}.skippedTemporaryBlock`, {
    ...payload,
    remainingMs: roundMs(remainingMs),
  })
  return true
}

function isTemporarilyBlocked(config: WebDAVConfig) {
  return getTemporaryBlockRemainingMs(config) > 0
}

function buildWebDAVBaseUrl(config: WebDAVConfig): string {
  const rawUrl = config.url.trim().replace(/\/+$/, '')

  try {
    const parsedUrl = new URL(rawUrl)
    const isJianguoyun = parsedUrl.hostname === 'dav.jianguoyun.com'
    const hasNoPath = parsedUrl.pathname === '' || parsedUrl.pathname === '/'

    if (isJianguoyun && hasNoPath) {
      parsedUrl.pathname = '/dav'
      const normalizedUrl = parsedUrl.toString().replace(/\/+$/, '')
      debugSyncPath('webdav.normalizeBaseUrl', {
        host: parsedUrl.hostname,
        originalPath: '/',
        normalizedPath: parsedUrl.pathname,
      })
      return normalizedUrl
    }
  } catch {
    // 保持原始地址，后续请求会按当前错误处理路径返回。
  }

  return rawUrl
}

function getPathPrefix(config: WebDAVConfig) {
  return config.pathPrefix ? config.pathPrefix.trim().replace(/^\/+|\/+$/g, '') : ''
}

function getUrlPath(url: string) {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

function isPropfindSuccess(status: number) {
  return status === 207 || status === 200
}

async function propfindUrl(url: string, config: WebDAVConfig, proxy?: Proxy) {
  const startedAt = getPerfNow()
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      'Authorization': buildAuthHeader(config.username, config.password),
      'Depth': '0'
    },
    proxy
  })
  debugSyncPerf('webdav.propfind', {
    path: getUrlPath(url),
    status: response.status,
    stepMs: roundMs(getPerfNow() - startedAt),
  })
  markTemporaryBlocked(config, response, 'propfind')
  return response
}

async function getReachableWebDAVBaseUrl(config: WebDAVConfig, proxy?: Proxy) {
  const baseUrl = buildWebDAVBaseUrl(config)
  const urlsToTry = Array.from(new Set([
    baseUrl,
    `${baseUrl}/`,
  ]))

  for (const url of urlsToTry) {
    if (shouldSkipForTemporaryBlock(config, 'testBaseUrl', { path: getUrlPath(url) })) {
      return null
    }

    const response = await propfindUrl(url, config, proxy)
    debugSyncPath('webdav.testBaseUrl', {
      basePath: getUrlPath(url),
      status: response.status,
      success: isPropfindSuccess(response.status),
    })

    if (isPropfindSuccess(response.status)) {
      return url.replace(/\/+$/, '')
    }
  }

  return null
}

/**
 * 构建 WebDAV URL
 */
function buildWebDAVUrl(config: WebDAVConfig, key: string): string {
  const baseUrl = buildWebDAVBaseUrl(config)
  const prefix = getPathPrefix(config)
  const fullKey = prefix ? `${prefix}/${key}` : key
  const encodedFullKey = buildRepoContentPath({ path: fullKey })
  const basePath = getUrlPath(baseUrl)
  debugSyncPath('webdav.buildUrl', {
    key,
    pathPrefix: prefix,
    basePath,
    fullKey,
    encodedFullKey,
  })

  return `${baseUrl}/${encodedFullKey}`
}

function withWebDAVPathWriteLock<T>(config: WebDAVConfig, paths: string[], operation: () => Promise<T>): Promise<T> {
  const urls = paths.map(path => new URL(buildWebDAVUrl(config, path)))
  return withRemotePathWriteLock(
    JSON.stringify(['webdav', urls[0].origin, config.username]),
    urls.map(url => decodeURIComponent(url.pathname)), operation,
  )
}

function getParentKey(key: string) {
  const parts = key.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

async function inspectParentCollection(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
) {
  const startedAt = getPerfNow()
  if (shouldSkipForTemporaryBlock(config, 'inspectParentCollection', { key })) {
    return {
      parentKey: getParentKey(key),
      parentStatus: 503,
      parentExists: false,
    }
  }

  const parentKey = getParentKey(key)
  const parentUrl = buildWebDAVUrl(config, parentKey)
  const response = await fetch(parentUrl, {
    method: 'PROPFIND',
    headers: {
      'Authorization': buildAuthHeader(config.username, config.password),
      'Depth': '0'
    },
    proxy
  })
  markTemporaryBlocked(config, response, 'inspectParentCollection')
  const parentExists = response.status === 207 || response.status === 200

  debugSyncPath('webdav.uploadParentCheck', {
    key,
    parentKey,
    parentStatus: response.status,
    parentExists,
    basePath: getUrlPath(buildWebDAVBaseUrl(config)),
    hasPathPrefix: Boolean(getPathPrefix(config)),
  })
  debugSyncPerf('webdav.inspectParentCollection', {
    key,
    parentKey,
    status: response.status,
    exists: parentExists,
    stepMs: roundMs(getPerfNow() - startedAt),
  })

  return {
    parentKey,
    parentStatus: response.status,
    parentExists,
  }
}

async function mkcolFullPath(
  config: WebDAVConfig,
  fullPath: string,
  proxy?: Proxy,
  beforeWrite?: () => Promise<void>,
) {
  const startedAt = getPerfNow()
  if (shouldSkipForTemporaryBlock(config, 'mkcol', { fullPath })) {
    return false
  }

  const baseUrl = buildWebDAVBaseUrl(config)
  const encodedFullPath = buildRepoContentPath({ path: fullPath })
  const url = `${baseUrl}/${encodedFullPath}`
  const response = await recoverRemoteMutation<Response>({
    beforeWrite,
    send: () => fetch(url, {
      method: 'MKCOL', headers: { Authorization: buildAuthHeader(config.username, config.password) }, proxy,
    }),
    reconcile: () => recoverRemoteRead(async () => {
      const remote = await propfindUrl(url, config, proxy)
      if (remote.status === 404) return { state: 'unchanged' }
      if (isPropfindSuccess(remote.status) && isCollectionResponse(await remote.text(), url)) {
        return { state: 'applied', value: new Response(null, { status: 201 }) }
      }
      throw new Error('WebDAV collection creation could not be confirmed')
    }),
  })
  markTemporaryBlocked(config, response, 'mkcol')

  debugSyncPath('webdav.mkcol', {
    fullPath,
    encodedFullPath,
    status: response.status,
  })
  debugSyncPerf('webdav.mkcol', {
    fullPath,
    status: response.status,
    ok: response.status === 201 || response.status === 405,
    stepMs: roundMs(getPerfNow() - startedAt),
  })

  return response.status === 201 || response.status === 405
}

async function ensureCollectionPathExists(
  config: WebDAVConfig,
  collectionPath: string,
  proxy?: Proxy,
  beforeWrite?: () => Promise<void>,
) {
  const parts = collectionPath.split('/').filter(Boolean)
  for (let i = 1; i <= parts.length; i++) {
    const parentPath = parts.slice(0, i).join('/')
    const ok = await ensureCollectionExists(config, parentPath, proxy, beforeWrite)
    if (!ok) {
      return false
    }
  }

  return true
}

function isCollectionResponse(xml: string, directoryUrl: string): boolean {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagNameNS('*', 'parsererror').length > 0
    || document.documentElement.localName !== 'multistatus'
    || document.documentElement.namespaceURI !== 'DAV:') return false

  const requested = new URL(directoryUrl)
  const path = (url: URL) => decodeURIComponent(url.pathname).replace(/\/+$/, '')
  return Array.from(document.getElementsByTagNameNS('DAV:', 'response')).some(response => {
    const href = response.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent?.trim()
    if (!href) return false
    const actual = new URL(href, `${directoryUrl.replace(/\/+$/, '')}/`)
    if (actual.origin !== requested.origin || path(actual) !== path(requested)) return false
    return Array.from(response.getElementsByTagNameNS('DAV:', 'propstat')).some(propstat => {
      const status = propstat.getElementsByTagNameNS('DAV:', 'status')[0]?.textContent?.trim() || ''
      return /^HTTP\/\S+\s+2\d{2}\b/.test(status)
        && propstat.getElementsByTagNameNS('DAV:', 'collection').length > 0
    })
  })
}

async function ensureCollectionExists(
  config: WebDAVConfig, fullPath: string, proxy?: Proxy, beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  if (shouldSkipForTemporaryBlock(config, 'ensureCollection', { fullPath })) return false
  const url = `${buildWebDAVBaseUrl(config)}/${buildRepoContentPath({ path: fullPath })}`
  const existing = await propfindUrl(url, config, proxy)
  if (isPropfindSuccess(existing.status)) return isCollectionResponse(await existing.text(), url)
  // NAS mount points can reject MKCOL even when they already exist. Never
  // attempt creation after permission, transport or service errors.
  if (existing.status !== 404 || !await mkcolFullPath(config, fullPath, proxy, beforeWrite)) return false
  // Verify creation, including a race where another client created this path.
  const created = await propfindUrl(url, config, proxy)
  return isPropfindSuccess(created.status) && isCollectionResponse(await created.text(), url)
}

/**
 * 测试 WebDAV 连接
 */
export async function testWebDAVConnection(config: WebDAVConfig, proxy?: Proxy): Promise<boolean> {
  config = { ...config }
  try {
    return await withWebDAVPathWriteLock(config, [''], () => testWebDAVConnectionRaw(config, proxy))
  } catch { return false }
}

async function testWebDAVConnectionRaw(config: WebDAVConfig, proxy?: Proxy): Promise<boolean> {
  const startedAt = getPerfNow()
  try {
    if (shouldSkipForTemporaryBlock(config, 'testConnection')) {
      debugSyncPerf('webdav.testConnection', {
        success: true,
        temporaryBlocked: true,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return true
    }

    const reachableBaseUrl = await getReachableWebDAVBaseUrl(config, proxy)
    if (!reachableBaseUrl) {
      if (isTemporarilyBlocked(config)) {
        debugSyncPerf('webdav.testConnection', {
          success: true,
          temporaryBlocked: true,
          totalMs: roundMs(getPerfNow() - startedAt),
        })
        return true
      }

      debugSyncPerf('webdav.testConnection', {
        success: false,
        reason: 'base-url-unreachable',
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return false
    }

    const pathPrefix = getPathPrefix(config)
    if (!pathPrefix) {
      debugSyncPerf('webdav.testConnection', {
        success: true,
        hasPathPrefix: false,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return true
    }

    const prefixExists = await ensureCollectionPathExists(config, pathPrefix, proxy)
    debugSyncPath('webdav.testPathPrefix', {
      pathPrefix,
      prefixExists,
    })

    debugSyncPerf('webdav.testConnection', {
      success: prefixExists,
      hasPathPrefix: true,
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    return prefixExists
  } catch (error) {
    debugSyncPerf('webdav.testConnection', {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV connection test failed:', error)
    return false
  }
}

/**
 * 创建所有父目录
 */
async function ensureParentDirsExist(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy,
  beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  const pathPrefix = getPathPrefix(config)

  // 首先确保 pathPrefix 目录存在
  if (pathPrefix) {
    const ok = await ensureCollectionPathExists(config, pathPrefix, proxy, beforeWrite)
    if (!ok) {
      return false
    }
  }

  const parts = key.split('/').filter(p => p)
  // 构建所有可能的父目录路径
  for (let i = 1; i < parts.length; i++) {
    const relativeParentPath = parts.slice(0, i).join('/')
    const parentPath = pathPrefix ? `${pathPrefix}/${relativeParentPath}` : relativeParentPath
    if (!await ensureCollectionExists(config, parentPath, proxy, beforeWrite)) return false
  }
  return true
}

/**
 * 上传文件到 WebDAV
 */
export async function webdavUpload(
  config: WebDAVConfig,
  key: string,
  content: string | Uint8Array,
  proxy?: Proxy,
  contentType = 'text/markdown; charset=utf-8',
  condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<{ etag: string } | null> {
  config = { ...config }
  return withWebDAVPathWriteLock(config, [key], async () => {
    await beforeWrite?.()
    return webdavUploadRaw(config, key, content, proxy, contentType, condition, beforeWrite)
  })
}

async function webdavUploadRaw(
  config: WebDAVConfig,
  key: string,
  content: string | Uint8Array,
  proxy: Proxy | undefined,
  contentType: string,
  condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<{ etag: string } | null> {
  const uploadStartedAt = getPerfNow()
  let previousPerfAt = uploadStartedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`webdav.upload.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - uploadStartedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    if (shouldSkipForTemporaryBlock(config, 'upload', { key })) {
      return null
    }

    logPerf('start', {
      contentLength: content.length,
      hasPathPrefix: Boolean(getPathPrefix(config)),
    })
    // 先确保父目录存在
    if (!await ensureParentDirsExist(config, key, proxy, beforeWrite)) return null
    logPerf('ensureParentDirs')

    const url = buildWebDAVUrl(config, key)
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content)
    logPerf('encodeContent', {
      byteLength: contentBytes.byteLength,
    })

    let frozenCondition = condition ? { ...condition } : undefined
    if (!frozenCondition) {
      try {
        const previous = await webdavHeadObject(config, key, proxy)
        if (!previous || hasStrongWebDAVEtag(previous.etag)) frozenCondition = { version: previous?.etag ?? null }
      } catch { /* Keep the first ordinary write available when HEAD is unsupported. */ }
    }
    const originalVersion = frozenCondition?.version
    const canReplay = Boolean(frozenCondition)
    const conditions = conditionalHeaders(frozenCondition)
    const response = await recoverRemoteMutation<Response>({
      beforeWrite,
      send: () => fetch(url, {
        method: 'PUT',
        headers: {
          ...conditions, Authorization: buildAuthHeader(config.username, config.password),
          'Content-Type': contentType, 'Content-Length': contentBytes.byteLength.toString(),
        },
        body: contentBytes, proxy,
      }),
      reconcile: async () => {
        const remote = await recoverRemoteRead(() => webdavDownloadBytesInternal(config, key, proxy))
        if (remote && sameWebDAVBytes(remote.content, contentBytes)) {
          return { state: 'applied', value: new Response(null, { status: 200, headers: { ETag: remote.etag } }) }
        }
        if (canReplay && ((!remote && originalVersion === null)
          || (remote && conditions['If-Match'] === remote.etag))) return { state: 'unchanged' }
        throw new Error('SYNC_SWITCH_STALE')
      },
    })
    markTemporaryBlocked(config, response, 'upload')
    assertConditionalResponse(response, frozenCondition)
    logPerf('putRequest', {
      status: response.status,
    })

    if (response.status === 200 || response.status === 201 || response.status === 204) {
      const etag = response.headers.get('ETag') || ''
      logPerf('completed', {
        success: true,
        status: response.status,
        hasEtag: Boolean(etag),
      })
      return { etag }
    } else {
      const errorText = await response.text()
      logPerf('readErrorBody', {
        status: response.status,
        bodyLength: errorText.length,
      })
      const parentCheck = response.status === 404 || response.status === 409
        ? await inspectParentCollection(config, key, proxy).catch(() => null)
        : null
      debugSyncPath('webdav.uploadFailed', {
        key,
        status: response.status,
        hasPathPrefix: Boolean(getPathPrefix(config)),
        basePath: getUrlPath(buildWebDAVBaseUrl(config)),
        parentKey: parentCheck?.parentKey,
        parentStatus: parentCheck?.parentStatus,
        parentExists: parentCheck?.parentExists,
        needsWritableCollection: parentCheck?.parentExists && !getPathPrefix(config),
      })
      logPerf('completed', {
        success: false,
        status: response.status,
      })
      if (!isTemporaryBlockStatus(response.status)) {
        console.error('WebDAV Upload failed:', response.status, errorText)
      }
      return null
    }
  } catch (error) {
    if (condition) throw error
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('WebDAV upload error:', error)
    return null
  }
}

/**
 * 从 WebDAV 下载文件
 */
async function webdavDownloadBytesInternal(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  try {
    if (shouldSkipForTemporaryBlock(config, 'download', { key })) {
      throw new Error(`webdav / ${key}: requests temporarily rate limited`)
    }

    const url = buildWebDAVUrl(config, key)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })
    markTemporaryBlocked(config, response, 'download')
    debugSyncPerf('webdav.download.request', {
      key,
      status: response.status,
      stepMs: roundMs(getPerfNow() - startedAt),
    })

    if (response.status === 200) {
      const textStartedAt = getPerfNow()
      const content = new Uint8Array(await response.arrayBuffer())
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''
      debugSyncPerf('webdav.download.readBody', {
        key,
        contentLength: content.length,
        stepMs: roundMs(getPerfNow() - textStartedAt),
        totalMs: roundMs(getPerfNow() - startedAt),
      })

      return { content, etag, lastModified }
    } else if (response.status === 404) {
      debugSyncPerf('webdav.download.completed', {
        key,
        success: false,
        status: response.status,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return null
    } else {
      const errorText = await response.text().catch(() => '')
      debugSyncPerf('webdav.download.completed', {
        key,
        success: false,
        status: response.status,
        bodyLength: errorText.length,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      if (!isTemporaryBlockStatus(response.status)) {
        console.error('WebDAV Download failed:', response.status, errorText)
      }
      throw new Error(`webdav / ${key}: HTTP ${response.status}`)
    }
  } catch (error) {
    debugSyncPerf('webdav.download.failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV download error:', error)
    throw error
  }
}

export async function webdavDownloadBytes(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  return await webdavDownloadBytesInternal(config, key, proxy)
}

export async function webdavDownload(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
): Promise<{ content: string; etag: string; lastModified: string } | null> {
  const file = await webdavDownloadBytesInternal(config, key, proxy)
  return file ? { ...file, content: new TextDecoder().decode(file.content) } : null
}

/**
 * 删除 WebDAV 文件
 */
export async function webdavDelete(
  config: WebDAVConfig, key: string, proxy?: Proxy, condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  config = { ...config }
  return withWebDAVPathWriteLock(config, [key], async () => {
    await beforeWrite?.()
    return webdavDeleteRaw(config, key, proxy, condition, beforeWrite)
  })
}

async function webdavDeleteRaw(
  config: WebDAVConfig, key: string, proxy?: Proxy, condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  try {
    if (shouldSkipForTemporaryBlock(config, 'delete', { key })) {
      return false
    }

    const url = buildWebDAVUrl(config, key)

    let frozenCondition = condition ? { ...condition } : undefined
    if (!frozenCondition) {
      try {
        const previous = await webdavHeadObject(config, key, proxy)
        if (!previous) return true
        if (hasStrongWebDAVEtag(previous.etag)) frozenCondition = { version: previous.etag }
      } catch { /* HEAD support is not required for the original first delete. */ }
    }
    const canReplay = Boolean(frozenCondition)
    const conditions = conditionalHeaders(frozenCondition)
    const response = await recoverRemoteMutation<Response>({
      beforeWrite,
      send: () => fetch(url, {
        method: 'DELETE',
        headers: { ...conditions, Authorization: buildAuthHeader(config.username, config.password) },
        proxy,
      }),
      reconcile: async () => {
        const remote = await recoverRemoteRead(() => webdavHeadObject(config, key, proxy))
        if (!remote) return { state: 'applied', value: new Response(null, { status: 204 }) }
        if (canReplay && conditions['If-Match'] === remote.etag) return { state: 'unchanged' }
        throw new Error('SYNC_SWITCH_STALE')
      },
    })
    assertConditionalResponse(response, frozenCondition)
    markTemporaryBlocked(config, response, 'delete')

    return response.status === 204 || response.status === 200 || response.status === 404
  } catch (error) {
    if (condition) throw error
    console.error('WebDAV delete error:', error)
    return false
  }
}

/**
 * 获取文件信息（HEAD 请求）
 */
export async function webdavHeadObject(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
): Promise<{ etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  try {
    if (shouldSkipForTemporaryBlock(config, 'headObject', { key })) {
      throw new Error('WebDAV metadata request is temporarily blocked')
    }

    const url = buildWebDAVUrl(config, key)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })
    markTemporaryBlocked(config, response, 'headObject')
    debugSyncPerf('webdav.headObject', {
      key,
      status: response.status,
      stepMs: roundMs(getPerfNow() - startedAt),
    })

    if (response.status === 200) {
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      return { etag, lastModified }
    } else if (response.status === 404) {
      // 文件不存在，返回 null
      return null
    } else {
      const errorText = await response.text().catch(() => '')
      debugSyncPerf('webdav.headObject.errorBody', {
        key,
        status: response.status,
        bodyLength: errorText.length,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      if (!isTemporaryBlockStatus(response.status)) {
        console.error('WebDAV HeadObject failed:', response.status, errorText)
      }
      throw new Error(`WebDAV metadata request failed: HTTP ${response.status}`)
    }
  } catch (error) {
    debugSyncPerf('webdav.headObject.failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV head error:', error)
    throw error
  }
}

/**
 * 列出 WebDAV 文件
 * key 相对于本次请求目录，直接子目录保留末尾的 /。
 */
export async function webdavListObjects(
  config: WebDAVConfig,
  prefix: string,
  proxy?: Proxy
): Promise<Array<{ key: string; etag: string; lastModified: string; size: number }>> {
  const startedAt = getPerfNow()
  try {
    if (shouldSkipForTemporaryBlock(config, 'listObjects', { prefix })) {
      throw new Error('WebDAV directory request is temporarily blocked')
    }

    const baseUrl = buildWebDAVBaseUrl(config)
    const pathPrefix = getPathPrefix(config)
    // 不要尾随斜杠
    const fullPrefix = pathPrefix ? (prefix ? `${pathPrefix}/${prefix}` : pathPrefix) : prefix

    const encodedFullPrefix = buildRepoContentPath({ path: fullPrefix })
    debugSyncPath('webdav.listObjects', {
      prefix,
      pathPrefix,
      fullPrefix,
      encodedFullPrefix,
    })

    const directoryUrl = `${baseUrl}/${encodedFullPrefix}`
    const response = await fetch(directoryUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password),
        'Depth': '1'
      },
      proxy
    })
    markTemporaryBlocked(config, response, 'listObjects')
    debugSyncPerf('webdav.listObjects.request', {
      prefix,
      status: response.status,
      stepMs: roundMs(getPerfNow() - startedAt),
    })

    if (response.status === 207) {
      const textStartedAt = getPerfNow()
      const text = await response.text()
      const results = parsePropfindResponse(text, directoryUrl)
      debugSyncPerf('webdav.listObjects.parse', {
        prefix,
        responseLength: text.length,
        resultCount: results.length,
        stepMs: roundMs(getPerfNow() - textStartedAt),
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return results
    } else if (response.status === 404) {
      // 目录不存在是正常情况，不需要打印错误日志
      debugSyncPerf('webdav.listObjects.completed', {
        prefix,
        success: false,
        status: response.status,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      return []
    } else {
      const errorText = await response.text()
      debugSyncPerf('webdav.listObjects.completed', {
        prefix,
        success: false,
        status: response.status,
        bodyLength: errorText.length,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      if (!isTemporaryBlockStatus(response.status)) {
        console.error('WebDAV ListObjects failed:', response.status, errorText)
      }
      const detail = errorText.trim()
      const reason = detail && !detail.startsWith('<') ? `: ${detail.slice(0, 300)}` : ''
      throw new Error(`WebDAV directory request failed: HTTP ${response.status}${reason}`)
    }
  } catch (error) {
    debugSyncPerf('webdav.listObjects.failed', {
      prefix,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV list error:', error)
    throw new Error(`WebDAV directory listing failed (${prefix || '/'}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 解析 PROPFIND 响应 XML
 */
function parsePropfindResponse(
  xml: string,
  directoryUrl: string
): Array<{ key: string; etag: string; lastModified: string; size: number }> {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagNameNS('*', 'parsererror').length > 0
    || document.documentElement.localName !== 'multistatus'
    || document.documentElement.namespaceURI !== 'DAV:') {
    throw new Error('Invalid WebDAV directory response')
  }

  const results: Array<{ key: string; etag: string; lastModified: string; size: number }> = []
  const children = (element: Element, name: string) => Array.from(element.children)
    .filter(child => child.namespaceURI === 'DAV:' && child.localName === name)
  const text = (element: Element, name: string) => children(element, name)[0]?.textContent?.trim() || ''
  const statusCode = (status: string) => Number(/^HTTP\/\S+\s+(\d{3})\b/.exec(status)?.[1] || 0)
  // 按命名空间读取，兼容 d:、D: 和默认 DAV 命名空间。
  for (const response of children(document.documentElement, 'response')) {
    const responseStatus = statusCode(text(response, 'status'))
    if (responseStatus >= 400) {
      throw new Error(`WebDAV PROPFIND resource failed: HTTP ${responseStatus}`)
    }
    const propstats = children(response, 'propstat')
    const successfulProps = propstats
      .filter(propstat => {
        const status = statusCode(text(propstat, 'status'))
        return status >= 200 && status < 300
      })
      .flatMap(propstat => children(propstat, 'prop'))
    if (successfulProps.length === 0) {
      const status = propstats.map(propstat => text(propstat, 'status')).find(Boolean)
      throw new Error(`WebDAV PROPFIND properties unavailable${status ? `: ${status}` : ''}`)
    }
    const readProperty = (name: string) => successfulProps.map(prop => text(prop, name)).find(Boolean) || ''
    const href = text(response, 'href')
    if (!href) throw new Error('WebDAV directory entry is missing its path')

    // 从实际请求目录还原相对路径，兼容绝对 URL 和不同服务端的根路径。
    const baseUrl = new URL(directoryUrl)
    const entryUrl = new URL(href, `${directoryUrl.replace(/\/+$/, '')}/`)
    const directoryPath = decodeURIComponent(baseUrl.pathname).replace(/\/+$/, '')
    const entryPath = decodeURIComponent(entryUrl.pathname).replace(/\/+$/, '')
    if (entryUrl.origin !== baseUrl.origin) throw new Error('Unexpected WebDAV directory entry origin')
    if (entryPath === directoryPath) continue
    if (!entryPath.startsWith(`${directoryPath}/`)) {
      throw new Error('Unexpected WebDAV directory entry path')
    }
    const relativePath = entryPath.slice(directoryPath.length + 1)
    if (!relativePath || relativePath.includes('/')) {
      throw new Error('Unexpected WebDAV directory entry depth')
    }
    const isDirectory = entryUrl.pathname.endsWith('/')
      || successfulProps.some(prop => children(prop, 'resourcetype')
        .some(type => children(type, 'collection').length > 0))

    results.push({
      key: isDirectory ? `${relativePath}/` : relativePath,
      etag: readProperty('getetag').replace(/"/g, ''),
      lastModified: readProperty('getlastmodified'),
      size: parseInt(readProperty('getcontentlength'), 10) || 0,
    })
  }
  return results
}

/**
 * 创建目录
 */
export async function webdavMkcol(
  config: WebDAVConfig, path: string, proxy?: Proxy,
): Promise<boolean> {
  config = { ...config }
  return withWebDAVPathWriteLock(config, [path], () => webdavMkcolRaw(config, path, proxy))
}

async function webdavMkcolRaw(
  config: WebDAVConfig,
  path: string,
  proxy?: Proxy
): Promise<boolean> {
  try {
    if (shouldSkipForTemporaryBlock(config, 'mkcolPublic', { path })) {
      return false
    }

    const pathPrefix = getPathPrefix(config)
    const fullPath = pathPrefix ? `${pathPrefix}/${path}` : path
    return await ensureCollectionPathExists(config, fullPath, proxy)
  } catch (error) {
    console.error('WebDAV mkcol error:', error)
    return false
  }
}

export interface WebDAVPathIdentity {
  type: 'file' | 'directory'
  digest: string
  etag?: string
  files: Array<{ path: string; digest: string; etag?: string }>
}

interface WebDAVMovePathOptions {
  expected?: WebDAVPathIdentity
  /** Persist this snapshot before sending MOVE, including a response-loss retry. */
  rememberSource: (identity: WebDAVPathIdentity) => Promise<void>
  assertCurrent: () => Promise<boolean>
}

export interface WebDAVPathMoveResult {
  status: 'moved' | 'missing'
  entry?: WebDAVPathIdentity
  files?: Array<{
    path: string
    sourceVersion: string
    targetVersion: string
    sourceHash: string
    targetHash: string
  }>
}

/** Rename the existing remote resource. Local bytes are never uploaded, and an
 * existing destination is never replaced. Collection identities include every
 * child because a collection ETag alone does not identify its descendants. */
export async function webdavMovePath(
  config: WebDAVConfig, source: string, target: string, options: WebDAVMovePathOptions, proxy?: Proxy,
): Promise<WebDAVPathMoveResult> {
  config = { ...config }
  return withWebDAVPathWriteLock(config, [source, target], () => webdavMovePathRaw(config, source, target, options, proxy))
}

async function webdavMovePathRaw(
  config: WebDAVConfig,
  source: string,
  target: string,
  { expected, rememberSource, assertCurrent }: WebDAVMovePathOptions,
  proxy?: Proxy,
): Promise<WebDAVPathMoveResult> {
  // Keep every read and the mutation on one captured endpoint/account even if
  // the caller replaces its settings object while requests are in flight.
  config = { ...config }
  const failure = (stage: string, detail: string) => new Error(
    `WebDAV 路径迁移失败（${source} → ${target}，${stage}）：${detail}`,
  )
  const validPath = (path: string) => Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..')
  if (!validPath(source) || !validPath(target) || source === target
    || source.startsWith(`${target}/`) || target.startsWith(`${source}/`)) {
    throw failure('校验路径', '源路径和目标路径无效或互相包含')
  }
  const current = async () => {
    if (!await assertCurrent()) throw failure('校验上下文', '同步配置或本地迁移状态已变化，待办已保留')
  }
  const strongEtag = (value: string | null | undefined): string | undefined => {
    const trimmed = value?.trim()
    // Preserve the server's quoted value: weak validators cannot guard MOVE.
    return trimmed && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(trimmed) ? trimmed : undefined
  }
  const hash = async (bytes: Uint8Array) => {
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  }
  const encodedHash = (value: unknown) => hash(new TextEncoder().encode(JSON.stringify(value)))
  const headers = { Authorization: buildAuthHeader(config.username, config.password) }
  const request = async (
    url: string,
    method: 'PROPFIND' | 'GET' | 'MKCOL' | 'MOVE',
    stage: string,
    extraHeaders: Record<string, string> = {},
    body?: string,
    reconcile?: () => Promise<RemoteMutationObservation<Response>>,
  ): Promise<{ status: number; text: string; bytes?: Uint8Array; etag?: string }> => {
    let controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const prepare = async () => {
      await current()
      if (shouldSkipForTemporaryBlock(config, 'movePath', { source, target })) {
        throw failure(stage, '服务端暂时限制请求，待办已保留')
      }
      clearTimeout(timeout)
      controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), 15_000)
    }
    const send = () => fetch(url, {
      method, headers: { ...headers, ...extraHeaders }, body,
      proxy, signal: controller.signal, connectTimeout: 15_000,
      // Never forward credentials or a mutation across an HTTP redirect.
      maxRedirections: 0,
    }).catch(error => {
      // This controller is private to the request and only its timer aborts it.
      if (controller.signal.aborted) throw new Error('Remote request timed out')
      throw error
    })
    try {
      let response: Response
      try {
        if (reconcile) response = await recoverRemoteMutation({ send, reconcile, beforeWrite: prepare })
        else { await prepare(); response = await send() }
        // Some servers canonicalize collection URLs with a trailing slash.
        // Only follow a read redirect to that exact resource on the same host.
        if ((method === 'PROPFIND' || method === 'GET') && [301, 302, 307, 308].includes(response.status)) {
          const location = response.headers.get('Location')
          const original = new URL(url)
          const redirected = location ? new URL(location, url) : null
          if (!redirected || redirected.origin !== original.origin
            || redirected.pathname.replace(/\/+$/, '') !== original.pathname.replace(/\/+$/, '')
            || redirected.search || redirected.hash || redirected.username || redirected.password) {
            throw failure(stage, '服务端返回了不同路径的重定向，待办已保留')
          }
          await current()
          response = await fetch(redirected.toString(), {
            method, headers: { ...headers, ...extraHeaders }, body,
            proxy, signal: controller.signal, connectTimeout: 15_000, maxRedirections: 0,
          })
        }
        markTemporaryBlocked(config, response, 'movePath')
        return {
          status: response.status,
          etag: strongEtag(response.headers.get('ETag')),
          // MOVE/MKCOL have already been acknowledged by their status; only
          // PROPFIND requires a response body to establish the remote state.
          text: method === 'PROPFIND' && isPropfindSuccess(response.status) ? await response.text() : '',
          bytes: method === 'GET' && response.status === 200
            ? new Uint8Array(await response.arrayBuffer()) : undefined,
        }
      } catch (error) {
        // Native transport failures can contain proxy credentials or server
        // response bodies. Only surface our own path/stage description.
        if (isRemoteConnectionError(error)) {
          throw new RemoteMutationTransportError(failure(stage, '网络请求失败或超时，待办已保留').message)
        }
        throw failure(stage, '网络请求失败、重定向无效或超时，待办已保留')
      }
    } finally {
      clearTimeout(timeout)
    }
  }
  interface Resource {
    key: string
    type: 'file' | 'directory'
    etag?: string
  }
  const parseResources = (xml: string, url: string, key: string, depth: '0' | '1'): Resource[] => {
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    if (document.getElementsByTagNameNS('*', 'parsererror').length
      || document.documentElement.localName !== 'multistatus'
      || document.documentElement.namespaceURI !== 'DAV:') throw failure('读取资源信息', 'WebDAV 响应格式无效')
    const children = (element: Element, name: string) => Array.from(element.children)
      .filter(child => child.namespaceURI === 'DAV:' && child.localName === name)
    const text = (element: Element, name: string) => children(element, name)[0]?.textContent?.trim() || ''
    const status = (value: string) => Number(/^HTTP\/\S+\s+(\d{3})\b/.exec(value)?.[1] || 0)
    const requested = new URL(url)
    const requestedPath = decodeURIComponent(requested.pathname).replace(/\/+$/, '')
    const seen = new Set<string>()
    const resources: Resource[] = []
    for (const response of children(document.documentElement, 'response')) {
      const resourceStatus = status(text(response, 'status'))
      if (resourceStatus >= 400) throw failure('读取资源信息', `目录成员请求失败（HTTP ${resourceStatus}）`)
      const properties = children(response, 'propstat')
        .filter(propstat => {
          const code = status(text(propstat, 'status'))
          return code >= 200 && code < 300
        }).flatMap(propstat => children(propstat, 'prop'))
      const resourceTypes = properties.flatMap(prop => children(prop, 'resourcetype'))
      if (!resourceTypes.length) throw failure('读取资源信息', '资源类型缺失，无法确认完整目录')
      const href = text(response, 'href')
      if (!href) throw failure('读取资源信息', '目录成员缺少路径')
      const actual = new URL(href, `${url.replace(/\/+$/, '')}/`)
      const actualPath = decodeURIComponent(actual.pathname).replace(/\/+$/, '')
      if (actual.origin !== requested.origin) throw failure('读取资源信息', '目录成员来源异常')
      const relative = actualPath === requestedPath ? '' : actualPath.startsWith(`${requestedPath}/`)
        ? actualPath.slice(requestedPath.length + 1) : null
      if (relative === null || relative.includes('/') || (depth === '0' && relative)
        || relative === '.' || relative === '..' || seen.has(relative)) {
        throw failure('读取资源信息', '目录成员路径重复或超出请求范围')
      }
      seen.add(relative)
      const etag = strongEtag(properties.map(prop => text(prop, 'getetag')).find(Boolean))
      resources.push({
        key: relative ? `${key}/${relative}` : key,
        type: resourceTypes.some(type => children(type, 'collection').length) ? 'directory' : 'file',
        etag,
      })
    }
    if (!seen.has('')) throw failure('读取资源信息', '响应缺少请求资源，无法确认路径状态')
    return resources
  }
  const properties = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>'
  const readResources = async (key: string, depth: '0' | '1') => {
    const url = buildWebDAVUrl(config, key)
    const response = await request(url, 'PROPFIND', '读取资源信息', {
      Depth: depth, 'Content-Type': 'application/xml; charset=utf-8',
    }, properties)
    if (response.status === 404) return null
    if (!isPropfindSuccess(response.status)) throw failure('读取资源信息', `请求被拒绝（HTTP ${response.status}）`)
    return parseResources(response.text, url, key, depth)
  }
  const snapshot = async (key: string): Promise<WebDAVPathIdentity | null> => {
    const root = await readResources(key, '0')
    if (!root) return null
    const resource = root.find(entry => entry.key === key)!
    const files: WebDAVPathIdentity['files'] = []
    const entries: Array<[string, 'file' | 'directory', string?]> = []
    const visited = new Set<string>()
    const collect = async (entry: Resource): Promise<void> => {
      if (visited.has(entry.key) || visited.size >= 100_000) throw failure('读取目录快照', '目录成员重复或数量过多')
      visited.add(entry.key)
      const relative = entry.key === key ? '' : entry.key.slice(key.length + 1)
      if (entry.type === 'file') {
        const response = await request(buildWebDAVUrl(config, entry.key), 'GET', '读取文件快照',
          entry.etag ? { 'If-Match': entry.etag } : {})
        if (response.status !== 200 || !response.bytes || (entry.etag && response.etag && entry.etag !== response.etag)) {
          throw failure('读取文件快照', `文件已变化或请求失败（HTTP ${response.status}）`)
        }
        const digest = await hash(response.bytes)
        files.push({ path: relative, digest, etag: response.etag })
        entries.push([relative, 'file', digest])
      } else {
        entries.push([relative, 'directory'])
        const listing = await readResources(entry.key, '1')
        if (!listing || listing.find(item => item.key === entry.key)?.type !== 'directory') {
          throw failure('读取目录快照', '目录已变化，无法确认完整内容')
        }
        for (const child of listing) if (child.key !== entry.key) await collect(child)
      }
    }
    await collect(resource)
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    return {
      type: resource.type,
      digest: await encodedHash(entries),
      etag: resource.type === 'file' ? files[0]?.etag : undefined,
      files,
    }
  }
  const versionMappings = (before: WebDAVPathIdentity, after: WebDAVPathIdentity) => {
    const targets = new Map(after.files.map(file => [file.path, file]))
    return before.files.flatMap(file => {
      const moved = targets.get(file.path)
      return moved?.digest === file.digest && file.etag && moved.etag
        ? [{
          path: file.path, sourceVersion: file.etag, targetVersion: moved.etag,
          sourceHash: file.digest, targetHash: moved.digest,
        }] : []
    })
  }
  const sourceEntry = await snapshot(source)
  const targetEntry = await snapshot(target)
  await current()
  if (!sourceEntry) {
    if (targetEntry && expected && targetEntry.type === expected.type && targetEntry.digest === expected.digest) {
      return { status: 'moved', entry: expected, files: versionMappings(expected, targetEntry) }
    }
    if (targetEntry) throw failure('校验迁移结果', '源路径不存在但目标已存在，无法确认先前迁移结果')
    if (expected) throw failure('校验迁移结果', '已记录的远端源路径和目标路径均不存在，无法确认迁移结果')
    return { status: 'missing' }
  }
  if (targetEntry) throw failure('校验目标路径', '目标已存在，未覆盖任何远端内容')
  if (expected && (sourceEntry.type !== expected.type || sourceEntry.digest !== expected.digest
    || (expected.etag && sourceEntry.etag !== expected.etag))) {
    throw failure('校验源版本', '远端源内容已变化，待办已保留')
  }
  const identity = expected || sourceEntry
  if (!expected) await rememberSource(identity)
  await current()
  // A MOVE cannot create intermediate collections. Check every parent and only
  // create a collection after a genuine 404, never after permission errors.
  const prefix = getPathPrefix(config)
  const parent = getParentKey(target)
  const fullParent = [prefix, parent].filter(Boolean).join('/')
  const parentParts = fullParent.split('/').filter(Boolean)
  for (let index = 1; index <= parentParts.length; index++) {
    const fullPath = parentParts.slice(0, index).join('/')
    const url = `${buildWebDAVBaseUrl(config)}/${buildRepoContentPath({ path: fullPath })}`
    const existing = await request(url, 'PROPFIND', '校验目标父目录', {
      Depth: '0', 'Content-Type': 'application/xml; charset=utf-8',
    }, properties)
    if (isPropfindSuccess(existing.status)) {
      if (!isCollectionResponse(existing.text, url)) throw failure('校验目标父目录', '目标父路径不是目录')
      continue
    }
    if (existing.status !== 404) throw failure('校验目标父目录', `请求被拒绝（HTTP ${existing.status}）`)
    const created = await request(url, 'MKCOL', '创建目标父目录', {}, undefined, async () => {
      const remote = await recoverRemoteRead(() => request(url, 'PROPFIND', '核对目标父目录', {
        Depth: '0', 'Content-Type': 'application/xml; charset=utf-8',
      }, properties))
      if (remote.status === 404) return { state: 'unchanged' }
      if (isPropfindSuccess(remote.status) && isCollectionResponse(remote.text, url)) {
        return { state: 'applied', value: new Response(null, { status: 201 }) }
      }
      throw failure('核对目标父目录', '无法确认目录创建结果，待办已保留')
    })
    if (created.status !== 201 && created.status !== 405) throw failure('创建目标父目录', `请求被拒绝（HTTP ${created.status}）`)
    const verified = await request(url, 'PROPFIND', '确认目标父目录', {
      Depth: '0', 'Content-Type': 'application/xml; charset=utf-8',
    }, properties)
    if (!isPropfindSuccess(verified.status) || !isCollectionResponse(verified.text, url)) {
      throw failure('确认目标父目录', '目标父目录未创建成功')
    }
  }
  const collectionSuffix = sourceEntry.type === 'directory' ? '/' : ''
  const moveHeaders: Record<string, string> = {
    Destination: `${buildWebDAVUrl(config, target)}${collectionSuffix}`,
    Overwrite: 'F',
  }
  if (sourceEntry.type === 'directory') moveHeaders.Depth = 'infinity'
  else if (sourceEntry.etag) moveHeaders['If-Match'] = sourceEntry.etag
  const moved = await request(
    `${buildWebDAVUrl(config, source)}${collectionSuffix}`, 'MOVE', '远端重命名', moveHeaders, undefined, async () => {
      const remaining = await recoverRemoteRead(() => snapshot(source))
      const destination = await recoverRemoteRead(() => snapshot(target))
      if (!remaining && destination?.type === identity.type && destination.digest === identity.digest) {
        return { state: 'applied', value: new Response(null, { status: 201 }) }
      }
      if (destination || !remaining || remaining.type !== identity.type || remaining.digest !== identity.digest
        || (identity.etag && remaining.etag !== identity.etag)) {
        throw failure('核对重命名结果', '源路径或目标路径已变化，待办已保留')
      }
      // Only a file with a frozen strong ETag can protect an automatic replay.
      // Directory MOVE has no atomic validator for all descendants.
      if (identity.type !== 'file' || !moveHeaders['If-Match']) {
        throw failure('核对重命名结果', '服务端无法保护重发时的完整源版本，待办已保留')
      }
      return { state: 'unchanged' }
    },
  )
  if (moved.status !== 201 && moved.status !== 204) {
    const detail = moved.status === 207 ? '部分目录成员未迁移，待办已保留'
      : moved.status === 405 || moved.status === 501 ? '服务端不支持 MOVE，待办已保留'
      : `请求被拒绝（HTTP ${moved.status}），待办已保留`
    throw failure('远端重命名', detail)
  }
  await current()
  // The server has confirmed MOVE. A later edit at the destination must not
  // strand an already completed rename; only rebind unchanged file versions.
  let after: WebDAVPathIdentity | null = null
  try { after = await snapshot(target) } catch { /* Metadata refresh can retry independently. */ }
  return { status: 'moved', entry: identity, files: after ? versionMappings(identity, after) : [] }
}
