"use client"

import * as React from 'react'
import { useEffect } from 'react'
import { Server, Check } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

export function McpSelector() {
  const t = useTranslations('mcp')
  const { servers, selectedServerIds, toggleServerSelection, initMcpData, serverStates } = useMcpStore()
  
  useEffect(() => {
    initMcpData()
  }, [])

  const enabledServers = servers.filter(s => s.enabled)
  const selectedServer = enabledServers.find(s => selectedServerIds.includes(s.id))
  
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Server className="size-4" />
        <Label className="text-sm font-medium">{t('selectServers')}</Label>
      </div>
      <Select 
        value={selectedServer?.id || ''} 
        onValueChange={(serverId) => toggleServerSelection(serverId)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('searchServers')} />
        </SelectTrigger>
        <SelectContent>
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
                <SelectItem key={server.id} value={server.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{server.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {server.type}
                    </Badge>
                    {status === 'connected' && (
                      <span className="text-[10px] text-green-600 dark:text-green-400">
                        {toolCount} {t('tools')}
                      </span>
                    )}
                    {isSelected && <Check className="size-3 ml-auto" />}
                  </div>
                </SelectItem>
              )
            })
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
