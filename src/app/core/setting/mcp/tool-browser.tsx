'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function ToolBrowser() {
  const t = useTranslations('settings.mcp')
  const { servers, getServerState } = useMcpStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  
  // 获取所有工具
  const allTools = servers.flatMap(server => {
    const state = getServerState(server.id)
    if (!state || state.status !== 'connected') return []
    
    return state.tools.map(tool => ({
      serverName: server.name,
      serverId: server.id,
      tool,
    }))
  })
  
  // 过滤工具
  const filteredTools = allTools.filter(({ tool }) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      tool.name.toLowerCase().includes(query) ||
      tool.description?.toLowerCase().includes(query)
    )
  })
  
  if (allTools.length === 0) {
    return null
  }
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="p-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-0 h-auto">
            <div className="flex items-center gap-2">
              <Wrench className="size-4" />
              <span className="font-medium">{t('toolBrowser')}</span>
              <Badge variant="secondary">{allTools.length}</Badge>
            </div>
            {isOpen ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="mt-4 space-y-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchTools')}
              className="pl-9"
            />
          </div>
          
          {/* 工具列表 */}
          {filteredTools.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noToolsFound')}
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredTools.map(({ serverName, tool }, index) => (
                <Card key={`${serverName}-${tool.name}-${index}`} className="p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono">{tool.name}</code>
                      <Badge variant="outline" className="text-xs">
                        {serverName}
                      </Badge>
                    </div>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground">
                        {tool.description}
                      </p>
                    )}
                    {tool.inputSchema.properties && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">{t('parameters')}: </span>
                        {Object.keys(tool.inputSchema.properties).join(', ')}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
