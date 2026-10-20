import { invoke } from '@tauri-apps/api/core'
import { checkIsTauri } from '@/lib/check'

export const APP_FONT_SYSTEM_VALUE = '__notegen_system_font__'

export const APP_FONT_GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace'] as const

export const DEFAULT_APP_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", Arial, sans-serif'

interface SystemFontPayload {
  family: string
}

const CSS_GENERIC_FONT_FAMILIES = new Set<string>([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

function quoteCssFontFamily(fontFamily: string) {
  const normalized = fontFamily.replace(/[\n\r\f]/g, ' ').trim()
  return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function getAppFontFamilyCss(fontFamily?: string | null) {
  if (!fontFamily || fontFamily === APP_FONT_SYSTEM_VALUE) {
    return DEFAULT_APP_FONT_FAMILY
  }

  if (CSS_GENERIC_FONT_FAMILIES.has(fontFamily)) {
    return `${fontFamily}, ${DEFAULT_APP_FONT_FAMILY}`
  }

  return `${quoteCssFontFamily(fontFamily)}, ${DEFAULT_APP_FONT_FAMILY}`
}

export function applyAppFontFamily(fontFamily?: string | null) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.style.setProperty('--notegen-app-font-family', getAppFontFamilyCss(fontFamily))
}

export function normalizeFontFamilies(fontFamilies: string[]) {
  const seen = new Set<string>()
  const normalized = fontFamilies
    .map((family) => family.trim())
    .filter((family) => family.length > 0)
    .filter((family) => {
      const key = family.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

  normalized.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  return normalized
}

export async function loadSystemFontFamilies() {
  if (!checkIsTauri()) {
    return []
  }

  try {
    const fonts = await invoke<SystemFontPayload[]>('list_system_fonts')
    return normalizeFontFamilies(fonts.map((font) => font.family))
  } catch (error) {
    console.debug('Failed to load system fonts:', error)
    return []
  }
}
