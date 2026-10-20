'use client'

import { invoke } from "@tauri-apps/api/core"
import { hslToHex } from "@/lib/theme-utils"
import { useTheme } from "next-themes"
import { useEffect } from "react"
import useSettingStore from "@/stores/setting"
import type { HSLValue } from "@/types/theme"

function parseHslCssValue(value: string): HSLValue | null {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%?\s+(\d+(?:\.\d+)?)%?/)

  if (!match) {
    return null
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]
}

function getThemeColorHex(variableName: string, fallback: HSLValue) {
  if (typeof window === 'undefined') {
    return hslToHex(fallback)
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
  return hslToHex(parseHslCssValue(value) || fallback)
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')

  if (normalized.length !== 6) {
    return null
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function shouldUseDarkIcons(hex: string) {
  const rgb = hexToRgb(hex)

  if (!rgb) {
    return true
  }

  const toLinear = (value: number) => {
    const channel = value / 255
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  }

  const luminance = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
  return luminance > 0.5
}

export function MobileStatusBar() {
  const { theme, systemTheme } = useTheme()
  const { customThemeColors } = useSettingStore()

  useEffect(() => {
    const currentTheme = theme === 'system' ? systemTheme : theme
    const isDark = currentTheme === 'dark'

    const updateStatusBarColor = () => {
      const statusBarColor = getThemeColorHex('--background', isDark ? [240, 10, 3.9] : [0, 0, 100])
      const lightSystemBar = shouldUseDarkIcons(statusBarColor)
      
      let metaThemeColor = document.querySelector('meta[name="theme-color"]')
      if (!metaThemeColor) {
        metaThemeColor = document.createElement('meta')
        metaThemeColor.setAttribute('name', 'theme-color')
        document.head.appendChild(metaThemeColor)
      }
      metaThemeColor.setAttribute('content', statusBarColor)

      let metaStatusBar = document.querySelector('meta[name="mobile-web-app-status-bar-style"]')
      if (!metaStatusBar) {
        metaStatusBar = document.createElement('meta')
        metaStatusBar.setAttribute('name', 'mobile-web-app-status-bar-style')
        document.head.appendChild(metaStatusBar)
      }
      metaStatusBar.setAttribute('content', isDark ? 'black-translucent' : 'default')

      void invoke('set_mobile_system_bars', {
        statusBarColor,
        navigationBarColor: statusBarColor,
        lightStatusBar: lightSystemBar,
        lightNavigationBar: lightSystemBar,
      }).catch((error) => {
        console.debug('Failed to sync mobile system bars:', error)
      })
    }

    const timer = setTimeout(updateStatusBarColor, 100)

    return () => clearTimeout(timer)
  }, [theme, systemTheme, customThemeColors])

  return null
}
