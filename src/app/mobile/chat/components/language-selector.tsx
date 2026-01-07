"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { Store } from "@tauri-apps/plugin-store"
import { Globe } from "lucide-react"
import { useTranslations } from "next-intl"
import useChatStore from "@/stores/chat"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const languageOptions = [
  "English",
  "中文",
  "日本語",
  "한국어",
  "Français",
  "Deutsch",
  "Español",
  "Русский",
]

export function LanguageSelector() {
  const t = useTranslations('record.chat.input')
  const [chatLanguage, setChatLanguage] = useState<string>('中文')
  const { setLocale } = useChatStore()

  async function initChatLanguage() {
    try {
      const store = await Store.load('store.json')
      const savedLanguage = await store.get<string>('chatLanguage')
      if (savedLanguage) {
        setChatLanguage(savedLanguage)
        setLocale(savedLanguage)
      } else {
        const appLocale = await store.get<string>('locale') || '中文'
        setChatLanguage(appLocale)
        setLocale(appLocale)
        await store.set('chatLanguage', appLocale)
        await store.save()
      }
    } catch (error) {
      console.error('Failed to initialize chat language:', error)
      setChatLanguage('en')
    }
  }

  async function languageSelectChangeHandler(langId: string) {
    setChatLanguage(langId)
    try {
      const store = await Store.load('store.json')
      await store.set('chatLanguage', langId)
      await store.save()
    } catch (error) {
      console.error('Failed to save chat language:', error)
    }
    setLocale(langId)
  }

  useEffect(() => {
    initChatLanguage()
  }, [])

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Globe className="size-4" />
        <Label className="text-sm font-medium">{t('chatLanguage.tooltip')}</Label>
      </div>
      <Select value={chatLanguage} onValueChange={languageSelectChangeHandler}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('chatLanguage.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {languageOptions.map((lang) => (
            <SelectItem key={lang} value={lang}>
              {lang}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
