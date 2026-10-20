'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Palette, Moon, Sun, SunMoon } from 'lucide-react'
import { useTheme } from "next-themes"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ThemeSettings() {
  const t = useTranslations('settings.general.interface')
  const { theme, setTheme } = useTheme()
  const activeTheme = theme || 'system'

  function handleThemeChange(value: string) {
    if (value) setTheme(value)
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Palette /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('theme.title')}</ItemTitle>
        <ItemDescription>{t('theme.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          value={activeTheme}
          onValueChange={handleThemeChange}
          aria-label={t('theme.title')}
          className="w-full sm:w-auto"
        >
          <ToggleGroupItem value="light" aria-label={t('theme.options.light')} className="flex-1 sm:flex-none">
            <Sun />
            <span>{t('theme.options.light')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label={t('theme.options.dark')} className="flex-1 sm:flex-none">
            <Moon />
            <span>{t('theme.options.dark')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="system" aria-label={t('theme.options.system')} className="flex-1 sm:flex-none">
            <SunMoon />
            <span>{t('theme.options.system')}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </ItemActions>
    </Item>
  )
}
