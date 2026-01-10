/**
 * 自定义主题颜色配置
 * 使用 HSL 格式，值为 [hue, saturation, lightness] 数组或 null
 * null 表示使用默认值
 */
export interface CustomThemeColors {
  // 亮色主题颜色
  light: {
    background: HSLValue | null
    foreground: HSLValue | null
    card: HSLValue | null
    cardForeground: HSLValue | null
    primary: HSLValue | null
    primaryForeground: HSLValue | null
    secondary: HSLValue | null
    secondaryForeground: HSLValue | null
    third: HSLValue | null
    thirdForeground: HSLValue | null
    muted: HSLValue | null
    mutedForeground: HSLValue | null
    accent: HSLValue | null
    accentForeground: HSLValue | null
    border: HSLValue | null
    shadow: HSLValue | null
  }
  // 暗色主题颜色
  dark: {
    background: HSLValue | null
    foreground: HSLValue | null
    card: HSLValue | null
    cardForeground: HSLValue | null
    primary: HSLValue | null
    primaryForeground: HSLValue | null
    secondary: HSLValue | null
    secondaryForeground: HSLValue | null
    third: HSLValue | null
    thirdForeground: HSLValue | null
    muted: HSLValue | null
    mutedForeground: HSLValue | null
    accent: HSLValue | null
    accentForeground: HSLValue | null
    border: HSLValue | null
    shadow: HSLValue | null
  }
}

/**
 * HSL 颜色值
 */
export type HSLValue = [number, number, number]

/**
 * 获取主题 CSS 变量名映射
 */
export const THEME_VARIABLE_MAP = {
  light: {
    background: '--background',
    foreground: '--foreground',
    card: '--card',
    cardForeground: '--card-foreground',
    primary: '--primary',
    primaryForeground: '--primary-foreground',
    secondary: '--secondary',
    secondaryForeground: '--secondary-foreground',
    third: '--third',
    thirdForeground: '--third-foreground',
    muted: '--muted',
    mutedForeground: '--muted-foreground',
    accent: '--accent',
    accentForeground: '--accent-foreground',
    border: '--border',
    shadow: '--shadow',
  },
  dark: {
    background: '--background',
    foreground: '--foreground',
    card: '--card',
    cardForeground: '--card-foreground',
    primary: '--primary',
    primaryForeground: '--primary-foreground',
    secondary: '--secondary',
    secondaryForeground: '--secondary-foreground',
    third: '--third',
    thirdForeground: '--third-foreground',
    muted: '--muted',
    mutedForeground: '--muted-foreground',
    accent: '--accent',
    accentForeground: '--accent-foreground',
    border: '--border',
    shadow: '--shadow',
  },
} as const
