'use client'

import { Globe, Server } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { TokenInputControl } from './components/token-input-control'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { GiteaInstanceType } from '@/lib/sync/gitea.types'
import { getGiteaEndpoint } from '@/lib/sync/gitea-connection'
import { toast } from '@/hooks/use-toast'
import useSettingStore from '@/stores/setting'

export function GiteaSync() {
  const t = useTranslations()
  const {
    giteaInstanceType,
    setGiteaInstanceType,
    giteaCustomUrl,
    setGiteaCustomUrl,
    giteaAccessToken,
    giteaRepositoryScope,
    setGiteaAccessToken,
    refreshGiteaConnection,
  } = useSettingStore()
  const [tokenVisible, setTokenVisible] = useState(false)
  const [urlDraft, setUrlDraft] = useState<string>()
  const [savingEndpoint, setSavingEndpoint] = useState(false)
  const [tokenDraft, setTokenDraft] = useState<{ endpoint: string; repositoryScope: string; value: string } | null>(null)
  const endpoint = getGiteaEndpoint({ instanceType: giteaInstanceType, customUrl: giteaCustomUrl })
  const tokenDisabled = !endpoint || urlDraft !== undefined || savingEndpoint

  useEffect(() => {
    void refreshGiteaConnection().catch(() => {
      toast({ title: t('settings.sync.repositoryCheck.error'), variant: 'destructive' })
    })
  }, [refreshGiteaConnection, t])

  function handleTokenChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!endpoint || tokenDisabled) return
    const draft = { endpoint, repositoryScope: giteaRepositoryScope, value: event.target.value }
    setTokenDraft(draft)
    void setGiteaAccessToken(draft.value, endpoint, draft.repositoryScope).catch(() => {
      toast({ title: t('settings.sync.tokenSaveFailed'), variant: 'destructive' })
    }).finally(() => setTokenDraft(current => current === draft ? null : current))
  }

  async function saveEndpoint(save: () => Promise<void>) {
    setSavingEndpoint(true)
    try {
      await save()
      setUrlDraft(undefined)
    } catch {
      toast({ title: t('settings.sync.repositoryCheck.error'), variant: 'destructive' })
    } finally {
      setSavingEndpoint(false)
    }
  }

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
              onValueChange={(value) => void saveEndpoint(() => setGiteaInstanceType(value as GiteaInstanceType))}
              disabled={savingEndpoint}
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
                value={urlDraft ?? giteaCustomUrl}
                onChange={(event) => setUrlDraft(event.target.value)}
                onBlur={() => {
                  if (urlDraft !== undefined) void saveEndpoint(() => setGiteaCustomUrl(urlDraft))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                placeholder="https://gitea.example.com"
                inputMode="url"
                disabled={savingEndpoint}
              />
              <FieldDescription>{t('settings.sync.giteaInstanceTypeOptions.selfHostedDesc')}</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>Gitea Access Token</FieldLabel>
            <TokenInputControl
              value={tokenDraft && tokenDraft.endpoint === endpoint && tokenDraft.repositoryScope === giteaRepositoryScope
                ? tokenDraft.value : giteaAccessToken}
              onChange={handleTokenChange}
              visible={tokenVisible}
              onVisibleChange={setTokenVisible}
              tokenUrl={tokenDisabled ? '#' : `${endpoint}/user/settings/applications`}
              disabled={tokenDisabled}
              placeholder={t('settings.sync.enterToken')}
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
