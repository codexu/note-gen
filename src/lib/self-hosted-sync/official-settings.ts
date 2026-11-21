import {
  normalizeCanvasGridGap, normalizeCanvasGridStyle, normalizeCanvasInsertBehavior,
  normalizeCanvasManagerSortMode, normalizeCanvasManagerViewMode, normalizeCanvasWheelBehavior, normalizeCanvasZoom,
} from '@/lib/canvas/preferences'
import { normalizeEditorContentWidth, normalizeEditorLineHeight, normalizeEditorViewMode } from '@/lib/editor-layout-styles'
import { normalizeOutlinePlacement, normalizeOutlinePosition } from '@/lib/outline-preferences'
import { normalizeRecordSortMode, normalizeRecordViewMode } from '@/lib/record-display-preferences'

function booleanPreference(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

// These preferences have closed value sets or bounded numeric values. Keep
// connection credentials, arbitrary strings and nested settings device-local.
const preferences = {
  editorContentWidth: normalizeEditorContentWidth,
  editorLineHeight: normalizeEditorLineHeight,
  editorViewMode: normalizeEditorViewMode,
  outlinePosition: normalizeOutlinePosition,
  outlinePlacement: normalizeOutlinePlacement,
  recordViewMode: normalizeRecordViewMode,
  recordSortMode: normalizeRecordSortMode,
  canvasGridVisible: booleanPreference,
  canvasSnapToGrid: booleanPreference,
  canvasMinimapVisible: booleanPreference,
  canvasGridStyle: normalizeCanvasGridStyle,
  canvasGridGap: normalizeCanvasGridGap,
  canvasDefaultZoom: normalizeCanvasZoom,
  canvasManagerViewMode: normalizeCanvasManagerViewMode,
  canvasManagerSortMode: normalizeCanvasManagerSortMode,
  canvasWheelBehavior: normalizeCanvasWheelBehavior,
  canvasInsertBehavior: normalizeCanvasInsertBehavior,
}

export function filterOfficialSyncSettings(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const settings = value as Record<string, unknown>
  const allowed: Record<string, string | number | boolean> = {}
  for (const [key, normalize] of Object.entries(preferences)) {
    const preference = Object.hasOwn(settings, key) ? settings[key] : undefined
    if (typeof preference !== 'string' && typeof preference !== 'number' && typeof preference !== 'boolean') continue
    if (normalize(preference) === preference) allowed[key] = preference
  }
  return allowed
}

export function sanitizeOfficialSettingsPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.deleted === true) return { version: 1, domain: 'setting', relativePath: 'all', deleted: true }
  return { version: 1, domain: 'setting', localKey: 'all', value: filterOfficialSyncSettings(payload.value) }
}
