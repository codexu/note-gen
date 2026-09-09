"use client"

import { ChevronRight, Server, ToolCase } from "lucide-react"
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
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { useMcpStore } from "@/stores/mcp"
import { ClipboardMonitor } from "./clipboard-monitor"
import { McpServerList } from "./mcp-button"
import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"
import { ReasoningSelect } from "./reasoning-select"

const TOOL_IDS = ['modelSelect', 'promptSelect', 'mcpButton', 'clipboardMonitor'] as const

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
      <PopoverContent align="start" side="top" className="w-96 p-0">
        <div className="flex max-h-96 flex-col overflow-y-auto px-3 py-3">
          {TOOL_IDS.map((toolId) => (
            <div key={toolId}>
              {toolId === 'modelSelect' && <><ModelSelect display="panel" /><ReasoningSelect /></>}
              {toolId === 'promptSelect' && <PromptSelect display="panel" />}
              {toolId === 'mcpButton' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Item asChild size="sm" className="h-12 flex-nowrap py-0 cursor-pointer hover:bg-muted">
                      <button type="button">
                        <ItemMedia variant="icon">
                          <Server />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{t('mcp.selectServers')}</ItemTitle>
                        </ItemContent>
                        <ItemActions className="shrink-0">
                          {selectedServerCount > 0 && <Badge variant="secondary">{selectedServerCount}</Badge>}
                          <ChevronRight />
                        </ItemActions>
                      </button>
                    </Item>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="right" className="w-96 p-0">
                    <PopoverHeader className="px-3 pt-3">
                      <PopoverTitle>{t('mcp.selectServers')}</PopoverTitle>
                    </PopoverHeader>
                    <div className="px-2 pb-2">
                      <McpServerList onInitialize />
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {toolId === 'clipboardMonitor' && <ClipboardMonitor display="panel" />}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
