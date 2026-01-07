"use client"

import { BotMessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ModelSelector } from "./model-selector"
import { PromptSelector } from "./prompt-selector"
import { LanguageSelector } from "./language-selector"
import { ClipboardToggle } from "./clipboard-toggle"
import { useTranslations } from "next-intl"

export function ChatSettingsDrawer() {
  const t = useTranslations('mobile.chat.drawer')

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <BotMessageSquare className="size-4" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>{t('settings.title')}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4 overflow-auto">
          <div className="divide-y">
            <div className="h-16 flex items-center w-full">
              <ModelSelector />
            </div>
            <div className="h-16 flex items-center w-full">
              <PromptSelector />
            </div>
            <div className="h-16 flex items-center w-full">
              <LanguageSelector />
            </div>
            <div className="h-16 flex items-center w-full">
              <ClipboardToggle />
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
