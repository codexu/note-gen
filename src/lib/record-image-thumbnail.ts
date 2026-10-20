import { BaseDirectory, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'

const THUMBNAIL_DIR = 'thumbnail/records'
const DEFAULT_THUMBNAIL_MAX_SIZE = 360
const THUMBNAIL_QUALITY = 0.78
const RESOLVED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i
const RECORD_IMAGE_PATH_RE = /^(?:image|screenshot)\//

const thumbnailPromises = new Map<string, Promise<string | null>>()
let thumbnailGenerationTail = Promise.resolve()

function scheduleThumbnailGeneration(task: () => Promise<string | null>) {
  const scheduledTask = thumbnailGenerationTail.then(task)
  thumbnailGenerationTail = scheduledTask.then(
    () => undefined,
    () => undefined
  )
  return scheduledTask
}

function normalizeRecordImagePath(src: string) {
  const path = src.trim().replace(/^\/+/, '')

  if (!path || RESOLVED_IMAGE_SRC_RE.test(path) || !RECORD_IMAGE_PATH_RE.test(path)) {
    return null
  }

  return path
}

function getMimeType(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function hashPath(path: string) {
  let hash = 2166136261

  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function getSafeBaseName(path: string) {
  const filename = path.split('/').pop() ?? 'image'
  const baseName = filename.replace(/\.[^.]+$/, '') || 'image'

  return baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)
}

function getThumbnailPath(path: string, maxSize: number, extension: 'webp' | 'png') {
  return `${THUMBNAIL_DIR}/${getSafeBaseName(path)}-${hashPath(path)}-${maxSize}.${extension}`
}

async function findExistingThumbnailPath(imagePath: string, maxSize: number) {
  const webpPath = getThumbnailPath(imagePath, maxSize, 'webp')
  if (await exists(webpPath, { baseDir: BaseDirectory.AppData })) {
    return `/${webpPath}`
  }

  const pngPath = getThumbnailPath(imagePath, maxSize, 'png')
  if (await exists(pngPath, { baseDir: BaseDirectory.AppData })) {
    return `/${pngPath}`
  }

  return null
}

async function ensureThumbnailDir() {
  if (await exists(THUMBNAIL_DIR, { baseDir: BaseDirectory.AppData })) {
    return
  }

  await mkdir(THUMBNAIL_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
}

async function loadImage(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob)
  const image = new window.Image()
  image.decoding = 'async'
  image.src = objectUrl

  try {
    if (image.decode) {
      await image.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Image decode failed'))
      })
    }

    return { image, objectUrl }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

function getThumbnailDimensions(image: HTMLImageElement, maxSize: number) {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const ratio = Math.min(1, maxSize / Math.max(width, height))

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

async function createThumbnailBlob(image: HTMLImageElement, maxSize: number) {
  const canvas = document.createElement('canvas')
  const dimensions = getThumbnailDimensions(image, maxSize)
  canvas.width = dimensions.width
  canvas.height = dimensions.height

  const context = canvas.getContext('2d', { alpha: true })
  if (!context) {
    return null
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height)

  const webpBlob = await canvasToBlob(canvas, 'image/webp', THUMBNAIL_QUALITY)
  if (webpBlob) {
    return { blob: webpBlob, extension: 'webp' as const }
  }

  const pngBlob = await canvasToBlob(canvas, 'image/png')
  return pngBlob ? { blob: pngBlob, extension: 'png' as const } : null
}

async function generateRecordImageThumbnail(imagePath: string, maxSize: number) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const existingThumbnailPath = await findExistingThumbnailPath(imagePath, maxSize)
  if (existingThumbnailPath) {
    return existingThumbnailPath
  }

  await ensureThumbnailDir()

  const bytes = await readFile(imagePath, { baseDir: BaseDirectory.AppData })
  const blob = new Blob([bytes], { type: getMimeType(imagePath) })
  const { image, objectUrl } = await loadImage(blob)

  try {
    const thumbnail = await createThumbnailBlob(image, maxSize)
    if (!thumbnail) {
      return null
    }

    const thumbnailPath = getThumbnailPath(imagePath, maxSize, thumbnail.extension)
    const arrayBuffer = await thumbnail.blob.arrayBuffer()
    await writeFile(thumbnailPath, new Uint8Array(arrayBuffer), { baseDir: BaseDirectory.AppData })

    return `/${thumbnailPath}`
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function getCachedRecordImageThumbnailPath(src: string, maxSize = DEFAULT_THUMBNAIL_MAX_SIZE) {
  const imagePath = normalizeRecordImagePath(src)
  if (!imagePath) {
    return null
  }

  const preferredThumbnail = await findExistingThumbnailPath(imagePath, maxSize)
  if (preferredThumbnail || maxSize === DEFAULT_THUMBNAIL_MAX_SIZE) {
    return preferredThumbnail
  }

  return findExistingThumbnailPath(imagePath, DEFAULT_THUMBNAIL_MAX_SIZE)
}

export async function getRecordImageThumbnailPath(src: string, maxSize = DEFAULT_THUMBNAIL_MAX_SIZE) {
  const imagePath = normalizeRecordImagePath(src)
  if (!imagePath) {
    return null
  }

  const cacheKey = `${imagePath}:${maxSize}`
  const cachedPromise = thumbnailPromises.get(cacheKey)
  if (cachedPromise) {
    return cachedPromise
  }

  const thumbnailPromise = scheduleThumbnailGeneration(() => generateRecordImageThumbnail(imagePath, maxSize))
    .catch(() => null)

  thumbnailPromises.set(cacheKey, thumbnailPromise)

  const thumbnailPath = await thumbnailPromise
  if (!thumbnailPath) {
    thumbnailPromises.delete(cacheKey)
  }

  return thumbnailPath
}
