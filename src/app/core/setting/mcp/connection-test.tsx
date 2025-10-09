'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import type { MCPServerConfig } from '@/lib/mcp/types'

interface ConnectionTestProps {
  server: MCPServerConfig
}

export function ConnectionTest({ server }: ConnectionTestProps) {
  const t = useTranslations('settings.mcp')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  
  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    
    try {
      const success = await mcpServerManager.testConnection(server)
      setResult(success ? 'success' : 'error')
    } catch {
      setResult('error')
    } finally {
      setTesting(false)
    }
  }
  
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleTest}
        disabled={testing}
      >
        {testing && <Loader2 className="mr-2 size-3 animate-spin" />}
        {t('test')}
      </Button>
      
      {result === 'success' && (
        <CheckCircle2 className="size-4 text-green-500" />
      )}
      
      {result === 'error' && (
        <XCircle className="size-4 text-red-500" />
      )}
    </div>
  )
}
