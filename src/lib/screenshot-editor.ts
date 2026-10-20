export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

export type Tool = 'select' | 'rectangle' | 'ellipse' | 'arrow' | 'pen' | 'text' | 'mosaic'

export interface Annotation {
  id: string
  tool: Exclude<Tool, 'select'>
  points: Point[]
  color: string
  width: number
  text?: string
}

export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function clampPoint(point: Point, bounds: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(bounds.width, point.x)),
    y: Math.max(0, Math.min(bounds.height, point.y)),
  }
}

function pixelate(context: CanvasRenderingContext2D, rect: Rect, width: number) {
  if (rect.width <= 0 || rect.height <= 0) return

  // Sample the rendered image, including preceding annotations, in backing pixels.
  const transform = context.getTransform()
  const origin = transform.transformPoint(rect)
  const end = transform.transformPoint({ x: rect.x + rect.width, y: rect.y + rect.height })
  const left = Math.max(0, Math.floor(origin.x))
  const top = Math.max(0, Math.floor(origin.y))
  const right = Math.min(context.canvas.width, Math.ceil(end.x))
  const bottom = Math.min(context.canvas.height, Math.ceil(end.y))
  if (right <= left || bottom <= top) return

  const blockSize = Math.max(10, width * 6)
  const sample = document.createElement('canvas')
  sample.width = Math.max(1, Math.ceil(rect.width / blockSize))
  sample.height = Math.max(1, Math.ceil(rect.height / blockSize))
  const sampleContext = sample.getContext('2d')
  if (!sampleContext) throw new Error('Canvas is unavailable')
  sampleContext.drawImage(context.canvas, left, top, right - left, bottom - top, 0, 0, sample.width, sample.height)
  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()
  context.imageSmoothingEnabled = false
  context.drawImage(sample, rect.x, rect.y, rect.width, rect.height)
  context.restore()
  sample.width = 0
  sample.height = 0
}

export function drawAnnotations(context: CanvasRenderingContext2D, annotations: readonly Annotation[]) {
  for (const annotation of annotations) {
    const start = annotation.points[0]
    const end = annotation.points[annotation.points.length - 1]
    if (!start || !end) continue

    const rect = rectFromPoints(start, end)
    if (annotation.tool === 'mosaic') {
      pixelate(context, rect, annotation.width)
      continue
    }

    context.save()
    context.strokeStyle = annotation.color
    context.fillStyle = annotation.color
    context.lineWidth = annotation.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()

    switch (annotation.tool) {
      case 'rectangle':
        context.strokeRect(rect.x, rect.y, rect.width, rect.height)
        break
      case 'ellipse':
        context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2)
        context.stroke()
        break
      case 'arrow': {
        context.moveTo(start.x, start.y)
        context.lineTo(end.x, end.y)
        context.stroke()
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const head = Math.max(10, annotation.width * 4)
        context.beginPath()
        context.moveTo(end.x, end.y)
        context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
        context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
        context.closePath()
        context.fill()
        break
      }
      case 'pen':
        context.moveTo(start.x, start.y)
        if (annotation.points.length === 1) {
          context.arc(start.x, start.y, annotation.width / 2, 0, Math.PI * 2)
          context.fill()
        } else {
          for (const point of annotation.points.slice(1)) context.lineTo(point.x, point.y)
          context.stroke()
        }
        break
      case 'text': {
        const fontSize = Math.max(14, annotation.width * 6)
        context.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
        context.textBaseline = 'top'
        for (const [index, line] of (annotation.text || '').split('\n').entries()) {
          context.fillText(line, start.x, start.y + index * fontSize * 1.35)
        }
        break
      }
    }
    context.restore()
  }
}

export function drawScreenshot(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewport: { width: number; height: number },
  annotations: readonly Annotation[],
) {
  context.clearRect(0, 0, viewport.width, viewport.height)
  context.drawImage(image, 0, 0, viewport.width, viewport.height)
  drawAnnotations(context, annotations)
}

export async function exportScreenshot(
  image: HTMLImageElement,
  viewport: { width: number; height: number },
  selection: Rect,
  annotations: readonly Annotation[],
): Promise<Uint8Array> {
  if (viewport.width <= 0 || viewport.height <= 0 || !image.naturalWidth || !image.naturalHeight) {
    throw new Error('Screenshot is not ready')
  }
  const scaleX = image.naturalWidth / viewport.width
  const scaleY = image.naturalHeight / viewport.height
  const left = Math.max(0, Math.round(selection.x * scaleX))
  const top = Math.max(0, Math.round(selection.y * scaleY))
  const right = Math.min(image.naturalWidth, Math.round((selection.x + selection.width) * scaleX))
  const bottom = Math.min(image.naturalHeight, Math.round((selection.y + selection.height) * scaleY))
  if (right <= left || bottom <= top) throw new Error('No screenshot area selected')

  // Render at the original capture resolution; CSS/DPI scaling never shrinks output.
  const full = document.createElement('canvas')
  const cropped = document.createElement('canvas')
  try {
    full.width = image.naturalWidth
    full.height = image.naturalHeight
    const context = full.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.scale(scaleX, scaleY)
    drawScreenshot(context, image, viewport, annotations)

    cropped.width = right - left
    cropped.height = bottom - top
    const croppedContext = cropped.getContext('2d')
    if (!croppedContext) throw new Error('Canvas is unavailable')
    croppedContext.drawImage(full, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      cropped.toBlob(value => value ? resolve(value) : reject(new Error('Unable to export screenshot')), 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    full.width = 0
    full.height = 0
    cropped.width = 0
    cropped.height = 0
  }
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}
