"use client"

import * as React from 'react'
import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { Clipboard } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function ClipboardToggle() {
  const t = useTranslations('record.chat.input')
  const [isEnabled, setIsEnabled] = useState(true)
  
  async function initClipboardMonitor() {
    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('clipboardMonitorEnabled')
      if (enabled !== null && enabled !== undefined) {
        setIsEnabled(enabled)
      }
    } catch (error) {
      console.error('Failed to initialize clipboard monitor:', error)
    }
  }

  async function toggleClipboardMonitor(enabled: boolean) {
    setIsEnabled(enabled)
    try {
      const store = await Store.load('store.json')
      await store.set('clipboardMonitorEnabled', enabled)
      await store.save()
    } catch (error) {
      console.error('Failed to save clipboard monitor state:', error)
    }
  }

  useEffect(() => {
    initClipboardMonitor()
  }, [])

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Clipboard className="size-4" />
        <Label className="text-sm font-medium">{t('clipboardMonitor.enable')}</Label>
      </div>
      <Switch
        checked={isEnabled}
        onCheckedChange={toggleClipboardMonitor}
      />
    </div>
  )
}
