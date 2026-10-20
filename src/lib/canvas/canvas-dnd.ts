export const CANVAS_DRAG_MIME = 'application/x-notegen-canvas'

export function setCanvasDragData(dataTransfer: DataTransfer, canvasId: string) {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(CANVAS_DRAG_MIME, canvasId)
  dataTransfer.setData('text/plain', `canvas://${canvasId}`)
}

export function getCanvasDragId(dataTransfer: DataTransfer) {
  const explicitId = dataTransfer.getData(CANVAS_DRAG_MIME)
  if (explicitId) return explicitId
  const plainText = dataTransfer.getData('text/plain')
  return plainText.startsWith('canvas://') ? plainText.slice('canvas://'.length) : ''
}

export function hasCanvasDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(CANVAS_DRAG_MIME) || Boolean(getCanvasDragId(dataTransfer))
}
