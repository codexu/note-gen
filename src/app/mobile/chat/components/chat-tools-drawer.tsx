"use client"

import { ToolCase } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { McpSelector } from "./mcp-selector"
import { ModelSelector } from "./model-selector"
import { PromptSelector } from "./prompt-selector"
import { ReasoningSelect } from "@/app/core/main/chat/reasoning-select"
import { useTranslations } from "next-intl"

export function ChatToolsDrawer() {
  const t = useTranslations('mobile.chat.drawer')

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <TooltipButton
          variant="ghost"
          size="icon"
          icon={<ToolCase className="size-4" />}
          tooltipText={t('tools.title')}
          side="bottom"
        />
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>{t('tools.title')}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">
          <div className="divide-y">
            <div className="h-16 flex items-center w-full">
              <ModelSelector />
            </div>
            <ReasoningSelect />
            <div className="h-16 flex items-center w-full">
              <PromptSelector />
            </div>
            <div className="py-2">
              <McpSelector />
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
