'use client'

import { useState } from 'react'
import { Puzzle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { McpSelector } from './mcp-selector'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'

export function McpButton() {
  const t = useTranslations('mcp')
  const [open, setOpen] = useState(false)
  const { selectedServerIds } = useMcpStore()
  
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="relative"
        title={t('selectServers')}
      >
        <Puzzle className="size-4" />
        {selectedServerIds.length > 0 && (
          <Badge 
            variant="secondary" 
            className="absolute -top-1 -right-1 size-4 p-0 flex items-center justify-center text-[10px]"
          >
            {selectedServerIds.length}
          </Badge>
        )}
      </Button>
      
      <McpSelector open={open} onOpenChange={setOpen} />
    </>
  )
}
