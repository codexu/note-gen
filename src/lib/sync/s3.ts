import { conditionalHeaders, assertConditionalResponse, type RemoteWriteCondition } from './write-condition'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { S3Config } from '@/types/sync'
import { buildRepoContentPath, debugSyncPath, debugSyncPerf } from './remote-file'
import { withRemotePathWriteLock } from './remote-write-lock'
import {
  isRemoteConnectionError, recoverRemoteMutation, recoverRemoteRead, RemoteMutationTransportError,
  type RemoteMutationObservation,
} from './remote-mutation-recovery'

/**
 * S3 同步核心模块
 * 支持阿里云 OSS、AWS S3、MinIO 等 S3 兼容服务
 */

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

function hasStrongS3Etag(value: string): boolean {
  return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
}

function sameS3Bytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function shouldUseVirtualHostedStyle(endpoint: string) {
  return endpoint.includes('amazonaws.com')
    || endpoint.includes('aliyuncs.com')
    || endpoint.includes('myqcloud.com')
}

function applyBucketHostname(url: URL, bucket: string) {
  if (url.hostname !== bucket && !url.hostname.startsWith(`${bucket}.`)) {
    url.hostname = `${bucket}.${url.hostname}`
  }

  return url
}

// 生成 AWS 签名 V4 (使用 Web Crypto API)
async function generateSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BufferSource,
  config: S3Config
) {
  const algorithm = 'AWS4-HMAC-SHA256'
  const date = new Date()
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '')
  const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '')

  // 必须将 x-amz-date 加入 headers 参与签名
  headers['x-amz-date'] = amzDate

  // 创建规范请求
  // 必须对路径进行 URI 编码，但要保留斜杠
  const urlObj = new URL(url)
  const canonicalUri = urlObj.pathname

  // AWS V4 签名要求查询字符串必须按字母顺序排列并正确编码
  const canonicalQuerystring = Array.from(urlObj.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

  // AWS V4 签名要求 Headers 的 Key 必须全部转为小写
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('')

  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';')

  // 使用 Web Crypto API 计算 SHA256
  const payloadHash = await crypto.subtle.digest('SHA-256', payload)
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n')

  // 创建字符串以供签名
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  // 计算签名
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3')
  const signature = await hmacSha256Hex(signingKey, stringToSign)

  return {
    authorization: `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHashHex
  }
}

// Web Crypto API 辅助函数
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  return await crypto.subtle.sign('HMAC', key, encoder.encode(data))
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const signature = await hmacSha256(key, data)
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder()

  // 导入初始密钥
  const kSecret = await crypto.subtle.importKey(
    'raw',
    encoder.encode('AWS4' + key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kDate = HMAC("AWS4" + kSecret, Date)
  const kDate = await crypto.subtle.sign('HMAC', kSecret, encoder.encode(dateStamp))

  const kDateKey = await crypto.subtle.importKey(
    'raw',
    kDate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kRegion = HMAC(kDate, Region)
  const kRegion = await crypto.subtle.sign('HMAC', kDateKey, encoder.encode(regionName))
  const kRegionKey = await crypto.subtle.importKey(
    'raw',
    kRegion,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kService = HMAC(kRegion, Service)
  const kService = await crypto.subtle.sign('HMAC', kRegionKey, encoder.encode(serviceName))
  const kServiceKey = await crypto.subtle.importKey(
    'raw',
    kService,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // kSigning = HMAC(kService, "aws4_request")
  const kSigning = await crypto.subtle.sign('HMAC', kServiceKey, encoder.encode('aws4_request'))
  return await crypto.subtle.importKey(
    'raw',
    kSigning,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * 构建 S3 URL
 * 支持 Virtual Hosted Style 和 Path Style
 */
function buildS3Url(config: S3Config, key: string): string {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim()
  const bucket = config.bucket.trim()

  // 移除 endpoint 末尾的斜杠
  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

  // 处理 pathPrefix，移除末尾的斜杠以防止双斜杠问题
  const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
  const fullKey = prefix ? `${prefix}/${key}` : key
  // A directory marker ("folder/") and the object "folder" are different keys.
  const encodedFullKey = buildRepoContentPath({ path: fullKey, preserveWhitespace: true })
    + (fullKey.endsWith('/') ? '/' : '')
  debugSyncPath('s3.buildUrl', {
    key,
    pathPrefix: prefix,
    fullKey,
    encodedFullKey,
  })

  let url = ''

  // 针对阿里云 OSS、腾讯云 COS、AWS S3 等支持 Virtual Hosted Style 的服务
  const isCloudflareR2 = cleanEndpoint.includes('cloudflarestorage.com')

  // Cloudflare R2 需要使用 Path Style，不是 Virtual Hosted Style
  if (isCloudflareR2) {
    // 使用 Path Style: https://endpoint/bucket/key
    url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
  } else if (shouldUseVirtualHostedStyle(cleanEndpoint)) {
    // 使用 Virtual Hosted Style: https://bucket.endpoint/key
    try {
      const urlObj = applyBucketHostname(new URL(cleanEndpoint), bucket)
      url = `${urlObj.toString()}/${encodedFullKey}`
      // 处理可能的双斜杠
      url = url.replace(/([^:]\/)\/+/g, '$1')
    } catch {
      console.warn('[S3 Sync] Failed to switch to Virtual Hosted Style, using Path Style')
      url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
    }
  } else {
    // MinIO 等使用 Path Style
    url = `${cleanEndpoint}/${bucket}/${encodedFullKey}`
  }

  return url
}

/**
 * 构建 S3 基础 URL（不含 key）
 */
function buildS3BaseUrl(config: S3Config): string {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim()
  const bucket = config.bucket.trim()

  // 移除 endpoint 末尾的斜杠
  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

  // 针对阿里云 OSS、腾讯云 COS、AWS S3 等支持 Virtual Hosted Style 的服务进行优化
  if (shouldUseVirtualHostedStyle(cleanEndpoint)) {
    try {
      const urlObj = applyBucketHostname(new URL(cleanEndpoint), bucket)
      return urlObj.toString().replace(/\/+$/, '')
    } catch {
      console.warn('[S3 Sync] Failed to switch to Virtual Hosted Style, using Path Style')
      return `${cleanEndpoint}/${bucket}`
    }
  }

  return `${cleanEndpoint}/${bucket}`
}

function withS3PathWriteLock<T>(config: S3Config, paths: string[], operation: () => Promise<T>): Promise<T> {
  const urls = paths.map(path => new URL(buildS3Url(config, path)))
  return withRemotePathWriteLock(
    JSON.stringify(['s3', urls[0].origin, config.accessKeyId]),
    urls.map(url => decodeURIComponent(url.pathname)), operation,
  )
}

/**
 * 测试 S3 连接
 */
export async function testS3Connection(config: S3Config, proxy?: Proxy): Promise<boolean> {
  config = { ...config }
  try {
    return await withS3PathWriteLock(config, ['.connection-test'], () => testS3ConnectionRaw(config, proxy))
  } catch { return false }
}

async function testS3ConnectionRaw(config: S3Config, proxy?: Proxy): Promise<boolean> {
  try {
    const baseUrl = buildS3BaseUrl(config)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(baseUrl).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    // 使用 GET 请求代替 HEAD，以便在出错时能获取具体的 XML 错误信息
    const method = 'GET'
    const { authorization, amzDate } = await generateSignature(method, baseUrl, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(baseUrl, {
      method: method,
      headers: requestHeaders,
      proxy
    })

    if (response.status === 200) {
      return true
    }

    // 如果 GET (ListObjects) 失败（可能是只有写权限），尝试 PUT 一个测试文件
    if (response.status === 403) {
      console.warn('ListObjects (GET) failed with 403, trying PutObject to verify write permission...')

      const testKey = '.connection-test'
      const testUrl = buildS3Url(config, testKey)
      const testContent = new TextEncoder().encode('test')

      const putHeaders = {
        Host: new URL(testUrl).host,
        'Content-Type': 'text/plain',
        'Content-Length': testContent.byteLength.toString()
      }

      const { authorization: authPut, amzDate: datePut, payloadHashHex: hashPut } =
        await generateSignature('PUT', testUrl, putHeaders, testContent, config)

      const requestPutHeaders = new Headers()
      requestPutHeaders.append('Authorization', authPut)
      requestPutHeaders.append('X-Amz-Date', datePut)
      requestPutHeaders.append('Content-Type', 'text/plain')
      requestPutHeaders.append('X-Amz-Content-Sha256', hashPut)

      const putResponse = await fetch(testUrl, {
        method: 'PUT',
        headers: requestPutHeaders,
        body: testContent,
        proxy
      })

      if (putResponse.status === 200 || putResponse.status === 204) {
        // 清理测试文件
        try {
          const deleteHeaders = {
            Host: new URL(testUrl).host
          }
          const { authorization: authDel, amzDate: dateDel, payloadHashHex: hashDel } =
            await generateSignature('DELETE', testUrl, deleteHeaders, emptyPayload, config)

          const requestDelHeaders = new Headers()
          requestDelHeaders.append('Authorization', authDel)
          requestDelHeaders.append('X-Amz-Date', dateDel)
          requestDelHeaders.append('X-Amz-Content-Sha256', hashDel)

          await fetch(testUrl, {
            method: 'DELETE',
            headers: requestDelHeaders,
            proxy
          })
        } catch {
          // 忽略清理错误
        }
        return true
      } else {
        const putErrorText = await putResponse.text()
        console.error('PutObject also failed:', putResponse.status, putErrorText)
      }
    }

    const errorText = await response.text()
    console.warn('S3 Check Failed:', {
      status: response.status,
      statusText: response.statusText,
      url: baseUrl,
      headers: Object.fromEntries(response.headers.entries()),
      errorBody: errorText || '(empty body)'
    })

    return false
  } catch (error) {
    console.error('S3 connection test failed:', error)

    // 尝试提取更有用的错误信息
    const errorMessage = (error as Error).message || String(error)
    if (errorMessage.includes('error sending request')) {
      console.warn(
        'Network Error Details: Please check your Endpoint, Region, and Proxy settings. URL might be malformed.'
      )
    }

    return false
  }
}

/**
 * 上传文件到 S3（类似推送）
 */
export async function s3Upload(
  config: S3Config,
  key: string,
  content: string | Uint8Array,
  proxy?: Proxy,
  contentType = 'text/markdown; charset=utf-8',
  condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<{ etag: string } | null> {
  config = { ...config }
  return withS3PathWriteLock(config, [key], async () => {
    await beforeWrite?.()
    return s3UploadRaw(config, key, content, proxy, contentType, condition, beforeWrite)
  })
}

async function s3UploadRaw(
  config: S3Config,
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
    debugSyncPerf(`s3.upload.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - uploadStartedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start', {
      contentLength: content.length,
      hasPathPrefix: Boolean(config.pathPrefix),
    })
    const url = buildS3Url(config, key)
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content)
    logPerf('encodeContent', {
      byteLength: contentBytes.byteLength,
    })

    let frozenCondition = condition ? { ...condition } : undefined
    if (!frozenCondition) {
      try {
        const previous = await s3HeadObject(config, key, proxy)
        if (!previous || hasStrongS3Etag(previous.etag)) frozenCondition = { version: previous?.etag ?? null }
      } catch { /* A write-only endpoint must still receive the original first write. */ }
    }
    const originalVersion = frozenCondition?.version
    const canReplay = Boolean(frozenCondition)
    const conditions = conditionalHeaders(frozenCondition)
    let requestHeaders = new Headers()
    const response = await recoverRemoteMutation<Response>({
      beforeWrite: async () => {
        await beforeWrite?.()
        const signingHeaders = {
          ...conditions, Host: new URL(url).host,
          'Content-Type': contentType, 'Content-Length': contentBytes.byteLength.toString(),
        }
        const { authorization, amzDate, payloadHashHex } = await generateSignature(
          'PUT', url, signingHeaders, contentBytes, config,
        )
        logPerf('generateSignature')
        requestHeaders = new Headers({
          ...conditions, Authorization: authorization, 'X-Amz-Date': amzDate,
          'Content-Type': contentType, 'X-Amz-Content-Sha256': payloadHashHex,
        })
      },
      send: () => fetch(url, { method: 'PUT', headers: requestHeaders, body: contentBytes, proxy }),
      reconcile: async () => {
        // ETags are version validators, never hashes of the uploaded bytes.
        const remote = await recoverRemoteRead(() => s3DownloadBytesInternal(config, key, proxy))
        if (remote && sameS3Bytes(remote.content, contentBytes)) {
          return { state: 'applied', value: new Response(null, { status: 200, headers: { ETag: remote.etag } }) }
        }
        if (canReplay && ((!remote && originalVersion === null)
          || (remote && conditions['If-Match'] === remote.etag))) return { state: 'unchanged' }
        throw new Error('SYNC_SWITCH_STALE')
      },
    })
    assertConditionalResponse(response, frozenCondition)
    logPerf('putRequest', {
      status: response.status,
    })

    if (response.status === 200 || response.status === 204) {
      // 获取 ETag
      const etag = response.headers.get('ETag') || ''
      logPerf('completed', {
        success: true,
        status: response.status,
        hasEtag: Boolean(etag),
      })
      return { etag }
    } else {
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 Upload failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    if (condition) throw error
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 Upload error:', error)
    return null
  }
}

/**
 * 从 S3 下载文件（类似拉取）
 */
async function s3DownloadBytesInternal(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  let previousPerfAt = startedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.download.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - startedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start')
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('GET', url, headers, emptyPayload, config)
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      proxy
    })
    logPerf('getRequest', {
      status: response.status,
    })

    if (response.status === 200) {
      const content = new Uint8Array(await response.arrayBuffer())
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''
      logPerf('readBody', {
        contentLength: content.length,
      })

      return { content, etag, lastModified }
    } else if (response.status === 404) {
      // 文件不存在
      logPerf('completed', {
        success: false,
        status: response.status,
      })
      return null
    } else {
      const errorText = await response.text().catch(() => '')
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 Download failed:', response.status, errorText)
      throw new Error(`s3 / ${key}: HTTP ${response.status}`)
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 Download error:', error)
    throw error
  }
}

export async function s3DownloadBytes(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: Uint8Array; etag: string; lastModified: string } | null> {
  return await s3DownloadBytesInternal(config, key, proxy)
}

export async function s3Download(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: string; etag: string; lastModified: string } | null> {
  const file = await s3DownloadBytesInternal(config, key, proxy)
  return file ? { ...file, content: new TextDecoder().decode(file.content) } : null
}

/**
 * 删除 S3 文件
 */
export async function s3Delete(
  config: S3Config, key: string, proxy?: Proxy, condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  config = { ...config }
  return withS3PathWriteLock(config, [key], async () => {
    await beforeWrite?.()
    return s3DeleteRaw(config, key, proxy, condition, beforeWrite)
  })
}

async function s3DeleteRaw(
  config: S3Config, key: string, proxy?: Proxy, condition?: RemoteWriteCondition,
  beforeWrite?: () => Promise<void>,
): Promise<boolean> {
  try {
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    let frozenCondition = condition ? { ...condition } : undefined
    if (!frozenCondition) {
      try {
        const previous = await s3HeadObject(config, key, proxy)
        if (!previous) return true
        if (hasStrongS3Etag(previous.etag)) frozenCondition = { version: previous.etag }
      } catch { /* Preserve the first unconditional delete on write-only endpoints. */ }
    }
    const canReplay = Boolean(frozenCondition)
    const conditions = conditionalHeaders(frozenCondition)
    let requestHeaders = new Headers()
    const response = await recoverRemoteMutation<Response>({
      beforeWrite: async () => {
        await beforeWrite?.()
        const headers = { ...conditions, Host: new URL(url).host, 'X-Amz-Content-Sha256': payloadHashHex }
        const { authorization, amzDate } = await generateSignature('DELETE', url, headers, emptyPayload, config)
        requestHeaders = new Headers({
          ...conditions, Authorization: authorization, 'X-Amz-Date': amzDate,
          'X-Amz-Content-Sha256': payloadHashHex,
        })
      },
      send: () => fetch(url, { method: 'DELETE', headers: requestHeaders, proxy }),
      reconcile: async () => {
        const remote = await recoverRemoteRead(() => s3HeadObject(config, key, proxy))
        if (!remote) return { state: 'applied', value: new Response(null, { status: 204 }) }
        if (canReplay && conditions['If-Match'] === remote.etag) return { state: 'unchanged' }
        throw new Error('SYNC_SWITCH_STALE')
      },
    })

    assertConditionalResponse(response, frozenCondition)
    // 204 No Content 或 200 OK 都表示删除成功
    return response.status === 204 || response.status === 200
  } catch (error) {
    if (condition) throw error
    console.error('S3 Delete error:', error)
    return false
  }
}

/**
 * 列出 S3 文件（用于获取文件列表）
 */
export async function s3ListObjects(
  config: S3Config,
  prefix: string,
  proxy?: Proxy
): Promise<Array<{ key: string; etag: string; lastModified: string; size: number }>> {
  const startedAt = getPerfNow()
  try {
    const baseUrl = buildS3BaseUrl(config)
    const configPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const directoryPrefix = prefix.replace(/^\/+|\/+$/g, '')
    const fullPrefix = [configPrefix, directoryPrefix].filter(Boolean).join('/')
    const objects: Array<{ key: string; etag: string; lastModified: string; size: number }> = []
    const seenTokens = new Set<string>()
    let continuationToken: string | undefined
    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    do {
      const listUrl = new URL(baseUrl)
      listUrl.searchParams.set('list-type', '2')
      listUrl.searchParams.set('prefix', fullPrefix ? `${fullPrefix}/` : '')
      if (continuationToken) listUrl.searchParams.set('continuation-token', continuationToken)
      const url = listUrl.toString()
      const headers: Record<string, string> = {
        Host: listUrl.host,
        'X-Amz-Content-Sha256': payloadHashHex,
      }
      // 每页的查询参数不同，必须重新签名。
      const { authorization, amzDate } = await generateSignature('GET', url, headers, emptyPayload, config)
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: authorization,
          'X-Amz-Date': amzDate,
          'X-Amz-Content-Sha256': payloadHashHex,
        },
        proxy,
      })
      if (response.status !== 200) {
        throw new Error(`S3 directory request failed: ${response.status}`)
      }
      const page = parseListObjectsResponse(await response.text(), configPrefix)
      objects.push(...page.objects)
      continuationToken = page.nextToken
      if (continuationToken) {
        if (seenTokens.has(continuationToken)) throw new Error('Repeated S3 directory page')
        seenTokens.add(continuationToken)
      }
    } while (continuationToken)

    debugSyncPerf('s3.listObjects.completed', {
      prefix, resultCount: objects.length, totalMs: roundMs(getPerfNow() - startedAt),
    })
    return objects
  } catch (error) {
    debugSyncPerf('s3.listObjects.failed', {
      prefix,
      message: error instanceof Error ? error.message : String(error),
      totalMs: roundMs(getPerfNow() - startedAt),
    })
    console.error('S3 ListObjects error:', error)
    throw error
  }
}

/**
 * 解析完整的 ListObjectsV2 页面，失败时不能作为空目录应用。
 */
function parseListObjectsResponse(xml: string, prefix: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0
    || document.documentElement.localName !== 'ListBucketResult') {
    throw new Error('Invalid S3 directory response')
  }
  const readProperty = (element: Element, name: string) => (
    element.getElementsByTagNameNS('*', name)[0]?.textContent || ''
  )
  const root = document.documentElement
  const truncated = readProperty(root, 'IsTruncated').trim()
  if (truncated !== 'true' && truncated !== 'false') {
    throw new Error('Invalid S3 directory pagination')
  }
  const nextToken = truncated === 'true' ? readProperty(root, 'NextContinuationToken') : undefined
  if (truncated === 'true' && !nextToken) throw new Error('Incomplete S3 directory listing')
  const objects = Array.from(root.getElementsByTagNameNS('*', 'Contents')).map(content => {
    let key = readProperty(content, 'Key')
    if (!key) throw new Error('S3 directory entry is missing its key')
    if (prefix && key.startsWith(`${prefix}/`)) key = key.slice(prefix.length + 1)
    return {
      key,
      etag: readProperty(content, 'ETag').replace(/"/g, ''),
      lastModified: readProperty(content, 'LastModified'),
      size: Number(readProperty(content, 'Size')) || 0,
    }
  })
  return { objects, nextToken }
}

/**
 * 获取文件信息
 */
export async function s3HeadObject(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ etag: string; lastModified: string } | null> {
  const startedAt = getPerfNow()
  let previousPerfAt = startedAt
  const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
    const now = getPerfNow()
    debugSyncPerf(`s3.headObject.${step}`, {
      key,
      stepMs: roundMs(now - previousPerfAt),
      totalMs: roundMs(now - startedAt),
      ...payload,
    })
    previousPerfAt = now
  }

  try {
    logPerf('start')
    const url = buildS3Url(config, key)

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('HEAD', url, headers, emptyPayload, config)
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: requestHeaders,
      proxy
    })
    logPerf('headRequest', {
      status: response.status,
    })

    if (response.status === 200) {
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      return { etag, lastModified }
    } else if (response.status === 404) {
      // 文件不存在
      logPerf('completed', {
        success: false,
        status: response.status,
      })
      return null
    } else {
      const errorText = await response.text().catch(() => '')
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 HeadObject failed:', response.status, errorText)
      throw new Error(`S3 metadata request failed: HTTP ${response.status}`)
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 HeadObject error:', error)
    throw error
  }
}

export interface S3PathIdentity {
  provider: 's3'
  type: 'file' | 'directory'
  digest: string
  operationId: string
  files: Array<{
    path: string
    digest: string
    etag: string
    contentType: string
    copyStarted?: boolean
    targetEtag?: string
    deleted?: boolean
  }>
}

interface S3MovePathOptions {
  expected?: S3PathIdentity
  /** Persist the snapshot and each step before the next remote mutation. */
  rememberSource: (identity: S3PathIdentity) => Promise<void>
  assertCurrent: () => Promise<boolean>
}

export interface S3PathMoveResult {
  status: 'moved' | 'missing'
  entry?: S3PathIdentity
  files?: Array<{
    path: string
    sourceVersion: string
    targetVersion: string
    sourceHash: string
    targetHash: string
  }>
}

/** S3 has no rename transaction. Copy remote bytes with create-only PUTs,
 * verify every destination, then delete only the snapshotted source versions.
 * The caller journals progress so interruption never causes a blind overwrite
 * or a fresh source snapshot to replace a partially completed operation. */
export async function s3MovePath(
  config: S3Config, source: string, target: string, options: S3MovePathOptions, proxy?: Proxy,
): Promise<S3PathMoveResult> {
  config = { ...config }
  return withS3PathWriteLock(config, [source, target], () => s3MovePathRaw(config, source, target, options, proxy))
}

async function s3MovePathRaw(
  config: S3Config,
  source: string,
  target: string,
  { expected, rememberSource, assertCurrent }: S3MovePathOptions,
  proxy?: Proxy,
): Promise<S3PathMoveResult> {
  config = { ...config }
  const failure = (stage: string, detail: string) => new Error(
    `S3 路径迁移失败（${source} → ${target}，${stage}）：${detail}`,
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
  const strongEtag = (value: string | null) => value && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ? value : null
  const hash = async (bytes: Uint8Array) => {
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  }
  const request = async (
    key: string, method: 'GET' | 'HEAD' | 'PUT' | 'DELETE',
    extraHeaders: Record<string, string> = {}, bytes?: Uint8Array, requestUrl?: string,
    reconcile?: () => Promise<RemoteMutationObservation<Response>>,
  ): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> => {
    const url = requestUrl || buildS3Url(config, key)
    const payload = bytes ? Uint8Array.from(bytes).buffer : new ArrayBuffer(0)
    let controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let requestHeaders = new Headers()
    const prepare = async () => {
      await current()
      const signingHeaders = { ...extraHeaders, Host: new URL(url).host }
      const { authorization, amzDate, payloadHashHex } = await generateSignature(method, url, signingHeaders, payload, config)
      requestHeaders = new Headers({
        ...extraHeaders, Authorization: authorization,
        'X-Amz-Date': amzDate, 'X-Amz-Content-Sha256': payloadHashHex,
      })
      clearTimeout(timeout)
      controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), 15_000)
    }
    const send = () => fetch(url, {
      method, headers: requestHeaders,
      body: method === 'PUT' ? payload : undefined,
      proxy, signal: controller.signal, connectTimeout: 15_000, maxRedirections: 0,
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
        // Consume bodies within the timeout. Never print signed request errors.
        const body = method === 'GET' && response.status === 200
          ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array()
        // A successful mutation is confirmed by its status. Its optional body
        // must not turn an acknowledged write into an ambiguous failure.
        return { status: response.status, headers: response.headers, bytes: body }
      } catch (error) {
        if (isRemoteConnectionError(error)) {
          throw new RemoteMutationTransportError(failure('请求远端', '网络请求失败或超时，待办已保留').message)
        }
        throw failure('请求远端', '网络请求失败或超时，待办已保留')
      }
    } finally { clearTimeout(timeout) }
  }
  const read = async (key: string, etag?: string) => {
    const response = await request(key, 'GET', etag ? { 'If-Match': etag } : {})
    if (response.status === 404) return null
    const version = strongEtag(response.headers.get('etag'))
    if (response.status !== 200 || !version || (etag && version !== etag)) {
      throw failure('读取文件快照', `文件已变化或请求被拒绝（HTTP ${response.status}）`)
    }
    return { ...response, etag: version, digest: await hash(response.bytes) }
  }
  const list = async (root: string) => {
    const configPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const fullPrefix = [configPrefix, root].filter(Boolean).join('/')
    const files: Array<{ key: string; etag: string; lastModified: string; size: number }> = []
    const tokens = new Set<string>()
    let token: string | undefined
    do {
      const url = new URL(buildS3BaseUrl(config))
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', `${fullPrefix}/`)
      if (token) url.searchParams.set('continuation-token', token)
      const response = await request('', 'GET', {}, undefined, url.toString())
      if (response.status !== 200) throw failure('读取目录快照', `请求被拒绝（HTTP ${response.status}）`)
      const page = parseListObjectsResponse(new TextDecoder().decode(response.bytes), configPrefix)
      files.push(...page.objects)
      if (files.length > 100_000) throw failure('读取目录快照', '目录成员数量过多')
      token = page.nextToken
      if (token) {
        if (tokens.has(token)) throw failure('读取目录快照', '服务端重复返回同一分页')
        tokens.add(token)
      }
    } while (token)
    const seen = new Set<string>()
    for (const file of files) {
      if (!file.key.startsWith(`${root}/`) || seen.has(file.key)
        || (file.key !== `${root}/` && !validPath(file.key.replace(/\/$/, '')))) {
        throw failure('读取目录快照', '目录成员重复或超出请求范围')
      }
      seen.add(file.key)
    }
    for (const key of seen) {
      if (key.endsWith('/') && seen.has(key.slice(0, -1))) {
        throw failure('读取目录快照', '目录中同时存在同名对象和目录标记，无法安全重命名')
      }
      const parts = key.replace(/\/$/, '').split('/')
      for (let index = 1; index < parts.length; index++) {
        if (seen.has(parts.slice(0, index).join('/'))) {
          throw failure('读取目录快照', '目录中同时存在同名对象和子目录，无法安全重命名')
        }
      }
    }
    return files
  }
  const kind = async (root: string) => {
    const exact = await request(root, 'HEAD')
    if (exact.status !== 200 && exact.status !== 404) {
      throw failure('读取资源信息', `请求被拒绝（HTTP ${exact.status}）`)
    }
    const children = await list(root)
    if (exact.status === 200 && children.length) throw failure('读取资源信息', '同一路径同时存在对象和子目录，无法安全重命名')
    return { type: exact.status === 200 ? 'file' as const : children.length ? 'directory' as const : null, children }
  }
  const keyOf = (root: string, entry: S3PathIdentity, path: string) => entry.type === 'file' ? root : `${root}/${path}`
  let identity: S3PathIdentity
  if (expected !== undefined) {
    // Progress comes from local storage: validate before constructing requests.
    if (!expected || typeof expected !== 'object' || expected.provider !== 's3' || !['file', 'directory'].includes(expected.type)
      || !/^[a-f0-9]{64}$/.test(expected.digest) || !/^[a-zA-Z0-9-]{16,64}$/.test(expected.operationId)
      || !Array.isArray(expected.files) || !expected.files.length || expected.files.length > 100_000
      || expected.files.some(file => typeof file.path !== 'string'
        || (expected.type === 'file' ? file.path !== '' : file.path !== '' && !validPath(file.path.replace(/\/$/, '')))
        || !/^[a-f0-9]{64}$/.test(file.digest) || !strongEtag(file.etag)
        || typeof file.contentType !== 'string' || /[\r\n]/.test(file.contentType)
        || (file.copyStarted !== undefined && typeof file.copyStarted !== 'boolean')
        || (file.deleted !== undefined && typeof file.deleted !== 'boolean')
        || (file.targetEtag !== undefined && (!strongEtag(file.targetEtag) || !file.copyStarted))
        || (file.deleted && !file.targetEtag))
      || new Set(expected.files.map(file => file.path)).size !== expected.files.length) {
      throw failure('校验待办', '迁移版本记录无效')
    }
    identity = structuredClone(expected)
  } else {
    const from = await kind(source)
    const to = await kind(target)
    if (to.type) throw failure('校验目标路径', '目标已存在，未覆盖任何远端内容')
    if (!from.type) return { status: 'missing' }
    const files: S3PathIdentity['files'] = []
    const keys = from.type === 'file' ? [source] : from.children.map(file => file.key)
    for (const key of keys) {
      const file = await read(key)
      if (!file) throw failure('读取源快照', '源对象已变化，待办已保留')
      files.push({
        path: from.type === 'file' ? '' : key.slice(source.length + 1), digest: file.digest,
        etag: file.etag, contentType: file.headers.get('content-type') || 'application/octet-stream',
      })
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    identity = {
      provider: 's3', type: from.type, operationId: crypto.randomUUID(), files,
      digest: await hash(new TextEncoder().encode(JSON.stringify(files.map(file => [file.path, file.digest, file.etag])))),
    }
    await rememberSource(structuredClone(identity))
  }
  const persist = async () => {
    await current()
    await rememberSource(structuredClone(identity))
  }
  const marker = 'x-amz-meta-notegen-path-move'
  const verifyTarget = async (file: S3PathIdentity['files'][number]) => {
    const remote = await read(keyOf(target, identity, file.path), file.targetEtag)
    if (!remote || remote.digest !== file.digest || remote.headers.get(marker) !== identity.operationId) {
      throw failure('确认目标内容', '目标对象已变化或不属于本次迁移，源对象已保留')
    }
    return remote
  }
  // Check exact objects, directory members and unexpected additions before
  // writing or deleting. Directory markers are ordinary objects and included.
  const verifyMembers = async () => {
    const sourceKind = await kind(source)
    const targetKind = await kind(target)
    for (const [root, state] of [[source, sourceKind], [target, targetKind]] as const) {
      if (state.type && state.type !== identity.type) throw failure('校验目录快照', '源路径或目标路径类型已变化')
      if (identity.type !== 'directory') continue
      const allowed = new Set(identity.files.map(file => keyOf(root, identity, file.path)))
      if (state.children.some(file => !allowed.has(file.key))) {
        throw failure('校验目录快照', '目录中出现新的远端对象，待办已保留')
      }
    }
  }
  await verifyMembers()
  const targetParts = target.split('/')
  for (let index = 1; index < targetParts.length; index++) {
    const parent = await request(targetParts.slice(0, index).join('/'), 'HEAD')
    if (parent.status !== 404) {
      throw failure('校验目标父路径', parent.status === 200 ? '目标父路径已经是一个对象' : `请求被拒绝（HTTP ${parent.status}）`)
    }
  }
  // Some compatible services silently ignore conditional headers. Probe only
  // our own random object; never test a destructive condition on user data.
  const probeKey = `.notegen-path-move-probes/${crypto.randomUUID()}`
  let probeCreated = false
  let probeVersion: string | null = null
  try {
    const probe = new TextEncoder().encode(crypto.randomUUID())
    const created = await request(probeKey, 'PUT', { 'If-None-Match': '*', 'Content-Type': 'application/octet-stream' }, probe)
    if (created.status !== 200 && created.status !== 204) throw failure('校验条件写入', `探针创建失败（HTTP ${created.status}）`)
    probeCreated = true
    probeVersion = strongEtag(created.headers.get('etag'))
    const overwrite = await request(probeKey, 'PUT', { 'If-None-Match': '*', 'Content-Type': 'application/octet-stream' }, probe)
    if (overwrite.status !== 412) throw failure('校验条件写入', '服务端不支持创建时的条件保护，未迁移用户对象')
    const remove = await request(probeKey, 'DELETE', { 'If-Match': `"notegen-mismatch-${crypto.randomUUID()}"` })
    if (remove.status !== 412) throw failure('校验条件删除', '服务端不支持删除时的版本保护，未迁移用户对象')
  } finally {
    if (probeCreated && probeVersion) {
      try { await request(probeKey, 'DELETE', { 'If-Match': probeVersion }) } catch { /* An orphan probe contains no user data. */ }
    }
  }
  for (const file of identity.files) {
    const targetKey = keyOf(target, identity, file.path)
    const existing = await read(targetKey)
    if (existing) {
      if (!file.copyStarted) throw failure('校验目标路径', '目标已存在，未覆盖任何远端内容')
      const verified = await verifyTarget(file)
      if (!file.targetEtag) { file.targetEtag = verified.etag; await persist() }
      continue
    }
    if (file.targetEtag || file.deleted) throw failure('校验迁移结果', '已复制的目标对象不存在，源对象已保留')
    const remote = await read(keyOf(source, identity, file.path), file.etag)
    if (!remote || remote.digest !== file.digest) throw failure('校验源版本', '源对象已变化，未使用本地内容覆盖')
    file.copyStarted = true
    await persist()
    const headers: Record<string, string> = {
      'If-None-Match': '*', 'Content-Type': file.contentType, [marker]: identity.operationId,
    }
    // Keep remote object metadata and presentation headers when copying bytes.
    remote.headers.forEach((value, name) => {
      if ((name.startsWith('x-amz-meta-') && name !== marker)
        || ['cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires'].includes(name)) {
        headers[name] = value
      }
    })
    const copied = await request(targetKey, 'PUT', headers, remote.bytes, undefined, async () => {
      const destination = await recoverRemoteRead(() => read(targetKey))
      if (destination) {
        if (destination.digest !== file.digest || destination.headers.get(marker) !== identity.operationId) {
          throw failure('核对复制结果', '目标对象不属于本次迁移，源对象已保留')
        }
        return { state: 'applied', value: new Response(null, { status: 200, headers: destination.headers }) }
      }
      const unchanged = await recoverRemoteRead(() => read(keyOf(source, identity, file.path), file.etag))
      if (!unchanged || unchanged.digest !== file.digest) throw failure('核对源版本', '源对象已变化，待办已保留')
      return { state: 'unchanged' }
    })
    if (copied.status !== 200 && copied.status !== 204) {
      throw failure('创建目标对象', `请求被拒绝（HTTP ${copied.status}），源对象已保留`)
    }
    const verified = await verifyTarget(file)
    file.targetEtag = verified.etag
    await persist()
  }
  await verifyMembers()
  for (const file of identity.files) await verifyTarget(file)
  // Delete children before their directory markers. A failed request leaves
  // already copied objects intact and every remaining source version guarded.
  for (const file of [...identity.files].sort((a, b) => b.path.length - a.path.length)) {
    const sourceKey = keyOf(source, identity, file.path)
    const remote = await read(sourceKey, file.etag)
    if (!remote) {
      if (!file.copyStarted || !file.targetEtag) throw failure('校验源版本', '未复制的源对象不存在')
      await verifyTarget(file)
      if (!file.deleted) { file.deleted = true; await persist() }
      continue
    }
    if (file.deleted || remote.digest !== file.digest) throw failure('校验源版本', '源对象被重新创建，未删除新内容')
    await verifyTarget(file)
    await current()
    const deleted = await request(sourceKey, 'DELETE', { 'If-Match': file.etag }, undefined, undefined, async () => {
      const remaining = await recoverRemoteRead(() => read(sourceKey, file.etag))
      await recoverRemoteRead(() => verifyTarget(file))
      if (!remaining) return { state: 'applied', value: new Response(null, { status: 204 }) }
      if (remaining.digest !== file.digest) throw failure('核对源版本', '源对象已变化，待办已保留')
      return { state: 'unchanged' }
    })
    if (deleted.status !== 200 && deleted.status !== 204 && deleted.status !== 404) {
      throw failure('删除旧对象', `版本已变化或请求被拒绝（HTTP ${deleted.status}），待办已保留`)
    }
    file.deleted = true
    await persist()
  }
  if ((await kind(source)).type) throw failure('确认迁移结果', '源路径出现新的远端内容，未继续删除')
  await verifyMembers()
  for (const file of identity.files) await verifyTarget(file)
  return {
    status: 'moved', entry: identity,
    files: identity.files.filter(file => identity.type === 'file' || (file.path && !file.path.endsWith('/'))).map(file => ({
      path: file.path, sourceVersion: file.etag, targetVersion: file.targetEtag!,
      sourceHash: file.digest, targetHash: file.digest,
    })),
  }
}
