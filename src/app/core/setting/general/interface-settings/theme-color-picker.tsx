'use client'

import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { HSLValue } from '@/types/theme'
import { hexToHsl, hslToHex } from '@/lib/theme-utils'
import { RotateCcw } from 'lucide-react'

interface ThemeColorPickerProps {
  colors: {
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
  onColorChange: (colorKey: string, value: HSLValue | null) => void
  t: (key: string) => string
}

export function ThemeColorPicker({ colors, onColorChange, t }: ThemeColorPickerProps) {
  const colorConfig: Array<{ key: string; label: string; defaultColor: string }> = [
    { key: 'background', label: t('colors.background'), defaultColor: '#ffffff' },
    { key: 'foreground', label: t('colors.foreground'), defaultColor: '#0a0a0a' },
    { key: 'card', label: t('colors.card'), defaultColor: '#ffffff' },
    { key: 'cardForeground', label: t('colors.cardForeground'), defaultColor: '#0a0a0a' },
    { key: 'primary', label: t('colors.primary'), defaultColor: '#171717' },
    { key: 'primaryForeground', label: t('colors.primaryForeground'), defaultColor: '#fafafa' },
    { key: 'secondary', label: t('colors.secondary'), defaultColor: '#f5f5f5' },
    { key: 'secondaryForeground', label: t('colors.secondaryForeground'), defaultColor: '#171717' },
    { key: 'third', label: t('colors.third'), defaultColor: '#e5e5e5' },
    { key: 'thirdForeground', label: t('colors.thirdForeground'), defaultColor: '#262626' },
    { key: 'muted', label: t('colors.muted'), defaultColor: '#f5f5f5' },
    { key: 'mutedForeground', label: t('colors.mutedForeground'), defaultColor: '#737373' },
    { key: 'accent', label: t('colors.accent'), defaultColor: '#f5f5f5' },
    { key: 'accentForeground', label: t('colors.accentForeground'), defaultColor: '#171717' },
    { key: 'border', label: t('colors.border'), defaultColor: '#e5e5e5' },
    { key: 'shadow', label: t('colors.shadow'), defaultColor: '#000000' },
  ]

  // 分成两列
  const half = Math.ceil(colorConfig.length / 2)
  const leftColumn = colorConfig.slice(0, half)
  const rightColumn = colorConfig.slice(half)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
      <div className="space-y-2">
        {leftColumn.map((config) => (
          <ColorInput
            key={config.key}
            label={config.label}
            value={colors[config.key as keyof typeof colors]}
            defaultColor={config.defaultColor}
            onChange={(value) => onColorChange(config.key, value)}
          />
        ))}
      </div>
      <div className="space-y-2">
        {rightColumn.map((config) => (
          <ColorInput
            key={config.key}
            label={config.label}
            value={colors[config.key as keyof typeof colors]}
            defaultColor={config.defaultColor}
            onChange={(value) => onColorChange(config.key, value)}
          />
        ))}
      </div>
    </div>
  )
}

interface ColorInputProps {
  label: string
  value: [number, number, number] | null
  defaultColor: string
  onChange: (value: HSLValue | null) => void
}

function ColorInput({ label, value, defaultColor, onChange }: ColorInputProps) {
  const hexValue = value ? hslToHex(value) : defaultColor
  const hasCustomValue = value !== null

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = e.target.value

    if (!newHex) {
      onChange(null)
      return
    }

    const hsl = hexToHsl(newHex)
    if (hsl) {
      onChange(hsl)
    }
  }

  const handleReset = () => {
    onChange(null)
  }

  return (
    <div className="flex items-center gap-2 py-1">
      {/* 颜色选择器 */}
      <input
        type="color"
        value={hexValue}
        onChange={handleColorChange}
        className="w-8 h-8 rounded cursor-pointer border-2 border-border hover:border-primary transition-colors shrink-0"
        title="点击选择颜色"
      />

      {/* 标签 */}
      <Label className="text-xs font-medium flex-1 cursor-pointer" title={label}>
        {label}
      </Label>

      {/* 颜色值 - 移动端隐藏 */}
      <span className="hidden md:inline text-xs text-muted-foreground font-mono w-16 text-right tabular-nums">
        {hexValue}
      </span>

      {/* 重置按钮 - 始终占位 */}
      <div className="h-6 w-6 shrink-0 flex items-center justify-center">
        {hasCustomValue ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleReset}
            title="恢复默认值"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
