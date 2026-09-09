"use client"

import { ChevronRight, ToolCase } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useMcpStore } from "@/stores/mcp"
import { ClipboardMonitor } from "./clipboard-monitor"
import { McpServerList } from "./mcp-button"
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { ReasoningSelect } from './reasoning-select'

export function ChatToolsPopover() {
  const t = useTranslations()
  const selectedServerCount = useMcpStore((state) => state.selectedServerIds.length)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={t('mobile.chat.drawer.tools.title')}
          title={t('mobile.chat.drawer.tools.title')}
        >
          <ToolCase data-icon="inline-start" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 max-w-[calc(100vw-2rem)] gap-1 p-1">
        <div className="flex max-h-[min(28rem,calc(var(--radix-popover-content-available-height)-4rem))] flex-col overflow-y-auto">
          <ModelSelect display="panel" />
          <ReasoningSelect />
          <PromptSelect display="panel" />
          <Separator className="my-1" />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" className="h-10 w-full justify-start gap-3 px-3">
                <span className="min-w-0 flex-1 truncate text-left">{t('mcp.selectServers')}</span>
                {selectedServerCount > 0 && <Badge variant="secondary">{selectedServerCount}</Badge>}
                <ChevronRight data-icon="inline-end" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" className="w-80 max-w-[calc(100vw-2rem)] p-0">
              <PopoverHeader className="px-3 pt-3">
                <PopoverTitle>{t('mcp.selectServers')}</PopoverTitle>
              </PopoverHeader>
              <div className="max-h-80 overflow-y-auto px-2 pb-2">
                <McpServerList onInitialize />
              </div>
            </PopoverContent>
          </Popover>
          <ClipboardMonitor display="panel" />
        </div>
      </PopoverContent>
    </Popover>
  )
}
