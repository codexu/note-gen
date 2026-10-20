import type { CanvasProject } from '@/types/canvas'

export const CANVAS_TAB_PREFIX = 'canvas://project/'

export interface CanvasTabInfo {
  id: string
  path: string
  name: string
  isFolder: false
  kind: 'canvas'
  canvasId: string
}

export function getCanvasTabPath(canvasId: string) {
  return `${CANVAS_TAB_PREFIX}${canvasId}`
}

export function getCanvasIdFromTabPath(path: string) {
  if (!path.startsWith(CANVAS_TAB_PREFIX)) {
    return null
  }
  const id = path.slice(CANVAS_TAB_PREFIX.length)
  return id || null
}

export function isCanvasTabPath(path: string) {
  return getCanvasIdFromTabPath(path) !== null
}

export function createCanvasTab(project: Pick<CanvasProject, 'id' | 'title'>): CanvasTabInfo {
  const path = getCanvasTabPath(project.id)
  return {
    id: path,
    path,
    name: project.title,
    isFolder: false,
    kind: 'canvas',
    canvasId: project.id,
  }
}
