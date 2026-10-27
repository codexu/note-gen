/** Stable names shared by the model schema and the local Lucide registry. */
export const responseIconNames = [
  'file-text', 'folder', 'search', 'calendar', 'lightbulb', 'check-circle',
  'triangle-alert', 'code', 'calculator', 'info', 'book-open', 'list-checks',
  'clock', 'image', 'quote', 'link', 'external-link', 'copy', 'download', 'chart-column',
] as const

export type ResponseIconName = typeof responseIconNames[number]
