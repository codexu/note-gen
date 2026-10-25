export const TEXT_COLORS = ['#c24141', '#b76518', '#92721a', '#348358', '#377ac2', '#9960bf'] as const
export const HIGHLIGHT_COLORS = ['#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#bfdbfe', '#e9d5ff'] as const

// Only color values, never arbitrary CSS, are persisted or rendered.
export function normalizeTextColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value)
  if (!rgb || rgb.slice(1).some(part => Number(part) > 255)) return null
  return '#' + rgb.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')
}
