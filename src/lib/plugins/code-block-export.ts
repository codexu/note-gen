import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { checkIsTauri } from '@/lib/check'

export type CodeBlockImageFormat = 'png' | 'svg' | 'jpeg'

const RASTER_EXPORT_SCALE = 3
const MAX_EXPORT_DIMENSION = 8192
const MAX_EXPORT_PIXELS = 16_777_216

// Export only the host-normalized preview image. No plugin code or editor DOM
// participates, so the file includes the entire diagram without its toolbar.
export async function exportCodeBlockImage(dataUrl: string, language: string, title: string, format: CodeBlockImageFormat = 'png'): Promise<boolean> {
  const svgPrefix = 'data:image/svg+xml;charset=utf-8,'
  const pngPrefix = 'data:image/png;base64,'
  let blob: Blob
  if (format === 'svg') {
    if (!dataUrl.startsWith(svgPrefix)) throw new Error('This preview does not contain vector SVG data')
    blob = new Blob([decodeURIComponent(dataUrl.slice(svgPrefix.length))], { type: 'image/svg+xml' })
  } else if (format === 'png' && dataUrl.startsWith(pngPrefix)) {
    const binary = atob(dataUrl.slice(pngPrefix.length))
    blob = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/png' })
  } else if (dataUrl.startsWith(svgPrefix) || dataUrl.startsWith(pngPrefix)) {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height || width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION || width * height > MAX_EXPORT_PIXELS) throw new Error('Invalid image dimensions')
    // Rasterize vector previews at higher resolution. Scaling bitmap input
    // cannot recover detail, so PNG sources retain their native dimensions.
    const scale = dataUrl.startsWith(svgPrefix) ? Math.min(
      RASTER_EXPORT_SCALE,
      MAX_EXPORT_DIMENSION / width,
      MAX_EXPORT_DIMENSION / height,
      Math.sqrt(MAX_EXPORT_PIXELS / (width * height)),
    ) : 1
    const exportWidth = Math.max(1, Math.floor(width * scale))
    const exportHeight = Math.max(1, Math.floor(height * scale))
    const canvas = document.createElement('canvas')
    try {
      canvas.width = exportWidth
      canvas.height = exportHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Unable to create image canvas')
      // JPEG has no alpha channel. Composite transparent diagrams onto white.
      if (format === 'jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, exportWidth, exportHeight)
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, exportWidth, exportHeight)
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => result?.type === mimeType ? resolve(result) : reject(new Error('Unable to encode image')), mimeType, 1)
      })
    } finally {
      canvas.width = 0
      canvas.height = 0
      image.src = ''
    }
  } else {
    throw new Error('Unsupported preview image')
  }
  const extension = format === 'jpeg' ? 'jpg' : format
  const extensions = format === 'jpeg' ? ['jpg', 'jpeg'] : [extension]
  const baseName = language.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64) || 'diagram'
  const filename = `${baseName}-${Date.now()}.${extension}`
  if (checkIsTauri()) {
    const path = await save({ title, defaultPath: filename, filters: [{ name: format.toUpperCase(), extensions }] })
    if (!path) return false
    const hasExtension = extensions.some(value => path.toLowerCase().endsWith(`.${value}`))
    await writeFile(hasExtension ? path : `${path}.${extension}`, new Uint8Array(await blob.arrayBuffer()))
  } else {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return true
}
