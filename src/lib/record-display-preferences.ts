export type RecordViewMode = 'list' | 'compact' | 'cards'
export type RecordSortMode = 'newest' | 'oldest' | 'type'

export const DEFAULT_RECORD_VIEW_MODE: RecordViewMode = 'list'
export const DEFAULT_RECORD_SORT_MODE: RecordSortMode = 'newest'

export function normalizeRecordViewMode(value: unknown): RecordViewMode {
  return value === 'compact' || value === 'cards' ? value : DEFAULT_RECORD_VIEW_MODE
}

export function normalizeRecordSortMode(value: unknown): RecordSortMode {
  return value === 'oldest' || value === 'type' ? value : DEFAULT_RECORD_SORT_MODE
}
