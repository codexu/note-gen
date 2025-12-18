'use client'

import { useTheme } from "next-themes"
import { useEffect } from "react"

export function MobileStatusBar() {
  const { theme, systemTheme } = useTheme()

  useEffect(() => {
    const currentTheme = theme === 'system' ? systemTheme : theme
    const isDark = currentTheme === 'dark'

    const updateStatusBarColor = () => {
      const statusBarColor = isDark ? '#0a0a0a' : '#ffffff'
      
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
    }

    const timer = setTimeout(updateStatusBarColor, 100)

    return () => clearTimeout(timer)
  }, [theme, systemTheme])

  return null
}
