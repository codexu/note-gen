import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { S3Config } from '@/types/sync'

/**
 * S3 同步核心模块
 * 支持阿里云 OSS、AWS S3、MinIO 等 S3 兼容服务
 */

// 调试模式
const DEBUG = true

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
  if (DEBUG) {
    console.log('[S3 Debug] Original pathname:', urlObj.pathname)
    console.log('[S3 Debug] Encoded pathname:', canonicalUri.split('/').map(encodeURIComponent).join('/'))
  }

  // AWS V4 签名要求查询字符串必须按字母顺序排列并正确编码
  const canonicalQuerystring = Array.from(urlObj.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

  if (DEBUG) {
    console.log('[S3 Debug] Canonical query string:', canonicalQuerystring)
  }

  // AWS V4 签名要求 Headers 的 Key 必须全部转为小写
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('')

  if (DEBUG) {
    console.log('[S3 Debug] Canonical headers:', canonicalHeaders)
  }

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

  if (DEBUG) {
    console.log('[S3 Debug] Canonical request:', canonicalRequest)
  }

  // 创建字符串以供签名
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  if (DEBUG) {
    console.log('[S3 Debug] Credential scope:', credentialScope)
  }

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  if (DEBUG) {
    console.log('[S3 Debug] String to sign:', stringToSign)
  }

  // 计算签名
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3')
  const signature = await hmacSha256Hex(signingKey, stringToSign)

  if (DEBUG) {
    console.log('[S3 Debug] Final signature:', signature)
  }

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

  if (DEBUG) {
    console.log('[S3 Debug] getSignatureKey - key:', key.substring(0, 4) + '***', 'dateStamp:', dateStamp, 'region:', regionName, 'service:', serviceName)
  }

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
  if (DEBUG) {
    console.log('[S3 Debug] kDate:', Array.from(new Uint8Array(kDate)).map(b => b.toString(16).padStart(2, '0')).join(''))
  }

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

  if (DEBUG) {
    console.log('[S3 Debug] Build URL - endpoint:', endpoint, 'bucket:', bucket, 'key:', key)
  }

  // 移除 endpoint 末尾的斜杠
  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

  // 处理 pathPrefix，移除末尾的斜杠以防止双斜杠问题
  const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
  const fullKey = prefix ? `${prefix}/${key}` : key

  if (DEBUG) {
    console.log('[S3 Debug] Build URL - prefix:', prefix, 'fullKey:', fullKey)
  }

  let url = ''

  // 针对阿里云 OSS、AWS S3 等支持 Virtual Hosted Style 的服务
  const isAliyun = cleanEndpoint.includes('aliyuncs.com')
  const isAWS = cleanEndpoint.includes('amazonaws.com')
  const isCloudflareR2 = cleanEndpoint.includes('cloudflarestorage.com')

  if (DEBUG) {
    console.log('[S3 Debug] isAliyun:', isAliyun, 'isAWS:', isAWS, 'isCloudflareR2:', isCloudflareR2)
  }

  // Cloudflare R2 需要使用 Path Style，不是 Virtual Hosted Style
  if (isCloudflareR2) {
    // 使用 Path Style: https://endpoint/bucket/key
    url = `${cleanEndpoint}/${bucket}/${fullKey}`
  } else if (isAliyun || isAWS) {
    // 使用 Virtual Hosted Style: https://bucket.endpoint/key
    try {
      const urlObj = new URL(cleanEndpoint)
      urlObj.hostname = `${bucket}.${urlObj.hostname}`
      url = `${urlObj.toString()}/${fullKey}`
      // 处理可能的双斜杠
      url = url.replace(/([^:]\/)\/+/g, '$1')
    } catch {
      console.warn('[S3 Sync] Failed to switch to Virtual Hosted Style, using Path Style')
      url = `${cleanEndpoint}/${bucket}/${fullKey}`
    }
  } else {
    // MinIO 等使用 Path Style
    url = `${cleanEndpoint}/${bucket}/${fullKey}`
  }

  if (DEBUG) {
    console.log('[S3 Debug] Build URL - final url:', url)
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

  // 针对阿里云 OSS、AWS S3 等支持 Virtual Hosted Style 的服务进行优化
  const isAliyun = cleanEndpoint.includes('aliyuncs.com')
  const isAWS = cleanEndpoint.includes('amazonaws.com')

  if (isAliyun || isAWS) {
    try {
      const urlObj = new URL(cleanEndpoint)
      urlObj.hostname = `${bucket}.${urlObj.hostname}`
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
  content: string,
  proxy?: Proxy
): Promise<{ etag: string } | null> {
  try {
    const url = buildS3Url(config, key)
    const contentBytes = new TextEncoder().encode(content)

    const headers = {
      Host: new URL(url).host,
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Length': contentBytes.byteLength.toString()
    }

    const { authorization, amzDate, payloadHashHex } = await generateSignature(
      'PUT',
      url,
      headers,
      contentBytes,
      config
    )

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('Content-Type', 'text/markdown; charset=utf-8')
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: contentBytes,
      proxy
    })

    if (response.status === 200 || response.status === 204) {
      // 获取 ETag
      const etag = response.headers.get('ETag') || ''
      return { etag }
    } else {
      const errorText = await response.text()
      console.error('S3 Upload failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    console.error('S3 Upload error:', error)
    return null
  }
}

/**
 * 从 S3 下载文件（类似拉取）
 */
export async function s3Download(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ content: string; etag: string; lastModified: string } | null> {
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

    const { authorization, amzDate } = await generateSignature('GET', url, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      proxy
    })

    if (response.status === 200) {
      const content = await response.text()
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      return { content, etag, lastModified }
    } else if (response.status === 404) {
      // 文件不存在
      return null
    } else {
      const errorText = await response.text()
      console.error('S3 Download failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    console.error('S3 Download error:', error)
    return null
  }
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
  try {
    const baseUrl = buildS3BaseUrl(config)

    // 处理 pathPrefix
    const configPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const fullPrefix = configPrefix ? `${configPrefix}/${prefix}` : prefix

    // 构建 ListObjectsV2 URL
    const listUrl = new URL(baseUrl)
    listUrl.searchParams.set('list-type', '2')
    listUrl.searchParams.set('prefix', fullPrefix)

    const urlStr = listUrl.toString()

    const emptyPayload = new ArrayBuffer(0)
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload)
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const headers: Record<string, string> = {
      Host: new URL(urlStr).host,
      'X-Amz-Content-Sha256': payloadHashHex
    }

    const { authorization, amzDate } = await generateSignature('GET', urlStr, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(urlStr, {
      method: 'GET',
      headers: requestHeaders,
      proxy
    })

    if (response.status === 200) {
      const xmlText = await response.text()
      console.log('[S3 FileList] ListObjects response:', xmlText.substring(0, 500))
      const result = parseListObjectsResponse(xmlText, configPrefix)
      console.log('[S3 FileList] Parsed files:', result)
      return result
    } else {
      const errorText = await response.text()
      console.error('S3 ListObjects failed:', response.status, errorText)
      return []
    }
  } catch (error) {
    console.error('S3 ListObjects error:', error)
    return []
  }
}

/**
 * 解析 ListObjectsV2 响应 XML
 */
function parseListObjectsResponse(
  xml: string,
  prefix: string
): Array<{ key: string; etag: string; lastModified: string; size: number }> {
  const results: Array<{ key: string; etag: string; lastModified: string; size: number }> = []

  // 提取所有 Contents 节点
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
  let match

  while ((match = contentsRegex.exec(xml)) !== null) {
    const content = match[1]

    // 提取 Key
    const keyMatch = /<Key>(.*?)<\/Key>/.exec(content)
    // 提取 ETag
    const etagMatch = /<ETag>(.*?)<\/ETag>/.exec(content)
    // 提取 LastModified
    const lastModifiedMatch = /<LastModified>(.*?)<\/LastModified>/.exec(content)
    // 提取 Size
    const sizeMatch = /<Size>(.*?)<\/Size>/.exec(content)

    if (keyMatch) {
      let key = keyMatch[1]

      // 移除 prefix 前缀，还原相对路径
      if (prefix && key.startsWith(prefix + '/')) {
        key = key.substring(prefix.length + 1)
      }

      results.push({
        key,
        etag: etagMatch ? etagMatch[1].replace(/"/g, '') : '',
        lastModified: lastModifiedMatch ? lastModifiedMatch[1] : '',
        size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0
      })
    }
  }

  return results
}

/**
 * 获取文件信息
 */
export async function s3HeadObject(
  config: S3Config,
  key: string,
  proxy?: Proxy
): Promise<{ etag: string; lastModified: string } | null> {
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

    const { authorization, amzDate } = await generateSignature('HEAD', url, headers, emptyPayload, config)

    const requestHeaders = new Headers()
    requestHeaders.append('Authorization', authorization)
    requestHeaders.append('X-Amz-Date', amzDate)
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: requestHeaders,
      proxy
    })

    if (response.status === 200) {
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      return { etag, lastModified }
    } else if (response.status === 404) {
      // 文件不存在
      return null
    } else {
      const errorText = await response.text()
      console.error('S3 HeadObject failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    console.error('S3 HeadObject error:', error)
    return null
  }
}
