'use client'

import * as React from 'react'
import { useState } from 'react'
import { ServerCrash, Server, Plug, PlugZap } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { TooltipButton } from '@/components/tooltip-button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'

interface McpServerListProps {
  onInitialize?: boolean
  searchable?: boolean
}

export function McpServerList({ onInitialize = false, searchable = true }: McpServerListProps) {
  const t = useTranslations('mcp')
  const { servers, selectedServerIds, toggleServerSelection, initMcpData, serverStates } = useMcpStore()

  React.useEffect(() => {
    if (onInitialize) {
      void initMcpData()
    }
  }, [initMcpData, onInitialize])

  const enabledServers = servers.filter((server) => server.enabled)

  return (
    <Command>
      {searchable && <CommandInput placeholder={t('searchServers')} className="h-9" />}
      <div className="max-h-72 overflow-y-auto pr-1">
        <CommandList className="max-h-none overflow-visible">
          <CommandEmpty>{t('noServersFound')}</CommandEmpty>
          <CommandGroup>
            {enabledServers.map((server) => {
              const state = serverStates.get(server.id)
              const status = state?.status || 'disconnected'
              const toolCount = state?.tools?.length || 0

              return (
                <CommandItem
                  key={server.id}
                  value={server.name}
                  onSelect={() => toggleServerSelection(server.id)}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{server.name}</span>
                      <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
                        {server.type}
                      </Badge>
                      {status === 'connected' ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <PlugZap className="size-3" />
                          <span className="text-[10px]">{toolCount} {t('tools')}</span>
                        </div>
                      ) : status === 'connecting' ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Plug className="size-3 animate-pulse" />
                          <span className="text-[10px]">{t('connecting')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Plug className="size-3" />
                          <span className="text-[10px]">{t('disconnected')}</span>
                        </div>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {server.type === 'stdio' ? `${server.command} ${server.args?.join(' ') || ''}` : `${server.url}`}
                    </span>
                  </div>
                  <div
                    className="ml-2 shrink-0"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Switch
                      checked={selectedServerIds.includes(server.id)}
                      aria-label={`${t('selectServers')}: ${server.name}`}
                      onCheckedChange={() => toggleServerSelection(server.id)}
                    />
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </div>
    </Command>
  )
}

export function McpButton() {
  const t = useTranslations('mcp')
  const [open, setOpen] = useState(false)
  const { selectedServerIds, initMcpData } = useMcpStore()

  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      initMcpData()
    }
  }

  return (
    <Popover open={open} onOpenChange={handleSetOpen}>
      <PopoverTrigger asChild>
        <div className="hidden md:block relative">
          <TooltipButton
            icon={selectedServerIds.length ? <ServerCrash className="size-4" /> : <Server className="size-4" />}
            tooltipText={t('selectServers')}
            size="icon"
            side="bottom"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <McpServerList />
      </PopoverContent>
    </Popover>
  )
}
