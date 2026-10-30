'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { isGiteaImageConfigComplete, testGiteaImageConnection } from '@/lib/imageHosting/gitea'
import { DEFAULT_GITEA_IMAGE_CONFIG, type GiteaImageConfig } from '@/lib/imageHosting/types'
import { SyncStateEnum } from '@/lib/sync/github.types'
import useImageStore from '@/stores/imageHosting'
import { SecretInput, ServiceSettingsCard, useInitialConnectionTest } from './service-settings-card'
import { useStoredImageConfig } from './use-stored-image-config'

export function GiteaImageHosting() {
  const t = useTranslations('settings.imageHosting.gitea')
  const { config, loaded, updateConfig } = useStoredImageConfig('giteaImageConfig', DEFAULT_GITEA_IMAGE_CONFIG)
  const state = useImageStore(store => store.serviceStates.gitea ?? SyncStateEnum.fail)
  const setState = useCallback((value: SyncStateEnum) => useImageStore.getState().setServiceState('gitea', value), [])
  const checkRevision = useRef(0)
  useEffect(() => () => { checkRevision.current += 1 }, [])
  const canTest = isGiteaImageConfigComplete(config)
  const runTest = useCallback(async () => {
    const revision = ++checkRevision.current
    setState(SyncStateEnum.checking)
    let result = SyncStateEnum.fail
    try {
      if (await testGiteaImageConnection(config)) result = SyncStateEnum.success
    } catch {
      result = SyncStateEnum.fail
    }
    if (revision === checkRevision.current) setState(result)
  }, [config, setState])
  useInitialConnectionTest({ loaded, canTest, test: runTest })

  function update(next: GiteaImageConfig) {
    checkRevision.current += 1
    setState(SyncStateEnum.fail)
    void updateConfig(next)
  }

  return (
    <ServiceSettingsCard title={t('title')} description={t('description')} state={state} canTest={canTest} onTest={runTest}>
      {(['baseUrl', 'repository', 'branch', 'pathPrefix'] as const).map(key => (
        <Field key={key}>
          <FieldLabel htmlFor={`gitea-image-${key}`}>{t(key)}</FieldLabel>
          <Input
            id={`gitea-image-${key}`}
            value={config[key] || ''}
            placeholder={key === 'baseUrl' ? 'https://gitea.example.com' : key === 'repository' ? 'owner/images' : undefined}
            onChange={event => update({ ...config, [key]: event.target.value })}
          />
        </Field>
      ))}
      <Field>
        <FieldLabel htmlFor="gitea-image-token">{t('token')}</FieldLabel>
        <SecretInput id="gitea-image-token" value={config.token} onChange={token => update({ ...config, token })} />
      </Field>
    </ServiceSettingsCard>
  )
}
