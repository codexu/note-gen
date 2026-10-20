import { BaseDirectory, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { assertPublicWebUrl } from './service'
import type { WebCaptureResult } from './types'

const LINK_ASSET_DIRECTORY = 'link-assets'
const MAX_IMAGE_COUNT = 30
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const MIN_IMAGE_BYTES = 256
const IMAGE_TIMEOUT_MS = 15_000
const DOWNLOAD_CONCURRENCY = 3
const MAX_REDIRECTS = 5

const IMAGE_TYPES: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface LocalizedCaptureImages {
  contentMarkdown: string
  savedPaths: string[]
  downloadedCount: number
  failedCount: number
}

export interface CachedRecordImage {
  bytes: Uint8Array
  extension: string
  filename: string
  imagePath: string
}

interface DownloadedImage {
  bytes: Uint8Array
  extension: string
}

function normalizeContentType(value: string) {
  return value.split(';')[0]?.trim().toLowerCase() || ''
}

function sniffImageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return 'image/jpeg'

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png'

  const firstFour = new TextDecoder('latin1').decode(bytes.subarray(0, 4))
  if (firstFour === 'GIF8') return 'image/gif'
  if (
    bytes.length >= 12
    && firstFour === 'RIFF'
    && new TextDecoder('latin1').decode(bytes.subarray(8, 12)) === 'WEBP'
  ) return 'image/webp'
  if (
    bytes.length >= 12
    && new TextDecoder('latin1').decode(bytes.subarray(4, 12)).includes('ftypavif')
  ) return 'image/avif'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  return null
}

async function readImageBytes(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the per-file size limit')
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds the per-file size limit')
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new Error('Image exceeds the per-file size limit')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function downloadImage(sourceUrl: string, referer: string): Promise<DownloadedImage> {
  let url = assertPublicWebUrl(sourceUrl)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await httpFetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp;q=0.9,*/*;q=0.1',
          Referer: referer,
        },
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Image redirected without a location')
        url = assertPublicWebUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`)

      const bytes = await readImageBytes(response)
      if (bytes.byteLength < MIN_IMAGE_BYTES) throw new Error('Image is too small')

      const declaredType = normalizeContentType(response.headers.get('content-type') || '')
      const sniffedType = sniffImageType(bytes)
      const imageType = sniffedType || (IMAGE_TYPES[declaredType] ? declaredType : '')
      const extension = IMAGE_TYPES[imageType]
      if (!extension) throw new Error('Response is not a supported image')

      return { bytes, extension }
    }
    throw new Error('Image exceeded the redirect limit')
  } finally {
    window.clearTimeout(timeout)
  }
}

function assertAssetGroupId(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error('Invalid link asset group')
  }
  return value
}

export async function removeLinkAssetGroup(assetGroupId: string) {
  const groupId = assertAssetGroupId(assetGroupId)
  try {
    await remove(`${LINK_ASSET_DIRECTORY}/${groupId}`, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    })
  } catch {
    // The directory may not have been created if every image download failed.
  }
}

export async function cacheCapturedRecordImage(
  sourceUrl: string,
  referer: string,
  recordId: string
): Promise<CachedRecordImage> {
  const safeRecordId = assertAssetGroupId(recordId)
  const image = await downloadImage(sourceUrl, referer)
  const filename = `${safeRecordId}.${image.extension}`
  const imagePath = `image/${filename}`
  await mkdir('image', { baseDir: BaseDirectory.AppData, recursive: true })
  await writeFile(imagePath, image.bytes, { baseDir: BaseDirectory.AppData })
  return {
    ...image,
    filename,
    imagePath,
  }
}

export async function localizeCapturedImages(
  result: WebCaptureResult,
  assetGroupId: string
): Promise<LocalizedCaptureImages> {
  const groupId = assertAssetGroupId(assetGroupId)
  const sources = (result.imageUrls || []).slice(0, MAX_IMAGE_COUNT)
  if (!result.contentMarkdown || sources.length === 0) {
    return {
      contentMarkdown: result.contentMarkdown,
      savedPaths: [],
      downloadedCount: 0,
      failedCount: 0,
    }
  }

  const savedPaths: string[] = []
  const replacements = new Map<string, string>()
  let totalBytes = 0
  let nextIndex = 0
  let failedCount = Math.max(0, (result.imageUrls?.length || 0) - sources.length)

  await Promise.all(Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, sources.length) },
    async () => {
      while (nextIndex < sources.length) {
        const index = nextIndex
        nextIndex += 1
        const source = sources[index]

        try {
          const image = await downloadImage(source, result.finalUrl)
          if (totalBytes + image.bytes.byteLength > MAX_TOTAL_BYTES) {
            failedCount += 1
            continue
          }
          totalBytes += image.bytes.byteLength

          const localPath = `${LINK_ASSET_DIRECTORY}/${groupId}/${index + 1}.${image.extension}`
          await mkdir(`${LINK_ASSET_DIRECTORY}/${groupId}`, {
            baseDir: BaseDirectory.AppData,
            recursive: true,
          })
          await writeFile(localPath, image.bytes, { baseDir: BaseDirectory.AppData })
          savedPaths.push(localPath)
          replacements.set(source, localPath)
        } catch {
          failedCount += 1
        }
      }
    }
  ))

  let contentMarkdown = result.contentMarkdown
  for (const [source, localPath] of replacements) {
    contentMarkdown = contentMarkdown.split(source).join(localPath)
  }

  return {
    contentMarkdown,
    savedPaths,
    downloadedCount: savedPaths.length,
    failedCount,
  }
}
