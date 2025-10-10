'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Pencil,
  Trash2,
  Terminal,
  Globe,
  CircleDot,
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { ServerConfigDialog } from './server-config-dialog'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { useToast } from '@/hooks/use-toast'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function ServerList() {
  const t = useTranslations('settings.mcp')
  const { toast } = useToast()
  const { servers, deleteServer, getServerState } = useMcpStore()
  
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [testingAll, setTestingAll] = useState(false)
  
  const handleAddServer = () => {
    setEditingServer(null)
    setDialogOpen(true)
  }
  
  const handleEditServer = (server: MCPServerConfig) => {
    setEditingServer(server)
    setDialogOpen(true)
  }
  
  const handleDeleteClick = (serverId: string) => {
    setServerToDelete(serverId)
    setDeleteDialogOpen(true)
  }
  
  const handleDeleteConfirm = () => {
    if (serverToDelete) {
      deleteServer(serverToDelete)
      toast({ description: t('serverDeleted') })
      setServerToDelete(null)
    }
    setDeleteDialogOpen(false)
  }
  
  const getStatusColor = (serverId: string) => {
    const state = getServerState(serverId)
    if (!state) return 'text-muted-foreground'
    
    switch (state.status) {
      case 'connected':
        return 'text-green-500'
      case 'connecting':
        return 'text-yellow-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-muted-foreground'
    }
  }
  
  const getStatusText = (serverId: string) => {
    const state = getServerState(serverId)
    if (!state) return t('disconnected')
    
    switch (state.status) {
      case 'connected':
        return t('connected')
      case 'connecting':
        return t('connecting')
      case 'error':
        return t('error')
      default:
        return t('disconnected')
    }
  }
  
  const toggleServerExpanded = (serverId: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serverId)) {
        newSet.delete(serverId)
      } else {
        newSet.add(serverId)
      }
      return newSet
    })
  }
  
  const handleTestAllConnections = async () => {
    setTestingAll(true)
    const enabledServers = servers.filter(s => s.enabled)
    
    try {
      // 并发测试所有启用的服务器
      await Promise.allSettled(
        enabledServers.map(server => mcpServerManager.reconnectServer(server))
      )
      
      toast({ 
        description: t('testAllCompleted'),
        variant: 'default'
      })
    } catch {
      toast({ 
        description: t('testAllFailed'),
        variant: 'destructive'
      })
    } finally {
      setTestingAll(false)
    }
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t('servers')}</h3>
          <p className="text-sm text-muted-foreground">{t('serversDesc')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleAddServer}>
          <Plus className="mr-2 size-4" />
          {t('addServer')}
        </Button>
        {servers.filter(s => s.enabled).length > 0 && (
          <Button 
            variant="outline" 
            onClick={handleTestAllConnections}
            disabled={testingAll}
          >
            {testingAll && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('testAll')}
          </Button>
        )}
      </div>
      
      {servers.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">{t('noServers')}</p>
          <Button onClick={handleAddServer} className="mt-4">
            <Plus className="mr-2 size-4" />
            {t('addFirstServer')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const state = getServerState(server.id)
            const toolCount = state?.tools.length || 0
            
            const isExpanded = expandedServers.has(server.id)
            const hasTools = toolCount > 0
            
            return (
              <Card key={server.id} className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        {server.type === 'stdio' ? (
                          <Terminal className="size-4 text-muted-foreground" />
                        ) : (
                          <Globe className="size-4 text-muted-foreground" />
                        )}
                        <h4 className="font-medium">{server.name}</h4>
                        <Badge variant="outline" className="text-xs">
                          {server.type === 'stdio' ? t('stdio') : t('http')}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <CircleDot className={`size-3 ${getStatusColor(server.id)}`} />
                          <span className="text-muted-foreground">
                            {getStatusText(server.id)}
                          </span>
                        </div>
                        
                        {hasTools && (
                          <button
                            onClick={() => toggleServerExpanded(server.id)}
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                          >
                            <Wrench className="size-3 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              {toolCount} {t('tools')}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="size-3 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="size-3 text-muted-foreground" />
                            )}
                          </button>
                        )}
                      </div>
                      
                      {server.type === 'stdio' && server.command && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {server.command} {server.args?.join(' ')}
                        </p>
                      )}
                      
                      {server.type === 'http' && server.url && (
                        <p className="text-xs text-muted-foreground">
                          {server.url}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditServer(server)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteClick(server.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* 工具列表 */}
                  {hasTools && isExpanded && state && (
                    <div className="pt-3 border-t space-y-2">
                      {state.tools.map((tool, index) => (
                        <div
                          key={`${tool.name}-${index}`}
                          className="p-3 rounded-lg bg-muted/50 space-y-1"
                        >
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono">{tool.name}</code>
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
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      
      <ServerConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingServer={editingServer}
      />
      
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteServerTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteServerDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
