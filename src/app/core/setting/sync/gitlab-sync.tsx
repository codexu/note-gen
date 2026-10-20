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
import { GITLAB_INSTANCES, GitlabInstanceType } from '@/lib/sync/gitlab.types'
import useSettingStore from '@/stores/setting'

export function GitlabSync() {
  const t = useTranslations()
  const {
    gitlabInstanceType,
    setGitlabInstanceType,
    gitlabCustomUrl,
    setGitlabCustomUrl,
    gitlabAccessToken,
    setGitlabAccessToken,
  } = useSettingStore()
  const [tokenVisible, setTokenVisible] = useState(false)

  async function handleTokenChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setGitlabAccessToken(value)
    const store = await Store.load('store.json')
    await store.set('gitlabAccessToken', value)
    await store.save()
  }

  function getTokenCreateUrl() {
    const query = '?name=NoteGen&description=NoteGen+sync&scopes=api'
    if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED) {
      const baseUrl = gitlabCustomUrl.replace(/\/+$/, '')
      return baseUrl ? `${baseUrl}/-/user_settings/personal_access_tokens${query}` : '#'
    }
    return `${GITLAB_INSTANCES[gitlabInstanceType].baseUrl}/-/user_settings/personal_access_tokens${query}`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json')
      const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType')
      const customUrl = await store.get<string>('gitlabCustomUrl')
      const token = await store.get<string>('gitlabAccessToken')

      if (instanceType) await setGitlabInstanceType(instanceType)
      if (customUrl) await setGitlabCustomUrl(customUrl)
      setGitlabAccessToken(token || '')
    }

    void init()
  }, [setGitlabAccessToken, setGitlabCustomUrl, setGitlabInstanceType])

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitLab {t('settings.sync.settings')}</CardTitle>
        <CardDescription>{t('settings.sync.platformDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('settings.sync.gitlabInstanceType')}</FieldLabel>
            <ResponsiveSelect
              title={t('settings.sync.gitlabInstanceType')}
              value={gitlabInstanceType}
              onValueChange={(value) => void setGitlabInstanceType(value as GitlabInstanceType)}
              placeholder={t('settings.sync.gitlabInstanceTypePlaceholder')}
              options={[
                { value: GitlabInstanceType.OFFICIAL, label: <span className="flex items-center gap-2"><Globe />GitLab.com</span> },
                { value: GitlabInstanceType.JIHULAB, label: <span className="flex items-center gap-2"><Globe />极狐</span> },
                { value: GitlabInstanceType.SELF_HOSTED, label: <span className="flex items-center gap-2"><Server />{t('settings.sync.gitlabInstanceTypeOptions.selfHosted')}</span> },
              ]}
            />
            <FieldDescription>{t('settings.sync.gitlabInstanceTypeDesc')}</FieldDescription>
          </Field>

          {gitlabInstanceType === GitlabInstanceType.SELF_HOSTED ? (
            <Field>
              <FieldLabel>GitLab URL</FieldLabel>
              <Input
                value={gitlabCustomUrl}
                onChange={(event) => void setGitlabCustomUrl(event.target.value)}
                placeholder="https://gitlab.example.com"
                type="url"
              />
              <FieldDescription>{t('settings.sync.gitlabInstanceTypeOptions.selfHostedDesc')}</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>GitLab Access Token</FieldLabel>
            <TokenInputControl
              value={gitlabAccessToken}
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
