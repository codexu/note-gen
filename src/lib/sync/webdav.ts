import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { WebDAVConfig } from '@/types/sync'

/**
 * WebDAV 同步核心模块
 * 支持群晖、QNAP、Nextcloud 等 WebDAV 协议存储
 */

// 调试模式
const DEBUG = true

/**
 * 构建 Basic Auth 头
 */
function buildAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

/**
 * 构建 WebDAV URL
 */
function buildWebDAVUrl(config: WebDAVConfig, key: string): string {
  const baseUrl = config.url.replace(/\/$/, '')
  const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
  const fullKey = prefix ? `${prefix}/${key}` : key
  return `${baseUrl}/${fullKey}`
}

/**
 * 测试 WebDAV 连接
 */
export async function testWebDAVConnection(config: WebDAVConfig, proxy?: Proxy): Promise<boolean> {
  try {
    const baseUrl = config.url.replace(/\/$/, '')
    const response = await fetch(baseUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password),
        'Depth': '0'
      },
      proxy
    })

    if (DEBUG) {
      console.log('[WebDAV] Connection test response status:', response.status)
    }

    return response.status === 207  // 207 Multi-Status 表示成功
  } catch (error) {
    console.error('WebDAV connection test failed:', error)
    return false
  }
}

/**
 * 上传文件到 WebDAV
 */
export async function webdavUpload(
  config: WebDAVConfig,
  key: string,
  content: string,
  proxy?: Proxy
): Promise<{ etag: string } | null> {
  try {
    const url = buildWebDAVUrl(config, key)
    const contentBytes = new TextEncoder().encode(content)

    if (DEBUG) {
      console.log('[WebDAV] Uploading to:', url, 'size:', contentBytes.byteLength)
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password),
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Length': contentBytes.byteLength.toString()
      },
      body: contentBytes,
      proxy
    })

    if (response.status === 201 || response.status === 204) {
      const etag = response.headers.get('ETag') || ''
      if (DEBUG) {
        console.log('[WebDAV] Upload success, etag:', etag)
      }
      return { etag }
    } else {
      const errorText = await response.text()
      console.error('WebDAV Upload failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    console.error('WebDAV upload error:', error)
    return null
  }
}

/**
 * 从 WebDAV 下载文件
 */
export async function webdavDownload(
  config: WebDAVConfig,
  key: string,
  proxy?: Proxy
): Promise<{ content: string; etag: string; lastModified: string } | null> {
  try {
    const url = buildWebDAVUrl(config, key)

    if (DEBUG) {
      console.log('[WebDAV] Downloading from:', url)
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })

    if (response.status === 200) {
      const content = await response.text()
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      if (DEBUG) {
        console.log('[WebDAV] Download success, etag:', etag, 'lastModified:', lastModified)
      }

      return { content, etag, lastModified }
    } else if (response.status === 404) {
      return null
    } else {
      const errorText = await response.text()
      console.error('WebDAV Download failed:', response.status, errorText)
      return null
    }
  } catch (error) {
    console.error('WebDAV download error:', error)
    return null
  }
}

/**
 * 删除 WebDAV 文件
 */
export async function webdavDelete(config: WebDAVConfig, key: string, proxy?: Proxy): Promise<boolean> {
  try {
    const url = buildWebDAVUrl(config, key)

    if (DEBUG) {
      console.log('[WebDAV] Deleting:', url)
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })

    const success = response.status === 204 || response.status === 200
    if (DEBUG) {
      console.log('[WebDAV] Delete result:', success)
    }

    return success
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
  try {
    const url = buildWebDAVUrl(config, key)

    if (DEBUG) {
      console.log('[WebDAV] Head object:', url)
    }

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })

    if (response.status === 200) {
      const etag = response.headers.get('ETag') || ''
      const lastModified = response.headers.get('Last-Modified') || ''

      if (DEBUG) {
        console.log('[WebDAV] Head object success, etag:', etag, 'lastModified:', lastModified)
      }

      return { etag, lastModified }
    } else if (response.status === 404) {
      return null
    } else {
      const errorText = await response.text()
      console.error('WebDAV HeadObject failed:', response.status, errorText)
      return null
    }
  } catch (error) {
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
  try {
    const baseUrl = config.url.replace(/\/$/, '')
    const pathPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const fullPrefix = pathPrefix ? `${pathPrefix}/${prefix}` : prefix

    if (DEBUG) {
      console.log('[WebDAV] Listing objects from:', `${baseUrl}/${fullPrefix}`)
    }

    const response = await fetch(`${baseUrl}/${fullPrefix}`, {
      method: 'PROPFIND',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password),
        'Depth': '1'
      },
      proxy
    })

    if (response.status === 207) {
      const text = await response.text()
      return parsePropfindResponse(text, pathPrefix)
    } else {
      const errorText = await response.text()
      console.error('WebDAV ListObjects failed:', response.status, errorText)
      return []
    }
  } catch (error) {
    console.error('WebDAV list error:', error)
    return []
  }
}

/**
 * 解析 PROPFIND 响应 XML
 */
function parsePropfindResponse(
  xml: string,
  prefix: string
): Array<{ key: string; etag: string; lastModified: string; size: number }> {
  const results: Array<{ key: string; etag: string; lastModified: string; size: number }> = []

  try {
    // 使用正则解析 XML 响应
    // 提取所有 response 元素
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g
    let match

    while ((match = responseRegex.exec(xml)) !== null) {
      const responseContent = match[1]

      // 提取 href
      const hrefMatch = /<d:href>([^<]+)<\/d:href>/.exec(responseContent)
      // 提取 getetag
      const etagMatch = /<d:getetag>([^<]+)<\/d:getetag>/.exec(responseContent)
      // 提取 getlastmodified
      const lastModMatch = /<d:getlastmodified>([^<]+)<\/d:getlastmodified>/.exec(responseContent)
      // 提取 getcontentlength
      const sizeMatch = /<d:getcontentlength>([^<]+)<\/d:getcontentlength>/.exec(responseContent)

      if (hrefMatch) {
        let href = hrefMatch[1]

        // 跳过根目录本身
        if (href === `/${prefix}/` || href === `/${prefix}` || href.endsWith('/')) {
          // 这是一个目录，跳过文件列表中的目录
          continue
        }

        // 移除前缀，还原相对路径
        if (prefix && href.startsWith(`/${prefix}/`)) {
          href = href.substring(`/${prefix}/`.length)
        } else if (prefix && href.startsWith(`/${prefix}`)) {
          href = href.substring(`/${prefix}`.length)
        }

        // 移除开头的斜杠
        href = href.replace(/^\/+/, '')

        results.push({
          key: href,
          etag: etagMatch ? etagMatch[1].replace(/"/g, '') : '',
          lastModified: lastModMatch ? lastModMatch[1] : '',
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0
        })
      }
    }
  } catch (error) {
    console.error('Error parsing PROPFIND response:', error)
  }

  if (DEBUG) {
    console.log('[WebDAV] Parsed files:', results)
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
    const baseUrl = config.url.replace(/\/$/, '')
    const pathPrefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
    const fullPath = pathPrefix ? `${pathPrefix}/${path}` : path

    if (DEBUG) {
      console.log('[WebDAV] Creating directory:', `${baseUrl}/${fullPath}`)
    }

    const response = await fetch(`${baseUrl}/${fullPath}`, {
      method: 'MKCOL',
      headers: {
        'Authorization': buildAuthHeader(config.username, config.password)
      },
      proxy
    })

    // 201 表示创建成功，405 表示已存在
    const success = response.status === 201 || response.status === 405

    if (DEBUG) {
      console.log('[WebDAV] MKCOL result:', success, 'status:', response.status)
    }

    return success
  } catch (error) {
    console.error('WebDAV mkcol error:', error)
    return false
  }
}
