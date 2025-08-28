'use client'

import { useTranslations } from 'next-intl'
import { SettingPanel } from '../../components/setting-base'
import { Languages } from 'lucide-react'
import { useI18n } from "@/hooks/useI18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function LanguageSettings() {
  const t = useTranslations('settings.general.interface')
  const { currentLocale, changeLanguage } = useI18n()

  const getLanguageDisplay = (locale: string) => {
    switch (locale) {
      case "en":
        return "English"
      case "zh":
        return "中文"
      case "ja":
        return "日本語"
      default:
        return "English"
    }
  }

  return (
    <SettingPanel
      title={t('language.title')}
      desc={t('language.desc')}
      icon={<Languages className="h-4 w-4" />}
    >
      <Select value={currentLocale} onValueChange={changeLanguage}>
        <SelectTrigger className="w-[180px]">
          <SelectValue>
            <div className="flex items-center gap-2">
              <span>{getLanguageDisplay(currentLocale)}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">
            <div className="flex items-center gap-2">
              <span>English</span>
            </div>
          </SelectItem>
          <SelectItem value="zh">
            <div className="flex items-center gap-2">
              <span>中文</span>
            </div>
          </SelectItem>
          <SelectItem value="ja">
            <div className="flex items-center gap-2">
              <span>日本語</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingPanel>
  )
}
