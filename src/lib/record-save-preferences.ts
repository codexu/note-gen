export type RecordSaveTargetMode = 'current' | 'last' | 'fixed'
export type RecordCompletionBehavior = 'stay' | 'highlight' | 'open'

export const DEFAULT_RECORD_SAVE_TARGET_MODE: RecordSaveTargetMode = 'current'
export const DEFAULT_RECORD_COMPLETION_BEHAVIOR: RecordCompletionBehavior = 'highlight'

export function normalizeRecordSaveTargetMode(value: unknown): RecordSaveTargetMode {
  return value === 'last' || value === 'fixed' ? value : DEFAULT_RECORD_SAVE_TARGET_MODE
}

export function normalizeRecordCompletionBehavior(value: unknown): RecordCompletionBehavior {
  return value === 'stay' || value === 'open' ? value : DEFAULT_RECORD_COMPLETION_BEHAVIOR
}

export function normalizeRecordTagId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function resolveRecordSaveTargetId({
  mode,
  currentTagId,
  lastTagId,
  fixedTagId,
  availableTagIds,
}: {
  mode: RecordSaveTargetMode
  currentTagId: number
  lastTagId: number | null
  fixedTagId: number | null
  availableTagIds: number[]
}): number {
  const availableIds = new Set(availableTagIds)
  const fallbackTagId = availableIds.has(currentTagId)
    ? currentTagId
    : availableTagIds[0] ?? currentTagId

  if (mode === 'last' && lastTagId && availableIds.has(lastTagId)) {
    return lastTagId
  }

  if (mode === 'fixed' && fixedTagId && availableIds.has(fixedTagId)) {
    return fixedTagId
  }

  return fallbackTagId
}
