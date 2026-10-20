'use client'

import { Store } from '@tauri-apps/plugin-store'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { TokenInputControl } from './token-input-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import type { SyncPlatform } from '@/types/sync'

export interface SyncPlatformConfig {
  platform: SyncPlatform
  tokenKey: string
  tokenLabel: string
  tokenDesc: string
  tokenUrl: string
  tokenUrlText: string
}

interface SyncPlatformCardProps {
  config: SyncPlatformConfig
  accessToken: string
  setAccessToken: (token: string) => void
}

export function SyncPlatformCard({
  config,
  accessToken,
  setAccessToken,
}: SyncPlatformCardProps) {
  const t = useTranslations()
  const [tokenVisible, setTokenVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const store = await Store.load('store.json')
        const token = await store.get<string>(config.tokenKey)
        if (token) setAccessToken(token)
      } catch (initError) {
        console.error(`Failed to load ${config.platform} token:`, initError)
      } finally {
        setIsInitializing(false)
      }
    }

    void init()
  }, [config.platform, config.tokenKey, setAccessToken])

  const handleTokenChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setAccessToken(value)
    setError(null)

    try {
      const store = await Store.load('store.json')
      await store.set(config.tokenKey, value)
      await store.save()
    } catch (saveError) {
      console.error('Failed to save token:', saveError)
      setError(t('settings.sync.tokenSaveFailed'))
    }
  }, [config.tokenKey, setAccessToken, t])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {config.platform.charAt(0).toUpperCase() + config.platform.slice(1)} {t('settings.sync.settings')}
        </CardTitle>
        <CardDescription>{t('settings.sync.platformDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>{config.tokenLabel}</FieldLabel>
            <TokenInputControl
              value={accessToken}
              onChange={handleTokenChange}
              visible={tokenVisible}
              onVisibleChange={setTokenVisible}
              tokenUrl={config.tokenUrl}
              placeholder={t('settings.sync.enterToken')}
              disabled={isInitializing}
            />
          </Field>
        </FieldGroup>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('settings.sync.settings')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
