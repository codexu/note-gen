'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  SecretInput,
  ServiceSettingsCard,
  useInitialConnectionTest,
} from './service-settings-card'
import { useStoredImageConfig } from './use-stored-image-config'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Textarea } from '@/components/ui/textarea'
import {
  isCloudinaryConfigComplete,
  isCustomHttpImageConfigComplete,
  isImageKitConfigComplete,
  isLskyConfigComplete,
  isWebDavImageConfigComplete,
  testImageKitConnection,
  testLskyConnection,
  testWebDavImageConnection,
} from '@/lib/imageHosting/remote-services'
import {
  isQiniuConfigComplete,
  isUpyunConfigComplete,
  testUpyunConnection,
} from '@/lib/imageHosting/china-object-services'
import {
  DEFAULT_CLOUDINARY_CONFIG,
  DEFAULT_CUSTOM_HTTP_IMAGE_CONFIG,
  DEFAULT_IMAGEKIT_CONFIG,
  DEFAULT_LSKY_CONFIG,
  DEFAULT_QINIU_CONFIG,
  DEFAULT_UPYUN_CONFIG,
  DEFAULT_WEBDAV_IMAGE_CONFIG,
  type CloudinaryConfig,
  type CustomHttpImageConfig,
  type ImageKitConfig,
  type LskyConfig,
  type QiniuConfig,
  type UpyunConfig,
  type WebDavImageConfig,
} from '@/lib/imageHosting/types'
import { SyncStateEnum } from '@/lib/sync/github.types'
import useImageStore from '@/stores/imageHosting'

export function LskyImageHosting() {
  const t = useTranslations('settings.imageHosting.lsky')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'lskyImageConfig',
    DEFAULT_LSKY_CONFIG,
  )
  const state = useServiceState('lsky')
  const canTest = isLskyConfigComplete(config)
  const runTest = useCallback(async () => {
    state.set(SyncStateEnum.checking)
    try {
      state.set(await testLskyConnection(config) ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch {
      state.set(SyncStateEnum.fail)
    }
  }, [config, state])
  useInitialConnectionTest({ loaded, canTest, test: runTest })

  async function update(next: LskyConfig) {
    state.set(SyncStateEnum.fail)
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={canTest}
      onTest={runTest}
    >
      <Field>
        <FieldLabel htmlFor="lsky-api-url">{t('apiUrl')}</FieldLabel>
        <Input
          id="lsky-api-url"
          value={config.apiUrl}
          placeholder="https://example.com/api/v1"
          onChange={(event) => void update({ ...config, apiUrl: event.target.value })}
        />
        <FieldDescription>{t('apiUrlDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="lsky-token">{t('token')}</FieldLabel>
        <SecretInput
          id="lsky-token"
          value={config.token}
          placeholder={t('tokenPlaceholder')}
          onChange={(token) => void update({ ...config, token })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="lsky-strategy">{t('strategyId')}</FieldLabel>
        <Input
          id="lsky-strategy"
          value={config.strategyId || ''}
          placeholder={t('strategyIdPlaceholder')}
          onChange={(event) => void update({ ...config, strategyId: event.target.value })}
        />
        <FieldDescription>{t('strategyIdDesc')}</FieldDescription>
      </Field>
    </ServiceSettingsCard>
  )
}

export function WebDavImageHosting() {
  const t = useTranslations('settings.imageHosting.webdav')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'webdavImageConfig',
    DEFAULT_WEBDAV_IMAGE_CONFIG,
  )
  const state = useServiceState('webdav')
  const canTest = isWebDavImageConfigComplete(config)
  const runTest = useCallback(async () => {
    state.set(SyncStateEnum.checking)
    try {
      state.set(await testWebDavImageConnection(config) ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch {
      state.set(SyncStateEnum.fail)
    }
  }, [config, state])
  useInitialConnectionTest({ loaded, canTest, test: runTest })

  async function update(next: WebDavImageConfig) {
    state.set(SyncStateEnum.fail)
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={canTest}
      onTest={runTest}
    >
      <Field>
        <FieldLabel htmlFor="image-webdav-url">{t('baseUrl')}</FieldLabel>
        <Input
          id="image-webdav-url"
          value={config.baseUrl}
          placeholder="https://dav.example.com/notes"
          onChange={(event) => void update({ ...config, baseUrl: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="image-webdav-username">{t('username')}</FieldLabel>
        <Input
          id="image-webdav-username"
          value={config.username}
          onChange={(event) => void update({ ...config, username: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="image-webdav-password">{t('password')}</FieldLabel>
        <SecretInput
          id="image-webdav-password"
          value={config.password}
          onChange={(password) => void update({ ...config, password })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="image-webdav-public-url">{t('publicUrl')}</FieldLabel>
        <Input
          id="image-webdav-public-url"
          value={config.publicUrl}
          placeholder="https://images.example.com"
          onChange={(event) => void update({ ...config, publicUrl: event.target.value })}
        />
        <FieldDescription>{t('publicUrlDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="image-webdav-prefix">{t('pathPrefix')}</FieldLabel>
        <Input
          id="image-webdav-prefix"
          value={config.pathPrefix || ''}
          placeholder="images"
          onChange={(event) => void update({ ...config, pathPrefix: event.target.value })}
        />
      </Field>
    </ServiceSettingsCard>
  )
}

export function CustomHttpImageHosting() {
  const t = useTranslations('settings.imageHosting.customHttp')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'customHttpImageConfig',
    DEFAULT_CUSTOM_HTTP_IMAGE_CONFIG,
  )
  const state = useServiceState('custom-http')
  const isComplete = isCustomHttpImageConfigComplete(config)

  useEffect(() => {
    if (!loaded) return
    state.set(isComplete ? SyncStateEnum.success : SyncStateEnum.fail)
  }, [isComplete, loaded, state])

  async function update(next: CustomHttpImageConfig) {
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={isComplete}
      statusMode="configuration"
    >
      <Field>
        <FieldLabel htmlFor="custom-http-url">{t('url')}</FieldLabel>
        <Input
          id="custom-http-url"
          value={config.url}
          placeholder="https://example.com/api/upload"
          onChange={(event) => void update({ ...config, url: event.target.value })}
        />
        <FieldDescription>{t('urlDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{t('method')}</FieldLabel>
        <ResponsiveSelect
          title={t('method')}
          value={config.method}
          onValueChange={value => void update({ ...config, method: value as 'POST' | 'PUT' })}
          options={[
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
          ]}
        />
      </Field>
      {config.method === 'POST' ? (
        <Field>
          <FieldLabel htmlFor="custom-http-file-field">{t('fileField')}</FieldLabel>
          <Input
            id="custom-http-file-field"
            value={config.fileField}
            placeholder="file"
            onChange={(event) => void update({ ...config, fileField: event.target.value })}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="custom-http-headers">{t('headers')}</FieldLabel>
        <Textarea
          id="custom-http-headers"
          value={config.headers}
          placeholder={'{\n  "Authorization": "Bearer token"\n}'}
          onChange={(event) => void update({ ...config, headers: event.target.value })}
        />
        <FieldDescription>{t('headersDesc')}</FieldDescription>
      </Field>
      {config.method === 'POST' ? (
        <Field>
          <FieldLabel htmlFor="custom-http-form-fields">{t('formFields')}</FieldLabel>
          <Textarea
            id="custom-http-form-fields"
            value={config.formFields}
            placeholder={'{\n  "album": "notes"\n}'}
            onChange={(event) => void update({ ...config, formFields: event.target.value })}
          />
          <FieldDescription>{t('formFieldsDesc')}</FieldDescription>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="custom-http-response-path">{t('responseUrlPath')}</FieldLabel>
        <Input
          id="custom-http-response-path"
          value={config.responseUrlPath}
          placeholder="data.url"
          onChange={(event) => void update({ ...config, responseUrlPath: event.target.value })}
        />
        <FieldDescription>{t('responseUrlPathDesc')}</FieldDescription>
      </Field>
    </ServiceSettingsCard>
  )
}

export function CloudinaryImageHosting() {
  const t = useTranslations('settings.imageHosting.cloudinary')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'cloudinaryImageConfig',
    DEFAULT_CLOUDINARY_CONFIG,
  )
  const state = useServiceState('cloudinary')
  const isComplete = isCloudinaryConfigComplete(config)

  useEffect(() => {
    if (!loaded) return
    state.set(isComplete ? SyncStateEnum.success : SyncStateEnum.fail)
  }, [isComplete, loaded, state])

  async function update(next: CloudinaryConfig) {
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={isComplete}
      statusMode="configuration"
    >
      <Field>
        <FieldLabel htmlFor="cloudinary-cloud-name">{t('cloudName')}</FieldLabel>
        <Input
          id="cloudinary-cloud-name"
          value={config.cloudName}
          onChange={(event) => void update({ ...config, cloudName: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="cloudinary-upload-preset">{t('uploadPreset')}</FieldLabel>
        <Input
          id="cloudinary-upload-preset"
          value={config.uploadPreset}
          onChange={(event) => void update({
            ...config,
            uploadPreset: event.target.value,
          })}
        />
        <FieldDescription>{t('uploadPresetDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="cloudinary-folder">{t('folder')}</FieldLabel>
        <Input
          id="cloudinary-folder"
          value={config.folder || ''}
          onChange={(event) => void update({ ...config, folder: event.target.value })}
        />
      </Field>
    </ServiceSettingsCard>
  )
}

export function ImageKitImageHosting() {
  const t = useTranslations('settings.imageHosting.imagekit')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'imageKitImageConfig',
    DEFAULT_IMAGEKIT_CONFIG,
  )
  const state = useServiceState('imagekit')
  const canTest = isImageKitConfigComplete(config)
  const runTest = useCallback(async () => {
    state.set(SyncStateEnum.checking)
    try {
      state.set(await testImageKitConnection(config) ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch {
      state.set(SyncStateEnum.fail)
    }
  }, [config, state])
  useInitialConnectionTest({ loaded, canTest, test: runTest })

  async function update(next: ImageKitConfig) {
    state.set(SyncStateEnum.fail)
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={canTest}
      onTest={runTest}
    >
      <Field>
        <FieldLabel htmlFor="imagekit-private-key">{t('privateKey')}</FieldLabel>
        <SecretInput
          id="imagekit-private-key"
          value={config.privateKey}
          onChange={(privateKey) => void update({ ...config, privateKey })}
        />
        <FieldDescription>{t('privateKeyDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="imagekit-folder">{t('folder')}</FieldLabel>
        <Input
          id="imagekit-folder"
          value={config.folder || ''}
          onChange={(event) => void update({ ...config, folder: event.target.value })}
        />
      </Field>
    </ServiceSettingsCard>
  )
}

export function QiniuImageHosting() {
  const t = useTranslations('settings.imageHosting.qiniu')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'qiniuImageConfig',
    DEFAULT_QINIU_CONFIG,
  )
  const state = useServiceState('qiniu')
  const isComplete = isQiniuConfigComplete(config)

  useEffect(() => {
    if (!loaded) return
    state.set(isComplete ? SyncStateEnum.success : SyncStateEnum.fail)
  }, [isComplete, loaded, state])

  async function update(next: QiniuConfig) {
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={isComplete}
      statusMode="configuration"
    >
      <Field>
        <FieldLabel htmlFor="qiniu-access-key">Access Key</FieldLabel>
        <SecretInput
          id="qiniu-access-key"
          value={config.accessKey}
          onChange={(accessKey) => void update({ ...config, accessKey })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="qiniu-secret-key">Secret Key</FieldLabel>
        <SecretInput
          id="qiniu-secret-key"
          value={config.secretKey}
          onChange={(secretKey) => void update({ ...config, secretKey })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="qiniu-bucket">{t('bucket')}</FieldLabel>
        <Input
          id="qiniu-bucket"
          value={config.bucket}
          onChange={(event) => void update({ ...config, bucket: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="qiniu-public-url">{t('publicUrl')}</FieldLabel>
        <Input
          id="qiniu-public-url"
          value={config.publicUrl}
          placeholder="https://images.example.com"
          onChange={(event) => void update({ ...config, publicUrl: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="qiniu-upload-url">{t('uploadUrl')}</FieldLabel>
        <Input
          id="qiniu-upload-url"
          value={config.uploadUrl}
          placeholder="https://upload.qiniup.com"
          onChange={(event) => void update({ ...config, uploadUrl: event.target.value })}
        />
        <FieldDescription>{t('uploadUrlDesc')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="qiniu-prefix">{t('pathPrefix')}</FieldLabel>
        <Input
          id="qiniu-prefix"
          value={config.pathPrefix || ''}
          onChange={(event) => void update({ ...config, pathPrefix: event.target.value })}
        />
      </Field>
    </ServiceSettingsCard>
  )
}

export function UpyunImageHosting() {
  const t = useTranslations('settings.imageHosting.upyun')
  const { config, loaded, updateConfig } = useStoredImageConfig(
    'upyunImageConfig',
    DEFAULT_UPYUN_CONFIG,
  )
  const state = useServiceState('upyun')
  const canTest = isUpyunConfigComplete(config)
  const runTest = useCallback(async () => {
    state.set(SyncStateEnum.checking)
    try {
      state.set(await testUpyunConnection(config) ? SyncStateEnum.success : SyncStateEnum.fail)
    } catch {
      state.set(SyncStateEnum.fail)
    }
  }, [config, state])
  useInitialConnectionTest({ loaded, canTest, test: runTest })

  async function update(next: UpyunConfig) {
    state.set(SyncStateEnum.fail)
    await updateConfig(next)
  }

  return (
    <ServiceSettingsCard
      title={t('title')}
      description={t('description')}
      state={state.value}
      canTest={canTest}
      onTest={runTest}
    >
      <Field>
        <FieldLabel htmlFor="upyun-bucket">{t('bucket')}</FieldLabel>
        <Input
          id="upyun-bucket"
          value={config.bucket}
          onChange={(event) => void update({ ...config, bucket: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="upyun-operator">{t('operator')}</FieldLabel>
        <Input
          id="upyun-operator"
          value={config.operator}
          onChange={(event) => void update({ ...config, operator: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="upyun-password">{t('password')}</FieldLabel>
        <SecretInput
          id="upyun-password"
          value={config.password}
          onChange={(password) => void update({ ...config, password })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="upyun-public-url">{t('publicUrl')}</FieldLabel>
        <Input
          id="upyun-public-url"
          value={config.publicUrl}
          placeholder="https://images.example.com"
          onChange={(event) => void update({ ...config, publicUrl: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="upyun-prefix">{t('pathPrefix')}</FieldLabel>
        <Input
          id="upyun-prefix"
          value={config.pathPrefix || ''}
          onChange={(event) => void update({ ...config, pathPrefix: event.target.value })}
        />
      </Field>
    </ServiceSettingsCard>
  )
}

function useServiceState(
  provider:
    | 'lsky'
    | 'webdav'
    | 'custom-http'
    | 'cloudinary'
    | 'imagekit'
    | 'qiniu'
    | 'upyun',
) {
  const value = useImageStore((store) => store.serviceStates[provider] ?? SyncStateEnum.fail)
  const setServiceState = useImageStore((store) => store.setServiceState)
  const set = useCallback((state: SyncStateEnum) => {
    setServiceState(provider, state)
  }, [provider, setServiceState])

  return useMemo(() => ({
    value,
    set,
  }), [set, value])
}
