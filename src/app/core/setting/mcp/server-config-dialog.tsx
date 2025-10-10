'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useMcpStore } from '@/stores/mcp'
import type { MCPServerConfig, MCPServerType } from '@/lib/mcp/types'
import { Loader2 } from 'lucide-react'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import { useToast } from '@/hooks/use-toast'

interface ServerConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingServer?: MCPServerConfig | null
}

export function ServerConfigDialog({
  open,
  onOpenChange,
  editingServer,
}: ServerConfigDialogProps) {
  const t = useTranslations('settings.mcp')
  const { toast } = useToast()
  const { addServer, updateServer } = useMcpStore()
  
  const [name, setName] = useState('')
  const [type, setType] = useState<MCPServerType>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [testing, setTesting] = useState(false)
  
  useEffect(() => {
    if (open) {
      if (editingServer) {
        setName(editingServer.name)
        setType(editingServer.type)
        
        // 对于 stdio 类型，如果 command 和 args 都存在，合并显示在 command 字段
        if (editingServer.type === 'stdio' && editingServer.command && editingServer.args && editingServer.args.length > 0) {
          const fullCommand = `${editingServer.command} ${editingServer.args.join(' ')}`
          setCommand(fullCommand)
          setArgs('')
        } else {
          setCommand(editingServer.command || '')
          setArgs((editingServer.args || []).join(' '))
        }
        
        setEnv(JSON.stringify(editingServer.env || {}, null, 2))
        setUrl(editingServer.url || '')
        setHeaders(JSON.stringify(editingServer.headers || {}, null, 2))
        setEnabled(editingServer.enabled ?? true)
      } else {
        resetForm()
      }
    }
  }, [editingServer, open])
  
  const resetForm = () => {
    setName('')
    setType('stdio')
    setCommand('')
    setArgs('')
    setEnv('')
    setUrl('')
    setHeaders('')
    setEnabled(true)
  }
  
  const handleTestConnection = async () => {
    setTesting(true)
    try {
      // 使用临时 ID 进行测试
      const config = buildConfig(true)
      console.log('测试连接配置:', {
        id: config.id,
        command: config.command,
        args: config.args,
        type: config.type
      })
      const success = await mcpServerManager.testConnection(config)
      
      if (success) {
        toast({ description: t('testSuccess') })
      } else {
        toast({ description: t('testFailed'), variant: 'destructive' })
      }
    } catch (error) {
      toast({ description: t('testFailed') + ': ' + error, variant: 'destructive' })
    } finally {
      setTesting(false)
    }
  }
  
  const buildConfig = (isTest: boolean = false): MCPServerConfig => {
    const config: MCPServerConfig = {
      // 测试时使用临时 ID，避免与已存在的服务器冲突
      id: isTest ? `mcp-test-${Date.now()}` : (editingServer?.id || `mcp-${Date.now()}`),
      name,
      type,
      enabled,
      createdAt: editingServer?.createdAt || Date.now(),
    }
    
    if (type === 'stdio') {
      // 智能解析命令：如果 command 包含空格且 args 为空，自动分割
      const commandParts = command.trim().split(/\s+/)
      if (commandParts.length > 1 && !args.trim()) {
        // 第一个词是命令，其余是参数
        config.command = commandParts[0]
        config.args = commandParts.slice(1)
      } else {
        // 使用原有逻辑
        config.command = command.trim()
        config.args = args.split(' ').filter(Boolean)
      }
      
      try {
        config.env = env ? JSON.parse(env) : {}
      } catch {
        config.env = {}
      }
    } else {
      config.url = url
      try {
        config.headers = headers ? JSON.parse(headers) : {}
      } catch {
        config.headers = {}
      }
    }
    
    return config
  }
  
  const handleSave = async () => {
    if (!name.trim()) {
      toast({ description: t('nameRequired'), variant: 'destructive' })
      return
    }
    
    if (type === 'stdio' && !command.trim()) {
      toast({ description: t('commandRequired'), variant: 'destructive' })
      return
    }
    
    if (type === 'http' && !url.trim()) {
      toast({ description: t('urlRequired'), variant: 'destructive' })
      return
    }
    
    const config = buildConfig()
    
    if (editingServer) {
      await updateServer(editingServer.id, config)
      toast({ description: t('serverUpdated') })
    } else {
      await addServer(config)
      toast({ description: t('serverAdded') })
    }
    
    onOpenChange(false)
    
    // 保存后自动测试连接（如果服务器已启用）
    if (config.enabled) {
      try {
        await mcpServerManager.connectServer(config)
      } catch (error) {
        console.error('Failed to auto-connect after save:', error)
      }
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingServer ? t('editServer') : t('addServer')}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* 服务器名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('serverName')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('serverNamePlaceholder')}
            />
          </div>
          
          {/* 启用状态 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('serverEnabled')}</Label>
              <p className="text-xs text-muted-foreground">{t('serverEnabledDesc')}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          
          {/* 服务器类型 */}
          <div className="space-y-2">
            <Label htmlFor="type">{t('serverType')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as MCPServerType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">{t('stdio')}</SelectItem>
                <SelectItem value="http">{t('http')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* stdio 配置 */}
          {type === 'stdio' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="command">{t('command')}</Label>
                <Input
                  id="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx @modelcontextprotocol/server-filesystem"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="args">{t('args')}</Label>
                <Input
                  id="args"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="/path/to/directory"
                />
                <p className="text-xs text-muted-foreground">{t('argsDesc')}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="env">{t('env')}</Label>
                <Textarea
                  id="env"
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  placeholder='{"KEY": "value"}'
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">{t('envDesc')}</p>
              </div>
            </>
          )}
          
          {/* HTTP 配置 */}
          {type === 'http' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="url">{t('url')}</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3000/mcp"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="headers">{t('headers')}</Label>
                <Textarea
                  id="headers"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder='{"Authorization": "Bearer token"}'
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">{t('headersDesc')}</p>
              </div>
            </>
          )}
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('testConnection')}
          </Button>
          <Button onClick={handleSave}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
