"use client"

import * as React from 'react'
import { useEffect, useState } from 'react'
import { Server, PlugZap, Plug, ChevronRight } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'

function McpListContent() {
  const t = useTranslations('mcp')
  const { servers, selectedServerIds, toggleServerSelection, serverStates } = useMcpStore()

  const enabledServers = servers.filter(s => s.enabled)

  return (
    <div className="space-y-1">
      {enabledServers.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
          {t('noServersFound')}
        </div>
      ) : (
        enabledServers.map((server) => {
          const state = serverStates.get(server.id)
          const status = state?.status || 'disconnected'
          const toolCount = state?.tools?.length || 0
          const isSelected = selectedServerIds.includes(server.id)

          return (
            <button
              key={server.id}
              onClick={() => toggleServerSelection(server.id)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                isSelected
                  ? "bg-accent"
                  : "hover:bg-muted/50"
              )}
            >
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{server.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
                    {server.type}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {status === 'connected' ? (
                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <PlugZap className="size-3" />
                      <span>{toolCount} {t('tools')}</span>
                    </div>
                  ) : status === 'connecting' ? (
                    <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                      <Plug className="size-3 animate-pulse" />
                      <span>{t('connecting')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Plug className="size-3" />
                      <span>{t('disconnected')}</span>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="shrink-0"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Switch
                  checked={isSelected}
                  aria-label={`${t('selectServers')}: ${server.name}`}
                  onCheckedChange={() => toggleServerSelection(server.id)}
                />
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}

export function McpSelector() {
  const t = useTranslations('mcp')
  const { servers, selectedServerIds, initMcpData } = useMcpStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    initMcpData()
  }, [])

  const enabledServers = servers.filter(s => s.enabled)
  const selectedServers = enabledServers.filter(s => selectedServerIds.includes(s.id))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-16 flex items-center justify-between w-full px-0"
      >
        <div className="flex items-center gap-2">
          <Server className="size-4" />
          <Label className="text-sm font-medium">{t('selectServers')}</Label>
          {selectedServerIds.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {selectedServerIds.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-40">
            {selectedServers.length > 0
              ? selectedServers.map(s => s.name).join(', ')
              : t('searchServers')
            }
          </span>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </div>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader>
            <DrawerTitle>{t('selectServers')}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4 overflow-auto">
            <McpListContent />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
