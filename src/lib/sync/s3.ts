import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { S3Config } from '@/types/sync'
import { buildRepoContentPath, debugSyncPath, debugSyncPerf } from './remote-file'

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
  const encodedFullKey = buildRepoContentPath({ path: fullKey })
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

/**
 * 测试 S3 连接
 */
export async function testS3Connection(config: S3Config, proxy?: Proxy): Promise<boolean> {
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
  contentType = 'text/markdown; charset=utf-8'
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
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    logPerf('encodeContent', {
      byteLength: contentBytes.byteLength,
    })

    const headers = {
      Host: new URL(url).host,
      'Content-Type': contentType,
      'Content-Length': contentBytes.byteLength.toString()
    }

    const { authorization, amzDate, payloadHashHex } = await generateSignature(
      'PUT',
      url,
      headers,
      contentBytes,
      config
    )
    logPerf('generateSignature')

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('Content-Type', contentType)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: contentBytes,
      proxy
    })
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
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 Download failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 Download error:', error)
    return null
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
export async function s3Delete(config: S3Config, key: string, proxy?: Proxy): Promise<boolean> {
  try {
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

    const { authorization, amzDate } = await generateSignature('DELETE', url, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: requestHeaders,
      proxy
    })

    // 204 No Content 或 200 OK 都表示删除成功
    return response.status === 204 || response.status === 200
  } catch (error) {
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
      const errorText = await response.text()
      logPerf('completed', {
        success: false,
        status: response.status,
        bodyLength: errorText.length,
      })
      console.error('S3 HeadObject failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    logPerf('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('S3 HeadObject error:', error)
    return null
  }
}
