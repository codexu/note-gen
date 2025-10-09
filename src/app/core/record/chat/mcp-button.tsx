'use client'

import * as React from 'react'
import { useState } from 'react'
import { Puzzle, Check } from 'lucide-react'
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
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export function McpButton() {
  const t = useTranslations('mcp')
  const [open, setOpen] = useState(false)
  const { servers, selectedServerIds, toggleServerSelection, initMcpData } = useMcpStore()
  
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
        <div className="hidden md:block">
          <TooltipButton
            icon={<Puzzle className="size-4" />}
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
            {enabledServers.map((server) => (
              <CommandItem
                key={server.id}
                value={server.name}
                onSelect={() => {
                  toggleServerSelection(server.id)
                }}
              >
                <div className="flex flex-col flex-1">
                  <span className="font-medium">{server.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {server.type === 'stdio' ? `stdio: ${server.command}` : `http: ${server.url}`}
                  </span>
                </div>
                <Check
                  className={cn(
                    "ml-auto size-4",
                    selectedServerIds.includes(server.id) ? "opacity-100" : "opacity-0"
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
