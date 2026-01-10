import { CustomThemeColors, HSLValue } from '@/types/theme'

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
export function applyThemeColors(colors: CustomThemeColors): void {
  const root = document.documentElement

  // 获取或创建用于暗色主题自定义颜色的 style 标签
  let darkStyleTag = document.getElementById('custom-dark-theme')
  if (!darkStyleTag) {
    darkStyleTag = document.createElement('style')
    darkStyleTag.id = 'custom-dark-theme'
    document.head.appendChild(darkStyleTag)
  }

  // 构建暗色主题的 CSS 规则
  let darkCssRules = '.dark {\n'

  // 应用亮色主题的自定义颜色到 :root（内联样式）
  Object.entries(colors.light).forEach(([key, value]) => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    if (value) {
      root.style.setProperty(cssVar, hslToCssValue(value))
    } else {
      // 如果值为 null，移除自定义值（恢复默认）
      root.style.removeProperty(cssVar)
    }
  })

  // 构建暗色主题的 CSS 规则
  Object.entries(colors.dark).forEach(([key, value]) => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    if (value) {
      darkCssRules += `  ${cssVar}: ${hslToCssValue(value)};\n`
    }
    // 如果值为 null，不添加到规则中，让 CSS 默认值生效
  })

  darkCssRules += '}'

  // 更新暗色主题的样式
  darkStyleTag.textContent = darkCssRules
}

/**
 * 移除所有自定义主题颜色
 */
export function removeThemeColors(): void {
  const root = document.documentElement

  // 移除 :root 上的所有自定义颜色变量
  const lightVars = [
    'background', 'foreground', 'card', 'cardForeground',
    'primary', 'primaryForeground', 'secondary', 'secondaryForeground',
    'third', 'thirdForeground',
    'muted', 'mutedForeground', 'accent', 'accentForeground', 'border',
    'shadow'
  ]

  lightVars.forEach(key => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    root.style.removeProperty(cssVar)
  })

  // 移除暗色主题的样式标签
  const darkStyleTag = document.getElementById('custom-dark-theme')
  if (darkStyleTag) {
    darkStyleTag.remove()
  }
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
