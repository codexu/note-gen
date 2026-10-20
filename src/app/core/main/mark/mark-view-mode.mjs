export const RECORD_VIEW_MODES = ["list", "compact", "cards"]

export function normalizeRecordViewMode(value) {
  return RECORD_VIEW_MODES.includes(value) ? value : "list"
}
