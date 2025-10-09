'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Plus,
  Pencil,
  Trash2,
  Terminal,
  Globe,
  CircleDot,
  Wrench,
} from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { ServerConfigDialog } from './server-config-dialog'
import { ConnectionTest } from './connection-test'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { useToast } from '@/hooks/use-toast'
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
  const { servers, deleteServer, toggleServerEnabled, getServerState } = useMcpStore()
  
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)
  
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
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t('servers')}</h3>
          <p className="text-sm text-muted-foreground">{t('serversDesc')}</p>
        </div>
        <Button onClick={handleAddServer}>
          <Plus className="mr-2 size-4" />
          {t('addServer')}
        </Button>
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
            
            return (
              <Card key={server.id} className="p-4">
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
                      
                      {toolCount > 0 && (
                        <div className="flex items-center gap-1">
                          <Wrench className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            {toolCount} {t('tools')}
                          </span>
                        </div>
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
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={() => toggleServerEnabled(server.id)}
                    />
                    
                    <ConnectionTest server={server} />
                    
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
