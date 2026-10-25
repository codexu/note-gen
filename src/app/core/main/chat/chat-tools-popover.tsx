"use client"

import { Plug, ToolCase } from "lucide-react"
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
import { ChatToolItem } from "./chat-tool-item"
import { Separator } from "@/components/ui/separator"
import { useMcpStore } from "@/stores/mcp"
import { ClipboardMonitor } from "./clipboard-monitor"
import { McpServerList } from "./mcp-button"
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { ReasoningSelect } from './reasoning-select'

export function ChatToolsPopover() {
  const t = useTranslations()
  const tTools = useTranslations('record.chat.input.toolsMenu')
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
      <PopoverContent align="start" side="top" sideOffset={8} className="w-80 min-w-0 max-w-[calc(100vw-2rem)] gap-1 overflow-x-hidden p-1.5">
        <div className="flex min-w-0 max-h-[min(28rem,calc(var(--radix-popover-content-available-height)-4rem))] flex-col overflow-x-hidden overflow-y-auto">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{tTools('groups.conversation')}</p>
          <ModelSelect display="panel" />
          <PromptSelect display="panel" />
          <ReasoningSelect />
          <Separator className="my-1.5" />
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{tTools('groups.extensions')}</p>
          <Popover>
            <PopoverTrigger asChild>
              <ChatToolItem
                icon={Plug}
                title={tTools('mcp.title')}
                description={tTools('mcp.description')}
                value={selectedServerCount > 0 ? <Badge variant="secondary">{selectedServerCount}</Badge> : undefined}
              />
            </PopoverTrigger>
            <PopoverContent align="start" side="right" className="w-80 max-w-[calc(100vw-2rem)] p-0">
              <PopoverHeader className="px-3 pt-3">
                <PopoverTitle>{t('mcp.selectServers')}</PopoverTitle>
              </PopoverHeader>
              <div className="max-h-80 min-w-0 overflow-x-hidden overflow-y-auto px-2 pb-2">
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
