'use client'

import { useTranslations } from 'next-intl'
import { SettingPanel } from '../../components/setting-base'
import { Palette, Moon, Sun, SunMoon } from 'lucide-react'
import { useTheme } from "next-themes"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ThemeSettings() {
  const t = useTranslations('settings.general.interface')
  const { theme, setTheme } = useTheme()

  return (
    <SettingPanel
      title={t('theme.title')}
      desc={t('theme.desc')}
      icon={<Palette className="size-4" />}
    >
      <Tabs value={theme || 'system'} onValueChange={setTheme}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="light" className="flex items-center gap-2">
            <Sun className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="dark" className="flex items-center gap-2">
            <Moon className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-2">
            <SunMoon className="size-4" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </SettingPanel>
  )
}
