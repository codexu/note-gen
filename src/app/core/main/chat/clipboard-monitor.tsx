"use client"
import { useTranslations } from 'next-intl'
import { Clipboard, ClipboardX } from 'lucide-react'
import { TooltipButton } from '@/components/tooltip-button'
import { useState, useEffect } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Switch } from '@/components/ui/switch'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'

interface ClipboardMonitorProps {
  display?: 'icon' | 'panel'
}

export function ClipboardMonitor({ display = 'icon' }: ClipboardMonitorProps) {
  const t = useTranslations('record.chat.input.clipboardMonitor')
  const [isEnabled, setIsEnabled] = useState(true)

  // Sync with store.json on mount
  useEffect(() => {
    const syncWithStore = async () => {
      try {
        const store = await Store.load('store.json')
        const storedValue = await store.get<boolean>('clipboardMonitor')

        // Only update if the stored value exists and is different from the current state
        if (storedValue !== undefined && storedValue !== isEnabled) {
          setIsEnabled(storedValue)
        }
      } catch (error) {
        console.error('Failed to load clipboard monitor state from store:', error)
      }
    }

    syncWithStore()
  }, [])

  const toggleClipboardMonitor = async () => {
    const newState = !isEnabled
    setIsEnabled(newState)
    const store = await Store.load('store.json')
    await store.set('clipboardMonitor', newState)
  }

  if (display === 'panel') {
    return (
      <Item size="sm" className="min-h-10 flex-nowrap py-2">
        <ItemContent className="min-w-0">
          <ItemTitle>{isEnabled ? t('enable') : t('disable')}</ItemTitle>
        </ItemContent>
        <ItemActions className="shrink-0">
          <Switch
            checked={isEnabled}
            aria-label={isEnabled ? t('enable') : t('disable')}
            onCheckedChange={() => void toggleClipboardMonitor()}
          />
        </ItemActions>
      </Item>
    )
  }

  return (
    <div>
      <TooltipButton
        variant={"ghost"}
        size="icon"
        icon={isEnabled ? <Clipboard className="size-4" /> : <ClipboardX className="size-4" />}
        tooltipText={isEnabled ? t('enable') : t('disable')}
        side="bottom"
        onClick={toggleClipboardMonitor}
      />
    </div>
  )
}
