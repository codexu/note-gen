'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useMcpStore } from '@/stores/mcp'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { useToast } from '@/hooks/use-toast'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import { AlertCircle } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'

interface JsonImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function JsonImportDialog({ open, onOpenChange }: JsonImportDialogProps) {
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const t = useTranslations('settings.mcp')
  const { toast } = useToast()
  const { addServer, servers } = useMcpStore()

  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState('')

  // 将 mcpServers 格式转换为标准配置数组
  const convertMcpServersFormat = (parsed: any): MCPServerConfig[] => {
    const configs: MCPServerConfig[] = []

    // 检查是否是 mcpServers 格式: { "mcpServers": { "serverName": {...} } }
    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      for (const [name, serverConfig] of Object.entries(parsed.mcpServers)) {
        const config = serverConfig as any

        // 检查是否是 stdio 类型 (有 command 字段)
        if (config.command) {
          configs.push({
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            type: 'stdio',
            enabled: true,
            createdAt: Date.now(),
            command: config.command,
            args: config.args,
            env: config.env,
          })
        }
        // 检查是否是 http 类型 (有 url 字段)
        else if (config.url) {
          configs.push({
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            type: 'http',
            enabled: true,
            createdAt: Date.now(),
            url: config.url,
            headers: config.headers,
          })
        }
      }
      return configs
    }

    // 检查是否是简化的 mcpServers 格式: { "serverName": {...} }
    // 如果没有 mcpServers 字段，但第一层是对象且包含 command 或 url
    if (!Array.isArray(parsed) && typeof parsed === 'object') {
      let hasMcpFormat = false
      for (const [, value] of Object.entries(parsed)) {
        const config = value as any
        if (config && (config.command || config.url)) {
          hasMcpFormat = true
          break
        }
      }

      if (hasMcpFormat) {
        for (const [name, serverConfig] of Object.entries(parsed)) {
          const config = serverConfig as any
          if (config.command) {
            configs.push({
              id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name,
              type: 'stdio',
              enabled: true,
              createdAt: Date.now(),
              command: config.command,
              args: config.args,
              env: config.env,
            })
          } else if (config.url) {
            configs.push({
              id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              name,
              type: 'http',
              enabled: true,
              createdAt: Date.now(),
              url: config.url,
              headers: config.headers,
            })
          }
        }
        return configs
      }
    }

    // 支持标准数组格式
    const standardConfigs = Array.isArray(parsed) ? parsed : [parsed]
    for (const config of standardConfigs) {
      configs.push({
        id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: config.name,
        type: config.type || 'stdio',
        enabled: config.enabled ?? true,
        createdAt: Date.now(),
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
      })
    }

    return configs
  }

  const handleImport = async () => {
    setError('')

    if (!jsonText.trim()) {
      setError(t('jsonRequired'))
      return
    }

    try {
      const parsed = JSON.parse(jsonText)

      // 转换为标准配置数组
      const configs = convertMcpServersFormat(parsed)

      if (configs.length === 0) {
        setError(t('jsonEmpty'))
        return
      }

      let successCount = 0
      let skippedCount = 0
      const addedConfigs: MCPServerConfig[] = []

      for (const config of configs) {
        // 验证配置结构
        if (!config.name || !config.type) {
          setError(t('jsonInvalidFormat'))
          return
        }

        if (config.type !== 'stdio' && config.type !== 'http') {
          setError(t('jsonInvalidType'))
          return
        }

        if (config.type === 'stdio' && !config.command) {
          setError(t('jsonMissingCommand'))
          return
        }

        if (config.type === 'http' && !config.url) {
          setError(t('jsonMissingUrl'))
          return
        }

        // 检查是否已存在同名服务器
        const exists = servers.some(s => s.name === config.name)
        if (exists) {
          skippedCount++
          continue
        }

        await addServer(config)
        addedConfigs.push(config)
        successCount++
      }

      onOpenChange(false)
      setJsonText('')

      if (successCount > 0) {
        toast({
          description: t('jsonImportSuccess', { count: successCount }),
        })

        // 自动连接已启用的新服务器
        for (const config of addedConfigs) {
          if (config.enabled) {
            try {
              await mcpServerManager.connectServer(config)
            } catch (error) {
              console.error(`Failed to auto-connect server ${config.name}:`, error)
            }
          }
        }
      }

      if (skippedCount > 0) {
        setTimeout(() => {
          toast({
            description: t('jsonImportSkipped', { count: skippedCount }),
          })
        }, 1000)
      }

      if (successCount === 0 && skippedCount === 0) {
        toast({
          description: t('jsonImportNoServers'),
          variant: 'destructive',
        })
      }
    } catch (e) {
      setError(t('jsonInvalidJson') + ': ' + (e as Error).message)
    }
  }

  const handleCancel = () => {
    setJsonText('')
    setError('')
    onOpenChange(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setJsonText('')
      setError('')
    }
    onOpenChange(newOpen)
  }

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader>
              <DrawerTitle>{t('jsonImportTitle')}</DrawerTitle>
              <DrawerDescription>{t('jsonImportDesc')}</DrawerDescription>
            </DrawerHeader>

            <div className="space-y-4 px-4 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="json-input">{t('jsonInput')}</Label>
                <Textarea
                  id="json-input"
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    setError('')
                  }}
                  placeholder={`{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}`}
                  rows={12}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('jsonInputHelp')}</p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                  <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>

            <DrawerFooter>
              <Button variant="outline" onClick={handleCancel}>
                {t('cancel')}
              </Button>
              <Button onClick={handleImport}>{t('import')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('jsonImportTitle')}</DialogTitle>
              <DialogDescription>{t('jsonImportDesc')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="json-input">{t('jsonInput')}</Label>
                <Textarea
                  id="json-input"
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    setError('')
                  }}
                  placeholder={`{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}`}
                  rows={12}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('jsonInputHelp')}</p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                  <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>
                {t('cancel')}
              </Button>
              <Button onClick={handleImport}>{t('import')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
