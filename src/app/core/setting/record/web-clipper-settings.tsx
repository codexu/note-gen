'use client'

import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Download, ExternalLink, Scissors } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import type { WebClipperStatus } from '@/lib/web-clipper/types'

export function WebClipperSettings() {
  const t = useTranslations('settings.webClipper')
  const locale = useLocale()
  const { toast } = useToast()
  const [enabled, setEnabledState] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let disposed = false
    void invoke<WebClipperStatus>('get_web_clipper_status')
      .then(status => {
        if (!disposed) setEnabledState(status.enabled)
      })
      .catch(error => {
        if (!disposed) {
          toast({
            title: t('loadFailed'),
            description: String(error),
            variant: 'destructive',
          })
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [t, toast])

  async function setEnabled(enabled: boolean) {
    setUpdating(true)
    try {
      await invoke('set_web_clipper_enabled', { enabled })
      setEnabledState(enabled)
    } catch (error) {
      toast({
        title: t('updateFailed'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      setUpdating(false)
    }
  }

  async function openInstallPage() {
    try {
      const websiteLocale = locale.toLocaleLowerCase().startsWith('zh') ? 'cn' : 'en'
      await openUrl(`https://notegen.top/${websiteLocale}/web-clipper/download`)
    } catch (error) {
      toast({
        title: t('installOpenFailed'),
        description: String(error),
        variant: 'destructive',
      })
    }
  }

  return (
    <ItemGroup>
      <Item variant="outline">
        <ItemMedia variant="icon"><Scissors /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enableTitle')}</ItemTitle>
          <ItemDescription>{t('enableDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label={t('enableTitle')}
            checked={enabled}
            disabled={loading || updating}
            onCheckedChange={setEnabled}
          />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><Download /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('installTitle')}</ItemTitle>
          <ItemDescription>{t('installDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm" onClick={() => void openInstallPage()}>
            {t('installAction')}
            <ExternalLink data-icon="inline-end" />
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
