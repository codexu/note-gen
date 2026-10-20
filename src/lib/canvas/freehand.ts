import { getStroke } from 'perfect-freehand'
import type { CanvasPoint } from '@/types/canvas'

export interface FreehandStyle {
  size: number
  thinning: number
  smoothing: number
  streamline: number
  simulatePressure: boolean
}

export const PEN_STYLE: FreehandStyle = {
  size: 4,
  thinning: 0.45,
  smoothing: 0.6,
  streamline: 0.5,
  simulatePressure: true,
}

export const HIGHLIGHTER_STYLE: FreehandStyle = {
  size: 18,
  thinning: 0,
  smoothing: 0.7,
  streamline: 0.6,
  simulatePressure: true,
}

export function getFreehandOutline(points: CanvasPoint[], style: FreehandStyle) {
  return getStroke(
    points.map(point => [point.x, point.y, point.pressure] as [number, number, number]),
    style
  )
}

export function getSvgPathFromStroke(points: number[][]) {
  if (points.length === 0) return ''

  const average = (left: number[], right: number[]) => [
    (left[0] + right[0]) / 2,
    (left[1] + right[1]) / 2,
  ]
  const first = points[0]
  let path = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} Q`

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = average(current, points[index + 1])
    path += ` ${current[0].toFixed(2)} ${current[1].toFixed(2)} ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
  }

  path += ' Z'
  return path
}

export function createFreehandGeometry(points: CanvasPoint[], style: FreehandStyle) {
  const outline = getFreehandOutline(points, style)
  if (outline.length === 0) return null

  const xs = outline.map(point => point[0])
  const ys = outline.map(point => point[1])
  const padding = 2
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  const maxX = Math.max(...xs) + padding
  const maxY = Math.max(...ys) + padding
  const localized = outline.map(point => [point[0] - minX, point[1] - minY])

  return {
    x: minX,
    y: minY,
    width: Math.max(4, maxX - minX),
    height: Math.max(4, maxY - minY),
    path: getSvgPathFromStroke(localized),
  }
}
