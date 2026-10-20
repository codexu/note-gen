'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
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
import {
  Plus,
  Pencil,
  Trash2,
  Terminal,
  Globe,
  Wrench,
  ChevronDown,
  ChevronUp,
  FileJson,
  PlugZap,
} from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { ServerConfigDialog } from './server-config-dialog'
import { JsonImportDialog } from './json-import-dialog'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { useToast } from '@/hooks/use-toast'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import { Spinner } from '@/components/ui/spinner'
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
import { SettingSection } from '../components/setting-base'

function redactSensitiveEndpoint(endpoint: string) {
  return endpoint
    .replace(
      /([?&][^=\s]*(?:api[_-]?key|access[_-]?token|token|secret|password)[^=\s]*=)[^&#\s]*/gi,
      '$1••••••',
    )
    .replace(
      /((?:--?|\/)(?:api[_-]?key|access[_-]?token|token|secret|password)(?:=|\s+))\S+/gi,
      '$1••••••',
    )
}

export function ServerList({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.mcp')
  const { toast } = useToast()
  const { servers, updateServer, deleteServer, getServerState } = useMcpStore()
  
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [jsonImportOpen, setJsonImportOpen] = useState(false)
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

  const handleServerEnabledChange = async (server: MCPServerConfig, enabled: boolean) => {
    if (!enabled) {
      await mcpServerManager.disconnectServer(server.id)
    }

    await updateServer(server.id, { enabled })

    if (enabled) {
      try {
        await mcpServerManager.connectServer({ ...server, enabled: true })
      } catch (error) {
        console.error('Failed to connect MCP server:', error)
      }
    }
  }
  
  const handleDeleteConfirm = async () => {
    if (serverToDelete) {
      await mcpServerManager.disconnectServer(serverToDelete)
      await deleteServer(serverToDelete)
      toast({ description: t('serverDeleted') })
      setServerToDelete(null)
    }
    setDeleteDialogOpen(false)
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
      const result = await mcpServerManager.testConnections(enabledServers)

      const description = result.failed === 0
        ? t('testAllCompleted')
        : `${t('testAllCompleted')} (${result.success}/${result.total})`

      toast({ 
        description,
        variant: result.failed === 0 ? 'default' : 'destructive'
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
    <div className="flex flex-col gap-4">
      <SettingSection
        title={t('servers')}
        desc={mobile ? undefined : t('serversDesc')}
        actions={(
          <div className={mobile ? 'grid w-full grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
            <Button onClick={handleAddServer}>
              <Plus data-icon="inline-start" />
              {t('addServer')}
            </Button>
            <Button variant="outline" onClick={() => setJsonImportOpen(true)}>
              <FileJson data-icon="inline-start" />
              {t('importJson')}
            </Button>
            {servers.filter(s => s.enabled).length > 0 && (
              <Button
                className={mobile ? 'col-span-2' : undefined}
                variant="outline"
                onClick={handleTestAllConnections}
                disabled={testingAll}
              >
                {testingAll ? <Spinner data-icon="inline-start" /> : <PlugZap data-icon="inline-start" />}
                {t('testAll')}
              </Button>
            )}
          </div>
        )}
      >
        {servers.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Terminal /></EmptyMedia>
              <EmptyTitle>{t('noServers')}</EmptyTitle>
              <EmptyDescription>{t('serversDesc')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={handleAddServer}>
                <Plus data-icon="inline-start" />
                {t('addFirstServer')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup className="gap-3">
            {servers.map((server) => {
              const state = getServerState(server.id)
              const toolCount = state?.tools.length || 0

              const isExpanded = expandedServers.has(server.id)
              const hasTools = toolCount > 0
              const endpoint = server.type === 'stdio'
                ? server.command && `${server.command} ${server.args?.join(' ') || ''}`.trim()
                : server.url
              const safeEndpoint = endpoint ? redactSensitiveEndpoint(endpoint) : endpoint

              if (mobile) {
                return (
                  <Item key={server.id} variant="outline" className="gap-3 p-3">
                    <div className="flex w-full min-w-0 items-start gap-3">
                      <ItemMedia variant="icon" className="mt-0.5 text-muted-foreground">
                        {server.type === 'stdio' ? <Terminal /> : <Globe />}
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="min-w-0 max-w-full flex-wrap">
                          <span className="break-words">{server.name}</span>
                          <Badge variant="outline">
                            {server.type === 'stdio' ? t('stdio') : t('http')}
                          </Badge>
                        </ItemTitle>
                        {safeEndpoint && <ItemDescription className="break-all font-mono">{safeEndpoint}</ItemDescription>}
                      </ItemContent>
                      <Switch
                        className="shrink-0"
                        checked={server.enabled}
                        onCheckedChange={(enabled) => handleServerEnabledChange(server, enabled)}
                        aria-label={`${t('serverEnabled')}: ${server.name}`}
                      />
                    </div>

                    <div className="flex w-full items-center justify-between gap-3 border-t border-border/60 pt-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge
                          variant={state?.status === 'error'
                            ? 'destructive'
                            : state?.status === 'connected'
                              ? 'secondary'
                              : 'outline'}
                        >
                          {getStatusText(server.id)}
                        </Badge>
                        {hasTools && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleServerExpanded(server.id)}
                          >
                            <Wrench data-icon="inline-start" />
                            {toolCount} {t('tools')}
                            {isExpanded ? <ChevronUp data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
                          </Button>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('editServer')}
                          onClick={() => handleEditServer(server)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t('delete')}
                          onClick={() => handleDeleteClick(server.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    {hasTools && isExpanded && state && (
                      <ItemGroup className="w-full gap-2 border-t border-border/60 pt-3">
                        {state.tools.map((tool, index) => (
                          <Item key={`${tool.name}-${index}`} variant="muted" size="xs">
                            <ItemContent>
                              <ItemTitle><code className="font-mono">{tool.name}</code></ItemTitle>
                              {tool.description && <ItemDescription>{tool.description}</ItemDescription>}
                              {tool.inputSchema.properties && (
                                <ItemDescription>
                                  {t('parameters')}: {Object.keys(tool.inputSchema.properties).join(', ')}
                                </ItemDescription>
                              )}
                            </ItemContent>
                          </Item>
                        ))}
                      </ItemGroup>
                    )}
                  </Item>
                )
              }

              return (
                <Item key={server.id} variant="outline">
                  <ItemMedia variant="icon" className="text-muted-foreground">
                    {server.type === 'stdio' ? <Terminal /> : <Globe />}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="min-w-0 max-w-full flex-wrap">
                      {server.name}
                      <Badge variant="outline">
                        {server.type === 'stdio' ? t('stdio') : t('http')}
                      </Badge>
                    </ItemTitle>
                    {safeEndpoint && <ItemDescription className="break-all font-mono">{safeEndpoint}</ItemDescription>}
                  </ItemContent>
                  <ItemActions className="mobile-setting-inline-action">
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(enabled) => handleServerEnabledChange(server, enabled)}
                      aria-label={`${t('serverEnabled')}: ${server.name}`}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('editServer')}
                      onClick={() => handleEditServer(server)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      aria-label={t('delete')}
                      onClick={() => handleDeleteClick(server.id)}
                    >
                      <Trash2 />
                    </Button>
                  </ItemActions>
                  <ItemFooter className="flex-col items-stretch gap-3">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <Badge
                        variant={state?.status === 'error'
                          ? 'destructive'
                          : state?.status === 'connected'
                            ? 'secondary'
                            : 'outline'}
                      >
                        {getStatusText(server.id)}
                      </Badge>
                      {hasTools && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleServerExpanded(server.id)}
                        >
                          <Wrench data-icon="inline-start" />
                          {toolCount} {t('tools')}
                          {isExpanded ? <ChevronUp data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
                        </Button>
                      )}
                    </div>
                    {hasTools && isExpanded && state && (
                      <ItemGroup className="gap-2">
                        {state.tools.map((tool, index) => (
                          <Item key={`${tool.name}-${index}`} variant="muted" size="xs">
                            <ItemContent>
                              <ItemTitle><code className="font-mono">{tool.name}</code></ItemTitle>
                              {tool.description && <ItemDescription>{tool.description}</ItemDescription>}
                              {tool.inputSchema.properties && (
                                <ItemDescription>
                                  {t('parameters')}: {Object.keys(tool.inputSchema.properties).join(', ')}
                                </ItemDescription>
                              )}
                            </ItemContent>
                          </Item>
                        ))}
                      </ItemGroup>
                    )}
                  </ItemFooter>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </SettingSection>
      
      <ServerConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingServer={editingServer}
      />

      <JsonImportDialog
        open={jsonImportOpen}
        onOpenChange={setJsonImportOpen}
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
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
