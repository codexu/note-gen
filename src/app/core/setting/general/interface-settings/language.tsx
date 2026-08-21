'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Languages } from 'lucide-react'
import { useI18n } from "@/hooks/useI18n"
import { ResponsiveSelect } from "@/components/responsive-select"

export function LanguageSettings() {
  const t = useTranslations('settings.general.interface')
  const { currentLocale, changeLanguage } = useI18n()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Languages /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('language.title')}</ItemTitle>
        <ItemDescription>{t('language.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ResponsiveSelect
          title={t('language.title')}
          value={currentLocale}
          onValueChange={changeLanguage}
          className="w-full sm:w-[180px]"
          options={[
            { value: 'zh', label: '中文' },
            { value: 'zh-TW', label: '繁體中文' },
            { value: 'en', label: 'English' },
            { value: 'ja', label: '日本語' },
            { value: 'pt-BR', label: 'Português' },
            { value: 'de', label: 'Deutsch' },
          ]}
        />
      </ItemActions>
    </Item>
  )
}
