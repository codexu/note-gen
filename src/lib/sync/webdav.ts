import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { WebDAVConfig } from '@/types/sync'
import { buildRepoContentPath, debugSyncPath, debugSyncPerf } from './remote-file'

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
  proxy?: Proxy
) {
  const startedAt = getPerfNow()
  if (shouldSkipForTemporaryBlock(config, 'mkcol', { fullPath })) {
    return false
  }

  const baseUrl = buildWebDAVBaseUrl(config)
  const encodedFullPath = buildRepoContentPath({ path: fullPath })
  const response = await fetch(`${baseUrl}/${encodedFullPath}`, {
    method: 'MKCOL',
    headers: {
      'Authorization': buildAuthHeader(config.username, config.password)
    },
    proxy
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
  proxy?: Proxy
) {
  const parts = collectionPath.split('/').filter(Boolean)
  for (let i = 1; i <= parts.length; i++) {
    const parentPath = parts.slice(0, i).join('/')
    const ok = await mkcolFullPath(config, parentPath, proxy)
    if (!ok) {
      return false
    }
  }

  return true
}

/**
 * 测试 WebDAV 连接
 */
export async function testWebDAVConnection(config: WebDAVConfig, proxy?: Proxy): Promise<boolean> {
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
  proxy?: Proxy
): Promise<boolean> {
  const pathPrefix = getPathPrefix(config)

  // 首先确保 pathPrefix 目录存在
  if (pathPrefix) {
    const ok = await ensureCollectionPathExists(config, pathPrefix, proxy)
    if (!ok) {
      return false
    }
  }

  const parts = key.split('/').filter(p => p)
  // 构建所有可能的父目录路径
  for (let i = 1; i < parts.length; i++) {
    const relativeParentPath = parts.slice(0, i).join('/')
    const parentPath = pathPrefix ? `${pathPrefix}/${relativeParentPath}` : relativeParentPath
    await mkcolFullPath(config, parentPath, proxy)
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
  contentType = 'text/markdown; charset=utf-8'
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
    await ensureParentDirsExist(config, key, proxy)
    logPerf('ensureParentDirs')

    const url = buildWebDAVUrl(config, key)
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    logPerf('encodeContent', {
      byteLength: contentBytes.byteLength,
    })

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password),
        'Content-Type': contentType,
        'Content-Length': contentBytes.byteLength.toString()
      },
      body: contentBytes,
      proxy
    })
    markTemporaryBlocked(config, response, 'upload')
    logPerf('putRequest', {
      status: response.status,
    })

    if (response.status === 201 || response.status === 204) {
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
      return null
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
      const errorText = await response.text()
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
      return null
    }
  } catch (error) {
    debugSyncPerf('webdav.download.failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV download error:', error)
    return null
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
export async function webdavDelete(config: WebDAVConfig, key: string, proxy?: Proxy): Promise<boolean> {
  try {
    if (shouldSkipForTemporaryBlock(config, 'delete', { key })) {
      return false
    }

    const url = buildWebDAVUrl(config, key)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })
    markTemporaryBlocked(config, response, 'delete')

    return response.status === 204 || response.status === 200 || response.status === 404
  } catch (error) {
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
      return null
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
    } else if (response.status === 404 || response.status === 409) {
      // 文件不存在，返回 null
      return null
    } else {
      const errorText = await response.text()
      debugSyncPerf('webdav.headObject.errorBody', {
        key,
        status: response.status,
        bodyLength: errorText.length,
        totalMs: roundMs(getPerfNow() - startedAt),
      })
      if (!isTemporaryBlockStatus(response.status)) {
        console.error('WebDAV HeadObject failed:', response.status, errorText)
      }
      return null
    }
  } catch (error) {
    debugSyncPerf('webdav.headObject.failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV head error:', error)
    return null
  }
}

/**
 * 列出 WebDAV 文件
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
    } else if (response.status === 404 || response.status === 409) {
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
      throw new Error(`WebDAV directory request failed: ${response.status}`)
    }
  } catch (error) {
    debugSyncPerf('webdav.listObjects.failed', {
      prefix,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('WebDAV list error:', error)
    throw error
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
  if (document.getElementsByTagName('parsererror').length > 0
    || document.documentElement.localName !== 'multistatus'
    || document.documentElement.namespaceURI !== 'DAV:') {
    throw new Error('Invalid WebDAV directory response')
  }

  const results: Array<{ key: string; etag: string; lastModified: string; size: number }> = []
  // 按命名空间读取，兼容 d:、D: 和默认 DAV 命名空间。
  for (const response of Array.from(document.getElementsByTagNameNS('DAV:', 'response'))) {
    const readProperty = (name: string) => (
      response.getElementsByTagNameNS('DAV:', name)[0]?.textContent?.trim() || ''
    )
    const statuses = Array.from(response.getElementsByTagNameNS('DAV:', 'status'))
    if (statuses.length > 0 && !statuses.some(status => /\s2\d{2}(?:\s|$)/.test(status.textContent || ''))) {
      throw new Error('WebDAV directory entry could not be read')
    }
    const href = readProperty('href')
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
      || response.getElementsByTagNameNS('DAV:', 'collection').length > 0

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
  config: WebDAVConfig,
  path: string,
  proxy?: Proxy
): Promise<boolean> {
  try {
    if (shouldSkipForTemporaryBlock(config, 'mkcolPublic', { path })) {
      return false
    }

    const baseUrl = buildWebDAVBaseUrl(config)
    const pathPrefix = getPathPrefix(config)
    const fullPath = pathPrefix ? `${pathPrefix}/${path}` : path

    const response = await fetch(`${baseUrl}/${buildRepoContentPath({ path: fullPath })}`, {
      method: 'MKCOL',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })
    markTemporaryBlocked(config, response, 'mkcolPublic')

    // 201 表示创建成功，405 表示已存在
    return response.status === 201 || response.status === 405
  } catch (error) {
    console.error('WebDAV mkcol error:', error)
    return false
  }
}
