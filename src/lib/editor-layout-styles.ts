export type EditorContentWidth = 'narrow' | 'standard' | 'wide' | 'full'
export type EditorLineHeight = 'compact' | 'comfortable' | 'relaxed'
export type EditorViewMode = 'visual' | 'source'

export const DEFAULT_EDITOR_CONTENT_WIDTH: EditorContentWidth = 'full'
export const DEFAULT_EDITOR_LINE_HEIGHT: EditorLineHeight = 'comfortable'
export const DEFAULT_EDITOR_VIEW_MODE: EditorViewMode = 'visual'

export const EDITOR_LINE_HEIGHT_VALUES: Record<EditorLineHeight, number> = {
  compact: 1.5,
  comfortable: 1.7,
  relaxed: 1.9,
}

const EDITOR_CONTENT_WIDTH_CLASSES: Record<EditorContentWidth, string> = {
  narrow: 'max-w-2xl mx-auto px-4',
  standard: 'max-w-3xl mx-auto px-4',
  wide: 'max-w-5xl mx-auto px-4',
  full: 'px-10',
}

export function normalizeEditorContentWidth(value: unknown): EditorContentWidth {
  return value === 'narrow' || value === 'standard' || value === 'wide' || value === 'full'
    ? value
    : DEFAULT_EDITOR_CONTENT_WIDTH
}

export function normalizeEditorLineHeight(value: unknown): EditorLineHeight {
  return value === 'compact' || value === 'comfortable' || value === 'relaxed'
    ? value
    : DEFAULT_EDITOR_LINE_HEIGHT
}

export function normalizeEditorViewMode(value: unknown): EditorViewMode {
  return value === 'visual' || value === 'source'
    ? value
    : DEFAULT_EDITOR_VIEW_MODE
}

export function getEditorContentContainerClass(options: {
  contentWidth: EditorContentWidth
  isMobile: boolean
  outlineOpen?: boolean
  outlinePosition?: 'left' | 'right'
  contentInset?: boolean
}) {
  if (options.contentInset === false) {
    return ''
  }

  if (options.isMobile) {
    return ''
  }

  return EDITOR_CONTENT_WIDTH_CLASSES[options.contentWidth]
}
