'use client'

import { RotateCcw } from 'lucide-react'

interface ColorScheme {
  name: string
  mode: 'light' | 'dark'
  colors: {
    background: string
    foreground: string
    card: string
    cardForeground: string
    primary: string
    primaryForeground: string
    secondary: string
    secondaryForeground: string
    third: string
    thirdForeground: string
    muted: string
    mutedForeground: string
    accent: string
    accentForeground: string
    border: string
    shadow: string
  }
  isReset?: boolean
}

interface ThemePresetsProps {
  onApplyPreset: (preset: ColorScheme) => void
  onResetDefault?: () => void
  t: (key: string) => string
}

export function ThemePresets({ onApplyPreset, onResetDefault, t }: ThemePresetsProps) {
  const presets: ColorScheme[] = [
    {
      name: t('presets.reset.name'),
      mode: 'light',
      isReset: true,
      colors: {
        background: '#ffffff',
        foreground: '#0a0a0a',
        card: '#ffffff',
        cardForeground: '#0a0a0a',
        primary: '#171717',
        primaryForeground: '#fafafa',
        secondary: '#f5f5f5',
        secondaryForeground: '#171717',
        third: '#e5e5e5',
        thirdForeground: '#262626',
        muted: '#f5f5f5',
        mutedForeground: '#737373',
        accent: '#f5f5f5',
        accentForeground: '#171717',
        border: '#e5e5e5',
        shadow: '#000000',
      },
    },
    {
      name: t('presets.ocean.name'),
      mode: 'light',
      colors: {
        background: '#f0f9ff',
        foreground: '#0c4a6e',
        card: '#ffffff',
        cardForeground: '#0c4a6e',
        primary: '#0284c7',
        primaryForeground: '#ffffff',
        secondary: '#e0f2fe',
        secondaryForeground: '#0c4a6e',
        third: '#bae6fd',
        thirdForeground: '#0369a1',
        muted: '#f1f5f9',
        mutedForeground: '#64748b',
        accent: '#0ea5e9',
        accentForeground: '#ffffff',
        border: '#bae6fd',
        shadow: '#0c4a6e',
      },
    },
    {
      name: t('presets.forest.name'),
      mode: 'light',
      colors: {
        background: '#f0fdf4',
        foreground: '#14532d',
        card: '#ffffff',
        cardForeground: '#14532d',
        primary: '#16a34a',
        primaryForeground: '#ffffff',
        secondary: '#dcfce7',
        secondaryForeground: '#14532d',
        third: '#bbf7d0',
        thirdForeground: '#166534',
        muted: '#f7fee7',
        mutedForeground: '#4d7c0f',
        accent: '#22c55e',
        accentForeground: '#ffffff',
        border: '#bbf7d0',
        shadow: '#14532d',
      },
    },
    {
      name: t('presets.sunset.name'),
      mode: 'light',
      colors: {
        background: '#fef2f2',
        foreground: '#7f1d1d',
        card: '#ffffff',
        cardForeground: '#7f1d1d',
        primary: '#dc2626',
        primaryForeground: '#ffffff',
        secondary: '#fee2e2',
        secondaryForeground: '#7f1d1d',
        third: '#fecaca',
        thirdForeground: '#b91c1c',
        muted: '#fef2f2',
        mutedForeground: '#991b1b',
        accent: '#f87171',
        accentForeground: '#ffffff',
        border: '#fecaca',
        shadow: '#7f1d1d',
      },
    },
    {
      name: t('presets.lavender.name'),
      mode: 'light',
      colors: {
        background: '#faf5ff',
        foreground: '#581c87',
        card: '#ffffff',
        cardForeground: '#581c87',
        primary: '#9333ea',
        primaryForeground: '#ffffff',
        secondary: '#f3e8ff',
        secondaryForeground: '#581c87',
        third: '#e9d5ff',
        thirdForeground: '#7e22ce',
        muted: '#faf5ff',
        mutedForeground: '#7e22ce',
        accent: '#a855f7',
        accentForeground: '#ffffff',
        border: '#e9d5ff',
        shadow: '#581c87',
      },
    },
    {
      name: t('presets.midnight.name'),
      mode: 'dark',
      colors: {
        background: '#1a1a2e',
        foreground: '#eaeaea',
        card: '#16213e',
        cardForeground: '#eaeaea',
        primary: '#0f3460',
        primaryForeground: '#eaeaea',
        secondary: '#1f4068',
        secondaryForeground: '#eaeaea',
        third: '#0f3460',
        thirdForeground: '#a0a0a0',
        muted: '#16213e',
        mutedForeground: '#a0a0a0',
        accent: '#e94560',
        accentForeground: '#ffffff',
        border: '#0f3460',
        shadow: '#000000',
      },
    },
    {
      name: t('presets.deepSea.name'),
      mode: 'dark',
      colors: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        card: '#1e293b',
        cardForeground: '#e2e8f0',
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#334155',
        secondaryForeground: '#e2e8f0',
        third: '#1e3a8a',
        thirdForeground: '#cbd5e1',
        muted: '#1e293b',
        mutedForeground: '#94a3b8',
        accent: '#60a5fa',
        accentForeground: '#ffffff',
        border: '#334155',
        shadow: '#020617',
      },
    },
    {
      name: t('presets.darkForest.name'),
      mode: 'dark',
      colors: {
        background: '#0a1f1a',
        foreground: '#e2e8f0',
        card: '#142b26',
        cardForeground: '#e2e8f0',
        primary: '#22c55e',
        primaryForeground: '#ffffff',
        secondary: '#1a3a33',
        secondaryForeground: '#e2e8f0',
        third: '#14532d',
        thirdForeground: '#bbf7d0',
        muted: '#142b26',
        mutedForeground: '#86efac',
        accent: '#4ade80',
        accentForeground: '#0a1f1a',
        border: '#1a3a33',
        shadow: '#052e16',
      },
    },
    {
      name: t('presets.darkViolet.name'),
      mode: 'dark',
      colors: {
        background: '#1a0b2e',
        foreground: '#e2e8f0',
        card: '#2d1b4e',
        cardForeground: '#e2e8f0',
        primary: '#a855f7',
        primaryForeground: '#ffffff',
        secondary: '#3b2466',
        secondaryForeground: '#e2e8f0',
        third: '#581c87',
        thirdForeground: '#d8b4fe',
        muted: '#2d1b4e',
        mutedForeground: '#c4b5fd',
        accent: '#c084fc',
        accentForeground: '#1a0b2e',
        border: '#3b2466',
        shadow: '#2e1065',
      },
    },
    {
      name: t('presets.coralWarm.name'),
      mode: 'light',
      colors: {
        background: '#fff7ed',
        foreground: '#431407',
        card: '#ffffff',
        cardForeground: '#431407',
        primary: '#ea580c',
        primaryForeground: '#ffffff',
        secondary: '#ffedd5',
        secondaryForeground: '#431407',
        third: '#fed7aa',
        thirdForeground: '#c2410c',
        muted: '#fed7aa',
        mutedForeground: '#9a3412',
        accent: '#fb923c',
        accentForeground: '#ffffff',
        border: '#fed7aa',
        shadow: '#431407',
      },
    },
    {
      name: t('presets.slateGray.name'),
      mode: 'light',
      colors: {
        background: '#f8fafc',
        foreground: '#1e293b',
        card: '#ffffff',
        cardForeground: '#1e293b',
        primary: '#475569',
        primaryForeground: '#ffffff',
        secondary: '#e2e8f0',
        secondaryForeground: '#1e293b',
        third: '#cbd5e1',
        thirdForeground: '#334155',
        muted: '#f1f5f9',
        mutedForeground: '#64748b',
        accent: '#64748b',
        accentForeground: '#ffffff',
        border: '#e2e8f0',
        shadow: '#0f172a',
      },
    },
    {
      name: t('presets.darkGold.name'),
      mode: 'dark',
      colors: {
        background: '#1a1915',
        foreground: '#e2e8f0',
        card: '#2a2924',
        cardForeground: '#e2e8f0',
        primary: '#fbbf24',
        primaryForeground: '#1a1915',
        secondary: '#3a3934',
        secondaryForeground: '#e2e8f0',
        third: '#78350f',
        thirdForeground: '#fde68a',
        muted: '#2a2924',
        mutedForeground: '#fcd34d',
        accent: '#f59e0b',
        accentForeground: '#1a1915',
        border: '#3a3934',
        shadow: '#000000',
      },
    },
    {
      name: t('presets.beigeWarm.name'),
      mode: 'light',
      colors: {
        background: '#fef9f3',
        foreground: '#4a3f35',
        card: '#ffffff',
        cardForeground: '#4a3f35',
        primary: '#c9a66b',
        primaryForeground: '#ffffff',
        secondary: '#f5ebe0',
        secondaryForeground: '#4a3f35',
        third: '#ede0d4',
        thirdForeground: '#5c4d3f',
        muted: '#f5ebe0',
        mutedForeground: '#8b7355',
        accent: '#d4a574',
        accentForeground: '#ffffff',
        border: '#ede0d4',
        shadow: '#4a3f35',
      },
    },
    {
      name: t('presets.beigeDark.name'),
      mode: 'dark',
      colors: {
        background: '#1a1814',
        foreground: '#e8e0d8',
        card: '#24201a',
        cardForeground: '#e8e0d8',
        primary: '#c9a66b',
        primaryForeground: '#1a1814',
        secondary: '#2e2a22',
        secondaryForeground: '#e8e0d8',
        third: '#3a342a',
        thirdForeground: '#d4c4b4',
        muted: '#24201a',
        mutedForeground: '#a89888',
        accent: '#d4a574',
        accentForeground: '#1a1814',
        border: '#2e2a22',
        shadow: '#0d0c0a',
      },
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {presets.map((preset) => (
        <div
          key={preset.name}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (preset.isReset && onResetDefault) {
              onResetDefault()
            } else {
              onApplyPreset(preset)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (preset.isReset && onResetDefault) {
                onResetDefault()
              } else {
                onApplyPreset(preset)
              }
            }
          }}
          className={`group relative flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
            preset.isReset
              ? 'border-dashed border-muted-foreground/50 hover:border-primary'
              : 'border-border hover:border-primary'
          }`}
        >
          {/* 恢复默认图标 - 只对第一个显示 */}
          {preset.isReset && (
            <RotateCcw className="w-4 h-4" />
          )}

          {/* 颜色预览条 - 恢复默认不显示 */}
          {!preset.isReset && (
            <div className="flex w-full h-3 rounded-full overflow-hidden">
              <div className="flex-1" style={{ backgroundColor: preset.colors.background }} />
              <div className="flex-1" style={{ backgroundColor: preset.colors.foreground }} />
              <div className="flex-1" style={{ backgroundColor: preset.colors.primary }} />
              <div className="flex-1" style={{ backgroundColor: preset.colors.secondary }} />
              <div className="flex-1" style={{ backgroundColor: preset.colors.accent }} />
            </div>
          )}

          {/* 标签和名称 */}
          <div className="flex items-center gap-2">
            {!preset.isReset && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {preset.mode === 'light' ? 'Light' : 'Dark'}
              </span>
            )}
            <span className="text-sm font-medium">{preset.name}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
