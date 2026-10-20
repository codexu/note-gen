'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Type } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { ResponsiveSelect } from '@/components/responsive-select'
import {
  APP_FONT_GENERIC_FAMILIES,
  APP_FONT_SYSTEM_VALUE,
  getAppFontFamilyCss,
  loadSystemFontFamilies,
} from '@/lib/font-settings'
import useSettingStore from '@/stores/setting'

interface FontOption {
  value: string
  label: string
  previewFamily: string
}

const STATUS_OPTION_LOADING = '__notegen_font_loading__'
const STATUS_OPTION_UNAVAILABLE = '__notegen_font_unavailable__'

export function FontFamilySettings() {
  const t = useTranslations('settings.general.interface')
  const { appFontFamily, setAppFontFamily } = useSettingStore()
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadFonts() {
      setIsLoading(true)
      const fonts = await loadSystemFontFamilies()

      if (!cancelled) {
        setSystemFonts(fonts)
        setIsLoading(false)
      }
    }

    void loadFonts()

    return () => {
      cancelled = true
    }
  }, [])

  const defaultOptions = useMemo<FontOption[]>(() => [
    {
      value: APP_FONT_SYSTEM_VALUE,
      label: t('fontFamily.options.system'),
      previewFamily: getAppFontFamilyCss(APP_FONT_SYSTEM_VALUE),
    },
  ], [t])

  const genericOptions = useMemo<FontOption[]>(() => (
    APP_FONT_GENERIC_FAMILIES.map((family) => ({
      value: family,
      label: t(`fontFamily.options.${family === 'sans-serif' ? 'sansSerif' : family}`),
      previewFamily: getAppFontFamilyCss(family),
    }))
  ), [t])

  const systemOptions = useMemo<FontOption[]>(() => {
    const options = systemFonts.map((family) => ({
      value: family,
      label: family,
      previewFamily: getAppFontFamilyCss(family),
    }))

    const knownValues = new Set([
      ...defaultOptions.map((option) => option.value),
      ...genericOptions.map((option) => option.value),
      ...options.map((option) => option.value),
    ])

    if (appFontFamily !== APP_FONT_SYSTEM_VALUE && !knownValues.has(appFontFamily)) {
      options.unshift({
        value: appFontFamily,
        label: appFontFamily,
        previewFamily: getAppFontFamilyCss(appFontFamily),
      })
    }

    return options
  }, [appFontFamily, defaultOptions, genericOptions, systemFonts])

  const handleFontChange = (fontFamily: string) => {
    void setAppFontFamily(fontFamily)
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Type /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('fontFamily.title')}</ItemTitle>
        <ItemDescription>{t('fontFamily.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ResponsiveSelect
          title={t('fontFamily.title')}
          value={appFontFamily}
          onValueChange={handleFontChange}
          className="w-full sm:w-[220px]"
          placeholder={t('fontFamily.placeholder')}
          options={[
            ...defaultOptions.map(option => ({
              value: option.value,
              label: <span style={{ fontFamily: option.previewFamily }}>{option.label}</span>,
              group: t('fontFamily.groups.default'),
            })),
            ...genericOptions.map(option => ({
              value: option.value,
              label: <span style={{ fontFamily: option.previewFamily }}>{option.label}</span>,
              group: t('fontFamily.groups.generic'),
            })),
            ...(isLoading ? [{
              value: STATUS_OPTION_LOADING,
              label: t('fontFamily.loading'),
              group: t('fontFamily.groups.system'),
              disabled: true,
            }] : []),
            ...(!isLoading && systemOptions.length === 0 ? [{
              value: STATUS_OPTION_UNAVAILABLE,
              label: t('fontFamily.noSystemFonts'),
              group: t('fontFamily.groups.system'),
              disabled: true,
            }] : []),
            ...systemOptions.map(option => ({
              value: option.value,
              label: <span style={{ fontFamily: option.previewFamily }}>{option.label}</span>,
              group: t('fontFamily.groups.system'),
            })),
          ]}
        />
      </ItemActions>
    </Item>
  )
}
