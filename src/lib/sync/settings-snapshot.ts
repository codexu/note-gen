import { normalizeSpeechMode } from '@/lib/speech/preferences'
import { filterSyncData } from '@/config/sync-exclusions'
import { DEFAULT_EDITOR_CONTENT_WIDTH, normalizeEditorContentWidth, normalizeEditorLineHeight, normalizeEditorViewMode } from '@/lib/editor-layout-styles'
import { normalizeOutlinePosition } from '@/lib/outline-preferences'
import { normalizeRecordSortMode, normalizeRecordViewMode } from '@/lib/record-display-preferences'
import { normalizeRecordCompletionBehavior, normalizeRecordSaveTargetMode, normalizeRecordTagId } from '@/lib/record-save-preferences'
import { normalizeCanvasGridGap, normalizeCanvasGridStyle, normalizeCanvasInsertBehavior, normalizeCanvasManagerSortMode, normalizeCanvasManagerViewMode, normalizeCanvasWheelBehavior, normalizeCanvasZoom } from '@/lib/canvas/preferences'
import { isManagedAgentSystemPrompt } from '@/lib/ai/system-prompt'

/** Pure equivalent of persisted preference migrations, before preview or writes.
 * Defaults come from getInitialState(), never from this device's live choices. */
export function normalizeSettingsSnapshot(value: Record<string, unknown>, defaults: Record<string, unknown>) {
  const filtered = (input: Record<string, unknown>) => filterSyncData(Object.fromEntries(
    Object.entries(input).filter(([, item]) => typeof item !== 'function' && item !== undefined)
  ), { excludeSensitiveConfig: true })
  const result: Record<string, unknown> = { ...filtered(defaults), ...filtered(value) }
  result.editorContentWidth = normalizeEditorContentWidth(value.editorContentWidth
    ?? (value.centeredContent === true ? 'standard' : DEFAULT_EDITOR_CONTENT_WIDTH))
  const normalizers: Record<string, (value: unknown) => unknown> = {
    textToSpeechMode: normalizeSpeechMode, speechToTextMode: normalizeSpeechMode,
    editorLineHeight: normalizeEditorLineHeight, editorViewMode: normalizeEditorViewMode,
    outlinePosition: normalizeOutlinePosition, recordViewMode: normalizeRecordViewMode,
    recordSortMode: normalizeRecordSortMode, recordSaveTargetMode: normalizeRecordSaveTargetMode,
    fixedRecordTagId: normalizeRecordTagId, recordCompletionBehavior: normalizeRecordCompletionBehavior,
    canvasGridStyle: normalizeCanvasGridStyle, canvasGridGap: normalizeCanvasGridGap,
    canvasDefaultZoom: normalizeCanvasZoom, canvasManagerViewMode: normalizeCanvasManagerViewMode,
    canvasManagerSortMode: normalizeCanvasManagerSortMode, canvasWheelBehavior: normalizeCanvasWheelBehavior,
    canvasInsertBehavior: normalizeCanvasInsertBehavior,
  }
  for (const [key, normalize] of Object.entries(normalizers)) result[key] = normalize(result[key])
  result.agentSystemPromptExtension = typeof value.agentSystemPromptExtension === 'string' ? value.agentSystemPromptExtension
    : typeof value.systemPrompt === 'string' && !isManagedAgentSystemPrompt(value.systemPrompt) ? value.systemPrompt : ''
  delete result.systemPrompt // Legacy storage alias; the extension is the persisted preference.
  if (Array.isArray(value.recordToolbarConfig) && Array.isArray(defaults.recordToolbarConfig)) {
    const toolbar = value.recordToolbarConfig as Array<{ id: string; order: number }>
    if (toolbar.some(item => !item || typeof item.id !== 'string' || !Number.isFinite(item.order))) throw new Error('Invalid record toolbar settings')
    let order = toolbar.reduce((max, item) => Math.max(max, item.order), 0)
    result.recordToolbarConfig = [...toolbar, ...(defaults.recordToolbarConfig as Array<{ id: string; order: number }>)
      .filter(item => !toolbar.some(existing => existing.id === item.id)).map(item => ({ ...item, order: ++order }))]
  }
  for (const key of ['primaryModel', 'editorModel', 'placeholderModel', 'imageMethodModel', 'completionModel', 'markDescModel', 'commitModel']) {
    const value = result[key]
    if (typeof value === 'string' && (value.startsWith('note-gen-limited') || value.startsWith('note-gen-free-note-gen-limited') || value === 'note-gen-vlm' || value === 'note-gen-free-note-gen-vlm')) result[key] = 'note-gen-chat'
  }
  // Keep the final snapshot inside the same boundary even when a migration
  // adds fields. Preview, persistence, verification and recovery share it.
  return filtered(result)
}
