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
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { TooltipButton } from '@/components/tooltip-button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'

export function McpButton() {
  const t = useTranslations('mcp')
  const [open, setOpen] = useState(false)
  const { servers, selectedServerIds, toggleServerSelection, initMcpData, serverStates } = useMcpStore()
  
  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      initMcpData()
    }
  }

  const enabledServers = servers.filter(s => s.enabled)
  
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
        <Command>
          <CommandInput placeholder={t('searchServers')} className="h-9" />
          <CommandList>
            <CommandEmpty>{t('noServersFound')}</CommandEmpty>
            {enabledServers.map((server) => {
              const state = serverStates.get(server.id)
              const status = state?.status || 'disconnected'
              const toolCount = state?.tools?.length || 0
              
              return (
                <CommandItem
                  key={server.id}
                  value={server.name}
                  onSelect={() => {
                    toggleServerSelection(server.id)
                  }}
                >
                  <div className="flex flex-col flex-1 gap-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{server.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                        {server.type}
                      </Badge>
                      {status === 'connected' ? (
                        <div className="flex items-center gap-1">
                          <PlugZap className="size-3 text-green-500" />
                          <span className="text-[10px] text-green-600 dark:text-green-400">
                            {toolCount} {t('tools')}
                          </span>
                        </div>
                      ) : status === 'connecting' ? (
                        <div className="flex items-center gap-1">
                          <Plug className="size-3 text-yellow-500 animate-pulse" />
                          <span className="text-[10px] text-yellow-600 dark:text-yellow-400">
                            {t('connecting')}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Plug className="size-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">
                            {t('disconnected')}
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground truncate">
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
