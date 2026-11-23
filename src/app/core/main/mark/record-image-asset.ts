import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { getMarkLocalAssetPath, type Mark } from '@/db/marks'
import { getRecordImageThumbnailPath } from '@/lib/record-image-thumbnail'
import { RECORD_INLINE_IMAGE_EXTENSIONS } from '@/lib/record-inline-images'
import { isHttpUrl } from '@/lib/utils'
import { isImageRecord } from './image-record-status'
import { commitRecordImageAsset, readRecordAfterPendingWrites } from './use-record-detail-save'

const appData = { baseDir: BaseDirectory.AppData }
const EDITED_IMAGE_PREFIX = 'edited-'

export function getRecordImageSrc(mark: Pick<Mark, 'type' | 'url'>): string | null {
  const url = mark.url?.trim()
  if (!isImageRecord(mark) || !url) return null
  if (isHttpUrl(url)) return url

  const path = getMarkLocalAssetPath({ type: mark.type, url })
  return path ? `/${path}` : null
}

export function isEditedRecordImage(mark: Pick<Mark, 'type' | 'url'>) {
  return isImageRecord(mark) && Boolean(mark.url?.startsWith(EDITED_IMAGE_PREFIX))
}

function getImageMimeType(path: string) {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  switch (extension) {
  case 'jfif':
  case 'jpg': return 'image/jpeg'
  case 'ico': return 'image/x-icon'
  case 'svg': return 'image/svg+xml'
  case 'tif': return 'image/tiff'
  default:
    return RECORD_INLINE_IMAGE_EXTENSIONS.some(candidate => candidate === extension)
      ? `image/${extension}`
      : undefined
  }
}

export async function loadRecordImage(mark: Mark): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (!isImageRecord(mark) || !mark.url) throw new Error('Record image is unavailable')

  const url = mark.url.trim()
  if (isHttpUrl(url)) {
    const response = await httpFetch(url)
    if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`)

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const mimeType = contentType?.startsWith('image/') ? contentType : getImageMimeType(new URL(url).pathname)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength) throw new Error('Record image is empty')
    return { bytes, mimeType }
  }

  const path = getMarkLocalAssetPath({ type: mark.type, url })
  if (!path) throw new Error('Record image path is unavailable')
  const bytes = await readFile(path, appData)
  if (!bytes.byteLength) throw new Error('Record image is empty')
  return { bytes, mimeType: getImageMimeType(path) }
}

async function removeUncommittedImage(path: string, thumbnail: string | null) {
  for (const asset of [path, thumbnail?.replace(/^\//, '')]) {
    if (!asset) continue
    try {
      if (await exists(asset, appData)) await remove(asset, appData)
    } catch (error) {
      console.error('Could not remove an uncommitted record image asset:', asset, error)
    }
  }
}

export async function saveEditedRecordImage(original: Mark, bytes: Uint8Array): Promise<Mark | null> {
  if (!isImageRecord(original) || original.deleted || !original.url) return null
  if (!bytes.byteLength) throw new Error('Edited record image is empty')

  const directory = original.type === 'scan' ? 'screenshot' : 'image'
  const filename = `${EDITED_IMAGE_PREFIX}${crypto.randomUUID()}.png`
  const path = `${directory}/${filename}`
  let thumbnail: string | null = null

  try {
    await mkdir(directory, { ...appData, recursive: true })
    await writeFile(path, bytes, appData)
    thumbnail = await getRecordImageThumbnailPath(path, 96)
  } catch (error) {
    await removeUncommittedImage(path, thumbnail)
    throw error
  }

  let saved: Mark | null
  try {
    saved = await commitRecordImageAsset(original, filename)
  } catch (error) {
    // A failed response can follow a committed write. Keep the staged file if the outcome is uncertain.
    const current = await readRecordAfterPendingWrites(original.id).catch(() => null)
    if (current?.url === filename) return current

    console.error('Unconfirmed record image update; retaining the staged file:', path, error)
    throw error
  }

  if (!saved) await removeUncommittedImage(path, thumbnail)
  return saved
}
