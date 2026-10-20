import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import type { CanvasDocument } from '@/types/canvas'
import { canvasDocumentToPngFile } from './static-export'

export const CANVAS_THUMBNAIL_VERSION = 4

export async function generateCanvasThumbnail(canvasId: string, document: CanvasDocument) {
  const directory = await join(await appDataDir(), 'canvas-thumbnails')
  await mkdir(directory, { recursive: true })
  const fileName = `${canvasId}-v${CANVAS_THUMBNAIL_VERSION}.png`
  const path = await join(directory, fileName)
  const file = await canvasDocumentToPngFile(document, fileName, {
    maxDimension: 480,
    scale: 1,
  })
  await writeFile(path, new Uint8Array(await file.arrayBuffer()))
  return path
}

export async function removeCanvasThumbnail(path?: string | null) {
  if (!path || !await exists(path)) return
  await remove(path)
}
