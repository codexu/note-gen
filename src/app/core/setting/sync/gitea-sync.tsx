'use client'

import { Store } from '@tauri-apps/plugin-store'
import { Globe, Server } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { TokenInputControl } from './components/token-input-control'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { GITEA_INSTANCES, GiteaInstanceType } from '@/lib/sync/gitea.types'
import useSettingStore from '@/stores/setting'

export function GiteaSync() {
  const t = useTranslations()
  const {
    giteaInstanceType,
    setGiteaInstanceType,
    giteaCustomUrl,
    setGiteaCustomUrl,
    giteaAccessToken,
    setGiteaAccessToken,
  } = useSettingStore()
  const [tokenVisible, setTokenVisible] = useState(false)

  async function handleTokenChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setGiteaAccessToken(value)
    const store = await Store.load('store.json')
    await store.set('giteaAccessToken', value)
    await store.save()
  }

  function getTokenCreateUrl() {
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED) {
      return giteaCustomUrl ? `${giteaCustomUrl}/user/settings/applications` : '#'
    }
    return `${GITEA_INSTANCES[giteaInstanceType].baseUrl}/user/settings/applications`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json')
      const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType')
      const customUrl = await store.get<string>('giteaCustomUrl')
      const token = await store.get<string>('giteaAccessToken')

      if (instanceType) await setGiteaInstanceType(instanceType)
      if (customUrl) await setGiteaCustomUrl(customUrl)
      setGiteaAccessToken(token || '')
    }

    void init()
  }, [setGiteaAccessToken, setGiteaCustomUrl, setGiteaInstanceType])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gitea {t('settings.sync.settings')}</CardTitle>
        <CardDescription>{t('settings.sync.platformDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('settings.sync.giteaInstanceType')}</FieldLabel>
            <ResponsiveSelect
              title={t('settings.sync.giteaInstanceType')}
              value={giteaInstanceType}
              onValueChange={(value) => void setGiteaInstanceType(value as GiteaInstanceType)}
              placeholder={t('settings.sync.giteaInstanceTypePlaceholder')}
              options={[
                { value: GiteaInstanceType.OFFICIAL, label: <span className="flex items-center gap-2"><Globe />Gitea.com</span> },
                { value: GiteaInstanceType.SELF_HOSTED, label: <span className="flex items-center gap-2"><Server />{t('settings.sync.giteaInstanceTypeOptions.selfHosted')}</span> },
              ]}
            />
            <FieldDescription>{t('settings.sync.giteaInstanceTypeDesc')}</FieldDescription>
          </Field>

          {giteaInstanceType === GiteaInstanceType.SELF_HOSTED ? (
            <Field>
              <FieldLabel>Gitea URL</FieldLabel>
              <Input
                value={giteaCustomUrl}
                onChange={(event) => void setGiteaCustomUrl(event.target.value.replace(/\/+$/, ''))}
                placeholder="https://gitea.example.com"
                type="url"
              />
              <FieldDescription>{t('settings.sync.giteaInstanceTypeOptions.selfHostedDesc')}</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>Gitea Access Token</FieldLabel>
            <TokenInputControl
              value={giteaAccessToken}
              onChange={handleTokenChange}
              visible={tokenVisible}
              onVisibleChange={setTokenVisible}
              tokenUrl={getTokenCreateUrl()}
              placeholder={t('settings.sync.enterToken')}
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
