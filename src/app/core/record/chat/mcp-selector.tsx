'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Check, Plus } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { useRouter } from 'next/navigation'

interface McpSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function McpSelector({ open, onOpenChange }: McpSelectorProps) {
  const t = useTranslations('mcp')
  const router = useRouter()
  const { servers, enabled, selectedServerIds, toggleServerSelection, getServerState } = useMcpStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  
  // 过滤已启用的服务器
  const enabledServers = servers.filter(s => s.enabled)
  
  // 搜索过滤
  const filteredServers = enabledServers.filter(server => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return server.name.toLowerCase().includes(query)
  })
  
  // 重置选中索引
  useEffect(() => {
    if (open) {
      setSelectedIndex(0)
      setSearchQuery('')
    }
  }, [open])
  
  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            Math.min(prev + 1, filteredServers.length)
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (selectedIndex === filteredServers.length) {
            // 添加服务器
            handleAddServer()
          } else if (filteredServers[selectedIndex]) {
            // 切换选中状态
            toggleServerSelection(filteredServers[selectedIndex].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectedIndex, filteredServers, toggleServerSelection, onOpenChange])
  
  // 滚动到选中项
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])
  
  const handleAddServer = () => {
    onOpenChange(false)
    router.push('/setting/mcp')
  }
  
  const handleConfirm = () => {
    onOpenChange(false)
  }
  
  if (!enabled) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('selectServers')}</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center">
            <p className="text-muted-foreground mb-4">{t('noServers')}</p>
            <Button onClick={handleAddServer}>
              <Plus className="mr-2 size-4" />
              {t('goToSettings')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>{t('selectServers')}</DialogTitle>
        </DialogHeader>
        
        {/* 搜索框 */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchServers')}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>
        
        {/* 服务器列表 */}
        <div 
          ref={listRef}
          className="max-h-96 overflow-y-auto border-y"
        >
          {filteredServers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('noServersFound')}
            </div>
          ) : (
            <>
              {filteredServers.map((server, index) => {
                const isSelected = selectedServerIds.includes(server.id)
                const isHighlighted = index === selectedIndex
                const state = getServerState(server.id)
                const toolCount = state?.tools.length || 0
                
                return (
                  <button
                    key={server.id}
                    onClick={() => toggleServerSelection(server.id)}
                    className={`
                      w-full px-4 py-3 flex items-center justify-between
                      hover:bg-accent transition-colors
                      ${isHighlighted ? 'bg-accent' : ''}
                    `}
                  >
                    <div className="flex items-center gap-3 flex-1 text-left">
                      <div className={`
                        size-4 rounded border flex items-center justify-center
                        ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}
                      `}>
                        {isSelected && <Check className="size-3 text-primary-foreground" />}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{server.name}</span>
                          {state?.status === 'connected' && (
                            <Badge variant="secondary" className="text-xs">
                              {toolCount} {t('tools')}
                            </Badge>
                          )}
                        </div>
                        {state?.status !== 'connected' && (
                          <p className="text-xs text-muted-foreground">
                            {t('disconnected')}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </>
          )}
          
          {/* 添加服务器选项 */}
          <button
            onClick={handleAddServer}
            className={`
              w-full px-4 py-3 flex items-center gap-3
              hover:bg-accent transition-colors border-t
              ${selectedIndex === filteredServers.length ? 'bg-accent' : ''}
            `}
          >
            <Plus className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('addServer')}</span>
          </button>
        </div>
        
        {/* 底部提示 */}
        <div className="px-4 py-3 bg-muted/50 text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>MCP</span>
            <span>ESC {t('close')}</span>
            <span>▲▼ {t('navigate')}</span>
          </div>
          <Button size="sm" onClick={handleConfirm}>
            ↵ {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
