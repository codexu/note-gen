'use client'

import * as React from 'react'
import { useState } from 'react'
import { ServerCrash, Server, Check, Plug, PlugZap } from 'lucide-react'
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
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

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
                  <div className="flex flex-col flex-1 gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{server.name}</span>
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
                  <Check
                    className={cn(
                      "ml-2 size-4 shrink-0",
                      selectedServerIds.includes(server.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
