export type OutlinePosition = 'left' | 'right'

export const DEFAULT_OUTLINE_POSITION: OutlinePosition = 'right'
export const OUTLINE_WIDTH_STORE_KEY = 'outlineWidth'
export const OUTLINE_OPEN_FILE_STORE_PREFIX = 'outlineOpenByFile'
export const DEFAULT_OUTLINE_WIDTH = 256
export const MIN_OUTLINE_WIDTH = 220
export const MAX_OUTLINE_WIDTH = 480
export const OUTLINE_CONTENT_GAP = 16

export function getFileOutlineOpenStoreKey(workspacePath: string, filePath: string) {
  const workspaceKey = workspacePath || 'default'
  return `${OUTLINE_OPEN_FILE_STORE_PREFIX}:${encodeURIComponent(workspaceKey)}:${encodeURIComponent(filePath)}`
}

export function normalizeOutlinePosition(value: unknown): OutlinePosition {
  return value === 'left' ? 'left' : DEFAULT_OUTLINE_POSITION
}

export function isOutlineOnLeft(position: OutlinePosition): boolean {
  return position === 'left'
}

export function normalizeOutlineWidth(value: unknown): number {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_OUTLINE_WIDTH
  }

  return Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, Math.round(numericValue)))
}

export function getOutlineContentPadding(width: number): number {
  return normalizeOutlineWidth(width) + OUTLINE_CONTENT_GAP
}
