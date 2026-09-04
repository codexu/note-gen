/**
 * Transaction meta key set by the editor when it re-applies a selection that
 * was saved with the view state (app start, file reopen). The bubble menu
 * collapses only selections carrying this marker; a selection created by an
 * assistive tool through the accessibility API (VoiceOver, writing
 * assistants) must survive so the tool can act on it.
 */
export const VIEW_STATE_RESTORE_META = 'noteGenViewStateRestore'
