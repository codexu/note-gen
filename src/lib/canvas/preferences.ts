export type CanvasGridStyle = 'dots' | 'lines'
export type CanvasManagerViewMode = 'grid' | 'list'
export type CanvasManagerSortMode = 'updated' | 'created' | 'name'
export type CanvasWheelBehavior = 'zoom' | 'pan'
export type CanvasInsertBehavior = 'keep' | 'select'

export const DEFAULT_CANVAS_GRID_VISIBLE = true
export const DEFAULT_CANVAS_SNAP_TO_GRID = false
export const DEFAULT_CANVAS_MINIMAP_VISIBLE = true
export const DEFAULT_CANVAS_GRID_STYLE: CanvasGridStyle = 'dots'
export const DEFAULT_CANVAS_GRID_GAP = 20
export const DEFAULT_CANVAS_ZOOM = 1
export const DEFAULT_CANVAS_MANAGER_VIEW_MODE: CanvasManagerViewMode = 'grid'
export const DEFAULT_CANVAS_MANAGER_SORT_MODE: CanvasManagerSortMode = 'updated'
export const DEFAULT_CANVAS_WHEEL_BEHAVIOR: CanvasWheelBehavior = 'zoom'
export const DEFAULT_CANVAS_INSERT_BEHAVIOR: CanvasInsertBehavior = 'select'

export function normalizeCanvasGridStyle(value: unknown): CanvasGridStyle {
  return value === 'lines' ? 'lines' : DEFAULT_CANVAS_GRID_STYLE
}

export function normalizeCanvasGridGap(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CANVAS_GRID_GAP
  }
  return Math.min(48, Math.max(8, Math.round(value / 4) * 4))
}

export function normalizeCanvasZoom(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CANVAS_ZOOM
  }
  return Math.min(2, Math.max(0.25, Math.round(value * 20) / 20))
}

export function normalizeCanvasManagerViewMode(value: unknown): CanvasManagerViewMode {
  return value === 'list' ? 'list' : DEFAULT_CANVAS_MANAGER_VIEW_MODE
}

export function normalizeCanvasManagerSortMode(value: unknown): CanvasManagerSortMode {
  return value === 'created' || value === 'name'
    ? value
    : DEFAULT_CANVAS_MANAGER_SORT_MODE
}

export function normalizeCanvasWheelBehavior(value: unknown): CanvasWheelBehavior {
  return value === 'pan' ? 'pan' : DEFAULT_CANVAS_WHEEL_BEHAVIOR
}

export function normalizeCanvasInsertBehavior(value: unknown): CanvasInsertBehavior {
  return value === 'keep' ? 'keep' : DEFAULT_CANVAS_INSERT_BEHAVIOR
}
