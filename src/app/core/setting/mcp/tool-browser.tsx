'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'

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
      <Item variant="outline">
        <ItemMedia variant="icon"><Wrench /></ItemMedia>
        <ItemContent>
          <ItemTitle>
            {t('toolBrowser')}
            <Badge variant="secondary">{allTools.length}</Badge>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('toolBrowser')}>
            {isOpen ? (
              <ChevronUp />
            ) : (
              <ChevronDown />
            )}
            </Button>
          </CollapsibleTrigger>
        </ItemActions>
        
        <CollapsibleContent asChild>
          <ItemFooter className="flex-col items-stretch gap-3">
          {/* 搜索框 */}
          <InputGroup>
            <InputGroupInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchTools')}
            />
            <InputGroupAddon><Search /></InputGroupAddon>
          </InputGroup>
          
          {/* 工具列表 */}
          {filteredTools.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noToolsFound')}
            </p>
          ) : (
            <ItemGroup className="max-h-96 gap-2 overflow-y-auto">
              {filteredTools.map(({ serverName, tool }, index) => (
                <Item key={`${serverName}-${tool.name}-${index}`} variant="muted" size="xs">
                  <ItemContent>
                    <ItemTitle>
                      <code className="font-mono">{tool.name}</code>
                      <Badge variant="outline" className="text-xs">
                        {serverName}
                      </Badge>
                    </ItemTitle>
                    {tool.description && <ItemDescription>{tool.description}</ItemDescription>}
                    {tool.inputSchema.properties && (
                      <ItemDescription>
                        {t('parameters')}:{' '}
                        {Object.keys(tool.inputSchema.properties).join(', ')}
                      </ItemDescription>
                    )}
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
          </ItemFooter>
        </CollapsibleContent>
      </Item>
    </Collapsible>
  )
}
