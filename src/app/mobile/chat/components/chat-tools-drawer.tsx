"use client"

import { ToolCase } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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
import { ReasoningSelect } from '@/app/core/main/chat/reasoning-select'
import { useTranslations } from "next-intl"

export function ChatToolsDrawer() {
  const t = useTranslations('mobile.chat.drawer')
  const tTools = useTranslations('record.chat.input.toolsMenu')

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t('tools.title')} title={t('tools.title')}>
          <ToolCase data-icon="inline-start" />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('tools.title')}</DrawerTitle>
        </DrawerHeader>
        <div className="flex min-w-0 flex-col gap-1 overflow-x-hidden px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p className="px-2 py-2 text-xs font-medium text-muted-foreground">{tTools('groups.conversation')}</p>
          <ModelSelector />
          <PromptSelector />
          <ReasoningSelect />
          <Separator className="my-2" />
          <p className="px-2 py-2 text-xs font-medium text-muted-foreground">{tTools('groups.extensions')}</p>
          <McpSelector />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
