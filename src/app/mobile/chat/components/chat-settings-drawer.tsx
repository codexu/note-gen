"use client"

import { BotMessageSquare } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { ModelSelector } from "./model-selector"
import { PromptSelector } from "./prompt-selector"
import { ClipboardToggle } from "./clipboard-toggle"
import { useTranslations } from "next-intl"

export function ChatSettingsDrawer() {
  const t = useTranslations('mobile.chat.drawer')

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <TooltipButton
          variant="ghost"
          size="icon"
          icon={<BotMessageSquare className="size-4" />}
          tooltipText={t('settings.title')}
          side="bottom"
        />
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
              <ClipboardToggle />
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
