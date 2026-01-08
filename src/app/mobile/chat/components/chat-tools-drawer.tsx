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
import { TagLinkToggle } from "./tag-link-toggle"
import { RagToggle } from "./rag-toggle"
import { McpSelector } from "./mcp-selector"
import { MobileClearContext } from "./clear-context"
import { MobileClearChat } from "./clear-chat"
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
        <div className="p-4 overflow-auto">
          <div className="divide-y">
            <div className="h-16 flex items-center w-full">
              <TagLinkToggle />
            </div>
            <div className="h-16 flex items-center w-full">
              <RagToggle />
            </div>
            <div className="h-16 flex items-center w-full">
              <McpSelector />
            </div>
            <MobileClearContext />
            <MobileClearChat />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
