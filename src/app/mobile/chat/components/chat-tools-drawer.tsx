"use client"

import { ToolCase } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { TagLinkToggle } from "./tag-link-toggle"
import { RagToggle } from "./rag-toggle"
import { McpSelector } from "./mcp-selector"
import { useTranslations } from "next-intl"

export function ChatToolsDrawer() {
  const t = useTranslations('mobile.chat.drawer')

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <ToolCase className="size-4" />
        </Button>
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
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
