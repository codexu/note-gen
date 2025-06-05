import * as React from "react"
import { useEffect, useState } from "react"
import { Store } from "@tauri-apps/plugin-store"
import { Globe } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"

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

export function ChatLanguage() {
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input')
  const [chatLanguage, setChatLanguage] = useState<string>('中文')
  
  function getCurrentLanguageName() {
    const lang = languageOptions.find(l => l === chatLanguage)
    return lang ? lang : 'English'
  }

  async function initChatLanguage() {
    try {
      const store = await Store.load('store.json')
      const savedLanguage = await store.get<string>('chatLanguage')
      if (savedLanguage) {
        setChatLanguage(savedLanguage)
      } else {
        const appLocale = await store.get<string>('locale') || '中文'
        setChatLanguage(appLocale)
        await store.set('chatLanguage', appLocale)
        await store.save()
      }
    } catch (error) {
      console.error('Failed to initialize chat language:', error)
      setChatLanguage('en') // Default fallback
    }
  }

  // Save language selection to local storage
  async function languageSelectChangeHandler(langId: string) {
    setChatLanguage(langId)
    try {
      const store = await Store.load('store.json')
      await store.set('chatLanguage', langId)
      await store.save()
    } catch (error) {
      console.error('Failed to save chat language:', error)
    }
  }

  useEffect(() => {
    initChatLanguage()
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <TooltipButton
            icon={<Globe className={`size-4 ${chatLanguage ? "text-primary" : ""}`} />}
            tooltipText={`${t('chatLanguage.tooltip') || "Select chat language"} (${getCurrentLanguageName()})`}
            size="icon"
            variant="ghost"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          <CommandInput 
            placeholder={t('chatLanguage.placeholder') || "Search language..."} 
            className="h-9" 
          />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {languageOptions.map((lang) => (
                <CommandItem
                  key={lang}
                  value={lang}
                  onSelect={(currentValue) => {
                    languageSelectChangeHandler(currentValue)
                    setOpen(false)
                  }}
                >
                  {lang}
                  <Check
                    className={cn(
                      "ml-auto",
                      chatLanguage === lang ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}