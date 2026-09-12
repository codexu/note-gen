import { CustomThemeColors, HSLValue, THEME_VARIABLE_MAP } from '@/types/theme'

/**
 * 将 HSL 值转换为 CSS 变量格式
 */
function hslToCssValue(hsl: HSLValue): string {
  const [h, s, l] = hsl
  return `${h} ${s}% ${l}%`
}

/**
 * 应用自定义主题颜色到 DOM
 * 这个函数会同时应用亮色和暗色主题的自定义颜色
 * 暗色主题的颜色通过设置在 .dark 类上的样式来实现
 */
let themeBase: { light: Partial<CustomThemeColors['light']>; dark: Partial<CustomThemeColors['dark']> } | null = null
let userColors: CustomThemeColors | null = null
export function setPluginThemeBase(base: typeof themeBase): void {
  themeBase = base
  renderThemeColors()
}
function renderThemeColors(): void {
  if (typeof document === 'undefined') return
  for (const variable of Object.values(THEME_VARIABLE_MAP.light)) document.documentElement.style.removeProperty(variable)
  let style = document.getElementById('custom-dark-theme')
  if (!style) { style = document.createElement('style'); style.id = 'custom-dark-theme'; document.head.appendChild(style) }
  // Both modes use rules on the root. Inline light values would defeat dark-mode rules.
  style.textContent = (['light', 'dark'] as const).map(mode => {
    const palette: Record<string, HSLValue | null | undefined> = { ...themeBase?.[mode] }
    for (const [key, value] of Object.entries(userColors?.[mode] ?? {})) {
      if (value) palette[key] = value as HSLValue
    }
    return `${mode === 'light' ? ':root' : ':root.dark'} {${Object.entries(palette).filter(([, v]) => v).map(([key, value]) => `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${hslToCssValue(value as HSLValue)};`).join('')}}`
  }).join('\n')
}
export function applyThemeColors(colors: CustomThemeColors): void {
  userColors = colors
  renderThemeColors()
}
export function removeThemeColors(): void {
  userColors = null
  renderThemeColors()
}

/**
 * 将颜色转换为 HSL 格式
 */
export function hexToHsl(hex: string): HSLValue | null {
  // 移除 # 号
  hex = hex.replace('#', '')

  // 解析 RGB
  let r = 0, g = 0, b = 0
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16)
    g = parseInt(hex.substring(2, 4), 16)
    b = parseInt(hex.substring(4, 6), 16)
  } else {
    return null
  }

  // 转换为 HSL
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/**
 * 将 HSL 格式转换为 Hex
 */
export function hslToHex(hsl: HSLValue): string {
  const [h, s, l] = hsl

  const sNormalized = s / 100
  const lNormalized = l / 100

  const c = (1 - Math.abs(2 * lNormalized - 1)) * sNormalized
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNormalized - c / 2

  let r = 0, g = 0, b = 0

  if (h >= 0 && h < 60) {
    r = c
    g = x
    b = 0
  } else if (h >= 60 && h < 120) {
    r = x
    g = c
    b = 0
  } else if (h >= 120 && h < 180) {
    r = 0
    g = c
    b = x
  } else if (h >= 180 && h < 240) {
    r = 0
    g = x
    b = c
  } else if (h >= 240 && h < 300) {
    r = x
    g = 0
    b = c
  } else if (h >= 300 && h < 360) {
    r = c
    g = 0
    b = x
  }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0')
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0')
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0')

  return `#${rHex}${gHex}${bHex}`
}
