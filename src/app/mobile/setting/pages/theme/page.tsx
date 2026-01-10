'use client'

import { useState } from 'react'
import { ArrowLeft, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import useSettingStore from '@/stores/setting'
import { HSLValue } from '@/types/theme'
import { applyThemeColors, hslToHex } from '@/lib/theme-utils'
import { useRouter } from 'next/navigation'
import { Store } from '@tauri-apps/plugin-store'

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
}

const presets: ColorScheme[] = [
  {
    name: '默认白色',
    mode: 'light',
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
    name: '海洋蓝',
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
    name: '森林绿',
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
    name: '日落红',
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
    name: '薰衣草紫',
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
    name: '午夜暗',
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
    name: '深海',
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
    name: '暗夜绿',
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
    name: '紫罗兰暗',
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
    name: '珊瑚暖',
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
    name: '石板灰',
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
    name: '暗夜金',
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
]

export default function ThemeSettingsPage() {
  const { customThemeColors } = useSettingStore()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'custom' | 'presets' | 'import-export'>('custom')
  const [importCode, setImportCode] = useState('')
  const [exportCode, setExportCode] = useState('')

  // 实时保存颜色变化
  const handleColorChange = async (colorKey: string, value: HSLValue | null) => {
    const updatedColors = {
      light: {
        ...customThemeColors.light,
        [colorKey]: value,
      },
      dark: {
        ...customThemeColors.dark,
        [colorKey]: value,
      },
    }

    const store = await Store.load('store.json')
    await store.set('customThemeColors', updatedColors)
    await store.save()
    useSettingStore.setState({ customThemeColors: updatedColors })
    applyThemeColors(updatedColors)
  }

  // 应用预设方案
  const applyPreset = async (preset: ColorScheme) => {
    const hexToHsl = (hex: string): HSLValue | null => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      if (!result) return null
      const r = parseInt(result[1], 16)
      const g = parseInt(result[2], 16)
      const b = parseInt(result[3], 16)
      const rNorm = r / 255
      const gNorm = g / 255
      const bNorm = b / 255
      const max = Math.max(rNorm, gNorm, bNorm)
      const min = Math.min(rNorm, gNorm, bNorm)
      let h = 0, s = 0
      const l = (max + min) / 2
      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
          case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break
          case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break
          case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break
        }
      }
      return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
    }

    const updatedColors = {
      light: {
        background: hexToHsl(preset.colors.background),
        foreground: hexToHsl(preset.colors.foreground),
        card: hexToHsl(preset.colors.card),
        cardForeground: hexToHsl(preset.colors.cardForeground),
        primary: hexToHsl(preset.colors.primary),
        primaryForeground: hexToHsl(preset.colors.primaryForeground),
        secondary: hexToHsl(preset.colors.secondary),
        secondaryForeground: hexToHsl(preset.colors.secondaryForeground),
        third: hexToHsl(preset.colors.third),
        thirdForeground: hexToHsl(preset.colors.thirdForeground),
        muted: hexToHsl(preset.colors.muted),
        mutedForeground: hexToHsl(preset.colors.mutedForeground),
        accent: hexToHsl(preset.colors.accent),
        accentForeground: hexToHsl(preset.colors.accentForeground),
        border: hexToHsl(preset.colors.border),
        shadow: hexToHsl(preset.colors.shadow),
      },
      dark: {
        background: hexToHsl(preset.colors.background),
        foreground: hexToHsl(preset.colors.foreground),
        card: hexToHsl(preset.colors.card),
        cardForeground: hexToHsl(preset.colors.cardForeground),
        primary: hexToHsl(preset.colors.primary),
        primaryForeground: hexToHsl(preset.colors.primaryForeground),
        secondary: hexToHsl(preset.colors.secondary),
        secondaryForeground: hexToHsl(preset.colors.secondaryForeground),
        third: hexToHsl(preset.colors.third),
        thirdForeground: hexToHsl(preset.colors.thirdForeground),
        muted: hexToHsl(preset.colors.muted),
        mutedForeground: hexToHsl(preset.colors.mutedForeground),
        accent: hexToHsl(preset.colors.accent),
        accentForeground: hexToHsl(preset.colors.accentForeground),
        border: hexToHsl(preset.colors.border),
        shadow: hexToHsl(preset.colors.shadow),
      },
    }

    const store = await Store.load('store.json')
    await store.set('customThemeColors', updatedColors)
    await store.save()
    useSettingStore.setState({ customThemeColors: updatedColors })
    applyThemeColors(updatedColors)
  }

  // 生成导出代码
  const handleExport = () => {
    const exportData = {
      name: 'Custom Theme',
      colors: {
        background: hslToHex(customThemeColors.light.background || [0, 0, 100]),
        foreground: hslToHex(customThemeColors.light.foreground || [0, 0, 0]),
        card: hslToHex(customThemeColors.light.card || [0, 0, 100]),
        cardForeground: hslToHex(customThemeColors.light.cardForeground || [0, 0, 0]),
        primary: hslToHex(customThemeColors.light.primary || [0, 0, 0]),
        primaryForeground: hslToHex(customThemeColors.light.primaryForeground || [0, 0, 100]),
        secondary: hslToHex(customThemeColors.light.secondary || [0, 0, 100]),
        secondaryForeground: hslToHex(customThemeColors.light.secondaryForeground || [0, 0, 0]),
        muted: hslToHex(customThemeColors.light.muted || [0, 0, 100]),
        mutedForeground: hslToHex(customThemeColors.light.mutedForeground || [0, 0, 50]),
        accent: hslToHex(customThemeColors.light.accent || [0, 0, 100]),
        accentForeground: hslToHex(customThemeColors.light.accentForeground || [0, 0, 0]),
        border: hslToHex(customThemeColors.light.border || [0, 0, 90]),
      },
    }
    setExportCode(JSON.stringify(exportData, null, 2))
  }

  // 导入配色方案
  const handleImport = async () => {
    try {
      const importData = JSON.parse(importCode) as ColorScheme
      if (importData.colors) {
        await applyPreset(importData)
        setImportCode('')
        setActiveTab('custom')
      }
    } catch (error) {
      console.error('Import failed:', error)
    }
  }

  const colorConfig: Array<{ key: string; label: string; defaultColor: string }> = [
    { key: 'background', label: '背景色', defaultColor: '#ffffff' },
    { key: 'foreground', label: '前景色', defaultColor: '#0a0a0a' },
    { key: 'card', label: '卡片背景', defaultColor: '#ffffff' },
    { key: 'cardForeground', label: '卡片前景', defaultColor: '#0a0a0a' },
    { key: 'primary', label: '主色调', defaultColor: '#171717' },
    { key: 'primaryForeground', label: '主色前景', defaultColor: '#fafafa' },
    { key: 'secondary', label: '次要色', defaultColor: '#f5f5f5' },
    { key: 'secondaryForeground', label: '次要前景', defaultColor: '#171717' },
    { key: 'muted', label: '柔和色', defaultColor: '#f5f5f5' },
    { key: 'mutedForeground', label: '柔和前景', defaultColor: '#737373' },
    { key: 'accent', label: '强调色', defaultColor: '#f5f5f5' },
    { key: 'accentForeground', label: '强调前景', defaultColor: '#171717' },
    { key: 'border', label: '边框色', defaultColor: '#e5e5e5' },
  ]

  const hexToHsl = (hex: string): HSLValue | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return null
    const r = parseInt(result[1], 16)
    const g = parseInt(result[2], 16)
    const b = parseInt(result[3], 16)
    const rNorm = r / 255
    const gNorm = g / 255
    const bNorm = b / 255
    const max = Math.max(rNorm, gNorm, bNorm)
    const min = Math.min(rNorm, gNorm, bNorm)
    let h = 0, s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break
        case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break
        case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break
      }
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 头部 */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="flex items-center px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold ml-2">自定义主题色</h1>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'custom' | 'presets' | 'import-export')} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="custom">自定义</TabsTrigger>
            <TabsTrigger value="presets">预设</TabsTrigger>
            <TabsTrigger value="import-export">导入/导出</TabsTrigger>
          </TabsList>

          <TabsContent value="custom" className="space-y-3">
            {colorConfig.map((config) => {
              const value = customThemeColors.light[config.key as keyof typeof customThemeColors.light]
              const hexValue = value ? hslToHex(value) : config.defaultColor

              return (
                <div key={config.key} className="flex items-center gap-3 py-2">
                  <input
                    type="color"
                    value={hexValue}
                    onChange={(e) => {
                      const hsl = hexToHsl(e.target.value)
                      if (hsl) handleColorChange(config.key, hsl)
                    }}
                    className="w-12 h-12 rounded-lg cursor-pointer border-2 border-border"
                  />
                  <div className="flex-1">
                    <Label className="text-sm font-medium">{config.label}</Label>
                    <p className="text-xs text-muted-foreground">{hexValue}</p>
                  </div>
                </div>
              )
            })}
          </TabsContent>

          <TabsContent value="presets" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="flex flex-col gap-2 p-3 rounded-lg border-2 border-border hover:border-primary transition-all"
                >
                  <div className="flex h-2 rounded-full overflow-hidden">
                    <div className="flex-1" style={{ backgroundColor: preset.colors.background }} />
                    <div className="flex-1" style={{ backgroundColor: preset.colors.foreground }} />
                    <div className="flex-1" style={{ backgroundColor: preset.colors.primary }} />
                    <div className="flex-1" style={{ backgroundColor: preset.colors.secondary }} />
                    <div className="flex-1" style={{ backgroundColor: preset.colors.accent }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {preset.mode === 'light' ? 'Light' : 'Dark'}
                    </span>
                    <span className="text-xs font-medium">{preset.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="import-export" className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">导出配色</h3>
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="h-4 w-4 mr-1" />
                  生成
                </Button>
              </div>
              <Textarea
                value={exportCode}
                onChange={(e) => setExportCode(e.target.value)}
                placeholder="点击生成按钮导出当前配色"
                className="font-mono text-xs"
                rows={6}
                readOnly
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">导入配色</h3>
                <Button variant="outline" size="sm" onClick={handleImport} disabled={!importCode.trim()}>
                  <Upload className="h-4 w-4 mr-1" />
                  导入
                </Button>
              </div>
              <Textarea
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder="粘贴配色代码..."
                className="font-mono text-xs"
                rows={6}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
